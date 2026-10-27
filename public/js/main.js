// Router + globale Event-Delegation
import { $app, closeSheet, toast } from './lib/dom.js';
import { stopConfetti, keepAwake } from './lib/fx.js';
import { unlockAudio } from './lib/sfx.js';
import { loadMeta } from './meta.js';

const routes = [
  [/^\/$/, () => import('./views/home.js'), () => ({})],
  [/^\/new$/, () => import('./views/home.js'), () => ({ create: true })],
  [/^\/join\/?$/, () => import('./views/home.js'), () => ({ join: true })],
  [/^\/join\/([A-Za-z]{4})$/, () => import('./views/game.js'), m => ({ code: m[1].toUpperCase(), as: 'player' })],
  [/^\/host\/([A-Za-z]{4})$/, () => import('./views/game.js'), m => ({ code: m[1].toUpperCase(), as: 'host' })],
  [/^\/tv\/([A-Za-z]{4})$/, () => import('./views/game.js'), m => ({ code: m[1].toUpperCase(), as: 'tv' })],
  [/^\/stats(?:\/(player|game)\/(\d+))?$/, () => import('./views/stats.js'), m => ({ kind: m[1], id: m[2] })],
  [/^\/admin$/, () => import('./views/admin.js'), () => ({})],
];

let current = null;
let navSeq = 0;

export async function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname + location.search) {
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
  }
  await route();
}

async function route() {
  const seq = ++navSeq;
  const path = location.pathname;
  let hit = null;
  for (const [re, load, params] of routes) {
    const m = path.match(re);
    if (m) { hit = { load, params: params(m) }; break; }
  }
  try { current?.unmount?.(); } catch {}
  current = null;
  closeSheet();
  stopConfetti();
  keepAwake(false);
  document.body.dataset.route = path.split('/')[1] || 'home';
  if (!hit) {
    $app.innerHTML = `<div class="screen center"><h2>Seite nicht gefunden</h2><a class="btn primary" href="/" data-link>Zur Startseite</a></div>`;
    return;
  }
  const mod = await hit.load();
  if (seq !== navSeq) return;
  current = mod.mount(hit.params, { navigate });
  window.scrollTo(0, 0);
}

// ---------- Events: alles über data-a / data-link / data-form ----------
document.addEventListener('click', e => {
  unlockAudio();
  const link = e.target.closest('a[data-link]');
  if (link && !e.metaKey && !e.ctrlKey && link.target !== '_blank') {
    e.preventDefault();
    navigate(link.getAttribute('href'));
    return;
  }
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  if (el.dataset.a === 'closeSheet') { closeSheet(); return; }
  current?.onAction?.(el.dataset.a, el, e);
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  unlockAudio();
  current?.onSubmit?.(f.dataset.form, f, e);
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el) current?.onInput?.(el.dataset.input, el, e);
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) current?.onChange?.(el.dataset.change, el, e);
});

window.addEventListener('popstate', route);
window.addEventListener('unhandledrejection', e => { toast('⚠️ ' + (e.reason?.message || 'Fehler')); });

loadMeta().finally(route);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
