// Spiel-Controller: Verbindung, Zustand, Rendern je Rolle, Aktionen
import { $app, patch, toast, openSheet, updateSheet, closeSheet, sheetOpen, buzz, esc, copyText } from '../lib/dom.js';
import { Conn } from '../lib/net.js';
import { store } from '../lib/store.js';
import { sfx, soundOn, setSound, unlockAudio } from '../lib/sfx.js';
import { confetti, stopConfetti, keepAwake } from '../lib/fx.js';
import { meta } from '../meta.js';
import { makeCtx, scoreSheet } from './game-common.js';
import { hostLobby, hostPlay, hostEnd } from './game-host.js';
import { joinScreen, playerLobby, playerPlay, playerEnd } from './game-player.js';
import { tvScreen } from './game-tv.js';

export function mount({ code, as }, { navigate }) {
  const sess = store.session(code);
  const token = as === 'tv' ? null : sess?.token || null;
  let view = null;
  let gone = null;
  let lastKey = '';
  let lastEnd = false;
  let timerInt = null;
  let lastTick = null;
  let timeupFor = 0;
  let sheet = false;
  const local = {
    sound: soundOn(),
    catsOpen: false,
    peek: false,
    addSelf: false,
    editProfile: false,
    lastName: store.get('lastName', ''),
    emoji: store.get('lastEmoji', null),
  };

  document.body.classList.toggle('tv-mode', as === 'tv');

  const conn = new Conn({
    code, token, as: as === 'tv' ? 'tv' : undefined,
    onHello(m) {
      if (m.role === 'host') store.setSession(code, { role: 'host', token: conn.token });
      else if (m.role === 'player') store.setSession(code, { role: 'player', token: conn.token, pid: m.pid });
      else if (m.role === 'guest' && sess && as !== 'tv') store.dropSession(code);
      // Host-Link auf einem Gerät ohne Host-Token → normale Beitrittsseite
      if (as === 'host' && m.role !== 'host') {
        history.replaceState({}, '', `/join/${code}`);
        if (sess?.role === 'host') toast('Auf diesem Gerät bist du nicht Spielleiter');
      }
      if (as === 'player' && m.role === 'host') history.replaceState({}, '', `/host/${code}`);
    },
    onJoined(m) {
      store.setSession(code, { role: 'player', token: m.token, pid: m.pid });
      sfx.join();
    },
    onState(v) {
      const prev = view;
      view = v;
      effects(prev, v);
      render();
    },
    onEvent(e) { handleEvent(e); },
    onError(msg) { toast('⚠️ ' + msg, 3200); },
    onGone(msg) {
      store.dropSession(code);
      gone = msg;
      render();
    },
    onKicked(msg) {
      store.dropSession(code);
      toast(msg, 4000);
    },
  });

  // ---------- Effekte bei Zustandswechseln (Vibration „Du bist dran“ etc.) ----------
  function effects(prev, v) {
    const g = v.game, pg = prev?.game;
    const me = v.you.pid;
    if (v.you.role === 'player' && g && !g.finished) {
      const myTurnNow = g.active === me && (g.phase === 'intro' || g.phase === 'question');
      const myTurnBefore = pg && pg.active === me && pg.idx === g.idx && (pg.phase === 'intro' || pg.phase === 'question');
      if (myTurnNow && !myTurnBefore) { buzz([60, 40, 60]); sfx.turn(); }
      if (g.mode !== 'klassik' && g.mode !== 'duell' && g.phase === 'question' && pg?.phase === 'intro') buzz(40);
    }
    if (g && pg && (g.idx !== pg.idx || g.phase !== pg.phase)) local.peek = false;
    if (v.status === 'lobby') local.peek = false;
  }

  function handleEvent(e) {
    const role = view?.you.role;
    if (e.toast) toast(e.toast);
    const fx = e.fx;
    if (!fx) return;
    if (fx === 'buzz') {
      if (e.buzzer === view?.you.pid) buzz([120]);
      sfx.buzz();
      return;
    }
    // Ticks und Timeup nur Host/TV (sonst piept es aus allen Ecken)
    if (fx === 'timeup') { if (role !== 'player') sfx.timeup(); else buzz([200, 80, 200]); return; }
    if (fx === 'join' && role === 'player') return;
    if (fx === 'show' && role === 'player') return;
    sfx[fx]?.();
    if (fx === 'ok') buzz(30);
    if (fx === 'no') buzz([20, 60, 20]);
  }

  // ---------- Rendern ----------
  function render() {
    if (gone) {
      patch($app, `<div class="screen center"><div class="big-emoji">👋</div><h2>${esc(gone)}</h2><a class="btn primary" href="/" data-link>Zur Startseite</a></div>`);
      stopTimer();
      keepAwake(false);
      return;
    }
    if (!view) {
      patch($app, `<div class="screen center"><div class="logo small">?</div><p class="muted">Verbinde mit Spiel ${esc(code)} …</p></div>`);
      return;
    }
    const v = view;
    const c = makeCtx(v, conn, local);
    const role = v.you.role;
    const g = v.game;
    let html;
    if (role === 'guest') html = joinScreen(v, local);
    else if (role === 'tv') html = tvScreen(c);
    else if (role === 'host') html = v.status === 'lobby' ? hostLobby(c) : g?.finished ? hostEnd(c) : hostPlay(c);
    else if (!c.me) html = joinScreen({ ...v, lateJoin: false, reclaimable: [] }, local);
    else html = v.status === 'lobby' ? playerLobby(c) : g?.finished ? playerEnd(c) : playerPlay(c);

    const key = `${role}|${v.status}|${g?.idx}|${g?.phase}`;
    const sameScreen = key === lastKey;
    patch($app, html, { keepScroll: sameScreen || v.status === 'lobby' });
    if (!sameScreen && v.status !== 'lobby') window.scrollTo(0, 0);
    lastKey = key;

    const ended = !!g?.finished;
    if (ended && !lastEnd) confetti();
    if (!ended) stopConfetti();
    lastEnd = ended;
    keepAwake(v.status === 'playing' || role === 'tv');
    if (sheet && g) updateSheet(scoreSheet(c));
    if (sheet && !g) { closeSheet(); sheet = false; }
    startTimer();
  }

  // ---------- Countdown ----------
  function stopTimer() { clearInterval(timerInt); timerInt = null; }
  function startTimer() {
    stopTimer();
    const g = view?.game;
    if (!g || !g.timer || (!g.deadline && !g.remaining)) return;
    const tick = () => {
      const bar = document.getElementById('timerBar'), num = document.getElementById('timerNum'), box = document.getElementById('timer');
      if (!bar) return stopTimer();
      const total = g.timer * 1000;
      const left = g.deadline ? Math.max(0, g.deadline - conn.now()) : g.remaining;
      const sec = Math.ceil(left / 1000);
      bar.style.width = (left / total) * 100 + '%';
      if (!g.deadline) { num.textContent = `⏸ ${sec} s`; return; }
      num.textContent = left > 0 ? sec + ' s' : '⏰ Zeit um!';
      box.classList.toggle('warn', left > 0 && left <= 5000);
      const loud = view.you.role !== 'player';
      if (loud && left > 0 && left <= 5000 && sec !== lastTick) sfx.tick();
      lastTick = sec;
      if (left <= 0) {
        box.classList.add('over');
        if (timeupFor !== g.deadline) {
          timeupFor = g.deadline;
          // Klassik/Duell: kein Server-Event, also lokal melden
          if (g.mode === 'klassik' || g.mode === 'duell') { if (loud) sfx.timeup(); buzz([200, 80, 200]); }
        }
        stopTimer();
      }
    };
    tick();
    timerInt = setInterval(tick, 200);
  }

  // ---------- Sheet ----------
  function openScoreSheet() {
    if (!view?.game) return;
    sheet = true;
    openSheet(scoreSheet(makeCtx(view, conn, local)));
  }

  function showQrSheet() {
    sheet = false;
    openSheet(`<h3>📱 Nachzügler einladen</h3>
      <div class="center-text"><img class="qr big" src="/api/rooms/${code}/qr.svg" alt="QR-Code"><div class="bigcode">${code}</div>
      <p class="muted small">${esc(location.host)}/join/${code}</p></div>
      <button class="btn primary" data-a="closeSheet">Schließen</button>`);
  }

  const settings = patchObj => conn.act('settings', { settings: patchObj });

  render();

  return {
    unmount() {
      stopTimer();
      conn.close();
      document.body.classList.remove('tv-mode');
      keepAwake(false);
    },

    onAction(a, el) {
      const d = el.dataset;
      const v = view;
      const s = v?.settings;
      switch (a) {
        // --- Allgemein ---
        case 'sheet': openScoreSheet(); break;
        case 'toggle':
          if (d.k === 'sound') { local.sound = !local.sound; setSound(local.sound); if (local.sound) { unlockAudio(); sfx.ok(); } render(); if (sheet) updateSheet(scoreSheet(makeCtx(view, conn, local))); }
          break;
        case 'share': {
          const url = `${location.origin}/join/${code}`;
          if (navigator.share) navigator.share({ title: 'Schnobbis Quiz', text: `Spiel mit! Code ${code}`, url }).catch(() => {});
          else copyText(url).then(ok => toast(ok ? '🔗 Link kopiert' : url, 3000));
          break;
        }
        case 'showQr': showQrSheet(); break;
        case 'peek': local.peek = !local.peek; render(); break;

        // --- Lobby (Host) ---
        case 'set': {
          const k = d.k;
          const val = k === 'mode' ? d.v : +d.v;
          settings({ [k]: val });
          break;
        }
        case 'setToggle': settings({ [d.k]: !s[d.k] }); break;
        case 'step': {
          const lim = d.k === 'jokers' ? [0, 5] : d.k === 'questions' ? [1, 100] : [1, 50];
          settings({ [d.k]: Math.min(lim[1], Math.max(lim[0], s[d.k] + +d.d)) });
          break;
        }
        case 'diff': {
          let diffs = d.v === '*' ? [] : (st => { const x = +d.v; st.has(x) ? st.delete(x) : st.add(x); return [...st].sort(); })(new Set(s.diffs));
          if (diffs.length === 3) diffs = [];
          settings({ diffs });
          break;
        }
        case 'cats': local.catsOpen = !local.catsOpen; render(); break;
        case 'cat': {
          let cats = d.v === '*' ? [] : (st => { st.has(d.v) ? st.delete(d.v) : st.add(d.v); return [...st]; })(new Set(s.cats));
          if (cats.length === meta.categories.length) cats = [];
          settings({ cats });
          break;
        }
        case 'emoji': conn.act('emoji', { pid: +d.pid }); break;
        case 'move': conn.act('move', { pid: +d.pid, d: +d.d }); break;
        case 'remove': {
          const p = v.players.find(x => x.id === +d.pid);
          if (p?.kind === 'device' && !p.isHost && !confirm(`${p.name} aus dem Spiel nehmen?`)) return;
          conn.act('remove', { pid: +d.pid });
          break;
        }
        case 'shuffle': conn.act('shuffle'); break;
        case 'addSelfOpen': local.addSelf = true; render(); document.getElementById('selfName')?.focus(); break;
        case 'resetPool': if (confirm('Alle Fragen wieder als „ungespielt“ markieren?')) conn.act('resetPool'); break;
        case 'start': unlockAudio(); conn.act('start'); break;

        // --- Spiel (Host) ---
        case 'show': case 'reveal': case 'next': case 'score': case 'joker':
          unlockAudio(); conn.act(a); break;
        case 'judge': conn.act('judge', { ok: d.ok === '1' }); break;
        case 'steal': conn.act('steal', { pid: +d.pid }); break;
        case 'mark': conn.act('mark', { pid: +d.pid, ok: d.ok === '1' }); break;
        case 'buzzFor': conn.act('buzz', { pid: +d.pid }); break;
        case 'undo': conn.act('undo'); break;
        case 'adjust': conn.act('adjust', { pid: +d.pid, d: +d.d }); break;
        case 'end':
          if (confirm('Spiel jetzt beenden und Ergebnis zeigen?')) { conn.act('end'); closeSheet(); sheet = false; }
          break;
        case 'rematch': conn.act('rematch'); break;
        case 'toLobby': conn.act('toLobby'); break;

        // --- Spieler ---
        case 'buzz':
          unlockAudio();
          buzz(50);
          el.classList.add('pressed');
          conn.act('buzz');
          break;
        case 'pickEmoji':
          local.emoji = d.v;
          document.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('on', b === el));
          break;
        case 'reclaim': conn.send({ t: 'reclaim', pid: +d.pid }); break;
        case 'editProfile': local.editProfile = true; render(); break;
        case 'setEmoji': conn.send({ t: 'profile', emoji: d.v }); store.set('lastEmoji', d.v); break;
        case 'leave':
          if (!confirm('Spiel wirklich verlassen?')) return;
          conn.send({ t: 'leave' });
          store.dropSession(code);
          navigate('/');
          break;
      }
    },

    onSubmit(form, f) {
      if (form === 'addLocal') {
        const i = document.getElementById('newName');
        const name = i.value.trim();
        if (!name) return;
        conn.act('addLocal', { name });
        i.value = '';
        i.focus();
      }
      if (form === 'addSelf') {
        const name = document.getElementById('selfName').value.trim();
        if (!name) return;
        store.set('lastName', name);
        local.addSelf = false;
        conn.act('addSelf', { name, emoji: local.emoji || undefined });
      }
      if (form === 'join') {
        const name = document.getElementById('joinName').value.trim();
        if (!name) return;
        unlockAudio();
        store.set('lastName', name);
        const emoji = local.emoji || f.querySelector('.emoji-btn.on')?.dataset.v;
        if (emoji) store.set('lastEmoji', emoji);
        conn.send({ t: 'join', name, emoji });
      }
      if (form === 'profile') {
        const name = document.getElementById('profName').value.trim();
        if (name) { conn.send({ t: 'profile', name }); store.set('lastName', name); }
        local.editProfile = false;
        render();
      }
      if (form === 'submit') {
        const i = f.querySelector('input');
        const text = i.value.trim();
        if (!text) return;
        conn.act('submit', { text });
        i.blur();
        buzz(20);
      }
    },
  };
}
