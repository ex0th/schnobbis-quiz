// Fragen aus einer JSON-Datei in die Datenbank importieren (ohne laufenden Server)
// Aufruf: npm run import -- pfad/zu/fragen.json
//   im Container: docker compose exec quiz node --disable-warning=ExperimentalWarning scripts/import-questions.js /data/fragen.json
import fs from 'node:fs';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { QuestionStore } from '../server/questions.js';

const file = process.argv[2];
if (!file) {
  console.error('Bitte eine JSON-Datei angeben: npm run import -- fragen.json');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const qs = new QuestionStore(openDb(config.dataDir));
const r = qs.import(Array.isArray(data) ? { questions: data } : data);
console.log(`${r.created} neu, ${r.updated} aktualisiert, ${r.pairs} Duell-Paare`);
for (const e of r.errors) console.log('  Fehler:', JSON.stringify(e));
