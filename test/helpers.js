import { openMemoryDb } from '../server/db.js';
import { QuestionStore } from '../server/questions.js';
import { Stats } from '../server/stats.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/questions.json');

export function setup() {
  const db = openMemoryDb();
  const qs = new QuestionStore(db);
  qs.syncSeed(SEED);
  const stats = new Stats(db);
  return { db, qs, stats };
}

// Deterministischer Zufall
export function rng(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export const players = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, emoji: '🦊', color: '#000', kind: 'device' }));
