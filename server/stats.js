// Statistik: Spiele speichern und auswerten
import { tx } from './db.js';
import { nameKey } from './util.js';
import { ranking } from './engine.js';

export class Stats {
  constructor(db) {
    this.db = db;
  }

  personFor(player) {
    const key = nameKey(player.name);
    const row = this.db.prepare('SELECT id FROM people WHERE name_key = ?').get(key);
    if (row) {
      this.db.prepare('UPDATE people SET name = ?, emoji = ?, color = ? WHERE id = ?').run(player.name, player.emoji, player.color, row.id);
      return row.id;
    }
    return Number(this.db.prepare('INSERT INTO people (name, name_key, emoji, color) VALUES (?, ?, ?, ?)')
      .run(player.name, key, player.emoji, player.color).lastInsertRowid);
  }

  // Rekorde VOR diesem Spiel (für „Neuer Rekord!“ auf dem Endscreen)
  recordsBefore(excludeGameId = null) {
    const ex = excludeGameId || -1;
    const topScore = this.db.prepare('SELECT MAX(score) AS v FROM game_players WHERE game_id != ?').get(ex).v;
    const topStreak = this.db.prepare('SELECT MAX(best_streak) AS v FROM game_players WHERE game_id != ?').get(ex).v;
    return { topScore: topScore ?? 0, topStreak: topStreak ?? 0 };
  }

  personalBests(personIds, excludeGameId) {
    const out = {};
    const st = this.db.prepare('SELECT MAX(score) AS s, MAX(best_streak) AS b, COUNT(*) AS n FROM game_players WHERE person_id = ? AND game_id != ?');
    for (const id of personIds) out[id] = st.get(id, excludeGameId || -1);
    return out;
  }

  // Ein Spiel komplett (neu) speichern. Wird beim Spielende aufgerufen – auch erneut nach „Rückgängig“.
  record(room) {
    const g = room.game;
    if (!g || !g.finished) return null;
    const scored = g.log.length > 0;
    return tx(this.db, () => {
      if (room.recordId) this.db.prepare('DELETE FROM games WHERE id = ?').run(room.recordId);
      if (!scored) return null; // sofort beendet, nichts gespielt → nicht zählen
      const pmap = new Map(room.players.map(p => [p.id, p]));
      const personId = new Map();
      for (const p of g.players) personId.set(p.pid, this.personFor(pmap.get(p.pid) || { name: '?', emoji: '❓' }));
      const qCount = g.endedEarly ? Math.min(g.turns.length, g.idx + (g.phase === 'intro' ? 0 : 1)) : g.turns.length;
      const gameId = Number(this.db.prepare(`INSERT INTO games (room_code, mode, settings, started_at, ended_at, ended_early, question_count, player_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        room.code, g.mode, JSON.stringify(g.settings), new Date(g.startedAt).toISOString(), new Date().toISOString(),
        g.endedEarly ? 1 : 0, qCount, g.players.length,
      ).lastInsertRowid);
      const insP = this.db.prepare(`INSERT INTO game_players (game_id, person_id, emoji, color, score, place, correct, answered, best_streak, steals, duels_won, jokers_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of ranking(g)) {
        const pl = pmap.get(r.pid) || {};
        insP.run(gameId, personId.get(r.pid), pl.emoji ?? null, pl.color ?? null, r.score, r.place, r.correct, r.answered, r.best, r.steals, r.duelsWon, r.jokersUsed);
      }
      const insA = this.db.prepare('INSERT INTO answers (game_id, person_id, question_id, correct, points, ms, kind, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const a of g.log) {
        insA.run(gameId, personId.get(a.pid), a.q, a.ok ? 1 : 0, a.pts, a.ms ?? null, a.kind, a.text ?? null);
      }
      return gameId;
    });
  }

  unrecord(gameId) {
    if (gameId) this.db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
  }

  // Rekorde, die dieses Spiel gebrochen hat
  recordsFor(room) {
    const g = room.game;
    if (!g?.finished || !room.recordId) return [];
    const before = this.recordsBefore(room.recordId);
    const hadGames = this.db.prepare('SELECT COUNT(*) AS n FROM games WHERE id != ?').get(room.recordId).n > 0;
    const out = [];
    const r = ranking(g);
    const top = r[0];
    if (hadGames && top && top.score > before.topScore) out.push({ icon: '🏆', title: 'Neuer Punkte-Rekord', pids: [top.pid], value: `${top.score} Punkte in einem Spiel` });
    const bestStreak = Math.max(...g.players.map(p => p.best));
    if (hadGames && bestStreak >= 3 && bestStreak > before.topStreak) {
      out.push({ icon: '🔥', title: 'Längste Serie aller Zeiten', pids: g.players.filter(p => p.best === bestStreak).map(p => p.pid), value: `${bestStreak} am Stück` });
    }
    // Persönliche Bestleistungen
    const pmap = new Map(room.players.map(p => [p.id, p]));
    const st = this.db.prepare('SELECT MAX(gp.score) AS s, COUNT(*) AS n FROM game_players gp JOIN people pe ON pe.id = gp.person_id WHERE pe.name_key = ? AND gp.game_id != ?');
    for (const p of g.players) {
      const pl = pmap.get(p.pid);
      if (!pl) continue;
      const pb = st.get(nameKey(pl.name), room.recordId);
      if (pb.n >= 1 && p.score > pb.s && !out.some(o => o.title === 'Neuer Punkte-Rekord' && o.pids.includes(p.pid))) {
        out.push({ icon: '⭐', title: 'Persönliche Bestleistung', pids: [p.pid], value: `${p.score} Punkte (vorher ${pb.s})` });
      }
    }
    return out;
  }

  // ---------- Abfragen ----------
  overview() {
    const one = sql => this.db.prepare(sql).get();
    const g = one('SELECT COUNT(*) AS games, COUNT(DISTINCT date(ended_at)) AS evenings, MIN(started_at) AS first, MAX(ended_at) AS last FROM games');
    const a = one('SELECT COUNT(*) AS answers, AVG(correct) AS rate FROM answers WHERE kind != \'steal\'');
    const p = one('SELECT COUNT(DISTINCT person_id) AS players FROM game_players');
    const modes = this.db.prepare('SELECT mode, COUNT(*) AS n FROM games GROUP BY mode ORDER BY n DESC').all().map(r => ({ ...r }));
    return { ...g, ...a, ...p, modes };
  }

  leaderboard() {
    return this.db.prepare(`
      SELECT pe.id, pe.name, pe.emoji, pe.color,
        COUNT(*) AS games,
        SUM(gp.place = 1) AS wins,
        SUM(gp.score) AS points,
        ROUND(AVG(gp.score), 1) AS avg_score,
        SUM(gp.correct) AS correct,
        SUM(gp.answered) AS answered,
        MAX(gp.best_streak) AS best_streak,
        SUM(gp.steals) AS steals,
        MAX(g.ended_at) AS last_played
      FROM game_players gp
      JOIN people pe ON pe.id = gp.person_id
      JOIN games g ON g.id = gp.game_id
      GROUP BY pe.id
      ORDER BY wins DESC, CAST(wins AS REAL) / COUNT(*) DESC, avg_score DESC`).all().map(r => ({
      ...r, rate: r.answered ? r.correct / r.answered : null, win_rate: r.games ? r.wins / r.games : 0,
    }));
  }

  person(id) {
    const p = this.db.prepare('SELECT id, name, emoji, color, created_at FROM people WHERE id = ?').get(+id);
    if (!p) return null;
    const cats = this.db.prepare(`
      SELECT q.category, COUNT(*) AS n, SUM(a.correct) AS ok
      FROM answers a JOIN questions q ON q.id = a.question_id
      WHERE a.person_id = ? AND a.kind != 'steal'
      GROUP BY q.category ORDER BY n DESC`).all(p.id).map(r => ({ ...r, rate: r.ok / r.n }));
    const diffs = this.db.prepare(`
      SELECT q.difficulty AS d, COUNT(*) AS n, SUM(a.correct) AS ok
      FROM answers a JOIN questions q ON q.id = a.question_id
      WHERE a.person_id = ? AND a.kind != 'steal'
      GROUP BY q.difficulty ORDER BY d`).all(p.id).map(r => ({ ...r, rate: r.ok / r.n }));
    const games = this.db.prepare(`
      SELECT g.id, g.mode, g.ended_at, g.player_count, gp.score, gp.place, gp.correct, gp.answered
      FROM game_players gp JOIN games g ON g.id = gp.game_id
      WHERE gp.person_id = ? ORDER BY g.ended_at DESC LIMIT 50`).all(p.id).map(r => ({ ...r }));
    const modes = this.db.prepare(`
      SELECT g.mode, COUNT(*) AS games, SUM(gp.place = 1) AS wins, ROUND(AVG(gp.score), 1) AS avg_score
      FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE gp.person_id = ? GROUP BY g.mode`).all(p.id).map(r => ({ ...r }));
    const speed = this.db.prepare(`SELECT ROUND(AVG(ms)) AS avg_ms FROM answers WHERE person_id = ? AND kind IN ('buzz','typed') AND correct = 1 AND ms IS NOT NULL`).get(p.id);
    return { ...p, categories: cats, difficulties: diffs, games, modes, avg_ms: speed.avg_ms };
  }

  questions({ sort = 'hardest', min = 3, limit = 15 } = {}) {
    const order = {
      hardest: 'rate ASC, n DESC',
      easiest: 'rate DESC, n DESC',
      played: 'n DESC, rate ASC',
    }[sort] || 'rate ASC';
    return this.db.prepare(`
      SELECT q.id, q.question, q.answer, q.category, q.difficulty, COUNT(*) AS n, AVG(a.correct) AS rate
      FROM answers a JOIN questions q ON q.id = a.question_id
      WHERE a.kind != 'steal'
      GROUP BY q.id HAVING COUNT(*) >= ?
      ORDER BY ${order} LIMIT ?`).all(+min || 1, Math.min(100, +limit || 15)).map(r => ({ ...r }));
  }

  categories() {
    return this.db.prepare(`
      SELECT q.category, c.icon, COUNT(*) AS n, AVG(a.correct) AS rate
      FROM answers a JOIN questions q ON q.id = a.question_id LEFT JOIN categories c ON c.name = q.category
      WHERE a.kind != 'steal'
      GROUP BY q.category ORDER BY rate ASC`).all().map(r => ({ ...r }));
  }

  games({ limit = 20, offset = 0 } = {}) {
    const games = this.db.prepare('SELECT * FROM games ORDER BY ended_at DESC LIMIT ? OFFSET ?').all(Math.min(100, +limit || 20), +offset || 0).map(r => ({ ...r }));
    const st = this.db.prepare(`SELECT gp.*, pe.name FROM game_players gp JOIN people pe ON pe.id = gp.person_id WHERE gp.game_id = ? ORDER BY gp.place, gp.score DESC`);
    for (const g of games) {
      g.settings = JSON.parse(g.settings);
      g.players = st.all(g.id).map(r => ({ ...r }));
    }
    return games;
  }

  game(id) {
    const g = this.db.prepare('SELECT * FROM games WHERE id = ?').get(+id);
    if (!g) return null;
    const out = { ...g, settings: JSON.parse(g.settings) };
    out.players = this.db.prepare(`SELECT gp.*, pe.name FROM game_players gp JOIN people pe ON pe.id = gp.person_id WHERE gp.game_id = ? ORDER BY gp.place`).all(g.id).map(r => ({ ...r }));
    out.answers = this.db.prepare(`SELECT a.person_id, a.question_id, a.correct, a.points, a.ms, a.kind, a.text, q.question, q.answer, q.category, q.difficulty
      FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.game_id = ? ORDER BY a.id`).all(g.id).map(r => ({ ...r }));
    return out;
  }

  // Punkteverlauf für die Bestenliste (letzte N Spiele je Spieler)
  trends(n = 12) {
    const rows = this.db.prepare(`
      SELECT gp.person_id, gp.score, gp.place, g.ended_at FROM game_players gp JOIN games g ON g.id = gp.game_id
      ORDER BY g.ended_at`).all();
    const out = {};
    for (const r of rows) (out[r.person_id] ||= []).push({ score: r.score, place: r.place });
    for (const k of Object.keys(out)) out[k] = out[k].slice(-n);
    return out;
  }

  mergePeople(fromId, intoId) {
    fromId = +fromId; intoId = +intoId;
    if (fromId === intoId) throw new Error('Gleiche Person');
    const a = this.db.prepare('SELECT id FROM people WHERE id = ?');
    if (!a.get(fromId) || !a.get(intoId)) throw new Error('Person nicht gefunden');
    tx(this.db, () => {
      // Falls beide im selben Spiel waren, kann man nicht zusammenlegen
      const clash = this.db.prepare('SELECT COUNT(*) AS n FROM game_players x JOIN game_players y ON x.game_id = y.game_id WHERE x.person_id = ? AND y.person_id = ?').get(fromId, intoId).n;
      if (clash) throw new Error('Beide haben im selben Spiel mitgespielt – zusammenlegen nicht möglich');
      this.db.prepare('UPDATE game_players SET person_id = ? WHERE person_id = ?').run(intoId, fromId);
      this.db.prepare('UPDATE answers SET person_id = ? WHERE person_id = ?').run(intoId, fromId);
      this.db.prepare('DELETE FROM people WHERE id = ?').run(fromId);
    });
  }

  people() {
    return this.db.prepare(`SELECT pe.*, (SELECT COUNT(*) FROM game_players gp WHERE gp.person_id = pe.id) AS games FROM people pe ORDER BY name`).all().map(r => ({ ...r }));
  }

  export() {
    return {
      exported_at: new Date().toISOString(),
      overview: this.overview(),
      leaderboard: this.leaderboard(),
      games: this.games({ limit: 100 }),
    };
  }
}
