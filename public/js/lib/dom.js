// DOM-Helfer, Toast, Bottom-Sheet
export const $app = document.getElementById('app');
export const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const $net = document.getElementById('net');

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Rendert HTML in einen Container und erhält dabei Eingaben (Wert, Fokus, Cursor) und Scrollposition
export function patch(el, html, { keepScroll = false } = {}) {
  const active = document.activeElement;
  const keep = {};
  el.querySelectorAll('input[id], textarea[id], select[id]').forEach(i => {
    if (i.dataset.keep === 'no') return;
    keep[i.id] = { value: i.value, focus: i === active, start: i.selectionStart, end: i.selectionEnd };
  });
  const y = window.scrollY;
  el.innerHTML = html;
  for (const [id, s] of Object.entries(keep)) {
    const i = document.getElementById(id);
    if (!i || i.dataset.keep === 'no') continue;
    if (i.type !== 'checkbox' && i.type !== 'radio' && i.tagName !== 'SELECT' && !i.dataset.server) i.value = s.value;
    if (s.focus) {
      i.focus({ preventScroll: true });
      try { if (s.start != null) i.setSelectionRange(s.start, s.end); } catch {}
    }
  }
  if (keepScroll) window.scrollTo(0, y);
}

let toastT;
export function toast(msg, ms = 2400) {
  if (!msg) return;
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => $toast.classList.remove('show'), ms);
}

export function netStatus(text) {
  $net.textContent = text || '';
  $net.classList.toggle('show', !!text);
}

export function openSheet(html) {
  $sheet.innerHTML = `<div class="backdrop" data-a="closeSheet"></div><div class="panel"><div class="grab"></div>${html}</div>`;
  requestAnimationFrame(() => $sheet.classList.add('open'));
}
export function updateSheet(html) {
  const p = $sheet.querySelector('.panel');
  if (p && $sheet.classList.contains('open')) patch(p, `<div class="grab"></div>${html}`);
}
export function closeSheet() { $sheet.classList.remove('open'); }
export const sheetOpen = () => $sheet.classList.contains('open');

export function avatar(p, size = '') {
  if (!p) return `<span class="avatar ${size}" style="--pc:#ccc">❓</span>`;
  return `<span class="avatar ${size}" style="--pc:${esc(p.color)}">${esc(p.emoji)}</span>`;
}

export function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

export function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

export function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function pct(x) { return x == null ? '–' : Math.round(x * 100) + ' %'; }

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `Fehler ${res.status}`), { status: res.status });
  return data;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
