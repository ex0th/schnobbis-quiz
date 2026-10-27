import crypto from 'node:crypto';

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function token(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Für Raumcodes: ohne I, O, 0, 1 – nichts Verwechselbares
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function roomCode() {
  let s = '';
  const b = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
  return s;
}
export const CODE_RE = /^[A-HJ-NP-Z]{4}$/;

export function nameKey(name) {
  return String(name).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Antwort-Vergleich für „Alle tippen“: normalisieren + Tippfehler-Toleranz
export function normalizeAnswer(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(der|die|das|den|dem|des|ein|eine|einer|the|a|an|von|van|de|la|le)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Lösungen enthalten oft Alternativen: „Nil (Amazonas auch gelten lassen)“, „Bern (offiziell …)“,
// „Dmitri Mendelejew (Lothar Meyer auch gelten lassen)“, „Indien (auch Pakistan/Persien …)“
export function answerVariants(solution) {
  const s = String(solution);
  const variants = new Set();
  const main = s.replace(/\(.*?\)/g, ' ').trim();
  variants.add(main);
  for (const part of main.split(/\s*(?:\/|;| oder | bzw\. )\s*/)) variants.add(part);
  for (const m of s.matchAll(/\(([^)]*)\)/g)) {
    const inner = m[1].replace(/\b(auch|gelten lassen|geht auch|zählt auch|offiziell)\b/gi, ' ');
    for (const part of inner.split(/\s*(?:\/|,|;| oder | und )\s*/)) if (part.trim()) variants.add(part);
  }
  // Zahlen mit Tausenderpunkt: „1.440“ → „1440“
  for (const v of [...variants]) if (/^[\d.]+$/.test(v.trim())) variants.add(v.replace(/\./g, ''));
  // Nachnamen allein zählen auch: „Albert Einstein“ → „Einstein“
  for (const v of [...variants]) {
    const words = normalizeAnswer(v).split(' ');
    if (words.length >= 2 && words.length <= 4 && /^[A-ZÄÖÜ]/.test(v.trim())) variants.add(words[words.length - 1]);
  }
  return [...variants].map(normalizeAnswer).filter(v => v.length > 0);
}

export function suggestCorrect(given, solution) {
  const g = normalizeAnswer(given);
  if (!g) return false;
  for (const v of answerVariants(solution)) {
    if (g === v) return true;
    if (/^\d+$/.test(v) || /^\d+$/.test(g)) continue; // Zahlen müssen exakt passen
    const tol = v.length <= 4 ? 0 : v.length <= 8 ? 1 : 2;
    if (levenshtein(g, v) <= tol) return true;
    // „Leonardo da Vinci“ vs. „da Vinci“: getippte Antwort deckt ein ganzes Wort der Lösung ab
    if (g.length >= 4 && v.split(' ').some(w => w.length >= 4 && levenshtein(w, g) <= (w.length <= 6 ? 1 : 2))) return true;
  }
  return false;
}
