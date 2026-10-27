// Projektion: Was darf welches Gerät sehen?
// Grundregel: Die Lösung verlässt den Server erst, wenn sie aufgedeckt ist – außer zum Spielleiter.
import { curTurn, isFinal, pointsFor, usesTurns, ranking, awards, totalQuestions, minPlayers } from './engine.js';

const REVEALED = new Set(['revealed', 'steal', 'duelResult', 'end']);
const QUESTION_VISIBLE = new Set(['question', 'buzzed', 'review', 'revealed', 'steal', 'duelResult']);

export function publicPlayer(p, room) {
  return {
    id: p.id, name: p.name, emoji: p.emoji, color: p.color, kind: p.kind,
    connected: p.kind === 'local' ? true : !!p.connected,
    isHost: room.hostPid === p.id,
  };
}

export function buildView(room, viewer, qs, now = Date.now()) {
  const isHost = viewer.role === 'host';
  const v = {
    code: room.code,
    status: room.status,
    you: { role: viewer.role, pid: viewer.pid ?? null },
    hostOnline: room.hostOnline,
    settings: room.settings,
    players: room.players.map(p => publicPlayer(p, room)),
    serverNow: now,
    game: null,
    lobby: null,
  };
  if (room.status === 'lobby') {
    v.lobby = {
      total: totalQuestions(room.settings, room.players.length),
      minPlayers: minPlayers(room.settings.mode),
      pool: isHost ? qs.poolInfo(room.settings.cats, room.settings.diffs) : null,
    };
    return v;
  }
  const g = room.game;
  if (!g) return v;

  const t = curTurn(g);
  const scores = g.players.map(p => ({
    pid: p.pid, score: p.score, correct: p.correct, answered: p.answered, streak: p.streak, best: p.best,
    jokers: p.jokers, duelsWon: p.duelsWon, steals: p.steals, buzzWins: p.buzzWins, fastest: p.fastest,
  }));
  const gv = {
    mode: g.mode,
    idx: g.idx,
    total: g.turns.length,
    phase: g.phase,
    finished: g.finished,
    endedEarly: g.endedEarly,
    scores,
    canUndo: isHost && g.history.length > 0,
    timer: g.settings.timer,
    deadline: g.deadline,
    remaining: g.remaining,
  };

  if (t && !g.finished) {
    const q = qs.get(t.q);
    const showQ = QUESTION_VISIBLE.has(g.phase);
    const showA = isHost || REVEALED.has(g.phase);
    gv.final = isFinal(g);
    gv.points = pointsFor(g, g.idx, qs);
    gv.question = {
      cat: q.c,
      d: q.d,
      text: showQ || (isHost && g.phase !== 'intro') ? q.q : null,
      answer: showA && g.phase !== 'intro' ? q.a : null,
    };
    // Duell-Thema
    if (t.duel !== undefined) {
      const pair = qs.getPair(t.pair);
      gv.duel = {
        k: t.duel,
        side: t.side,
        count: g.turns.length / 2,
        topic: pair && !t.joker ? pair.t : q.c,
        a: g.players[g.turns[t.side === 0 ? g.idx : g.idx - 1].p].pid,
        b: g.players[g.turns[t.side === 0 ? g.idx + 1 : g.idx].p].pid,
      };
      if (g.phase === 'duelResult') {
        const t0 = g.turns[g.idx - 1];
        gv.duel.result = { a: t0.res, b: t.res, winner: t0.duelBonus ? gv.duel.a : t.duelBonus ? gv.duel.b : null };
      }
    }
    if (usesTurns(g.mode)) {
      gv.active = g.players[t.p].pid;
      gv.joker = !!t.joker;
      if (g.phase === 'steal') gv.steal = { exclude: gv.active };
      // Wer kommt als Nächstes? (Klassik: zum Vorbereiten auf dem eigenen Handy)
      const nt = g.turns[g.idx + 1];
      if (nt) gv.nextPid = g.players[nt.p].pid;
    }
    if (g.mode === 'buzzer') {
      gv.buzz = g.buzz ? { pid: g.buzz.pid } : null;
      gv.locked = g.locked;
      if (g.phase === 'revealed') gv.result = { res: t.res, winner: t.winner ?? null };
    }
    if (g.mode === 'alle') {
      gv.submitted = Object.keys(g.answers).map(Number);
      if (viewer.pid != null && g.answers[viewer.pid]) gv.mine = g.answers[viewer.pid].text;
      if (isHost && g.phase === 'review') {
        gv.review = g.players.map(p => ({
          pid: p.pid,
          text: g.answers[p.pid]?.text ?? null,
          ms: g.answers[p.pid] ? g.answers[p.pid].at - g.qStart : null,
          mark: !!g.marks[p.pid],
          suggest: !!g.suggest?.[p.pid],
        }));
      }
      if (g.phase === 'revealed') {
        gv.result = {
          res: t.res,
          fastest: t.fastest ?? null,
          answers: g.players.map(p => ({ pid: p.pid, text: t.answers?.[p.pid]?.text ?? null, ok: t.res[p.pid] === 'ok' })),
        };
      }
    }
    if (usesTurns(g.mode) && REVEALED.has(g.phase)) {
      gv.turnResult = { res: t.res, bonus: !!t.bonus };
    }
  }

  if (g.finished) {
    gv.ranking = ranking(g).map(p => ({ pid: p.pid, place: p.place, score: p.score, correct: p.correct, answered: p.answered, best: p.best, duelsWon: p.duelsWon, steals: p.steals, buzzWins: p.buzzWins, fastest: p.fastest }));
    gv.awards = awards(g);
    gv.records = room.records || [];
    gv.gameId = room.recordId || null;
  }
  v.game = gv;
  return v;
}
