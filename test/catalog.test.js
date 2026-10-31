// Katalog-Sync: neue Fragen aus data/questions.json kommen per Update dazu,
// ohne Änderungen aus der Fragenverwaltung zu überschreiben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, openMemoryDb } from '../server/db.js';
import { QuestionStore } from '../server/questions.js';
import { SEED } from './helpers.js';

const catalog = JSON.parse(fs.readFileSync(SEED, 'utf8'));

test('Katalog ist in sich stimmig', () => {
  const ids = new Set();
  const texts = new Set();
  const cats = new Set(catalog.categories.map(c => c.name));
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const q of catalog.questions) {
    assert.ok(!ids.has(q.id), `doppelte id ${q.id}`);
    ids.add(q.id);
    assert.ok(!texts.has(norm(q.question)), `doppelte Frage: ${q.question}`);
    texts.add(norm(q.question));
    assert.ok(cats.has(q.category), `unbekannte Kategorie ${q.category} (#${q.id})`);
    assert.ok([1, 2, 3].includes(q.difficulty), `Schwierigkeit #${q.id}`);
    assert.ok(q.question.length >= 10 && q.answer.length >= 1, `#${q.id} unvollständig`);
  }
  const pairIds = new Set();
  const inPair = new Set();
  for (const p of catalog.pairs) {
    assert.ok(!pairIds.has(p.id), `doppelte Paar-id ${p.id}`);
    pairIds.add(p.id);
    assert.ok(ids.has(p.a) && ids.has(p.b) && p.a !== p.b, `Paar ${p.id} verweist ins Leere`);
    assert.ok(!inPair.has(p.a) && !inPair.has(p.b), `Frage in zwei Paaren (Paar ${p.id})`);
    inPair.add(p.a); inPair.add(p.b);
  }
});

test('Neue Datenbank bekommt den kompletten Katalog, zweiter Lauf ändert nichts', () => {
  const qs = new QuestionStore(openMemoryDb());
  const r = qs.syncSeed(SEED);
  assert.equal(r.questions, catalog.questions.length);
  assert.equal(r.pairs, catalog.pairs.length);
  assert.equal(r.errors.length, 0);
  assert.equal(qs.summary().questions, catalog.questions.length);
  const again = qs.syncSeed(SEED);
  assert.equal(again.questions + again.pairs + again.categories, 0);
});

test('Update einer v2.0.0-Datenbank: neue Fragen dazu, Admin-Änderungen bleiben', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-cat-'));
  try {
    // Zustand wie nach v2.0.0: Startkatalog (Fragen 1–500, Paare 1–70), dann in der Verwaltung gearbeitet
    let db = openDb(dir);
    db.exec('DROP TABLE seed_applied; PRAGMA user_version = 1;');
    let qs = new QuestionStore(db);
    const legacy = catalog.questions.filter(q => q.id <= 500);
    for (const [i, c] of catalog.categories.entries()) {
      db.prepare('INSERT INTO categories (name, icon, sort) VALUES (?, ?, ?)').run(c.name, c.icon, i + 1);
    }
    const ins = db.prepare("INSERT INTO questions (id, question, answer, category, difficulty, source) VALUES (?, ?, ?, ?, ?, 'original')");
    for (const q of legacy) ins.run(q.id, q.question, q.answer, q.category, q.difficulty);
    for (const p of catalog.pairs.filter(p => p.id <= 70)) db.prepare('INSERT INTO pairs (id, topic, a, b) VALUES (?, ?, ?, ?)').run(p.id, p.topic, p.a, p.b);
    qs.update(5, { active: false });                         // Frage deaktiviert
    qs.update(1, { answer: 'Canberra (geändert)' });         // Frage bearbeitet
    qs.deletePair(3);                                        // Duell-Paar gelöscht
    const own = qs.create({ question: 'Eigene Frage aus der Verwaltung?', answer: 'Ja', category: 'Mathe', difficulty: 1 });
    assert.equal(own.id, 501);                               // belegt die id einer neuen Katalogfrage
    db.close();

    // Update: Migration 2 + Katalog-Sync
    db = openDb(dir);
    qs = new QuestionStore(db);
    const r = qs.syncSeed(SEED);
    const newQ = catalog.questions.filter(q => q.id > 500).length;
    const newP = catalog.pairs.filter(p => p.id > 70).length;
    assert.equal(r.questions, newQ, 'alle neuen Katalogfragen übernommen');
    assert.equal(r.pairs, newP, 'alle neuen Paare übernommen');
    assert.deepEqual(r.errors, []);
    assert.equal(qs.getRow(5).active, 0, 'Deaktivierung bleibt');
    assert.equal(qs.getRow(1).answer, 'Canberra (geändert)', 'Bearbeitung bleibt');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pairs WHERE id = 3').get().n, 0, 'gelöschtes Paar bleibt gelöscht');
    assert.equal(qs.getRow(501).question, 'Eigene Frage aus der Verwaltung?', 'eigene Frage bleibt');
    const seed501 = catalog.questions.find(q => q.id === 501);
    if (seed501) assert.ok(db.prepare('SELECT id FROM questions WHERE question = ?').get(seed501.question), 'Katalogfrage 501 bekam eine andere id');
    // Neue Paare zeigen auf die richtigen Fragen, auch wenn ids verschoben wurden
    for (const p of catalog.pairs.filter(p => p.id > 70)) {
      const row = db.prepare('SELECT a, b FROM pairs WHERE topic = ?').get(p.topic.slice(0, 60));
      const qa = catalog.questions.find(q => q.id === p.a), qb = catalog.questions.find(q => q.id === p.b);
      assert.equal(qs.getRow(row.a).question, qa.question, `Paar ${p.topic}`);
      assert.equal(qs.getRow(row.b).question, qb.question, `Paar ${p.topic}`);
    }
    assert.equal(qs.summary().questions, catalog.questions.length - 1 + 1); // −1 deaktiviert, +1 eigene
    const again = qs.syncSeed(SEED);
    assert.equal(again.questions + again.pairs, 0, 'zweiter Start ändert nichts');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
