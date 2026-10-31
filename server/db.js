import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1: Grundschema
  `
  CREATE TABLE categories (
    name TEXT PRIMARY KEY,
    icon TEXT NOT NULL DEFAULT '🏷️',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE questions (
    id INTEGER PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES categories(name) ON UPDATE CASCADE,
    difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
    active INTEGER NOT NULL DEFAULT 1,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_questions_cat ON questions(category, difficulty) WHERE active = 1;
  CREATE TABLE pairs (
    id INTEGER PRIMARY KEY,
    topic TEXT NOT NULL,
    a INTEGER NOT NULL REFERENCES questions(id),
    b INTEGER NOT NULL REFERENCES questions(id),
    active INTEGER NOT NULL DEFAULT 1
  );
  -- Fragen/Paare, die schon gespielt wurden (kommen erst wieder, wenn der Pool leer ist)
  CREATE TABLE played (
    kind TEXT NOT NULL,          -- 'q' = Frage, 'p' = Duell-Paar
    ref_id INTEGER NOT NULL,
    PRIMARY KEY (kind, ref_id)
  );
  -- Spieler über alle Spielabende hinweg (erkannt am Namen)
  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    emoji TEXT,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    room_code TEXT,
    mode TEXT NOT NULL,
    settings TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    ended_early INTEGER NOT NULL DEFAULT 0,
    question_count INTEGER NOT NULL,
    player_count INTEGER NOT NULL
  );
  CREATE TABLE game_players (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id),
    emoji TEXT, color TEXT,
    score INTEGER NOT NULL, place INTEGER NOT NULL,
    correct INTEGER NOT NULL, answered INTEGER NOT NULL,
    best_streak INTEGER NOT NULL, steals INTEGER NOT NULL DEFAULT 0,
    duels_won INTEGER NOT NULL DEFAULT 0, jokers_used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, person_id)
  );
  CREATE TABLE answers (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id),
    question_id INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    points INTEGER NOT NULL,
    ms INTEGER,
    kind TEXT NOT NULL,          -- turn | steal | buzz | typed
    text TEXT
  );
  CREATE INDEX idx_answers_q ON answers(question_id);
  CREATE INDEX idx_answers_p ON answers(person_id);
  CREATE TABLE rooms (
    code TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // 2: Katalog-Sync. Merkt sich, welche Fragen/Paare aus data/questions.json schon übernommen wurden –
  // so kommen neue Katalogfragen per Update dazu, ohne gelöschte oder geänderte Einträge zurückzuholen.
  db => {
    db.exec(`
      CREATE TABLE seed_applied (
        kind TEXT NOT NULL,        -- 'q' = Frage, 'p' = Duell-Paar
        seed_id INTEGER NOT NULL,  -- id im Katalog (data/questions.json)
        ref_id INTEGER,            -- id in der Datenbank (NULL = bewusst nicht übernommen/gelöscht)
        PRIMARY KEY (kind, seed_id)
      );
    `);
    // Datenbanken aus v2.0.0 wurden mit dem Startkatalog befüllt: Fragen 1–500, Duell-Paare 1–70.
    // Ids sind dort identisch. Fehlende Paare wurden vom Admin gelöscht und bleiben gelöscht.
    if (db.prepare('SELECT COUNT(*) AS n FROM questions').get().n > 0) {
      db.exec(`
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
        INSERT INTO seed_applied (kind, seed_id, ref_id)
          SELECT 'q', i, (SELECT id FROM questions WHERE id = i) FROM n;
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 70)
        INSERT INTO seed_applied (kind, seed_id, ref_id)
          SELECT 'p', i, (SELECT id FROM pairs WHERE id = i) FROM n;
      `);
    }
  },
];

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'quiz.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

export function openMemoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = v; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      const m = MIGRATIONS[i];
      if (typeof m === 'function') m(db); else db.exec(m);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
