// Lokaler Speicher pro Gerät: Host-/Spieler-Tokens für den Wiedereinstieg, letzter Name, Sound
const K = 'sq2';
function load() { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch { return {}; } }
function save(s) { try { localStorage.setItem(K, JSON.stringify(s)); } catch {} }

export const store = {
  get(k, d) { const v = load()[k]; return v === undefined ? d : v; },
  set(k, v) { const s = load(); s[k] = v; save(s); },
  session(code) { return (load().sessions || {})[code] || null; },
  setSession(code, data) {
    const s = load();
    s.sessions = s.sessions || {};
    s.sessions[code] = { ...data, at: Date.now() };
    // Alte Sitzungen nach 2 Tagen vergessen
    for (const [c, v] of Object.entries(s.sessions)) if (Date.now() - (v.at || 0) > 2 * 864e5) delete s.sessions[c];
    save(s);
  },
  dropSession(code) { const s = load(); if (s.sessions) delete s.sessions[code]; save(s); },
  lastSession() {
    const all = Object.entries(load().sessions || {}).sort((a, b) => b[1].at - a[1].at);
    return all.length ? { code: all[0][0], ...all[0][1] } : null;
  },
};
