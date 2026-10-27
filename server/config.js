import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

export const config = {
  root,
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(root, 'data-local'),
  publicDir: path.join(root, 'public'),
  seedFile: process.env.SEED_FILE || path.join(root, 'data', 'questions.json'),
  // Ohne ADMIN_TOKEN ist die Fragenverwaltung abgeschaltet.
  adminToken: process.env.ADMIN_TOKEN || '',
  // Basis-URL für QR-Codes, z. B. https://quiz.example.de (sonst aus dem Request abgeleitet)
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // Räume ohne Aktivität werden nach so vielen Stunden gelöscht
  roomTtlHours: int(process.env.ROOM_TTL_HOURS, 12),
  maxRooms: int(process.env.MAX_ROOMS, 200),
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
};
