// Kleine Töne ohne Audiodateien (wie im Original)
import { store } from './store.js';

let actx = null;
export const soundOn = () => store.get('sound', true);
export function setSound(on) { store.set('sound', !!on); }

// iOS: AudioContext muss in einer Nutzer-Geste entsperrt werden
export function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
}

function tone(freqs, dur = 0.12, type = 'sine', gap = 0.09, vol = 0.18) {
  if (!soundOn()) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    freqs.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      const t0 = actx.currentTime + i * gap;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    });
  } catch {}
}

export const sfx = {
  ok: () => tone([660, 880], 0.14),
  no: () => tone([300, 220], 0.18, 'triangle', 0.12),
  bonus: () => tone([660, 880, 1100, 1320], 0.12, 'sine', 0.07),
  tick: () => tone([880], 0.05, 'square', 0.09, 0.1),
  timeup: () => tone([440, 330, 220], 0.2, 'sawtooth', 0.14, 0.12),
  win: () => tone([523, 659, 784, 1046, 784, 1046], 0.16, 'triangle', 0.12),
  buzz: () => tone([220, 220], 0.25, 'square', 0.05, 0.16),
  join: () => tone([523, 784], 0.1, 'sine', 0.08, 0.12),
  show: () => tone([587], 0.08, 'sine', 0.05, 0.1),
  turn: () => tone([784, 988, 1175], 0.1, 'sine', 0.07),
  joker: () => tone([440, 660, 440, 880], 0.08, 'triangle', 0.06),
  start: () => tone([392, 523, 659, 784], 0.12, 'triangle', 0.08),
  reopen: () => tone([523], 0.1, 'sine', 0.05, 0.1),
};
