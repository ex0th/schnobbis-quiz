// TV-/Beamer-Ansicht: nur lesend, große Schrift, Querformat
import { esc, avatar } from '../lib/dom.js';
import { MODE_INFO, diffBadge, catIcon } from '../meta.js';
import { qcard, timerBox, finalBadge, progressLabel, ranking, endScreen, name } from './game-common.js';
import { duelResult, alleResult } from './game-host.js';

export function tvScreen(c) {
  const v = c.v;
  if (v.status === 'lobby' || !c.g) {
    const m = MODE_INFO[v.settings.mode];
    const url = `${location.host}/join/${v.code}`;
    return `
    <div class="screen tv tv-lobby">
      <div class="tv-join">
        <img class="qr big" src="/api/rooms/${v.code}/qr.svg" alt="QR-Code zum Beitreten">
        <div>
          <div class="kicker">Mitspielen</div>
          <div class="bigcode xl">${v.code}</div>
          <p class="muted">${esc(url)}</p>
          <p class="mode-line">${m.icon} ${m.name}</p>
        </div>
      </div>
      <div class="tv-players">${v.players.map(p => `<div class="tv-player pop">${avatar(p, 'xl')}<strong>${esc(p.name)}</strong></div>`).join('') || '<p class="muted">Noch niemand da – scannt den Code!</p>'}</div>
    </div>`;
  }
  const g = c.g;
  if (g.finished) return endScreen(c);
  let main = '';
  const who = pid => { const p = c.P(pid); return `${avatar(p, 'lg')}<div><span class="kicker">🔔 Gebuzzert</span><h2>${esc(p.name)}</h2></div>`; };
  if (g.phase === 'intro') {
    if (g.active != null) {
      main = `<div class="intro pop">${finalBadge(g)}${avatar(c.P(g.active), 'xxl')}<h1 class="turn-name">${name(c, g.active)} ist dran!</h1>
        <p class="cat-hint">${catIcon(g.question.cat)} ${esc(g.duel ? g.duel.topic : g.question.cat)}</p><p class="intro-diff">${diffBadge(g.question.d)}</p></div>`;
    } else {
      main = `<div class="intro pop">${finalBadge(g)}<div class="kicker">${MODE_INFO[g.mode].icon} ${progressLabel(g)}</div>
        <p class="cat-hint">${catIcon(g.question.cat)} <strong>${esc(g.question.cat)}</strong></p><p class="intro-diff">${diffBadge(g.question.d)}</p></div>`;
    }
  } else if (g.phase === 'duelResult') {
    main = duelResult(c);
  } else if (g.mode === 'alle' && g.phase === 'revealed') {
    main = alleResult(c);
  } else {
    const showA = ['revealed', 'steal'].includes(g.phase);
    let status = '';
    if (g.phase === 'buzzed') status = `<div class="buzzed-banner pop" style="--pc:${esc(c.P(g.buzz.pid).color)}">${who(g.buzz.pid)}</div>`;
    else if (g.mode === 'buzzer' && g.phase === 'question') status = `<div class="status-line pulse-soft">🔔 Wer weiß es?</div>`;
    else if (g.mode === 'alle' && g.phase === 'question') status = `<div class="status-line">✍️ ${(g.submitted || []).length} von ${g.scores.length} haben geantwortet</div>`;
    else if (g.mode === 'alle' && g.phase === 'review') status = `<div class="status-line">🧐 Der Spielleiter prüft …</div>`;
    else if (g.phase === 'steal') status = `<div class="status-line">🫳 Klau-Chance: Wer wusste es?</div>`;
    else if (g.mode === 'buzzer' && g.phase === 'revealed') {
      const w = g.result?.winner;
      status = `<div class="result-line pop">${w != null ? `${avatar(c.P(w), 'sm')} <strong>${name(c, w)}</strong> holt den Punkt!` : '😅 Diesmal keiner'}</div>`;
    } else if (g.active != null) status = `<div class="who">${avatar(c.P(g.active), 'sm')}<strong>${name(c, g.active)}</strong></div>`;
    main = `<div class="qwrap">${g.phase !== 'revealed' && g.phase !== 'steal' ? timerBox(c) : ''}${qcard(c, { showAnswer: showA, big: true })}${status}</div>`;
  }
  return `
  <div class="screen tv tv-play ${g.final ? 'is-final' : ''}">
    <div class="tv-main">
      <div class="tv-head"><span class="kicker">${MODE_INFO[g.mode].icon} ${progressLabel(g)}</span><span class="code-pill">${v.code}</span></div>
      <div class="progress"><div style="width:${Math.round((g.idx / g.total) * 100)}%"></div></div>
      <main class="stage">${main}</main>
    </div>
    <aside class="tv-board">
      <h3>🏅 Punkte</h3>
      <ol>${ranking(c).map(s => {
        const p = c.P(s.pid);
        return `<li class="${s.pid === (g.active ?? g.buzz?.pid) ? 'active' : ''} ${g.locked?.includes(s.pid) ? 'locked' : ''}">${avatar(p, 'sm')}<span>${esc(p.name)}</span>${s.streak >= 2 ? `<small>🔥${s.streak}</small>` : ''}${g.mode === 'alle' && g.phase === 'question' && g.submitted?.includes(s.pid) ? '<small>✓</small>' : ''}<b>${s.score}</b></li>`;
      }).join('')}</ol>
    </aside>
  </div>`;
}
