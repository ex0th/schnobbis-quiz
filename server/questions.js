// Fragen-Datenbank: Kategorien, Fragen, Duell-Paare, Auswahl ohne Wiederholung, Import/Export
import fs from 'node:fs';
import { tx } from './db.js';
import { shuffle } from './util.js';

export const DIFFS = [
  { v: 1, label: 'Leicht', icon: '🌱' },
  { v: 2, label: 'Mittel', icon: '🌸' },
  { v: 3, label: 'Schwer', icon: '🔥' },
];

const MAX_TEXT = 500;

function clean(s, max = MAX_TEXT) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export class QuestionStore {
  constructor(db) {
    this.db = db;
    this.cache = null;
  }

  invalidate() { this.cache = null; }

  // Alles Aktive einmal in den Speicher (ein paar hundert Zeilen – billig)
  load() {
    if (this.cache) return this.cache;
    const qs = this.db.prepare('SELECT id, question, answer, category, difficulty, active FROM questions').all();
    const byId = new Map(qs.map(q => [q.id, { id: q.id, q: q.question, a: q.answer, c: q.category, d: q.difficulty, active: !!q.active }]));
    const pairs = this.db.prepare('SELECT id, topic, a, b, active FROM pairs').all().map(p => {
      const qa = byId.get(p.a), qb = byId.get(p.b);
      return { id: p.id, t: p.topic, a: p.a, b: p.b, d: Math.max(qa?.d || 1, qb?.d || 1), active: !!p.active && !!qa?.active && !!qb?.active };
    });
    const categories = this.db.prepare('SELECT name, icon FROM categories ORDER BY sort, name').all().map(c => ({ name: c.name, icon: c.icon }));
    this.cache = { byId, pairs, pairById: new Map(pairs.map(p => [p.id, p])), categories };
    return this.cache;
  }

  get(id) { return this.load().byId.get(id) || null; }
  getPair(id) { return this.load().pairById.get(id) || null; }
  categories() { return this.load().categories; }

  isEmpty() { return this.db.prepare('SELECT COUNT(*) AS n FROM questions').get().n === 0; }

  // ---------- Auswahl ----------
  poolIds(kind, cats = [], diffs = []) {
    const { byId, pairs } = this.load();
    if (kind === 'p') {
      return pairs.filter(p => p.active && (!diffs.length || diffs.includes(p.d))).map(p => p.id);
    }
    const out = [];
    for (const q of byId.values()) {
      if (q.active && (!cats.length || cats.includes(q.c)) && (!diffs.length || diffs.includes(q.d))) out.push(q.id);
    }
    return out;
  }

  playedSet(kind) {
    return new Set(this.db.prepare('SELECT ref_id FROM played WHERE kind = ?').all(kind).map(r => r.ref_id));
  }

  // Wie im Original: erst ungespielte Fragen; ist die Auswahl aufgebraucht, wird sie wieder freigegeben.
  pick(kind, count, exclude = [], cats = [], diffs = [], rng = Math.random) {
    let all = this.poolIds(kind, cats, diffs);
    if (!all.length) all = this.poolIds(kind, cats, []);
    if (!all.length) all = this.poolIds(kind, [], []);
    if (!all.length) throw new Error(kind === 'p' ? 'Keine Duell-Paare vorhanden' : 'Keine Fragen vorhanden');
    const ex = new Set(exclude);
    const played = this.playedSet(kind);
    let avail = all.filter(id => !played.has(id) && !ex.has(id));
    const del = this.db.prepare('DELETE FROM played WHERE kind = ? AND ref_id = ?');
    if (avail.length < count) {
      tx(this.db, () => { for (const id of all) del.run(kind, id); });
      avail = all.filter(id => !ex.has(id));
    }
    const out = [];
    let bag = shuffle(avail, rng);
    while (out.length < count) {
      if (!bag.length) bag = shuffle(all, rng);
      out.push(bag.shift());
    }
    this.markPlayed(kind, out);
    return out;
  }

  markPlayed(kind, ids) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO played (kind, ref_id) VALUES (?, ?)');
    tx(this.db, () => { for (const id of ids) ins.run(kind, id); });
  }

  unplayed(kind, cats = [], diffs = []) {
    const played = this.playedSet(kind);
    return this.poolIds(kind, cats, diffs).filter(id => !played.has(id)).length;
  }

  resetPlayed() { this.db.exec('DELETE FROM played'); }

  summary() {
    const { byId, pairs, categories } = this.load();
    const active = [...byId.values()].filter(q => q.active);
    const playedQ = this.playedSet('q'), playedP = this.playedSet('p');
    const activePairs = pairs.filter(p => p.active);
    const catCount = {};
    for (const q of active) catCount[q.c] = (catCount[q.c] || 0) + 1;
    return {
      questions: active.length,
      unplayed: active.filter(q => !playedQ.has(q.id)).length,
      pairs: activePairs.length,
      unplayedPairs: activePairs.filter(p => !playedP.has(p.id)).length,
      byDifficulty: DIFFS.map(d => ({ ...d, count: active.filter(q => q.d === d.v).length })),
      categories: categories.map(c => ({ ...c, count: catCount[c.name] || 0 })),
      diffs: DIFFS,
    };
  }

  // Für die Spiel-Einstellungen: wie viele Fragen passen zur Auswahl?
  poolInfo(cats, diffs) {
    return {
      klassik: this.poolIds('q', cats, diffs).length,
      klassikFresh: this.unplayed('q', cats, diffs),
      duell: this.poolIds('p', [], diffs).length,
      duellFresh: this.unplayed('p', [], diffs),
    };
  }

  // ---------- Verwaltung ----------
  ensureCategory(name, icon) {
    name = clean(name, 40);
    if (!name) throw new Error('Kategorie fehlt');
    const row = this.db.prepare('SELECT name FROM categories WHERE name = ?').get(name);
    if (!row) {
      const sort = this.db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories').get().s;
      this.db.prepare('INSERT INTO categories (name, icon, sort) VALUES (?, ?, ?)').run(name, clean(icon, 8) || '🏷️', sort);
    } else if (icon) {
      this.db.prepare('UPDATE categories SET icon = ? WHERE name = ?').run(clean(icon, 8), name);
    }
    return name;
  }

  validate(input, partial = false) {
    const out = {};
    if (!partial || input.question !== undefined) {
      out.question = clean(input.question);
      if (out.question.length < 3) throw new Error('Frage ist zu kurz');
    }
    if (!partial || input.answer !== undefined) {
      out.answer = clean(input.answer);
      if (!out.answer) throw new Error('Lösung fehlt');
    }
    if (!partial || input.category !== undefined) {
      out.category = clean(input.category, 40);
      if (!out.category) throw new Error('Kategorie fehlt');
    }
    if (!partial || input.difficulty !== undefined) {
      out.difficulty = parseInt(input.difficulty, 10);
      if (![1, 2, 3].includes(out.difficulty)) throw new Error('Schwierigkeit muss 1, 2 oder 3 sein');
    }
    if (input.active !== undefined) out.active = input.active ? 1 : 0;
    if (input.source !== undefined) out.source = clean(input.source, 120) || null;
    return out;
  }

  list({ search = '', category = '', difficulty = 0, active = 'all', limit = 50, offset = 0 } = {}) {
    const where = [], args = [];
    if (search) { where.push('(question LIKE ? OR answer LIKE ? OR CAST(id AS TEXT) = ?)'); args.push(`%${search}%`, `%${search}%`, search); }
    if (category) { where.push('category = ?'); args.push(category); }
    if (difficulty) { where.push('difficulty = ?'); args.push(+difficulty); }
    if (active === '1' || active === true) where.push('active = 1');
    if (active === '0' || active === false) where.push('active = 0');
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM questions ${w}`).get(...args).n;
    const rows = this.db.prepare(`
      SELECT q.*, (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS times,
             (SELECT AVG(correct) FROM answers a WHERE a.question_id = q.id) AS rate,
             (SELECT p.id FROM pairs p WHERE p.a = q.id OR p.b = q.id LIMIT 1) AS pair_id
      FROM questions q ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(500, +limit || 50), +offset || 0);
    return { total, items: rows.map(r => ({ ...r })) };
  }

  getRow(id) {
    const r = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(+id);
    return r ? { ...r } : null;
  }

  create(input) {
    const v = this.validate(input);
    const r = tx(this.db, () => {
      this.ensureCategory(v.category);
      const id = input.id && !this.getRow(input.id) ? +input.id : null;
      return this.db.prepare(`INSERT INTO questions (id, question, answer, category, difficulty, active, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, v.question, v.answer, v.category, v.difficulty, v.active ?? 1, v.source ?? null);
    });
    this.invalidate();
    return this.getRow(Number(r.lastInsertRowid));
  }

  update(id, input) {
    if (!this.getRow(id)) return null;
    const v = this.validate(input, true);
    const keys = Object.keys(v);
    if (keys.length) {
      tx(this.db, () => {
        if (v.category) this.ensureCategory(v.category);
        this.db.prepare(`UPDATE questions SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...keys.map(k => v[k]), +id);
      });
      this.invalidate();
    }
    return this.getRow(id);
  }

  // Fragen werden nie hart gelöscht (Statistik hängt dran) – nur deaktiviert
  deactivate(id) { return this.update(id, { active: false }); }

  listPairs() {
    return this.db.prepare(`SELECT p.*, qa.question AS a_question, qb.question AS b_question
      FROM pairs p JOIN questions qa ON qa.id = p.a JOIN questions qb ON qb.id = p.b ORDER BY p.id DESC`).all().map(r => ({ ...r }));
  }

  savePair(input, id = null) {
    const topic = clean(input.topic, 60);
    const a = +input.a, b = +input.b;
    if (!topic) throw new Error('Thema fehlt');
    if (!this.getRow(a) || !this.getRow(b)) throw new Error('Frage-ID existiert nicht');
    if (a === b) throw new Error('Zwei verschiedene Fragen nötig');
    const active = input.active === undefined ? 1 : (input.active ? 1 : 0);
    let res;
    if (id) {
      this.db.prepare('UPDATE pairs SET topic = ?, a = ?, b = ?, active = ? WHERE id = ?').run(topic, a, b, active, +id);
      res = +id;
    } else {
      res = Number(this.db.prepare('INSERT INTO pairs (id, topic, a, b, active) VALUES (?, ?, ?, ?, ?)')
        .run(input.id && !this.db.prepare('SELECT 1 FROM pairs WHERE id = ?').get(+input.id) ? +input.id : null, topic, a, b, active).lastInsertRowid);
    }
    this.invalidate();
    return this.db.prepare('SELECT * FROM pairs WHERE id = ?').get(res);
  }

  deletePair(id) {
    this.db.prepare('DELETE FROM pairs WHERE id = ?').run(+id);
    this.db.prepare("DELETE FROM played WHERE kind = 'p' AND ref_id = ?").run(+id);
    this.invalidate();
  }

  export() {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      categories: this.db.prepare('SELECT name, icon FROM categories ORDER BY sort, name').all().map(r => ({ ...r })),
      questions: this.db.prepare('SELECT id, question, answer, category, difficulty, active, source FROM questions ORDER BY id').all().map(r => ({ ...r, active: !!r.active })),
      pairs: this.db.prepare('SELECT id, topic, a, b, active FROM pairs ORDER BY id').all().map(r => ({ ...r, active: !!r.active })),
    };
  }

  // Import: Fragen mit vorhandener id werden aktualisiert, neue angelegt.
  import(data) {
    if (!data || !Array.isArray(data.questions)) throw new Error('Erwartet: { questions: [...] }');
    const stats = { created: 0, updated: 0, pairs: 0, errors: [] };
    tx(this.db, () => {
      for (const c of data.categories || []) this.ensureCategory(c.name, c.icon);
      data.questions.forEach((q, i) => {
        try {
          const v = this.validate(q);
          this.ensureCategory(v.category);
          if (q.id && this.getRow(q.id)) {
            const keys = Object.keys(v);
            this.db.prepare(`UPDATE questions SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
              .run(...keys.map(k => v[k]), +q.id);
            stats.updated++;
          } else {
            this.db.prepare('INSERT INTO questions (id, question, answer, category, difficulty, active, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(q.id ? +q.id : null, v.question, v.answer, v.category, v.difficulty, v.active ?? 1, v.source ?? null);
            stats.created++;
          }
        } catch (e) {
          stats.errors.push({ index: i, error: e.message });
        }
      });
      for (const p of data.pairs || []) {
        try {
          const exists = p.id && this.db.prepare('SELECT 1 FROM pairs WHERE id = ?').get(+p.id);
          this.cache = null;
          this.savePair(p, exists ? p.id : null);
          stats.pairs++;
        } catch (e) {
          stats.errors.push({ pair: p.id, error: e.message });
        }
      }
    });
    this.invalidate();
    return stats;
  }

  seedFromFile(file) {
    if (!this.isEmpty() || !fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.categories?.forEach((c, i) => {
      this.db.prepare('INSERT OR IGNORE INTO categories (name, icon, sort) VALUES (?, ?, ?)').run(c.name, c.icon || '🏷️', i + 1);
    });
    return this.import({ ...data, questions: data.questions.map(q => ({ ...q, source: q.source || 'original' })) });
  }
}
