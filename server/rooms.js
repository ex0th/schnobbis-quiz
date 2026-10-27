// Spielräume: Codes, Geräte, Reconnect, Persistenz, WebSocket-Protokoll
import { token, roomCode, CODE_RE, safeEqual, nameKey, shuffle } from './util.js';
import { act, createGame, sanitizeSettings, DEFAULT_SETTINGS, addLatePlayer, usesTurns } from './engine.js';
import { buildView } from './view.js';

export const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐧', '🦄', '🐯', '🐨', '🐵', '🦉', '🐢', '🐷', '🐰', '🦖', '🐳'];
export const COLORS = ['#EDBABC', '#598099', '#BB7B85', '#E8CF97', '#313857', '#9DBACB', '#D6969E', '#7C87AE', '#C7A2B8', '#8FAE9F', '#E3A587', '#6E9BB5'];
const MAX_PLAYERS = 16;

const HOST_ACTIONS_LOBBY = new Set(['settings', 'addLocal', 'remove', 'move', 'shuffle', 'emoji', 'rename', 'addSelf', 'start', 'resetPool']);
const GAME_ACTIONS = new Set(['show', 'reveal', 'joker', 'judge', 'steal', 'next', 'buzz', 'submit', 'mark', 'score', 'undo', 'adjust', 'end']);

function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

export class RoomManager {
  constructor({ db, qs, stats, config, now = () => Date.now(), log = console }) {
    this.db = db;
    this.qs = qs;
    this.stats = stats;
    this.config = config;
    this.now = now;
    this.log = log;
    this.rooms = new Map();
    this.saveTimers = new Map();
    this.clients = new Map(); // code → Set<client>
  }

  // ---------- Persistenz ----------
  loadPersisted() {
    const cutoff = this.now() - this.config.roomTtlHours * 3600e3;
    this.db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(cutoff);
    for (const row of this.db.prepare('SELECT code, state FROM rooms').all()) {
      try {
        const room = JSON.parse(row.state);
        room.hostOnline = false;
        for (const p of room.players) p.connected = false;
        this.rooms.set(room.code, room);
        this.schedule(room);
      } catch (e) {
        this.log.warn?.(`Raum ${row.code} konnte nicht geladen werden: ${e.message}`);
      }
    }
    return this.rooms.size;
  }

  persist(room, immediate = false) {
    const write = () => {
      this.saveTimers.delete(room.code);
      if (!this.rooms.has(room.code)) return;
      const { timer, ...state } = room;
      this.db.prepare('INSERT INTO rooms (code, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
        .run(room.code, JSON.stringify(state), room.updatedAt);
    };
    clearTimeout(this.saveTimers.get(room.code));
    if (immediate) write();
    else this.saveTimers.set(room.code, setTimeout(write, 250));
  }

  flushAll() {
    for (const [code, t] of this.saveTimers) {
      clearTimeout(t);
      const room = this.rooms.get(code);
      if (room) this.persist(room, true);
    }
  }

  cleanup() {
    const cutoff = this.now() - this.config.roomTtlHours * 3600e3;
    for (const room of this.rooms.values()) {
      const active = this.clients.get(room.code)?.size;
      if (room.updatedAt < cutoff && !active) this.deleteRoom(room.code);
    }
  }

  deleteRoom(code) {
    const room = this.rooms.get(code);
    if (room) clearTimeout(room.timer);
    this.rooms.delete(code);
    this.db.prepare('DELETE FROM rooms WHERE code = ?').run(code);
  }

  // ---------- Räume ----------
  create() {
    if (this.rooms.size >= this.config.maxRooms) {
      this.cleanup();
      if (this.rooms.size >= this.config.maxRooms) throw new Error('Zu viele offene Spiele – bitte später nochmal');
    }
    let code;
    do { code = roomCode(); } while (this.rooms.has(code));
    const room = {
      code,
      hostToken: token(),
      hostPid: null,
      hostOnline: false,
      status: 'lobby',
      settings: { ...DEFAULT_SETTINGS },
      players: [],
      nextId: 1,
      game: null,
      recordId: null,
      records: [],
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.rooms.set(code, room);
    this.persist(room, true);
    return room;
  }

  get(code) {
    code = String(code || '').toUpperCase();
    return CODE_RE.test(code) ? this.rooms.get(code) || null : null;
  }

  info(code) {
    const room = this.get(code);
    if (!room) return null;
    return {
      code: room.code, status: room.status, mode: room.settings.mode, players: room.players.length,
      lateJoin: room.status === 'playing' && !usesTurns(room.settings.mode),
    };
  }

  addPlayer(room, { name, emoji, kind }) {
    name = cleanName(name);
    if (!name) throw new Error('Bitte einen Namen eingeben');
    if (room.players.length >= MAX_PLAYERS) throw new Error(`Maximal ${MAX_PLAYERS} Spieler`);
    if (room.players.some(p => nameKey(p.name) === nameKey(name))) throw new Error(`„${name}“ gibt es schon – nimm einen anderen Namen`);
    const usedE = new Set(room.players.map(p => p.emoji));
    if (!EMOJIS.includes(emoji) || usedE.has(emoji)) emoji = EMOJIS.find(e => !usedE.has(e)) || EMOJIS[room.players.length % EMOJIS.length];
    const usedC = new Set(room.players.map(p => p.color));
    const color = COLORS.find(c => !usedC.has(c)) || COLORS[room.players.length % COLORS.length];
    const p = { id: room.nextId++, name, emoji, color, kind, token: kind === 'device' ? token() : null, connected: false };
    room.players.push(p);
    return p;
  }

  // ---------- Clients ----------
  clientsOf(code) {
    let s = this.clients.get(code);
    if (!s) this.clients.set(code, (s = new Set()));
    return s;
  }

  refreshPresence(room) {
    const cs = [...this.clientsOf(room.code)];
    room.hostOnline = cs.some(c => c.role === 'host');
    for (const p of room.players) {
      if (p.kind !== 'device') continue;
      p.connected = cs.some(c => c.pid === p.id);
    }
  }

  devicePids(room) {
    return new Set(room.players.filter(p => p.kind === 'device' && p.connected).map(p => p.id));
  }

  send(client, msg) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  }

  broadcast(room, events = []) {
    const now = this.now();
    const names = new Map(room.players.map(p => [p.id, p.name]));
    const evs = events.map(e => ({ ...e, toast: e.toast ? e.toast.replace(/\{(\d+)\}/g, (_, id) => names.get(+id) ?? '?') : undefined }));
    for (const c of this.clientsOf(room.code)) {
      if (!c.role || c.role === 'guest') {
        this.send(c, { t: 'state', view: this.guestView(room) });
        continue;
      }
      this.send(c, { t: 'state', view: buildView(room, { role: c.role, pid: c.pid }, this.qs, now) });
      for (const e of evs) this.send(c, { t: 'event', ...e });
    }
  }

  guestView(room) {
    return {
      code: room.code,
      status: room.status,
      you: { role: 'guest', pid: null },
      players: room.players.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, kind: p.kind, connected: p.kind === 'local' || p.connected })),
      takenEmojis: room.players.map(p => p.emoji),
      lateJoin: room.status === 'lobby' || (room.status === 'playing' && !usesTurns(room.settings.mode)),
      // Wiedereinstieg: Handy-Spieler, deren Gerät gerade nicht verbunden ist
      reclaimable: room.status === 'lobby' ? [] : room.players.filter(p => p.kind === 'device' && !p.connected && p.id !== room.hostPid).map(p => p.id),
      serverNow: this.now(),
    };
  }

  touch(room, events = []) {
    room.updatedAt = this.now();
    this.refreshPresence(room);
    this.persist(room);
    this.schedule(room);
    this.broadcast(room, events);
  }

  // Countdown: Buzzer und „Alle tippen“ reagieren serverseitig auf das Zeitende
  schedule(room) {
    clearTimeout(room.timer);
    room.timer = null;
    const g = room.game;
    if (!g || g.finished || !g.deadline || usesTurns(g.mode) || g.phase !== 'question') return;
    const ms = Math.max(0, g.deadline - this.now()) + 30;
    room.timer = setTimeout(() => {
      try {
        const events = act(g, { a: 'timeout' }, { role: 'system' }, { qs: this.qs, now: this.now(), devicePids: this.devicePids(room) });
        if (events.length) this.touch(room, events);
      } catch (e) {
        this.log.warn?.(`timeout ${room.code}: ${e.message}`);
      }
    }, ms);
    room.timer.unref?.();
  }

  // ---------- WebSocket ----------
  connection(ws) {
    const client = { ws, room: null, role: null, pid: null, bucket: 20, last: this.now() };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      // Ratenbegrenzung: 20 Nachrichten Puffer, 10 pro Sekunde Nachschub
      const now = this.now();
      client.bucket = Math.min(20, client.bucket + ((now - client.last) / 1000) * 10);
      client.last = now;
      if (client.bucket < 1) return;
      client.bucket--;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      try {
        this.handle(client, msg);
      } catch (e) {
        this.send(client, { t: 'error', msg: e.message, ref: msg.ref });
      }
    });
    ws.on('close', () => {
      if (client.room) {
        this.clientsOf(client.room.code).delete(client);
        const room = this.rooms.get(client.room.code);
        if (room) { this.refreshPresence(room); this.broadcast(room); }
      }
    });
  }

  heartbeat(wss) {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }

  handle(client, msg) {
    if (msg.t === 'ping') return this.send(client, { t: 'pong', serverNow: this.now() });

    if (msg.t === 'hello') {
      const room = this.get(msg.code);
      if (!room) return this.send(client, { t: 'gone', msg: 'Dieses Spiel gibt es nicht (mehr).' });
      if (client.room && client.room !== room) this.clientsOf(client.room.code).delete(client);
      client.room = room;
      client.role = 'guest';
      client.pid = null;
      if (msg.token && safeEqual(msg.token, room.hostToken)) {
        client.role = 'host';
        client.pid = room.hostPid;
      } else if (msg.token) {
        const p = room.players.find(x => x.token && safeEqual(x.token, msg.token));
        if (p) { client.role = 'player'; client.pid = p.id; }
      }
      if (client.role === 'guest' && msg.as === 'tv') client.role = 'tv';
      this.clientsOf(room.code).add(client);
      this.send(client, { t: 'hello', role: client.role, pid: client.pid, code: room.code });
      this.refreshPresence(room);
      this.broadcast(room);
      return;
    }

    const room = client.room;
    if (!room || !this.rooms.has(room.code)) throw new Error('Nicht mit einem Spiel verbunden');

    if (msg.t === 'join') {
      if (client.role !== 'guest' && client.role !== 'tv') throw new Error('Du bist schon dabei');
      const late = room.status === 'playing' && room.game && !usesTurns(room.game.mode);
      if (room.status !== 'lobby' && !late) throw new Error('Das Spiel läuft schon. Warte auf die nächste Runde – der Spielleiter kann dich dann aufnehmen.');
      const p = this.addPlayer(room, { name: msg.name, emoji: msg.emoji, kind: 'device' });
      if (late) addLatePlayer(room.game, p);
      client.role = 'player';
      client.pid = p.id;
      this.send(client, { t: 'joined', code: room.code, token: p.token, pid: p.id });
      this.touch(room, [{ fx: 'join', toast: `👋 ${p.name} ist dabei` }]);
      return;
    }

    if (msg.t === 'reclaim') {
      if (client.role !== 'guest') throw new Error('Du bist schon dabei');
      const p = room.players.find(x => x.id === +msg.pid && x.kind === 'device' && x.id !== room.hostPid);
      if (!p) throw new Error('Spieler nicht gefunden');
      this.refreshPresence(room);
      if (p.connected) throw new Error(`${p.name} ist gerade mit einem anderen Gerät verbunden`);
      p.token = token(); // altes Gerät fliegt raus
      client.role = 'player';
      client.pid = p.id;
      this.send(client, { t: 'joined', code: room.code, token: p.token, pid: p.id });
      this.touch(room, [{ toast: `🔌 ${p.name} ist wieder da` }]);
      return;
    }

    if (msg.t === 'profile') {
      if (client.role !== 'player' || room.status !== 'lobby') throw new Error('Geht nur in der Lobby');
      const p = room.players.find(x => x.id === client.pid);
      if (msg.name !== undefined) {
        const name = cleanName(msg.name);
        if (!name) throw new Error('Bitte einen Namen eingeben');
        if (room.players.some(x => x !== p && nameKey(x.name) === nameKey(name))) throw new Error(`„${name}“ gibt es schon`);
        p.name = name;
      }
      if (msg.emoji !== undefined) {
        if (!EMOJIS.includes(msg.emoji)) throw new Error('Unbekanntes Emoji');
        if (room.players.some(x => x !== p && x.emoji === msg.emoji)) throw new Error('Das Tier ist schon vergeben');
        p.emoji = msg.emoji;
      }
      this.touch(room);
      return;
    }

    if (msg.t === 'leave') {
      if (client.role === 'player' && room.status === 'lobby') {
        room.players = room.players.filter(x => x.id !== client.pid);
      }
      client.role = 'guest';
      client.pid = null;
      this.touch(room);
      return;
    }

    if (msg.t === 'act') {
      const a = String(msg.a || '');
      if (client.role === 'host' && room.status === 'lobby' && HOST_ACTIONS_LOBBY.has(a)) return this.lobbyAction(client, room, a, msg);
      if (client.role === 'host' && a === 'rematch') return this.rematch(room, true);
      if (client.role === 'host' && a === 'toLobby') return this.rematch(room, false);
      if (client.role === 'host' && a === 'closeRoom') {
        for (const c of this.clientsOf(room.code)) this.send(c, { t: 'gone', msg: 'Der Spielleiter hat das Spiel geschlossen.' });
        this.deleteRoom(room.code);
        return;
      }
      if (GAME_ACTIONS.has(a)) return this.gameAction(client, room, a, msg);
      throw new Error('Unbekannte Aktion');
    }
    throw new Error('Unbekannte Nachricht');
  }

  lobbyAction(client, room, a, msg) {
    const find = pid => {
      const p = room.players.find(x => x.id === +pid);
      if (!p) throw new Error('Spieler nicht gefunden');
      return p;
    };
    const events = [];
    switch (a) {
      case 'settings':
        room.settings = sanitizeSettings({ ...room.settings, ...msg.settings }, this.qs.categories().map(c => c.name));
        break;
      case 'addLocal': {
        const p = this.addPlayer(room, { name: msg.name, emoji: msg.emoji, kind: 'local' });
        events.push({ fx: 'join' });
        void p;
        break;
      }
      case 'addSelf': {
        if (room.hostPid) throw new Error('Du spielst schon mit');
        const p = this.addPlayer(room, { name: msg.name, emoji: msg.emoji, kind: 'device' });
        p.token = null; // Der Spielleiter nutzt sein Host-Token
        room.hostPid = p.id;
        for (const c of this.clientsOf(room.code)) if (c.role === 'host') c.pid = p.id;
        break;
      }
      case 'remove': {
        const p = find(msg.pid);
        room.players = room.players.filter(x => x !== p);
        if (room.hostPid === p.id) {
          room.hostPid = null;
          for (const c of this.clientsOf(room.code)) if (c.role === 'host') c.pid = null;
        }
        for (const c of this.clientsOf(room.code)) {
          if (c.role === 'player' && c.pid === p.id) {
            c.role = 'guest'; c.pid = null;
            this.send(c, { t: 'kicked', msg: 'Der Spielleiter hat dich aus dem Spiel genommen.' });
          }
        }
        break;
      }
      case 'move': {
        const i = room.players.findIndex(x => x.id === +msg.pid), j = i + (Math.sign(+msg.d) || 0);
        if (i < 0 || j < 0 || j >= room.players.length) return;
        [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
        break;
      }
      case 'shuffle':
        room.players = shuffle(room.players);
        break;
      case 'emoji': {
        const p = find(msg.pid);
        const used = new Set(room.players.filter(x => x !== p).map(x => x.emoji));
        let k = EMOJIS.indexOf(p.emoji);
        for (let n = 0; n < EMOJIS.length; n++) { k = (k + 1) % EMOJIS.length; if (!used.has(EMOJIS[k])) break; }
        p.emoji = EMOJIS[k];
        break;
      }
      case 'rename': {
        const p = find(msg.pid);
        const name = cleanName(msg.name);
        if (!name) throw new Error('Bitte einen Namen eingeben');
        if (room.players.some(x => x !== p && nameKey(x.name) === nameKey(name))) throw new Error(`„${name}“ gibt es schon`);
        p.name = name;
        break;
      }
      case 'resetPool':
        this.qs.resetPlayed();
        events.push({ toast: 'Fragen-Pool zurückgesetzt' });
        break;
      case 'start':
        this.startGame(room);
        events.push({ fx: 'start' });
        break;
    }
    this.touch(room, events);
  }

  startGame(room) {
    room.settings = sanitizeSettings(room.settings, this.qs.categories().map(c => c.name));
    room.game = createGame(room.players, room.settings, { qs: this.qs, now: this.now() });
    room.status = 'playing';
    room.recordId = null;
    room.records = [];
  }

  rematch(room, startNow) {
    if (room.status === 'playing' && room.game && !room.game.finished && startNow) throw new Error('Das Spiel läuft noch');
    room.game = null;
    room.status = 'lobby';
    room.recordId = null;
    room.records = [];
    if (startNow) this.startGame(room);
    this.touch(room, startNow ? [{ fx: 'start' }] : []);
  }

  gameAction(client, room, a, msg) {
    const g = room.game;
    if (!g) throw new Error('Es läuft kein Spiel');
    if (client.role !== 'host' && client.role !== 'player') throw new Error('Du spielst nicht mit');
    const actor = { role: client.role === 'host' ? 'host' : 'player', pid: client.pid };
    const action = { a };
    for (const k of ['ok', 'pid', 'd', 'text']) if (msg[k] !== undefined) action[k] = msg[k];
    if (action.pid !== undefined && action.pid !== null) action.pid = +action.pid;
    // Spielleiter, der selbst mitspielt: Buzzer/Antworten gelten für seinen Spieler
    const wasFinished = g.finished;
    const events = act(g, action, actor, { qs: this.qs, now: this.now(), devicePids: this.devicePids(room) });
    this.afterChange(room, wasFinished);
    this.touch(room, events);
  }

  afterChange(room, wasFinished) {
    const g = room.game;
    if (g.finished) {
      room.status = 'finished';
      try {
        room.recordId = this.stats.record(room);
        room.records = this.stats.recordsFor(room);
      } catch (e) {
        this.log.error?.(`Statistik konnte nicht gespeichert werden: ${e.message}`);
      }
    } else if (wasFinished) {
      room.status = 'playing';
      this.stats.unrecord(room.recordId);
      room.recordId = null;
      room.records = [];
    }
  }
}
