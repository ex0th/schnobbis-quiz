// REST-API: Räume, Meta, Statistik (öffentlich lesbar) und Fragenverwaltung (mit ADMIN_TOKEN)
import { renderSVG } from 'uqr';
import { sendJson, readJson, HttpError } from './http.js';
import { safeEqual } from './util.js';
import { EMOJIS } from './rooms.js';
import { DEFAULT_SETTINGS, PRESETS, TIMERS } from './engine.js';

export function createApi({ rooms, qs, stats, config }) {
  const routes = [];
  const on = (method, pattern, handler, { admin = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, admin });
  };

  const requireAdmin = req => {
    if (!config.adminToken) throw new HttpError(403, 'Fragenverwaltung ist abgeschaltet: ADMIN_TOKEN ist nicht gesetzt');
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok || !safeEqual(tok, config.adminToken)) throw new HttpError(401, 'Falsches oder fehlendes Admin-Token');
  };

  const baseUrl = req => {
    if (config.publicUrl) return config.publicUrl;
    const proto = config.trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : (req.socket.encrypted ? 'https' : 'http');
    const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
    return `${proto}://${host}`;
  };

  // ---------- Allgemein ----------
  on('GET', '/api/meta', () => ({
    ...qs.summary(),
    emojis: EMOJIS,
    defaults: DEFAULT_SETTINGS,
    presets: PRESETS,
    timers: TIMERS,
    admin: !!config.adminToken,
  }));

  on('POST', '/api/pool', async req => {
    const body = await readJson(req, 4096);
    return qs.poolInfo(Array.isArray(body.cats) ? body.cats.map(String) : [], Array.isArray(body.diffs) ? body.diffs.map(Number) : []);
  });

  // ---------- Räume ----------
  on('POST', '/api/rooms', () => {
    const room = rooms.create();
    return { code: room.code, hostToken: room.hostToken };
  });

  on('GET', '/api/rooms/:code', (req, p) => {
    const info = rooms.info(p.code);
    if (!info) throw new HttpError(404, 'Dieses Spiel gibt es nicht (mehr)');
    return info;
  });

  on('GET', '/api/rooms/:code/qr.svg', (req, p, res) => {
    const room = rooms.get(p.code);
    if (!room) throw new HttpError(404, 'Unbekanntes Spiel');
    const svg = renderSVG(`${baseUrl(req)}/join/${room.code}`, { border: 1, ecc: 'M', whiteColor: '#ffffff', blackColor: '#313857' });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=300' });
    res.end(svg);
    return undefined;
  });

  // ---------- Statistik ----------
  on('GET', '/api/stats', () => ({
    overview: stats.overview(),
    leaderboard: stats.leaderboard(),
    trends: stats.trends(),
    categories: stats.categories(),
    hardest: stats.questions({ sort: 'hardest' }),
    easiest: stats.questions({ sort: 'easiest' }),
    played: stats.questions({ sort: 'played', limit: 10 }),
    games: stats.games({ limit: 15 }),
  }));
  on('GET', '/api/stats/players/:id', (req, p) => stats.person(p.id) || (() => { throw new HttpError(404, 'Spieler nicht gefunden'); })());
  on('GET', '/api/stats/games', (req, p, res, url) => stats.games({ limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }));
  on('GET', '/api/stats/games/:id', (req, p) => stats.game(p.id) || (() => { throw new HttpError(404, 'Spiel nicht gefunden'); })());
  on('GET', '/api/stats/questions', (req, p, res, url) => stats.questions({ sort: url.searchParams.get('sort'), min: url.searchParams.get('min'), limit: url.searchParams.get('limit') }));
  on('GET', '/api/stats/export', () => stats.export());

  // ---------- Verwaltung (ADMIN_TOKEN) ----------
  on('GET', '/api/admin/check', () => ({ ok: true }), { admin: true });

  on('GET', '/api/questions', (req, p, res, url) => {
    const s = url.searchParams;
    return qs.list({ search: s.get('search') || '', category: s.get('category') || '', difficulty: +s.get('difficulty') || 0, active: s.get('active') ?? 'all', limit: s.get('limit'), offset: s.get('offset') });
  }, { admin: true });

  on('GET', '/api/questions/:id', (req, p) => qs.getRow(p.id) || (() => { throw new HttpError(404, 'Frage nicht gefunden'); })(), { admin: true });

  // Einzelne Frage oder Liste (Bulk) anlegen – praktisch für n8n & Co.
  on('POST', '/api/questions', async req => {
    const body = await readJson(req);
    if (Array.isArray(body)) return qs.import({ questions: body.map(({ id, ...q }) => q) });
    try { return qs.create(body); } catch (e) { throw new HttpError(400, e.message); }
  }, { admin: true });

  on('PATCH', '/api/questions/:id', async (req, p) => {
    const body = await readJson(req);
    let r;
    try { r = qs.update(p.id, body); } catch (e) { throw new HttpError(400, e.message); }
    if (!r) throw new HttpError(404, 'Frage nicht gefunden');
    return r;
  }, { admin: true });

  on('DELETE', '/api/questions/:id', (req, p) => {
    const r = qs.deactivate(p.id);
    if (!r) throw new HttpError(404, 'Frage nicht gefunden');
    return r;
  }, { admin: true });

  on('GET', '/api/categories', () => qs.categories());
  on('POST', '/api/categories', async req => {
    const body = await readJson(req, 4096);
    try { qs.ensureCategory(body.name, body.icon); } catch (e) { throw new HttpError(400, e.message); }
    qs.invalidate();
    return qs.categories();
  }, { admin: true });

  on('GET', '/api/pairs', () => qs.listPairs(), { admin: true });
  on('POST', '/api/pairs', async req => {
    try { return qs.savePair(await readJson(req, 4096)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
  }, { admin: true });
  on('PATCH', '/api/pairs/:id', async (req, p) => {
    try { return qs.savePair(await readJson(req, 4096), p.id); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
  }, { admin: true });
  on('DELETE', '/api/pairs/:id', (req, p) => { qs.deletePair(p.id); return { ok: true }; }, { admin: true });

  on('GET', '/api/export', (req, p, res) => {
    const body = JSON.stringify(qs.export(), null, 1);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="schnobbis-fragen-${new Date().toISOString().slice(0, 10)}.json"` });
    res.end(body);
  }, { admin: true });

  on('POST', '/api/import', async req => {
    try { return qs.import(await readJson(req, 10 * 1024 * 1024)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
  }, { admin: true });

  on('GET', '/api/people', () => stats.people(), { admin: true });
  on('POST', '/api/people/merge', async req => {
    const b = await readJson(req, 1024);
    try { stats.mergePeople(b.from, b.into); } catch (e) { throw new HttpError(400, e.message); }
    return { ok: true };
  }, { admin: true });

  return async function handle(req, res, url) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        if (r.admin) requireAdmin(req);
        const out = await r.handler(req, params, res, url);
        if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
      } catch (e) {
        const status = e.status || 500;
        if (status >= 500) console.error(e);
        if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'Interner Fehler' : e.message });
      }
      return true;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
      return true;
    }
    return false;
  };
}
