// Statistik: Bestenliste, Spieler-Details, Fragen, Spiele
import { $app, esc, api, avatar, pct, fmtDate, patch } from '../lib/dom.js';
import { MODE_INFO, catIcon, diffBadge, meta } from '../meta.js';

// Einfarbige Balken (eine Größe → ein Farbton), Werte als Text-Label daneben
function bars(rows, { label, value, fmt = pct, note = () => '' }) {
  if (!rows.length) return `<p class="muted small">Noch keine Daten.</p>`;
  return `<ul class="bars">${rows.map(r => {
    const v = value(r);
    const w = Math.max(2, Math.round((v ?? 0) * 100));
    return `<li title="${esc(`${label(r, true)}: ${fmt(v)} ${note(r)}`)}">
      <span class="bl">${label(r)}</span>
      <span class="bt"><span class="bf" style="width:${w}%"></span></span>
      <span class="bv">${fmt(v)}<small>${note(r)}</small></span>
    </li>`;
  }).join('')}</ul>`;
}

// Punkteverlauf: eine Linie, Endpunkt markiert, Hover-Titel je Punkt
function sparkline(points) {
  if (!points || points.length < 2) return '';
  const W = 96, H = 28, pad = 4;
  const max = Math.max(...points.map(p => p.score), 1);
  const min = Math.min(...points.map(p => p.score), 0);
  const x = i => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = s => H - pad - ((s - min) / (max - min || 1)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Punkte der letzten ${points.length} Spiele">
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.score)}" r="7" fill="transparent"><title>Spiel ${i + 1}: ${p.score} Punkte (Platz ${p.place})</title></circle>`).join('')}
    <circle cx="${x(points.length - 1)}" cy="${y(last.score)}" r="3.5" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
  </svg>`;
}

const header = (title, back = '/') => `<header class="topbar"><a class="icon-btn" href="${back}" data-link aria-label="Zurück">‹</a><h2>${title}</h2><span class="spacer"></span></header>`;

const modeLabel = m => `${MODE_INFO[m]?.icon || ''} ${MODE_INFO[m]?.name || m}`;

function overviewPage(d) {
  const o = d.overview;
  if (!o.games) {
    return `<div class="screen stats">${header('📊 Statistik')}
      <div class="card center-text"><div class="big-emoji">📭</div><h3>Noch keine Spiele</h3><p class="muted">Sobald ihr ein Spiel zu Ende gespielt habt, erscheint hier die ewige Bestenliste.</p></div></div>`;
  }
  return `
  <div class="screen stats">
    ${header('📊 Statistik')}
    <div class="tiles">
      <div class="tile"><b>${o.games}</b><span>Spiele</span></div>
      <div class="tile"><b>${o.evenings}</b><span>Spielabende</span></div>
      <div class="tile"><b>${o.answers}</b><span>Antworten</span></div>
      <div class="tile"><b>${pct(o.rate)}</b><span>richtig</span></div>
    </div>

    <section class="card">
      <h3>🏆 Ewige Bestenliste</h3>
      <div class="table-wrap"><table class="lb">
        <thead><tr><th></th><th>Spieler</th><th title="Siege">🏆</th><th title="Spiele">Sp.</th><th title="Trefferquote">✅</th><th title="Ø Punkte">Ø</th><th title="Verlauf">Verlauf</th></tr></thead>
        <tbody>${d.leaderboard.map((p, i) => `
          <tr data-a="player" data-id="${p.id}">
            <td class="place">${i + 1}.</td>
            <td><span class="who-cell">${avatar(p, 'sm')}<strong>${esc(p.name)}</strong></span></td>
            <td><b>${p.wins}</b></td>
            <td>${p.games}</td>
            <td>${pct(p.rate)}</td>
            <td>${p.avg_score}</td>
            <td>${sparkline(d.trends[p.id])}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small hint">Sortiert nach Siegen, dann Siegquote. Tippe auf einen Namen für Details.</p>
    </section>

    <section class="card">
      <h3>🏷️ Kategorien – wie gut seid ihr?</h3>
      ${bars(d.categories, { label: (r, plain) => plain ? r.category : `${r.icon || catIcon(r.category)} ${esc(r.category)}`, value: r => r.rate, note: r => ` · ${r.n}` })}
    </section>

    <section class="card">
      <h3>🧠 Die schwersten Fragen</h3>
      ${questionList(d.hardest)}
    </section>
    <section class="card">
      <h3>🍰 Die leichtesten Fragen</h3>
      ${questionList(d.easiest.filter(q => q.rate > 0.5 && !d.hardest.some(h => h.id === q.id)))}
    </section>

    <section class="card">
      <h3>🗓️ Letzte Spiele</h3>
      <ul class="games">${d.games.map(gameRow).join('')}</ul>
    </section>

    <a class="link center" href="/api/stats/export" target="_blank" rel="noopener">⬇️ Statistik als JSON exportieren</a>
  </div>`;
}

function questionList(qs) {
  if (!qs.length) return `<p class="muted small">Jede Frage braucht mindestens 3 Antworten, bevor sie hier auftaucht.</p>`;
  return `<ul class="qlist">${qs.map(q => `
    <li>
      <div class="qmeta"><span class="cat">${catIcon(q.category)} ${esc(q.category)}</span>${diffBadge(q.difficulty)}</div>
      <p><strong>${esc(q.question)}</strong></p>
      <p class="muted small">${esc(q.answer)} · <b>${pct(q.rate)}</b> richtig bei ${q.n} Versuchen</p>
    </li>`).join('')}</ul>`;
}

function gameRow(g) {
  const w = g.players.filter(p => p.place === 1);
  return `<li data-a="game" data-id="${g.id}">
    <div><strong>${modeLabel(g.mode)}</strong> <span class="muted small">${fmtDate(g.ended_at)}${g.ended_early ? ' · vorzeitig' : ''}</span></div>
    <div class="avatars">${g.players.map(p => `<span class="mini ${p.place === 1 ? 'win' : ''}">${avatar({ emoji: p.emoji, color: p.color }, 'sm')}<span>${esc(p.name)} ${p.score}</span></span>`).join('')}</div>
    <span class="muted small">🏆 ${w.map(p => esc(p.name)).join(' & ')}</span>
  </li>`;
}

function playerPage(p) {
  const total = p.games.length;
  const wins = p.games.filter(g => g.place === 1).length;
  const correct = p.games.reduce((s, g) => s + g.correct, 0);
  const answered = p.games.reduce((s, g) => s + g.answered, 0);
  const best = Math.max(0, ...p.games.map(g => g.score));
  const cats = p.categories.filter(c => c.n >= 1);
  const strong = cats.filter(c => c.n >= 3).sort((a, b) => b.rate - a.rate)[0];
  const weak = cats.filter(c => c.n >= 3).sort((a, b) => a.rate - b.rate)[0];
  const trend = p.games.slice().reverse().slice(-20).map(g => ({ score: g.score, place: g.place }));
  return `
  <div class="screen stats">
    ${header(`${esc(p.emoji || '')} ${esc(p.name)}`, '/stats')}
    <div class="tiles">
      <div class="tile"><b>${total}</b><span>Spiele</span></div>
      <div class="tile"><b>${wins}</b><span>Siege</span></div>
      <div class="tile"><b>${pct(answered ? correct / answered : null)}</b><span>richtig</span></div>
      <div class="tile"><b>${best}</b><span>Rekord</span></div>
    </div>
    ${strong || weak ? `<div class="card sw-card">
      ${strong ? `<div><span class="muted small">💪 Stärkste Kategorie</span><strong>${catIcon(strong.category)} ${esc(strong.category)}</strong><span class="muted small">${pct(strong.rate)}</span></div>` : ''}
      ${weak && weak !== strong ? `<div><span class="muted small">🫣 Schwächste Kategorie</span><strong>${catIcon(weak.category)} ${esc(weak.category)}</strong><span class="muted small">${pct(weak.rate)}</span></div>` : ''}
    </div>` : ''}
    ${trend.length >= 2 ? `<section class="card"><h3>📈 Punkte pro Spiel</h3>${lineChart(trend)}</section>` : ''}
    <section class="card"><h3>🏷️ Trefferquote nach Kategorie</h3>
      ${bars(cats.slice().sort((a, b) => b.rate - a.rate), { label: (r, plain) => plain ? r.category : `${catIcon(r.category)} ${esc(r.category)}`, value: r => r.rate, note: r => ` · ${r.n}` })}
    </section>
    <section class="card"><h3>📶 Nach Schwierigkeit</h3>
      ${bars(p.difficulties, { label: (r, plain) => plain ? meta.diffs[r.d - 1]?.label : diffBadge(r.d), value: r => r.rate, note: r => ` · ${r.n}` })}
    </section>
    <section class="card"><h3>🎮 Nach Modus</h3>
      <ul class="results">${p.modes.map(m => `<li><span class="pname">${modeLabel(m.mode)}</span><span class="muted small">${m.games} Spiele · ${m.wins} Siege · Ø ${m.avg_score}</span></li>`).join('')}</ul>
      ${p.avg_ms ? `<p class="muted small hint">⚡ Ø ${(p.avg_ms / 1000).toFixed(1)} s bis zur richtigen Antwort (Buzzer & Tippen)</p>` : ''}
    </section>
    <section class="card"><h3>🗓️ Spiele</h3>
      <ul class="results">${p.games.map(g => `<li data-a="game" data-id="${g.id}"><span class="place">${g.place}.</span><span class="pname">${modeLabel(g.mode)} <span class="muted small">${fmtDate(g.ended_at)}</span></span><span class="muted small">✅ ${g.correct}/${g.answered}</span><strong>${g.score}</strong></li>`).join('')}</ul>
    </section>
  </div>`;
}

// Größerer Verlauf: eine Linie, Achse bei 0, Hover-Titel je Punkt
function lineChart(points) {
  const W = 340, H = 150, L = 28, R = 10, T = 12, B = 22;
  const max = Math.max(...points.map(p => p.score), 1);
  const x = i => L + (i * (W - L - R)) / Math.max(1, points.length - 1);
  const y = s => T + (1 - Math.max(0, s) / max) * (H - T - B);
  const ticks = [0, Math.round(max / 2), max];
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join('');
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Punkte der letzten ${points.length} Spiele">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 4}" class="ax" text-anchor="end">${t}</text>`).join('')}
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p, i) => `<g class="pt"><circle cx="${x(i)}" cy="${y(p.score)}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/><circle cx="${x(i)}" cy="${y(p.score)}" r="12" fill="transparent"><title>Spiel ${i + 1}: ${p.score} Punkte · Platz ${p.place}</title></circle></g>`).join('')}
    <text x="${L}" y="${H - 6}" class="ax">älter</text><text x="${W - R}" y="${H - 6}" class="ax" text-anchor="end">neuestes</text>
  </svg>`;
}

function gamePage(g) {
  const people = new Map(g.players.map(p => [p.person_id, p]));
  // Antworten nach Frage gruppieren
  const byQ = [];
  const idx = new Map();
  for (const a of g.answers) {
    if (!idx.has(a.question_id)) { idx.set(a.question_id, byQ.length); byQ.push({ ...a, list: [] }); }
    byQ[idx.get(a.question_id)].list.push(a);
  }
  return `
  <div class="screen stats">
    ${header(modeLabel(g.mode), '/stats')}
    <p class="muted center small">${fmtDate(g.ended_at)} · ${g.question_count} Fragen${g.ended_early ? ' · vorzeitig beendet' : ''}</p>
    <section class="card"><h3>🏅 Endstand</h3>
      <ul class="results">${g.players.map(p => `<li data-a="player" data-id="${p.person_id}"><span class="place">${p.place}.</span>${avatar(p, 'sm')}<span class="pname">${esc(p.name)}</span><span class="muted small">✅ ${p.correct}/${p.answered} · 🔥 ${p.best_streak}</span><strong>${p.score}</strong></li>`).join('')}</ul>
    </section>
    <section class="card"><h3>❓ Alle Fragen</h3>
      <ul class="qlist">${byQ.map(q => `
        <li>
          <div class="qmeta"><span class="cat">${catIcon(q.category)} ${esc(q.category)}</span>${diffBadge(q.difficulty)}</div>
          <p><strong>${esc(q.question)}</strong></p>
          <p class="muted small">Lösung: ${esc(q.answer)}</p>
          <div class="avatars">${q.list.map(a => {
            const p = people.get(a.person_id);
            return `<span class="mini ${a.correct ? 'ok' : 'no'}" title="${a.kind === 'steal' ? 'geklaut' : ''}">${avatar(p, 'sm')}<span>${a.correct ? '✅' : '❌'}${a.kind === 'steal' ? ' 🫳' : ''}${a.text ? ` „${esc(a.text)}“` : ''}${a.points > 0 ? ` +${a.points}` : a.points < 0 ? ` ${a.points}` : ''}</span></span>`;
          }).join('')}</div>
        </li>`).join('')}</ul>
    </section>
  </div>`;
}

export function mount({ kind, id }, { navigate }) {
  let html = `<div class="screen center"><p class="muted">Lade Statistik …</p></div>`;
  const render = () => patch($app, html);
  render();
  const load = kind === 'player' ? api(`/api/stats/players/${id}`).then(playerPage)
    : kind === 'game' ? api(`/api/stats/games/${id}`).then(gamePage)
    : api('/api/stats').then(overviewPage);
  load.then(h => { html = h; render(); }).catch(e => { html = `<div class="screen center"><h2>😕 ${esc(e.message)}</h2><a class="btn primary" href="/stats" data-link>Zur Statistik</a></div>`; render(); });

  return {
    onAction(a, el) {
      if (a === 'player') navigate(`/stats/player/${el.dataset.id}`);
      if (a === 'game') navigate(`/stats/game/${el.dataset.id}`);
    },
  };
}
