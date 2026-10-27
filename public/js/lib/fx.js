// Konfetti und Bildschirm-wach-halten
const COLORS = ['#598099', '#EDBABC', '#BB7B85', '#E8CF97', '#313857', '#9DBACB', '#D6969E', '#7C87AE', '#C7A2B8', '#8FAE9F', '#E3A587'];

let confettiRun = 0;
export function stopConfetti() {
  confettiRun++;
  const c = document.getElementById('confetti');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}
export function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const run = ++confettiRun;
  const c = document.getElementById('confetti');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    vy: 2 + Math.random() * 3, vx: -1.5 + Math.random() * 3,
    r: Math.random() * Math.PI, vr: -0.2 + Math.random() * 0.4,
    col: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  let frame = 0;
  (function tick() {
    if (run !== confettiRun) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (++frame < 260) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

let wakeLock = null;
let wantAwake = false;
export async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantAwake) keepAwake(true);
});
