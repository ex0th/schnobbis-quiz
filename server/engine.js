// Spiel-Engine: reine Zustandsübergänge. Kein Netzwerk, keine Timer.
// Fragenquelle (qs), Uhr (now) und Zufall (rng) werden von außen hereingereicht → testbar.
import { shuffle, suggestCorrect } from './util.js';

export const MODES = ['klassik', 'duell', 'buzzer', 'alle'];
export const PRESETS = [3, 5, 10, 15, 20];
export const TIMERS = [0, 15, 30, 60];

export const DEFAULT_SETTINGS = {
  mode: 'klassik',
  perPlayer: 5,      // Klassik/Duell: Fragen pro Spieler
  questions: 10,     // Buzzer/Alle tippen: Fragen insgesamt
  jokers: 1,
  streakBonus: true,
  cats: [],
  diffs: [],
  timer: 0,
  steal: true,
  finale: true,
  diffPoints: false,
  rising: true,
  buzzPenalty: false, // Buzzer: falsch = −1
  speedBonus: true,   // Alle tippen: schnellste richtige Antwort +1
};

const clampInt = (v, lo, hi, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function sanitizeSettings(input = {}, categories = null) {
  const s = { ...DEFAULT_SETTINGS };
  if (MODES.includes(input.mode)) s.mode = input.mode;
  s.perPlayer = clampInt(input.perPlayer, 1, 50, s.perPlayer);
  s.questions = clampInt(input.questions, 1, 100, s.questions);
  s.jokers = clampInt(input.jokers, 0, 5, s.jokers);
  s.timer = TIMERS.includes(+input.timer) ? +input.timer : 0;
  for (const k of ['streakBonus', 'steal', 'finale', 'diffPoints', 'rising', 'buzzPenalty', 'speedBonus']) {
    if (input[k] !== undefined) s[k] = !!input[k];
  }
  s.diffs = Array.isArray(input.diffs) ? [...new Set(input.diffs.map(Number).filter(d => [1, 2, 3].includes(d)))].sort() : [];
  if (s.diffs.length === 3) s.diffs = [];
  s.cats = Array.isArray(input.cats) ? [...new Set(input.cats.map(String))].slice(0, 50) : [];
  if (categories) {
    s.cats = s.cats.filter(c => categories.includes(c));
    if (s.cats.length === categories.length) s.cats = [];
  }
  return s;
}

export const usesTurns = mode => mode === 'klassik' || mode === 'duell';

export function totalQuestions(settings, nPlayers) {
  if (settings.mode === 'klassik') return nPlayers * settings.perPlayer;
  if (settings.mode === 'duell') return Math.ceil((nPlayers * settings.perPlayer) / 2) * 2;
  return settings.questions;
}

export function minPlayers(mode) {
  return mode === 'duell' || mode === 'buzzer' ? 2 : 1;
}

// Stufen-Plan für „Steigend“: R Runden gleichmäßig auf die gewählten Stufen verteilen
export function levelPlan(R, diffs) {
  const levels = diffs.length ? diffs.slice().sort() : [1, 2, 3];
  return Array.from({ length: R }, (_, r) => levels[Math.floor((r * levels.length) / R)]);
}

// ---------------------------------------------------------------------------
// Spiel anlegen
// ---------------------------------------------------------------------------
export function createGame(players, settings, { qs, now = Date.now(), rng = Math.random }) {
  const s = { ...settings };
  const n = players.length;
  if (n < minPlayers(s.mode)) throw new Error(s.mode === 'duell' ? 'Duell braucht mindestens 2 Spieler' : s.mode === 'buzzer' ? 'Buzzer braucht mindestens 2 Spieler' : 'Mindestens 1 Spieler');
  if (n > 16) throw new Error('Maximal 16 Spieler');

  const turns = [];
  if (s.mode === 'klassik') {
    const R = s.perPlayer;
    let ids;
    if (s.rising) {
      const lv = levelPlan(R, s.diffs);
      ids = [];
      for (const d of [1, 2, 3]) {
        const rounds = lv.filter(x => x === d).length;
        if (rounds) ids.push(...qs.pick('q', rounds * n, ids, s.cats, [d], rng));
      }
    } else {
      ids = qs.pick('q', n * R, [], s.cats, s.diffs, rng);
    }
    for (let r = 0; r < R; r++) for (let i = 0; i < n; i++) turns.push({ p: i, q: ids[r * n + i], res: null });
  } else if (s.mode === 'duell') {
    const D = Math.ceil((n * s.perPlayer) / 2);
    let pairIds;
    if (s.rising) {
      const lv = levelPlan(D, s.diffs);
      pairIds = [];
      for (const d of [1, 2, 3]) {
        const k = lv.filter(x => x === d).length;
        if (k) pairIds.push(...qs.pick('p', k, pairIds, [], [d], rng));
      }
    } else {
      pairIds = qs.pick('p', D, [], [], s.diffs, rng);
    }
    for (let k = 0; k < D; k++) {
      const pr = qs.getPair(pairIds[k]);
      const sw = rng() < 0.5;
      const a = (2 * k) % n, b = (2 * k + 1) % n;
      turns.push({ p: a, q: sw ? pr.b : pr.a, res: null, duel: k, side: 0, pair: pr.id });
      turns.push({ p: b, q: sw ? pr.a : pr.b, res: null, duel: k, side: 1, pair: pr.id });
    }
  } else {
    // Buzzer / Alle tippen: eine Frage für alle
    const R = s.questions;
    let ids;
    if (s.rising) {
      const lv = levelPlan(R, s.diffs);
      ids = [];
      for (const d of [1, 2, 3]) {
        const k = lv.filter(x => x === d).length;
        if (k) ids.push(...qs.pick('q', k, ids, s.cats, [d], rng));
      }
    } else {
      ids = qs.pick('q', R, [], s.cats, s.diffs, rng);
    }
    for (const q of ids) turns.push({ q, res: {} });
  }

  return {
    mode: s.mode,
    settings: s,
    players: players.map(p => ({
      pid: p.id, score: 0, correct: 0, answered: 0, streak: 0, best: 0,
      jokers: s.jokers, jokersUsed: 0, duelsWon: 0, steals: 0, buzzWins: 0, fastest: 0,
    })),
    turns,
    idx: 0,
    phase: 'intro',
    finished: false,
    endedEarly: false,
    startedAt: now,
    qStart: 0,
    deadline: 0,       // Server-Zeit (ms), 0 = kein Timer aktiv
    remaining: 0,      // Buzzer: Restzeit, während jemand antwortet
    buzz: null,        // { pid, at }
    locked: [],        // Buzzer: wer schon falsch lag
    answers: {},       // Alle tippen: pid → { text, at }
    marks: {},         // Alle tippen: pid → true/false (Bewertung des Spielleiters)
    log: [],           // Für die Statistik: jede gewertete Antwort
    history: [],
  };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
export const curTurn = g => g.turns[g.idx];
const gp = (g, pid) => g.players.find(p => p.pid === pid);

export function finaleCount(g) {
  if (g.mode === 'klassik') return g.players.length;
  if (g.mode === 'duell') return 2;
  return g.turns.length >= 6 ? 3 : 1;
}

export function isFinal(g, i = g.idx) {
  if (!g.settings.finale || !g.turns[i]) return false;
  return i >= g.turns.length - finaleCount(g);
}

export function pointsFor(g, i = g.idx, qs) {
  const t = g.turns[i];
  const base = g.settings.diffPoints ? (qs.get(t.q)?.d || 1) : 1;
  return base * (isFinal(g, i) ? 2 : 1);
}

function snapshot(g) {
  const { history, ...rest } = g;
  g.history.push(JSON.stringify(rest));
  if (g.history.length > 40) g.history.shift();
}

function restore(g) {
  const prev = JSON.parse(g.history.pop());
  const h = g.history;
  for (const k of Object.keys(g)) delete g[k];
  Object.assign(g, prev, { history: h });
}

function startClock(g, now) {
  g.qStart = now;
  g.deadline = g.settings.timer ? now + g.settings.timer * 1000 : 0;
  g.remaining = 0;
}

function award(g, p, ok, pts, events, qs) {
  p.answered++;
  if (ok) {
    p.score += pts;
    p.correct++;
    p.streak++;
    p.best = Math.max(p.best, p.streak);
    if (g.settings.streakBonus && p.streak % 3 === 0) {
      p.score++;
      events.push({ fx: 'bonus', toast: `🔥 {${p.pid}}: ${p.streak}er-Serie! +1 Bonus` });
      return 1;
    }
  } else {
    p.streak = 0;
  }
  return 0;
}

function logAnswer(g, entry) {
  g.log.push({ idx: g.idx, ...entry });
}

function advance(g, events) {
  g.idx++;
  g.phase = 'intro';
  g.deadline = 0;
  g.remaining = 0;
  g.buzz = null;
  g.locked = [];
  g.answers = {};
  g.marks = {};
  if (g.idx >= g.turns.length) finish(g, events);
}

function finish(g, events, early = false) {
  g.finished = true;
  g.endedEarly = early;
  g.phase = 'end';
  g.deadline = 0;
  events.push({ fx: 'win' });
}

// ---------------------------------------------------------------------------
// Aktionen
// actor: { role: 'host' | 'player', pid }
// ctx: { qs, now, rng, devicePids: Set (verbundene Handy-Spieler) }
// Rückgabe: Liste von Events ({ fx, toast }) für Sounds/Toasts auf den Geräten
// ---------------------------------------------------------------------------
export function act(g, action, actor, ctx) {
  const events = [];
  const { qs, now = Date.now(), rng = Math.random } = ctx;
  const host = actor.role === 'host';
  const t = curTurn(g);
  const need = (cond, msg = 'Gerade nicht möglich') => { if (!cond) throw new Error(msg); };
  const needHost = () => need(host, 'Nur der Spielleiter darf das');

  // Aktionen, die auch nach Spielende gehen
  switch (action.a) {
    case 'undo':
      needHost();
      need(g.history.length > 0, 'Nichts zum Rückgängigmachen');
      restore(g);
      if (['question', 'buzzed'].includes(g.phase)) {
        // Timer frisch starten, statt mit abgelaufener Zeit weiterzumachen
        if (g.phase === 'question' && g.settings.timer) g.deadline = now + g.settings.timer * 1000;
        g.qStart = now;
      }
      events.push({ toast: '↩️ Rückgängig gemacht' });
      return events;
    case 'adjust': {
      needHost();
      const p = gp(g, action.pid);
      need(p, 'Spieler nicht gefunden');
      const d = Math.sign(+action.d) || 0;
      need(d !== 0);
      snapshot(g);
      p.score += d;
      return events;
    }
  }

  need(!g.finished, 'Das Spiel ist vorbei');

  switch (action.a) {
    case 'end':
      needHost();
      snapshot(g);
      finish(g, events, true);
      return events;

    case 'show': {
      needHost();
      need(g.phase === 'intro');
      g.phase = 'question';
      startClock(g, now);
      g.buzz = null; g.locked = []; g.answers = {}; g.marks = {};
      events.push({ fx: 'show' });
      return events;
    }

    case 'reveal': {
      needHost();
      if (usesTurns(g.mode)) {
        need(g.phase === 'question');
        g.phase = 'revealed';
        g.deadline = 0;
      } else if (g.mode === 'buzzer') {
        need(g.phase === 'question' || g.phase === 'buzzed');
        snapshot(g);
        g.buzz = null;
        g.phase = 'revealed';
        g.deadline = 0;
      } else {
        need(g.phase === 'question');
        toReview(g, qs);
      }
      return events;
    }

    case 'joker': {
      need(g.mode === 'klassik' && g.phase === 'question', 'Joker geht nur in Klassik, solange die Frage offen ist');
      const p = g.players[t.p];
      need(host || actor.pid === p.pid, 'Nur wer dran ist, kann den Joker ziehen');
      need(p.jokers > 0, 'Keine Joker mehr');
      snapshot(g);
      const inGame = g.turns.map(x => x.q);
      const [nq] = qs.pick('q', 1, inGame, g.settings.cats, [qs.get(t.q).d], rng);
      t.q = nq; t.joker = true;
      p.jokers--; p.jokersUsed++;
      startClock(g, now);
      events.push({ fx: 'joker', toast: `🃏 Joker! Neue Frage für {${p.pid}}` });
      return events;
    }

    case 'judge': {
      needHost();
      const ok = !!action.ok;
      if (usesTurns(g.mode)) {
        need(g.phase === 'revealed' || g.phase === 'question');
        snapshot(g);
        const p = g.players[t.p];
        const pts = pointsFor(g, g.idx, qs);
        t.res = ok ? 'ok' : 'no';
        const bonus = award(g, p, ok, pts, events, qs);
        if (bonus) t.bonus = 1;
        logAnswer(g, { pid: p.pid, q: t.q, ok, pts: ok ? pts + bonus : 0, ms: now - g.qStart, kind: 'turn' });
        if (ok && !bonus) events.push({ fx: 'ok' });
        if (!ok) events.push({ fx: 'no' });
        g.deadline = 0;
        if (t.duel !== undefined && t.side === 1) {
          const t0 = g.turns[g.idx - 1];
          const p0 = g.players[t0.p];
          if (t0.res === 'ok' && t.res !== 'ok') { p0.score++; p0.duelsWon++; t0.duelBonus = 1; }
          else if (t.res === 'ok' && t0.res !== 'ok') { p.score++; p.duelsWon++; t.duelBonus = 1; }
          g.phase = 'duelResult';
        } else if (!ok && g.settings.steal && g.mode === 'klassik' && g.players.length > 1) {
          g.phase = 'steal';
        } else {
          advance(g, events);
        }
        return events;
      }
      if (g.mode === 'buzzer') {
        need(g.phase === 'buzzed' && g.buzz);
        snapshot(g);
        const p = gp(g, g.buzz.pid);
        const pts = pointsFor(g, g.idx, qs);
        t.res[p.pid] = ok ? 'ok' : 'no';
        const bonus = award(g, p, ok, pts, events, qs);
        let pen = 0;
        if (!ok && g.settings.buzzPenalty) { p.score--; pen = -1; }
        logAnswer(g, { pid: p.pid, q: t.q, ok, pts: ok ? pts + bonus : pen, ms: g.buzz.at - g.qStart, kind: 'buzz' });
        if (ok) {
          p.buzzWins++;
          t.winner = p.pid;
          if (!bonus) events.push({ fx: 'ok' });
          g.phase = 'revealed';
          g.deadline = 0;
          g.buzz = null;
        } else {
          events.push({ fx: 'no' });
          g.locked.push(p.pid);
          g.buzz = null;
          if (g.locked.length >= g.players.length) {
            g.phase = 'revealed';
            g.deadline = 0;
          } else {
            g.phase = 'question';
            if (g.remaining) g.deadline = now + g.remaining;
            g.remaining = 0;
            events.push({ fx: 'reopen' });
          }
        }
        return events;
      }
      throw new Error('Gerade nicht möglich');
    }

    case 'steal': {
      needHost();
      need(g.phase === 'steal');
      snapshot(g);
      if (action.pid !== null && action.pid !== undefined && action.pid !== -1) {
        const p = gp(g, action.pid);
        need(p && p.pid !== g.players[t.p].pid, 'Ungültiger Spieler');
        const pts = pointsFor(g, g.idx, qs);
        p.score += pts;
        p.steals++;
        t.stolenBy = p.pid;
        logAnswer(g, { pid: p.pid, q: t.q, ok: true, pts, ms: null, kind: 'steal' });
        events.push({ fx: 'ok', toast: `🫳 {${p.pid}} klaut ${pts === 1 ? 'den Punkt' : pts + ' Punkte'}!` });
      }
      advance(g, events);
      return events;
    }

    case 'next': {
      needHost();
      need(g.phase === 'duelResult' || (!usesTurns(g.mode) && g.phase === 'revealed'));
      snapshot(g);
      advance(g, events);
      return events;
    }

    // ---------- Buzzer ----------
    case 'buzz': {
      need(g.mode === 'buzzer', 'Kein Buzzer-Spiel');
      // Spielleiter kann für Spieler ohne Handy buzzern („hat sich gemeldet“)
      const pid = host && action.pid !== undefined ? action.pid : actor.pid;
      const p = gp(g, pid);
      need(p, 'Du spielst nicht mit');
      if (g.phase === 'buzzed' && g.buzz) return events; // zu spät, jemand war schneller
      need(g.phase === 'question', 'Buzzer ist gerade zu');
      if (g.locked.includes(pid)) return events;
      snapshot(g);
      g.buzz = { pid, at: now };
      g.phase = 'buzzed';
      if (g.deadline) { g.remaining = Math.max(1000, g.deadline - now); g.deadline = 0; }
      events.push({ fx: 'buzz', buzzer: pid });
      return events;
    }

    // ---------- Alle tippen ----------
    case 'submit': {
      need(g.mode === 'alle', 'Kein Tipp-Spiel');
      need(g.phase === 'question', 'Antworten ist gerade nicht möglich');
      const p = gp(g, actor.pid);
      need(p, 'Du spielst nicht mit');
      const text = String(action.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!text) { delete g.answers[p.pid]; return events; }
      g.answers[p.pid] = { text, at: now };
      const devices = ctx.devicePids || new Set();
      const waiting = g.players.filter(x => devices.has(x.pid) && !g.answers[x.pid]);
      if (devices.size > 0 && waiting.length === 0) toReview(g, qs);
      return events;
    }

    case 'mark': {
      needHost();
      need(g.mode === 'alle' && g.phase === 'review');
      need(gp(g, action.pid), 'Spieler nicht gefunden');
      g.marks[action.pid] = !!action.ok;
      return events;
    }

    case 'score': {
      needHost();
      need(g.mode === 'alle' && g.phase === 'review');
      snapshot(g);
      const pts = pointsFor(g, g.idx, qs);
      const right = [];
      for (const p of g.players) {
        const ok = !!g.marks[p.pid];
        const a = g.answers[p.pid];
        t.res[p.pid] = ok ? 'ok' : 'no';
        const bonus = award(g, p, ok, pts, events, qs);
        logAnswer(g, { pid: p.pid, q: t.q, ok, pts: ok ? pts + bonus : 0, ms: a ? a.at - g.qStart : null, kind: 'typed', text: a?.text ?? null });
        if (ok && a) right.push({ p, at: a.at });
      }
      t.answers = g.answers; // für die Auflösung aufheben
      if (g.settings.speedBonus && right.length > 1) {
        right.sort((x, y) => x.at - y.at);
        const f = right[0].p;
        f.score++; f.fastest++;
        t.fastest = f.pid;
        const last = g.log[g.log.length - g.players.length + g.players.indexOf(f)];
        if (last) last.pts++;
        events.push({ toast: `⚡ {${f.pid}} war am schnellsten! +1` });
      }
      events.push({ fx: right.length ? 'ok' : 'no' });
      g.phase = 'revealed';
      return events;
    }

    case 'timeout': {
      // Vom Server ausgelöst, wenn der Countdown abläuft
      if (!g.deadline || now < g.deadline - 50) return events;
      g.deadline = 0;
      events.push({ fx: 'timeup' });
      if (g.mode === 'buzzer' && g.phase === 'question') { g.phase = 'revealed'; }
      else if (g.mode === 'alle' && g.phase === 'question') toReview(g, qs);
      return events;
    }
  }
  throw new Error('Unbekannte Aktion');
}

function toReview(g, qs) {
  const t = curTurn(g);
  const sol = qs.get(t.q).a;
  g.marks = {};
  for (const p of g.players) {
    const a = g.answers[p.pid];
    g.marks[p.pid] = a ? suggestCorrect(a.text, sol) : false;
  }
  g.suggest = { ...g.marks };
  g.phase = 'review';
  g.deadline = 0;
}

// Spieler, die während eines laufenden Buzzer-/Tipp-Spiels dazukommen
export function addLatePlayer(g, player) {
  if (usesTurns(g.mode)) throw new Error('In Klassik und Duell kann man nicht mehr einsteigen');
  if (g.players.some(p => p.pid === player.id)) return;
  g.players.push({ pid: player.id, score: 0, correct: 0, answered: 0, streak: 0, best: 0, jokers: 0, jokersUsed: 0, duelsWon: 0, steals: 0, buzzWins: 0, fastest: 0 });
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------
export function ranking(g) {
  const ps = g.players.map((p, i) => ({ ...p, i }));
  ps.sort((a, b) => b.score - a.score || b.correct - a.correct || b.best - a.best);
  let place = 0, last = null;
  ps.forEach((p, k) => { if (p.score !== last) { place = k + 1; last = p.score; } p.place = place; });
  return ps;
}

export function awards(g) {
  const ps = g.players;
  if (!ps.length) return [];
  const out = [];
  const pick = (val, title, icon, fmt) => {
    const best = Math.max(...ps.map(val));
    if (best > 0) out.push({ icon, title, pids: ps.filter(p => val(p) === best).map(p => p.pid), value: fmt(best) });
  };
  const best = Math.max(...ps.map(p => p.best));
  if (best >= 2) out.push({ icon: '🔥', title: 'Längste Serie', pids: ps.filter(p => p.best === best).map(p => p.pid), value: `${best} am Stück` });
  const quote = p => (p.answered ? p.correct / p.answered : 0);
  pick(quote, 'Beste Quote', '🎯', v => `${Math.round(v * 100)} %`);
  pick(p => p.steals, 'Meisterdieb', '🫳', v => `${v}× geklaut`);
  if (g.mode === 'duell') pick(p => p.duelsWon, 'Duell-König', '⚔️', v => `${v} Siege`);
  if (g.mode === 'buzzer') pick(p => p.buzzWins, 'Schnellster Finger', '🔔', v => `${v}× zuerst richtig`);
  if (g.mode === 'alle') pick(p => p.fastest, 'Blitzmerker', '⚡', v => `${v}× am schnellsten`);
  return out;
}

export { shuffle };
