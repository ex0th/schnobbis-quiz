// Gemeinsame Bausteine für Spielleiter-, Spieler- und TV-Ansicht
import { esc, avatar } from '../lib/dom.js';
import { diffBadge, catIcon, MODE_INFO } from '../meta.js';

export function makeCtx(v, conn, local) {
  const byId = new Map(v.players.map(p => [p.id, p]));
  const P = pid => byId.get(pid);
  const g = v.game;
  const S = pid => g?.scores.find(s => s.pid === pid);
  const me = v.you.pid != null ? P(v.you.pid) : null;
  return { v, g, P, S, me, conn, local, role: v.you.role };
}

export const name = (c, pid) => esc(c.P(pid)?.name ?? '?');

export function progressLabel(g) {
  if (g.duel) return `Duell ${g.duel.k + 1} / ${g.duel.count}`;
  return `Frage ${Math.min(g.idx + 1, g.total)} / ${g.total}`;
}

export function topbar(c, { left = '', right = '' } = {}) {
  const g = c.g;
  const pct = g ? Math.round((g.idx / g.total) * 100) : 0;
  return `
  <header class="topbar">
    ${left || '<span class="spacer"></span>'}
    <div class="prog"><span>${g && !g.finished ? progressLabel(g) : ''}</span>${g && !g.finished ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}</div>
    ${right || '<span class="spacer"></span>'}
  </header>`;
}

export function scoreStrip(c, { activePid = null } = {}) {
  const g = c.g;
  return `<button class="strip" data-a="sheet" aria-label="Punktestand">${g.scores.map(s => {
    const p = c.P(s.pid);
    if (!p) return '';
    const off = p.kind === 'device' && !p.connected;
    const locked = g.locked?.includes(s.pid);
    const sub = g.mode === 'alle' && g.phase === 'question' && g.submitted?.includes(s.pid);
    return `<span class="chip ${s.pid === activePid ? 'active' : ''} ${s.pid === c.v.you.pid ? 'me' : ''} ${off ? 'off' : ''} ${locked ? 'locked' : ''}" style="--pc:${esc(p.color)}">${esc(p.emoji)}<b>${s.score}</b>${sub ? '<i class="tick">✓</i>' : ''}</span>`;
  }).join('')}<span class="chip more">⋯</span></button>`;
}

export function finalBadge(g) {
  return g.final ? `<div class="final-badge">🎉 Finale · doppelte Punkte</div>` : '';
}

export function timerBox(c) {
  const g = c.g;
  if (!g.timer) return '';
  const running = g.deadline > 0;
  const paused = !running && g.remaining > 0;
  if (!running && !paused) return '';
  return `<div class="timer ${paused ? 'paused' : ''}" id="timer"><div class="tbar"><div id="timerBar"></div></div><span id="timerNum">${paused ? '⏸' : ''}</span></div>`;
}

export function qcard(c, { showAnswer = false, big = false, answerLabel = 'Lösung' } = {}) {
  const g = c.g, q = g.question;
  const topic = g.duel ? g.duel.topic : q.cat;
  return `
  <div class="qcard ${big ? 'big' : ''}">
    <div class="qmeta"><span class="cat">${catIcon(q.cat)} ${esc(topic)}</span>${diffBadge(q.d)}</div>
    ${q.text ? `<p class="question">${esc(q.text)}</p>` : `<p class="question muted">…</p>`}
    ${showAnswer && q.answer ? `<div class="answer slide"><span class="muted small">${answerLabel}</span><p>${esc(q.answer)}</p></div>` : ''}
  </div>`;
}

export function introCard(c, extra = '') {
  const g = c.g, q = g.question;
  return `
  <div class="intro pop">
    ${finalBadge(g)}
    <div class="kicker">${MODE_INFO[g.mode].icon} ${progressLabel(g)}</div>
    <p class="cat-hint">${catIcon(q.cat)} <strong>${esc(q.cat)}</strong></p>
    <p class="intro-diff">${diffBadge(q.d)}${g.points > 1 ? `<span class="muted small">zählt ${g.points} Punkte</span>` : ''}</p>
    ${extra}
  </div>`;
}

export function ranking(c) {
  const out = c.g.scores.map(s => ({ ...s }));
  out.sort((a, b) => b.score - a.score || b.correct - a.correct || b.best - a.best);
  let place = 0, last = null;
  out.forEach((p, k) => { if (p.score !== last) { place = k + 1; last = p.score; } p.place = place; });
  return out;
}

export function scoreSheet(c) {
  const host = c.role === 'host';
  const g = c.g;
  return `
    <h3>🏅 Punktestand</h3>
    <ul class="results">
      ${ranking(c).map(s => {
        const p = c.P(s.pid);
        return `<li>
          <span class="place">${s.place}.</span>
          ${avatar(p, 'sm')}
          <span class="pname">${esc(p?.name)}${p?.kind === 'device' ? `<span class="dot ${p.connected ? 'on' : ''}" title="${p.connected ? 'verbunden' : 'nicht verbunden'}"></span>` : ''}
            <span class="muted small">${g.mode === 'klassik' ? ` · 🃏 ${s.jokers}` : ''}${s.streak >= 2 ? ` · 🔥 ${s.streak}` : ''}</span></span>
          ${host ? `<span class="stepper sm"><button data-a="adjust" data-pid="${s.pid}" data-d="-1">−</button><span>${s.score}</span><button data-a="adjust" data-pid="${s.pid}" data-d="1">＋</button></span>` : `<strong>${s.score}</strong>`}
        </li>`;
      }).join('')}
    </ul>
    ${host ? `<p class="muted small">Mit − / ＋ kannst du Punkte von Hand korrigieren.</p>
    <div class="sheet-actions">
      <button class="btn ghost" data-a="undo" ${g.canUndo ? '' : 'disabled'}>↩︎ Rückgängig</button>
      <button class="btn ghost danger" data-a="end">🏁 Spiel beenden</button>
    </div>
    ${g.mode === 'buzzer' || g.mode === 'alle' ? `<button class="btn ghost" data-a="showQr">📱 Nachzügler einladen</button>` : ''}
    <a class="btn ghost" href="/tv/${c.v.code}" target="_blank" rel="noopener">📺 TV-Ansicht öffnen</a>` : ''}
    <div class="setting"><div><strong>🔊 Sounds auf diesem Gerät</strong></div>${switchBtn('sound', c.local.sound)}</div>
    <button class="btn primary" data-a="closeSheet">Schließen</button>`;
}

export function switchBtn(key, on, action = 'toggle') {
  return `<button class="switch ${on ? 'on' : ''}" data-a="${action}" data-k="${key}" role="switch" aria-checked="${on}" aria-label="${key}"><span></span></button>`;
}

export function endScreen(c, { actions = '' } = {}) {
  const g = c.g;
  const r = g.ranking;
  const top = r.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const winners = r.filter(p => p.place === 1);
  const names = pids => pids.map(pid => name(c, pid)).join(' & ');
  const mine = c.v.you.pid != null ? r.find(x => x.pid === c.v.you.pid) : null;
  return `
  <div class="screen end">
    <div class="logo-wrap">
      <div class="kicker">🎉 Spiel vorbei${g.endedEarly ? ' (vorzeitig)' : ''}</div>
      <h1>${winners.length > 1 ? 'Gleichstand!' : `${name(c, winners[0].pid)} gewinnt!`}</h1>
      ${mine ? `<p class="muted">Du bist ${mine.place}. mit ${mine.score} Punkten</p>` : ''}
    </div>
    <div class="podium">
      ${order.map(s => `
        <div class="pod p${s.place}">
          ${s.place === 1 ? '<div class="crown">👑</div>' : ''}
          ${avatar(c.P(s.pid), s.place === 1 ? 'xl' : 'lg')}
          <strong>${name(c, s.pid)}</strong>
          <div class="block"><span>${s.place}</span><b>${s.score} P</b></div>
        </div>`).join('')}
    </div>
    ${g.records?.length ? `<div class="records">${g.records.map(a => `
      <div class="record"><span class="aic">${a.icon}</span><div><span class="muted small">${esc(a.title)}</span><strong>${names(a.pids)}</strong><span class="muted small">${esc(a.value)}</span></div></div>`).join('')}</div>` : ''}
    ${g.awards.length ? `<div class="awards">${g.awards.map(a => `
      <div class="award"><span class="aic">${a.icon}</span><span class="muted small">${esc(a.title)}</span><strong>${names(a.pids)}</strong><span class="muted small">${esc(a.value)}</span></div>`).join('')}</div>` : ''}
    <section class="card">
      <h3>📊 Auswertung</h3>
      <ul class="results">
        ${r.map(s => `
          <li class="${s.pid === c.v.you.pid ? 'me' : ''}">
            <span class="place">${s.place}.</span>
            ${avatar(c.P(s.pid), 'sm')}
            <span class="pname">${name(c, s.pid)}</span>
            <span class="stats muted small">✅ ${s.correct}/${s.answered} · 🔥 ${s.best}${g.mode === 'duell' ? ` · ⚔️ ${s.duelsWon}` : ''}${g.mode === 'buzzer' ? ` · 🔔 ${s.buzzWins}` : ''}${g.mode === 'alle' ? ` · ⚡ ${s.fastest}` : ''}</span>
            <strong>${s.score}</strong>
          </li>`).join('')}
      </ul>
    </section>
    ${actions}
  </div>`;
}

export function connDot(p) {
  if (!p || p.kind !== 'device') return '';
  return `<span class="dot ${p.connected ? 'on' : ''}" title="${p.connected ? 'verbunden' : 'nicht verbunden'}"></span>`;
}
