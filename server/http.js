// Kleine HTTP-Helfer: JSON, Body, statische Dateien, Sicherheits-Header
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return reject(new HttpError(415, 'Content-Type muss application/json sein'));
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Anfrage zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

// Statische Dateien. Build-ID = Hash über alle Dateien → Service-Worker-Cache versioniert sich selbst.
export class Static {
  constructor(dir) {
    this.dir = dir;
    this.files = new Map();
    this.scan();
  }

  scan() {
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
      const p = path.join(d, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
    const hash = crypto.createHash('sha256');
    for (const file of walk(this.dir).sort()) {
      const rel = '/' + path.relative(this.dir, file).split(path.sep).join('/');
      const buf = fs.readFileSync(file);
      hash.update(rel).update(buf);
      this.files.set(rel, { buf, type: MIME[path.extname(file)] || 'application/octet-stream', etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url') + '"' });
    }
    this.buildId = hash.digest('hex').slice(0, 10);
    // Service Worker mit Build-ID und Asset-Liste
    const sw = this.files.get('/sw.js');
    if (sw) {
      const assets = ['/', ...[...this.files.keys()].filter(k => k !== '/sw.js' && !k.endsWith('.txt') && k !== '/index.html')];
      const buf = Buffer.from(sw.buf.toString('utf8')
        .replace('__BUILD_ID__', this.buildId)
        .replace("'__ASSETS__'", JSON.stringify(assets)));
      this.files.set('/sw.js', { ...sw, buf, etag: '"' + this.buildId + '"' });
    }
    const idx = this.files.get('/index.html');
    if (idx) {
      const buf = Buffer.from(idx.buf.toString('utf8').replaceAll('__BUILD_ID__', this.buildId));
      this.files.set('/index.html', { ...idx, buf });
    }
  }

  serve(req, res, pathname) {
    let f = this.files.get(pathname);
    if (!f || pathname === '/index.html') return false;
    const headers = { 'Content-Type': f.type, ETag: f.etag };
    if (pathname === '/sw.js') headers['Cache-Control'] = 'no-cache';
    else if (pathname.startsWith('/fonts/') || pathname.startsWith('/icons/')) headers['Cache-Control'] = 'public, max-age=604800';
    else headers['Cache-Control'] = 'no-cache';
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); res.end(); return true; }
    headers['Content-Length'] = f.buf.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : f.buf);
    return true;
  }

  index(res) {
    const f = this.files.get('/index.html');
    res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache', 'Content-Length': f.buf.length });
    res.end(f.buf);
  }
}
