// Schnobbis Quiz – Server
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { openDb } from './db.js';
import { QuestionStore } from './questions.js';
import { Stats } from './stats.js';
import { RoomManager } from './rooms.js';
import { createApi } from './api.js';
import { Static, securityHeaders, sendJson } from './http.js';

export function createServer(cfg = config, db = openDb(cfg.dataDir)) {
  const qs = new QuestionStore(db);
  const seeded = qs.syncSeed(cfg.seedFile);
  if (seeded && (seeded.questions || seeded.pairs || seeded.errors.length)) {
    console.log(`Fragenkatalog: ${seeded.questions} neue Fragen, ${seeded.pairs} neue Duell-Paare übernommen${seeded.errors.length ? ` (${seeded.errors.length} Fehler: ${JSON.stringify(seeded.errors.slice(0, 3))})` : ''}`);
  }
  const stats = new Stats(db);
  const rooms = new RoomManager({ db, qs, stats, config: cfg });
  const restored = rooms.loadPersisted();
  if (restored) console.log(`${restored} offene Spielräume wiederhergestellt`);
  const api = createApi({ rooms, qs, stats, config: cfg });
  const files = new Static(cfg.publicDir);

  // Seiten der App (alles andere ist API oder Datei)
  const PAGES = /^\/(?:|join(?:\/[A-Za-z]{4})?|host\/[A-Za-z]{4}|tv\/[A-Za-z]{4}|stats(?:\/.*)?|admin|new)$/;

  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400).end(); return; }
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, build: files.buildId, rooms: rooms.rooms.size });
    if (await api(req, res, url)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (files.serve(req, res, url.pathname)) return;
    if (PAGES.test(url.pathname) || url.pathname === '/index.html') return files.index(res);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => rooms.connection(ws));
  });
  const hb = setInterval(() => rooms.heartbeat(wss), 25000);
  const gc = setInterval(() => rooms.cleanup(), 15 * 60 * 1000);
  hb.unref(); gc.unref();

  const close = () => new Promise(resolve => {
    clearInterval(hb); clearInterval(gc);
    rooms.flushAll();
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.close(() => { try { db.close(); } catch {} resolve(); });
  });

  return { server, wss, rooms, qs, stats, files, close };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = createServer();
  app.server.listen(config.port, config.host, () => {
    console.log(`Schnobbis Quiz läuft auf http://${config.host}:${config.port} (Build ${app.files.buildId})`);
    if (!config.adminToken) console.log('Hinweis: ADMIN_TOKEN nicht gesetzt – Fragenverwaltung ist abgeschaltet.');
  });
  const stop = sig => {
    console.log(`${sig} empfangen, fahre herunter …`);
    app.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
