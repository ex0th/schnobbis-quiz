// Startet den echten Server und spielt mit WebSocket-Clients (1 Host + 3 Handys) jeden Modus durch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server/index.js';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { suggestCorrect } from '../server/util.js';

let app, base, wsUrl, dataDir, cfg;

async function start() {
  app = createServer(cfg, openDb(cfg.dataDir));
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const { port } = app.server.address();
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-'));
  cfg = { ...config, dataDir, adminToken: 'geheim', port: 0 };
  await start();
});
after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

class Client {
  constructor(code, token, as) {
    this.view = null;
    this.events = [];
    this.errors = [];
    this.ws = new WebSocket(wsUrl);
    this.waiters = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'hello', code, token, as })));
      this.ws.on('error', reject);
      this.ws.on('message', d => {
        const m = JSON.parse(d.toString());
        if (m.t === 'hello') { this.role = m.role; this.pid = m.pid; resolve(this); }
        if (m.t === 'joined') { this.token = m.token; this.pid = m.pid; this.role = 'player'; }
        if (m.t === 'state') this.view = m.view;
        if (m.t === 'event') this.events.push(m);
        if (m.t === 'error') this.errors.push(m.msg);
        this.waiters = this.waiters.filter(w => !w());
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  act(a, extra = {}) { this.send({ t: 'act', a, ...extra }); }
  until(pred, ms = 2000) {
    return new Promise((resolve, reject) => {
      const check = () => { let ok = false; try { ok = !!(this.view && pred(this.view)); } catch {} if (ok) { resolve(this.view); return true; } return false; };
      if (check()) return;
      const t = setTimeout(() => reject(new Error('Timeout; letzter Zustand: ' + JSON.stringify(this.view?.game?.phase ?? this.view?.status) + ' Fehler: ' + this.errors.join('; '))), ms);
      this.waiters.push(() => { if (check()) { clearTimeout(t); return true; } return false; });
    });
  }
  close() { this.ws.close(); }
}

async function newRoom() {
  const r = await fetch(`${base}/api/rooms`, { method: 'POST' }).then(r => r.json());
  const host = await new Client(r.code, r.hostToken).ready;
  assert.equal(host.role, 'host');
  const phones = [];
  for (const name of ['Anna', 'Ben', 'Clara']) {
    const c = await new Client(r.code).ready;
    assert.equal(c.role, 'guest');
    c.send({ t: 'join', name, emoji: '🦊' });
    await c.until(v => v.you.role === 'player');
    phones.push(c);
  }
  await host.until(v => v.players.length === 3);
  return { code: r.code, hostToken: r.hostToken, host, phones };
}

const ids = phones => phones.map(p => p.pid);

test('Antwort-Vorschläge für „Alle tippen“', () => {
  assert.ok(suggestCorrect('canberra', 'Canberra'));
  assert.ok(suggestCorrect('Canbera', 'Canberra'));
  assert.ok(suggestCorrect('amazonas', 'Nil (Amazonas auch gelten lassen – je nach Messung umstritten)'));
  assert.ok(suggestCorrect('Einstein', 'Albert Einstein'));
  assert.ok(suggestCorrect('da vinci', 'Leonardo da Vinci'));
  assert.ok(suggestCorrect('1440', '1.440'));
  assert.ok(!suggestCorrect('1441', '1.440'));
  assert.ok(!suggestCorrect('1990x', '1990'));
  assert.ok(!suggestCorrect('Paris', 'Rom'));
  assert.ok(suggestCorrect('Haut', 'Die Haut'));
});

test('Klassik über WebSockets: Projektion, Rollen, Statistik', async () => {
  const { host, phones } = await newRoom();
  // Emojis sind eindeutig, obwohl alle 🦊 wollten
  assert.equal(new Set(host.view.players.map(p => p.emoji)).size, 3);
  host.act('settings', { settings: { mode: 'klassik', perPlayer: 1, steal: true, finale: false } });
  await host.until(v => v.settings.perPlayer === 1);
  // Spieler dürfen nicht starten
  phones[0].act('start');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(host.view.status, 'lobby');
  host.act('start');
  await host.until(v => v.status === 'playing');
  await phones[0].until(v => v.game?.active === phones[0].pid);
  host.act('show');
  const pv = await phones[1].until(v => v.game.phase === 'question');
  assert.ok(pv.game.question.text, 'Spieler sieht die Frage');
  assert.equal(pv.game.question.answer, null, 'Spieler sieht keine Lösung');
  const hv = await host.until(v => v.game.phase === 'question');
  assert.ok(hv.game.question.answer, 'Host sieht Lösung');
  // Spieler darf nicht werten
  phones[1].act('judge', { ok: true });
  await phones[1].until(() => phones[1].errors.length > 0);
  host.act('reveal');
  await phones[1].until(v => v.game.phase === 'revealed' && v.game.question.answer);
  host.act('judge', { ok: false });
  await host.until(v => v.game.phase === 'steal');
  host.act('steal', { pid: phones[2].pid });
  for (let i = 0; i < 2; i++) {
    await host.until(v => v.game.phase === 'intro' && v.game.idx === i + 1);
    host.act('show'); host.act('reveal'); host.act('judge', { ok: true });
  }
  const end = await host.until(v => v.status === 'finished');
  assert.equal(end.game.ranking[0].score, 2); // Clara: geklaut + eigene
  assert.ok(end.game.gameId);
  const stats = await fetch(`${base}/api/stats`).then(r => r.json());
  assert.equal(stats.overview.games, 1);
  assert.equal(stats.leaderboard[0].name, 'Clara');
  // Rückgängig nach Spielende → Statistik wieder weg
  host.act('undo');
  await host.until(v => v.status === 'playing');
  assert.equal((await fetch(`${base}/api/stats`).then(r => r.json())).overview.games, 0);
  host.act('judge', { ok: true });
  await host.until(v => v.status === 'finished');
  assert.equal((await fetch(`${base}/api/stats`).then(r => r.json())).overview.games, 1);
  [host, ...phones].forEach(c => c.close());
});

test('Buzzer über WebSockets: schnellster gewinnt, Sperre, Timer', async () => {
  const { host, phones } = await newRoom();
  host.act('settings', { settings: { mode: 'buzzer', questions: 2, timer: 15, finale: false } });
  host.act('start');
  await host.until(v => v.status === 'playing');
  host.act('show');
  await phones[0].until(v => v.game.phase === 'question');
  phones[1].act('buzz');
  phones[2].act('buzz');
  const hv = await host.until(v => v.game.phase === 'buzzed');
  assert.equal(hv.game.buzz.pid, phones[1].pid);
  const p0 = await phones[0].until(v => v.game.phase === 'buzzed');
  assert.equal(p0.game.question.answer, null, 'Lösung bleibt geheim, während jemand antwortet');
  host.act('judge', { ok: false });
  await host.until(v => v.game.phase === 'question' && v.game.locked.includes(phones[1].pid) && v.game.deadline > 0);
  phones[1].act('buzz'); // gesperrt → ignoriert
  phones[2].act('buzz');
  await host.until(v => v.game.phase === 'buzzed' && v.game.buzz.pid === phones[2].pid);
  host.act('judge', { ok: true });
  const rv = await phones[0].until(v => v.game.phase === 'revealed');
  assert.equal(rv.game.result.winner, phones[2].pid);
  assert.ok(rv.game.question.answer);
  host.act('next');
  host.act('show');
  await host.until(v => v.game.idx === 1 && v.game.phase === 'question');
  host.act('end');
  await host.until(v => v.status === 'finished');
  [host, ...phones].forEach(c => c.close());
});

test('Alle tippen: Einsammeln, wenn alle Handys abgegeben haben; Antworten erst nach Auflösung sichtbar', async () => {
  const { host, phones } = await newRoom();
  host.act('settings', { settings: { mode: 'alle', questions: 1, finale: false, speedBonus: true } });
  host.act('start');
  await host.until(v => v.status === 'playing');
  host.act('show');
  const hv = await host.until(v => v.game.phase === 'question');
  const sol = hv.game.question.answer;
  phones[0].act('submit', { text: sol });
  phones[1].act('submit', { text: 'falsch' });
  const pv = await phones[2].until(v => v.game.submitted?.length === 2);
  assert.ok(!JSON.stringify(pv).includes('falsch'), 'Andere Antworten sind vor der Auflösung geheim');
  phones[2].act('submit', { text: sol });
  const rv = await host.until(v => v.game.phase === 'review');
  assert.deepEqual(rv.game.review.map(r => r.suggest), [true, false, true]);
  host.act('score');
  const res = await phones[1].until(v => v.game.phase === 'revealed');
  assert.equal(res.game.result.answers.find(a => a.pid === phones[1].pid).text, 'falsch');
  assert.equal(res.game.result.fastest, phones[0].pid);
  host.act('next');
  const end = await host.until(v => v.status === 'finished');
  assert.equal(end.game.ranking[0].pid, phones[0].pid);
  assert.equal(end.game.ranking[0].score, 2);
  [host, ...phones].forEach(c => c.close());
});

test('Reconnect, Wiedereinstieg mit neuem Gerät und Server-Neustart mitten im Spiel', async () => {
  const { code, hostToken, host, phones } = await newRoom();
  host.act('settings', { settings: { mode: 'klassik', perPlayer: 2 } });
  host.act('start');
  await host.until(v => v.status === 'playing');
  host.act('show');
  await host.until(v => v.game.phase === 'question');
  // Anna lädt die Seite neu (gleiches Token)
  const annaTok = phones[0].token;
  phones[0].close();
  await host.until(v => v.players.find(p => p.name === 'Anna').connected === false);
  const anna2 = await new Client(code, annaTok).ready;
  assert.equal(anna2.role, 'player');
  await host.until(v => v.players.find(p => p.name === 'Anna').connected === true);
  // Ben verliert sein Handy → neues Gerät, Wiedereinstieg über „Ich bin Ben“
  phones[1].close();
  await host.until(v => v.players.find(p => p.name === 'Ben').connected === false);
  const ben2 = await new Client(code).ready;
  await ben2.until(v => v.reclaimable?.length === 1);
  ben2.send({ t: 'reclaim', pid: phones[1].pid });
  await ben2.until(v => v.you.role === 'player' && v.game);
  // Server-Neustart: Spiel ist wieder da
  [host, anna2, ben2, phones[2]].forEach(c => c.close());
  await app.close();
  await start();
  const host2 = await new Client(code, hostToken).ready;
  assert.equal(host2.role, 'host');
  const v = await host2.until(v => v.status === 'playing');
  assert.equal(v.game.phase, 'question');
  assert.equal(v.players.length, 3);
  host2.close();
});

test('Admin-API: Schutz, Anlegen, Bulk-Import, Export', async () => {
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer geheim' };
  assert.equal((await fetch(`${base}/api/questions`)).status, 401);
  assert.equal((await fetch(`${base}/api/questions`, { headers: { Authorization: 'Bearer falsch' } })).status, 401);
  const q = await fetch(`${base}/api/questions`, { method: 'POST', headers: H, body: JSON.stringify({ question: 'Wie heißt die Hauptstadt von Bayern?', answer: 'München', category: 'Deutschland', difficulty: 1, source: 'test' }) }).then(r => r.json());
  assert.ok(q.id > 0);
  const bad = await fetch(`${base}/api/questions`, { method: 'POST', headers: H, body: JSON.stringify({ question: 'x' }) });
  assert.equal(bad.status, 400);
  const bulk = await fetch(`${base}/api/questions`, { method: 'POST', headers: H, body: JSON.stringify([
    { question: 'Neue Kategorie-Frage?', answer: 'Ja', category: 'Popkultur', difficulty: 2 },
    { question: 'Kaputt', answer: '', category: 'X', difficulty: 9 },
  ]) }).then(r => r.json());
  assert.equal(bulk.created, 1);
  assert.equal(bulk.errors.length, 1);
  const meta = await fetch(`${base}/api/meta`).then(r => r.json());
  assert.ok(meta.categories.some(c => c.name === 'Popkultur'));
  const upd = await fetch(`${base}/api/questions/${q.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ active: false }) }).then(r => r.json());
  assert.equal(upd.active, 0);
  const exp = await fetch(`${base}/api/export`, { headers: H }).then(r => r.json());
  const cat = JSON.parse(fs.readFileSync(cfg.seedFile, 'utf8'));
  assert.equal(exp.questions.length, cat.questions.length + 2);
  assert.equal(exp.pairs.length, cat.pairs.length);
  // Re-Import des Exports ändert nichts an der Anzahl
  const imp = await fetch(`${base}/api/import`, { method: 'POST', headers: H, body: JSON.stringify(exp) }).then(r => r.json());
  assert.equal(imp.created, 0);
  assert.equal(imp.updated, cat.questions.length + 2);
});

test('Statische Auslieferung: Seiten, Service Worker mit Build-ID, Sicherheits-Header', async () => {
  for (const p of ['/', '/join/ABCD', '/host/ABCD', '/tv/ABCD', '/stats', '/stats/player/1', '/admin']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  }
  const sw = await (await fetch(base + '/sw.js')).text();
  assert.ok(!sw.includes('__BUILD_ID__') && !sw.includes("'__ASSETS__'"));
  assert.match(sw, /\/icons\/icon-192\.png/);
  assert.equal((await fetch(base + '/gibtsnicht')).status, 404);
  assert.equal((await fetch(base + '/../server/index.js')).status, 404);
  const qr = await fetch(`${base}/api/rooms/ABCD/qr.svg`);
  assert.equal(qr.status, 404);
});
