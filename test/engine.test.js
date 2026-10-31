import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, sanitizeSettings, isFinal, ranking, awards } from '../server/engine.js';
import { buildView } from '../server/view.js';
import fs from 'node:fs';
import { setup, rng, players, SEED } from './helpers.js';

const host = { role: 'host' };
const S = over => sanitizeSettings({ timer: 0, ...over });

function ctx(qs, now = 1000, extra = {}) { return { qs, now, rng: rng(), ...extra }; }

test('Seed: kompletter Katalog in der Datenbank', () => {
  const { qs } = setup();
  const s = qs.summary();
  const cat = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  assert.equal(s.questions, cat.questions.length);
  assert.equal(s.pairs, cat.pairs.length);
  assert.equal(s.categories.length, cat.categories.length);
  assert.ok(s.categories.every(c => c.count > 0), 'jede Kategorie hat Fragen');
});

test('Klassik: Reihum-Reihenfolge, Punkte, Serien-Bonus, Klauen, Finale', () => {
  const { qs } = setup();
  const g = createGame(players(2), S({ mode: 'klassik', perPlayer: 3, streakBonus: true, steal: true, finale: true }), { qs, rng: rng() });
  assert.equal(g.turns.length, 6);
  assert.deepEqual(g.turns.map(t => t.p), [0, 1, 0, 1, 0, 1]);
  // Steigend (Standard): Schwierigkeit nimmt nicht ab
  const ds = g.turns.map(t => qs.get(t.q).d);
  for (let i = 1; i < ds.length; i++) assert.ok(ds[i] >= ds[i - 1] || Math.floor(i / 2) === Math.floor((i - 1) / 2));
  const play = ok => { act(g, { a: 'show' }, host, ctx(qs)); act(g, { a: 'reveal' }, host, ctx(qs)); return act(g, { a: 'judge', ok }, host, ctx(qs)); };
  play(true);                       // P1 +1
  play(false);                      // P2 falsch → Klau-Phase
  assert.equal(g.phase, 'steal');
  act(g, { a: 'steal', pid: 1 }, host, ctx(qs)); // P1 klaut +1
  assert.equal(g.players[0].score, 2);
  assert.equal(g.players[0].steals, 1);
  play(true);                       // P1 2. richtige
  assert.equal(g.players[0].score, 3);
  assert.throws(() => act(g, { a: 'steal', pid: -1 }, host, ctx(qs)), /nicht möglich/);
});

test('Klassik: Serien-Bonus nach 3 richtigen, Finale doppelt', () => {
  const { qs } = setup();
  const g = createGame(players(1), S({ mode: 'klassik', perPlayer: 4, finale: true, steal: false }), { qs, rng: rng() });
  const play = ok => { act(g, { a: 'show' }, host, ctx(qs)); act(g, { a: 'reveal' }, host, ctx(qs)); return act(g, { a: 'judge', ok }, host, ctx(qs)); };
  play(true); play(true);
  const ev = play(true);
  assert.ok(ev.some(e => e.toast?.includes('Serie')));
  assert.equal(g.players[0].score, 4); // 3 + Bonus
  assert.ok(isFinal(g));               // letzte Runde (1 Spieler)
  play(true);
  assert.equal(g.players[0].score, 6); // Finale zählt 2
  assert.ok(g.finished);
  assert.equal(g.log.length, 4);
});

test('Schwer zählt mehr', () => {
  const { qs } = setup();
  const g = createGame(players(1), S({ mode: 'klassik', perPlayer: 1, diffPoints: true, finale: false, diffs: [3] }), { qs, rng: rng() });
  act(g, { a: 'show' }, host, ctx(qs));
  act(g, { a: 'judge', ok: true }, host, ctx(qs));
  assert.equal(g.players[0].score, 3);
});

test('Joker tauscht die Frage, nur der aktive Spieler oder der Host', () => {
  const { qs } = setup();
  const g = createGame(players(2), S({ mode: 'klassik', perPlayer: 2, jokers: 1 }), { qs, rng: rng() });
  act(g, { a: 'show' }, host, ctx(qs));
  const before = g.turns[0].q;
  assert.throws(() => act(g, { a: 'joker' }, { role: 'player', pid: 2 }, ctx(qs)), /Nur wer dran ist/);
  act(g, { a: 'joker' }, { role: 'player', pid: 1 }, ctx(qs));
  assert.notEqual(g.turns[0].q, before);
  assert.equal(qs.get(g.turns[0].q).d, qs.get(before).d);
  assert.throws(() => act(g, { a: 'joker' }, { role: 'player', pid: 1 }, ctx(qs)), /Keine Joker/);
});

test('Spieler dürfen nicht werten', () => {
  const { qs } = setup();
  const g = createGame(players(2), S({ mode: 'klassik' }), { qs, rng: rng() });
  assert.throws(() => act(g, { a: 'show' }, { role: 'player', pid: 1 }, ctx(qs)), /Spielleiter/);
  act(g, { a: 'show' }, host, ctx(qs));
  assert.throws(() => act(g, { a: 'judge', ok: true }, { role: 'player', pid: 1 }, ctx(qs)), /Spielleiter/);
});

test('Duell: Extrapunkt, wenn nur einer richtig ist', () => {
  const { qs } = setup();
  const g = createGame(players(2), S({ mode: 'duell', perPlayer: 1, finale: false }), { qs, rng: rng() });
  assert.equal(g.turns.length, 2);
  const pair = qs.getPair(g.turns[0].pair);
  assert.deepEqual([g.turns[0].q, g.turns[1].q].sort(), [pair.a, pair.b].sort());
  act(g, { a: 'show' }, host, ctx(qs)); act(g, { a: 'judge', ok: true }, host, ctx(qs));
  act(g, { a: 'show' }, host, ctx(qs)); act(g, { a: 'judge', ok: false }, host, ctx(qs));
  assert.equal(g.phase, 'duelResult');
  assert.equal(g.players[0].score, 2);
  assert.equal(g.players[0].duelsWon, 1);
  act(g, { a: 'next' }, host, ctx(qs));
  assert.ok(g.finished);
});

test('Buzzer: Erster gewinnt, Falsch sperrt, Zweiter darf', () => {
  const { qs } = setup();
  const g = createGame(players(3), S({ mode: 'buzzer', questions: 2, finale: false, buzzPenalty: true }), { qs, rng: rng() });
  act(g, { a: 'show' }, host, ctx(qs, 1000));
  act(g, { a: 'buzz' }, { role: 'player', pid: 2 }, ctx(qs, 1500));
  act(g, { a: 'buzz' }, { role: 'player', pid: 3 }, ctx(qs, 1501)); // zu spät → ignoriert
  assert.equal(g.buzz.pid, 2);
  act(g, { a: 'judge', ok: false }, host, ctx(qs, 2000));
  assert.equal(g.phase, 'question');
  assert.deepEqual(g.locked, [2]);
  assert.equal(g.players[1].score, -1);
  act(g, { a: 'buzz' }, { role: 'player', pid: 2 }, ctx(qs, 2100)); // gesperrt
  assert.equal(g.buzz, null);
  act(g, { a: 'buzz' }, { role: 'player', pid: 3 }, ctx(qs, 2200));
  act(g, { a: 'judge', ok: true }, host, ctx(qs, 2500));
  assert.equal(g.phase, 'revealed');
  assert.equal(g.players[2].score, 1);
  assert.equal(g.players[2].buzzWins, 1);
  act(g, { a: 'next' }, host, ctx(qs));
  assert.equal(g.idx, 1);
  // Host buzzert für Spieler ohne Handy
  act(g, { a: 'show' }, host, ctx(qs));
  act(g, { a: 'buzz', pid: 1 }, host, ctx(qs));
  assert.equal(g.buzz.pid, 1);
});

test('Buzzer: Zeit läuft ab → Auflösung; Zeit pausiert beim Antworten', () => {
  const { qs } = setup();
  const g = createGame(players(2), S({ mode: 'buzzer', questions: 1, timer: 15 }), { qs, rng: rng() });
  act(g, { a: 'show' }, host, ctx(qs, 0));
  assert.equal(g.deadline, 15000);
  act(g, { a: 'buzz' }, { role: 'player', pid: 1 }, ctx(qs, 5000));
  assert.equal(g.deadline, 0);
  assert.equal(g.remaining, 10000);
  act(g, { a: 'judge', ok: false }, host, ctx(qs, 9000));
  assert.equal(g.deadline, 19000);
  assert.equal(act(g, { a: 'timeout' }, { role: 'system' }, ctx(qs, 18000)).length, 0); // zu früh
  act(g, { a: 'timeout' }, { role: 'system' }, ctx(qs, 19000));
  assert.equal(g.phase, 'revealed');
});

test('Alle tippen: Vorschläge, Wertung, Schnellster-Bonus, Auto-Review', () => {
  const { qs } = setup();
  const g = createGame(players(3), S({ mode: 'alle', questions: 1, finale: false, speedBonus: true, rising: false }), { qs, rng: rng() });
  const q = qs.get(g.turns[0].q);
  const devices = new Set([1, 2, 3]);
  act(g, { a: 'show' }, host, ctx(qs, 0, { devicePids: devices }));
  act(g, { a: 'submit', text: q.a }, { role: 'player', pid: 2 }, ctx(qs, 3000, { devicePids: devices }));
  act(g, { a: 'submit', text: q.a.toUpperCase() }, { role: 'player', pid: 1 }, ctx(qs, 4000, { devicePids: devices }));
  assert.equal(g.phase, 'question');
  act(g, { a: 'submit', text: 'xyz quatsch' }, { role: 'player', pid: 3 }, ctx(qs, 5000, { devicePids: devices }));
  assert.equal(g.phase, 'review'); // alle haben abgegeben
  assert.deepEqual(g.marks, { 1: true, 2: true, 3: false });
  act(g, { a: 'mark', pid: 3, ok: true }, host, ctx(qs)); // Spielleiter lässt es gelten
  act(g, { a: 'score' }, host, ctx(qs));
  assert.equal(g.phase, 'revealed');
  assert.equal(g.players[1].score, 2); // schnellster: 1 + 1
  assert.equal(g.players[0].score, 1);
  assert.equal(g.players[2].score, 1);
  assert.equal(g.log.find(l => l.pid === 2).pts, 2);
});

test('Rückgängig stellt den vorherigen Stand her', () => {
  const { qs } = setup();
  const g = createGame(players(2), S({ mode: 'klassik', steal: false }), { qs, rng: rng() });
  act(g, { a: 'show' }, host, ctx(qs));
  act(g, { a: 'judge', ok: true }, host, ctx(qs));
  assert.equal(g.players[0].score, 1);
  act(g, { a: 'undo' }, host, ctx(qs));
  assert.equal(g.players[0].score, 0);
  assert.equal(g.idx, 0);
  assert.equal(g.log.length, 0);
});

test('Spiel vorzeitig beenden + Ranking + Awards', () => {
  const { qs } = setup();
  const g = createGame(players(3), S({ mode: 'klassik', steal: false }), { qs, rng: rng() });
  act(g, { a: 'show' }, host, ctx(qs)); act(g, { a: 'judge', ok: true }, host, ctx(qs));
  act(g, { a: 'end' }, host, ctx(qs));
  assert.ok(g.finished && g.endedEarly);
  const r = ranking(g);
  assert.equal(r[0].pid, 1);
  assert.equal(r[1].place, 2);
  assert.equal(r[2].place, 2); // Gleichstand
  assert.ok(awards(g).some(a => a.title === 'Beste Quote'));
});

test('Lösung wird nie vorzeitig an Spieler geschickt', () => {
  const { qs } = setup();
  for (const mode of ['klassik', 'duell', 'buzzer', 'alle']) {
    const ps = players(3);
    const room = { code: 'ABCD', status: 'playing', settings: S({ mode }), players: ps, hostPid: null };
    const g = createGame(ps, S({ mode, perPlayer: 2, questions: 2, steal: true }), { qs, rng: rng() });
    room.game = g;
    const answerOf = () => qs.get(g.turns[g.idx].q).a;
    const leaks = () => {
      const a = answerOf();
      for (const pid of [1, 2, 3]) {
        const json = JSON.stringify(buildView(room, { role: 'player', pid }, qs));
        if (json.includes(JSON.stringify(a))) return pid;
      }
      const tv = JSON.stringify(buildView(room, { role: 'tv' }, qs));
      if (tv.includes(JSON.stringify(a))) return 'tv';
      return null;
    };
    assert.equal(leaks(), null, `${mode}: intro`);
    act(g, { a: 'show' }, host, ctx(qs, 0, { devicePids: new Set([1, 2, 3]) }));
    assert.equal(leaks(), null, `${mode}: Frage offen`);
    assert.ok(JSON.stringify(buildView(room, host, qs)).includes(JSON.stringify(answerOf())), `${mode}: Host sieht Lösung`);
    if (mode === 'buzzer') {
      act(g, { a: 'buzz' }, { role: 'player', pid: 1 }, ctx(qs));
      assert.equal(leaks(), null, 'buzzer: buzzed');
    }
    if (mode === 'alle') {
      act(g, { a: 'reveal' }, host, ctx(qs));
      assert.equal(g.phase, 'review');
      assert.equal(leaks(), null, 'alle: review');
      const pv = buildView(room, { role: 'player', pid: 1 }, qs);
      assert.equal(pv.game.review, undefined, 'alle: Spieler sieht keine Bewertung');
    }
  }
});

test('Fragen wiederholen sich nicht, bis der Pool leer ist', () => {
  const { qs } = setup();
  const seen = new Set();
  const total = qs.poolIds('q', ['Kunst'], []).length;
  for (let i = 0; i < Math.floor(total / 5); i++) {
    for (const id of qs.pick('q', 5, [], ['Kunst'], [], rng(i + 1))) {
      assert.ok(!seen.has(id), 'Wiederholung');
      assert.equal(qs.get(id).c, 'Kunst');
      seen.add(id);
    }
  }
  assert.equal(qs.unplayed('q', ['Kunst']), total - seen.size);
  qs.resetPlayed();
  assert.equal(qs.unplayed('q', ['Kunst']), total);
});
