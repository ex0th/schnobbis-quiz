// Stammdaten vom Server (Kategorien, Icons, Emojis, Voreinstellungen)
import { api } from './lib/dom.js';

export const meta = {
  categories: [],
  icons: {},
  emojis: ['🦊', '🐼', '🐸', '🦁', '🐙', '🐧', '🦄', '🐯', '🐨', '🐵', '🦉', '🐢', '🐷', '🐰', '🦖', '🐳'],
  diffs: [{ v: 1, label: 'Leicht', icon: '🌱' }, { v: 2, label: 'Mittel', icon: '🌸' }, { v: 3, label: 'Schwer', icon: '🔥' }],
  presets: [3, 5, 10, 15, 20],
  timers: [0, 15, 30, 60],
  summary: null,
  admin: false,
};

export async function loadMeta() {
  try {
    const m = await api('/api/meta');
    meta.summary = m;
    meta.categories = m.categories.map(c => c.name);
    meta.icons = Object.fromEntries(m.categories.map(c => [c.name, c.icon]));
    meta.emojis = m.emojis;
    meta.diffs = m.diffs;
    meta.presets = m.presets;
    meta.timers = m.timers;
    meta.admin = m.admin;
  } catch {
    /* offline – Standardwerte reichen für die Startseite */
  }
  return meta;
}

export function diffBadge(d) {
  const x = meta.diffs[d - 1];
  return x ? `<span class="diff d${d}">${x.icon} ${x.label}</span>` : '';
}

export const catIcon = c => meta.icons[c] || '🏷️';

export const MODE_INFO = {
  klassik: { icon: '🎯', name: 'Klassik', desc: 'Jeder bekommt reihum eine eigene Frage' },
  duell: { icon: '⚔️', name: 'Duell', desc: 'Zwei Spieler, zwei vergleichbare Fragen. Nur einer richtig = +1 Extrapunkt' },
  buzzer: { icon: '🔔', name: 'Buzzer', desc: 'Alle sehen die Frage – wer zuerst buzzert, darf antworten', phones: true },
  alle: { icon: '✍️', name: 'Alle tippen', desc: 'Jeder tippt seine Antwort ins Handy, dann wird aufgelöst', phones: true },
};
