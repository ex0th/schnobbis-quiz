// Ansicht des Spielleiters: Lobby mit Einstellungen, Spielsteuerung, Ende
import { esc, avatar } from '../lib/dom.js';
import { meta, diffBadge, MODE_INFO } from '../meta.js';
import { topbar, scoreStrip, qcard, introCard, finalBadge, timerBox, endScreen, switchBtn, connDot, name } from './game-common.js';

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
export function hostLobby(c) {
  const v = c.v, s = v.settings, L = v.lobby, n = v.players.length;
  const mode = s.mode;
  const turnMode = mode === 'klassik' || mode === 'duell';
  const total = L.total;
  const pool = L.pool || {};
  const poolSize = mode === 'duell' ? (pool.duell || 0) * 2 : pool.klassik || 0;
  const fresh = mode === 'duell' ? (pool.duellFresh || 0) * 2 : pool.klassikFresh || 0;
  const mins = Math.max(1, Math.round(total * (mode === 'alle' ? 1 : 0.6)));
  const canStart = n >= L.minPlayers;
  const joinUrl = `${location.origin}/join/${v.code}`;
  const hostPlays = v.players.some(p => p.isHost);
  const devices = v.players.filter(p => p.kind === 'device').length;
  const sum = meta.summary;
  const countKey = turnMode ? 'perPlayer' : 'questions';
  const count = s[countKey];

  return `
  <div class="screen setup">
    <header class="topbar"><a class="icon-btn" href="/" data-link aria-label="Startseite">⌂</a><h2>Neues Spiel</h2><a class="icon-btn" href="/tv/${v.code}" target="_blank" rel="noopener" aria-label="TV-Ansicht">📺</a></header>

    <section class="card invite">
      <h3>📱 Mitspielen per Handy</h3>
      <div class="invite-row">
        <img class="qr" src="/api/rooms/${v.code}/qr.svg" alt="QR-Code zum Beitreten" width="132" height="132">
        <div class="invite-text">
          <span class="muted small">Code</span>
          <div class="bigcode">${v.code}</div>
          <span class="muted small break">${esc(joinUrl.replace(/^https?:\/\//, ''))}</span>
          <button class="btn ghost slim" data-a="share">🔗 Link teilen</button>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>👥 Spieler <span class="muted small">(${n})</span></h3>
      ${n ? `<ul class="plist">${v.players.map((p, i) => `
        <li>
          <button class="avatar-btn" data-a="emoji" data-pid="${p.id}" title="Emoji ändern">${avatar(p)}</button>
          <span class="pname">${esc(p.name)}</span>
          ${p.isHost ? '<span class="tag">Du</span>' : p.kind === 'device' ? `<span class="tag">📱${connDot(p)}</span>` : '<span class="tag muted">ohne Handy</span>'}
          <span class="pctrl">
            <button class="icon-btn s" data-a="move" data-pid="${p.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">↑</button>
            <button class="icon-btn s" data-a="move" data-pid="${p.id}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="nach unten">↓</button>
            <button class="icon-btn s danger" data-a="remove" data-pid="${p.id}" aria-label="entfernen">✕</button>
          </span>
        </li>`).join('')}</ul>
        <p class="muted small hint">Tipp aufs Tier = anderes Emoji · Reihenfolge = Spielreihenfolge</p>
        ${n > 1 ? `<button class="link" data-a="shuffle">🔀 Reihenfolge mischen</button>` : ''}`
      : `<p class="empty">Noch keine Spieler – QR-Code scannen lassen oder unten eintragen 🎉</p>`}
      <form class="add-row" data-form="addLocal">
        <input id="newName" type="text" placeholder="Spieler ohne Handy" maxlength="16" autocomplete="off" enterkeyhint="done">
        <button class="btn primary" type="submit" aria-label="hinzufügen">＋</button>
      </form>
      ${!hostPlays ? (c.local.addSelf ? `
        <form class="add-row self-row" data-form="addSelf">
          <input id="selfName" type="text" placeholder="Dein Name" maxlength="16" autocomplete="given-name" enterkeyhint="done" value="${esc(c.local.lastName || '')}">
          <button class="btn primary" type="submit">Ich</button>
        </form>` : `<button class="link" data-a="addSelfOpen">🙋 Ich spiele selbst mit</button>`) : ''}
    </section>

    <section class="card">
      <h3>🎮 Spielmodus</h3>
      <div class="modes">
        ${Object.entries(MODE_INFO).map(([k, m]) => `
        <button class="mode ${mode === k ? 'on' : ''}" data-a="set" data-k="mode" data-v="${k}">
          <span class="mi">${m.icon}</span><strong>${m.name}</strong><span class="muted small">${m.desc}</span>
          ${m.phones ? `<span class="tag phones">📱 Handys</span>` : ''}
        </button>`).join('')}
      </div>
      ${(mode === 'buzzer' || mode === 'alle') && devices === 0 ? `<p class="note">💡 Dieser Modus macht mit Handys am meisten Spaß. Spieler ohne Handy gehen trotzdem: ${mode === 'buzzer' ? 'sie melden sich, du buzzerst für sie' : 'sie sagen ihre Antwort laut, du wertest'}.</p>` : ''}
      ${(mode === 'buzzer' || mode === 'alle') && hostPlays ? `<p class="note">👀 Als Spielleiter siehst du die Lösung vorher – fair ist es nur ohne Spicken.</p>` : ''}
      ${!canStart ? `<p class="note">${MODE_INFO[mode].name} braucht mindestens ${L.minPlayers} Spieler.</p>` : ''}
    </section>

    <section class="card">
      <h3>❓ ${turnMode ? 'Fragen pro Spieler' : 'Anzahl Fragen'}</h3>
      <div class="presets">
        ${meta.presets.map(x => `<button class="preset ${count === x ? 'on' : ''}" data-a="set" data-k="${countKey}" data-v="${x}">${x}</button>`).join('')}
      </div>
      <div class="setting fine">
        <div class="muted small">Feinjustieren</div>
        <div class="stepper"><button data-a="step" data-k="${countKey}" data-d="-1" aria-label="weniger">−</button><span>${count}</span><button data-a="step" data-k="${countKey}" data-d="1" aria-label="mehr">＋</button></div>
      </div>
      ${n || !turnMode ? `<p class="summary">= <strong>${total} Fragen</strong> insgesamt · ca. ${mins} Min.${total > fresh ? `<br><span class="muted small">Davon ${Math.min(fresh, total)} noch ungespielt – danach kommen schon gespielte wieder dran.</span>` : ''}</p>` : ''}
    </section>

    <section class="card">
      <h3>📶 Schwierigkeit</h3>
      <div class="diffpick">
        <button class="dchip ${!s.diffs.length ? 'on' : ''}" data-a="diff" data-v="*">✨ Alle</button>
        ${meta.diffs.map(d => `<button class="dchip d${d.v} ${s.diffs.includes(d.v) ? 'on' : ''}" data-a="diff" data-v="${d.v}">${d.icon} ${d.label}</button>`).join('')}
      </div>
      <p class="muted small hint">${poolSize} Fragen in dieser Auswahl${mode === 'duell' ? ` (${poolSize / 2} Duell-Paare)` : ''}</p>
      <div class="setting"><div><strong>📈 Steigend</strong><div class="muted small">Es wird von Runde zu Runde schwerer</div></div>${switchBtn('rising', s.rising, 'setToggle')}</div>
      <div class="setting"><div><strong>💎 Schwer zählt mehr</strong><div class="muted small">Leicht 1 · Mittel 2 · Schwer 3 Punkte</div></div>${switchBtn('diffPoints', s.diffPoints, 'setToggle')}</div>
    </section>

    ${mode !== 'duell' ? `
    <section class="card">
      <button class="row-between collapse" data-a="cats">
        <h3>🏷️ Kategorien</h3>
        <span class="muted small">${s.cats.length ? `${s.cats.length} ausgewählt` : 'Alle'} · ${poolSize} Fragen ${c.local.catsOpen ? '▲' : '▼'}</span>
      </button>
      ${c.local.catsOpen ? `
      <div class="cats">
        <button class="catchip ${!s.cats.length ? 'on' : ''}" data-a="cat" data-v="*">✨ Alle</button>
        ${meta.categories.map(cat => `<button class="catchip ${s.cats.includes(cat) ? 'on' : ''}" data-a="cat" data-v="${esc(cat)}">${meta.icons[cat] || '🏷️'} ${esc(cat)}</button>`).join('')}
      </div>` : ''}
    </section>` : ''}

    <section class="card">
      <h3>⚙️ Spielregeln</h3>
      <div class="setting">
        <div><strong>⏱️ Antwort-Timer</strong><div class="muted small">${mode === 'buzzer' ? 'Danach ist der Buzzer zu' : mode === 'alle' ? 'Danach wird eingesammelt' : 'Countdown pro Frage'}</div></div>
        <div class="seg">${meta.timers.map(x => `<button class="${s.timer === x ? 'on' : ''}" data-a="set" data-k="timer" data-v="${x}">${x ? x + 's' : 'Aus'}</button>`).join('')}</div>
      </div>
      ${mode === 'klassik' ? `<div class="setting">
        <div><strong>🃏 Joker pro Spieler</strong><div class="muted small">Frage tauschen, ohne Punktverlust</div></div>
        <div class="stepper"><button data-a="step" data-k="jokers" data-d="-1" aria-label="weniger">−</button><span>${s.jokers}</span><button data-a="step" data-k="jokers" data-d="1" aria-label="mehr">＋</button></div>
      </div>` : ''}
      <div class="setting"><div><strong>🔥 Serien-Bonus</strong><div class="muted small">Alle 3 richtigen am Stück +1</div></div>${switchBtn('streakBonus', s.streakBonus, 'setToggle')}</div>
      ${mode === 'klassik' ? `<div class="setting"><div><strong>🫳 Klauen</strong><div class="muted small">Falsch? Wer es wusste, schnappt sich den Punkt</div></div>${switchBtn('steal', s.steal, 'setToggle')}</div>` : ''}
      ${mode === 'buzzer' ? `<div class="setting"><div><strong>⚠️ Falsch buzzern kostet</strong><div class="muted small">−1 Punkt bei falscher Antwort</div></div>${switchBtn('buzzPenalty', s.buzzPenalty, 'setToggle')}</div>` : ''}
      ${mode === 'alle' ? `<div class="setting"><div><strong>⚡ Schnellster Bonus</strong><div class="muted small">Schnellste richtige Antwort +1</div></div>${switchBtn('speedBonus', s.speedBonus, 'setToggle')}</div>` : ''}
      <div class="setting"><div><strong>🎉 Finale</strong><div class="muted small">${turnMode ? 'Letzte Runde zählt doppelt' : 'Die letzten Fragen zählen doppelt'}</div></div>${switchBtn('finale', s.finale, 'setToggle')}</div>
      <div class="setting"><div><strong>🔊 Sounds auf diesem Gerät</strong></div>${switchBtn('sound', c.local.sound)}</div>
    </section>

    ${sum ? `<div class="card pool">
      <div class="row-between"><span>🎯 Fragen ungespielt</span><strong>${pool.klassikFresh ?? '–'} in Auswahl</strong></div>
      <button class="link" data-a="resetPool">Gespielte Fragen zurücksetzen</button>
    </div>` : ''}

    <div class="sticky-bottom">
      <button class="btn primary big" data-a="start" ${canStart ? '' : 'disabled'}>🚀 Spiel starten · ${total} Fragen</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Spiel
// ---------------------------------------------------------------------------
export function hostPlay(c) {
  const g = c.g;
  const body = { klassik: turnBody, duell: turnBody, buzzer: buzzerBody, alle: alleBody }[g.mode](c);
  return `
  <div class="screen play ${g.final ? 'is-final' : ''}">
    ${topbar(c, {
      left: `<button class="icon-btn" data-a="sheet" aria-label="Menü">☰</button>`,
      right: `<button class="icon-btn" data-a="undo" ${g.canUndo ? '' : 'disabled'} aria-label="Rückgängig">↩︎</button>`,
    })}
    ${scoreStrip(c, { activePid: g.active ?? g.buzz?.pid ?? null })}
    <main class="stage">${body}</main>
  </div>`;
}

function phoneHint(c, pid) {
  const p = c.P(pid);
  if (!p || p.kind !== 'device' || p.isHost) return '';
  return `<p class="muted small">📱 Die Frage erscheint auch auf ${esc(p.name)}s Handy${p.connected ? '' : ' (gerade nicht verbunden)'}</p>`;
}

function turnBody(c) {
  const g = c.g;
  const p = c.P(g.active), s = c.S(g.active);
  if (g.phase === 'intro') {
    if (g.duel && g.duel.side === 0) {
      const a = c.P(g.duel.a), b = c.P(g.duel.b);
      return `
      <div class="intro duel-intro pop">
        ${finalBadge(g)}
        <div class="kicker">⚔️ Duell</div>
        <div class="vs">
          <div>${avatar(a, 'xl')}<strong>${esc(a.name)}</strong></div>
          <span class="vs-badge">VS</span>
          <div>${avatar(b, 'xl')}<strong>${esc(b.name)}</strong></div>
        </div>
        <p class="cat-hint">Thema: <strong>${esc(g.duel.topic)}</strong></p>
        <p class="intro-diff">${diffBadge(g.question.d)}</p>
        <p class="muted">${esc(a.name)} fängt an</p>
        <button class="btn primary big" data-a="show">Frage zeigen</button>
      </div>`;
    }
    return `
    <div class="intro pop">
      ${finalBadge(g)}
      ${avatar(p, 'xxl')}
      <h2 class="turn-name">${esc(p.name)} ist dran!</h2>
      ${g.duel ? `<p class="cat-hint">Gleiches Thema: <strong>${esc(g.duel.topic)}</strong></p>` : `<p class="muted">Punkte: ${s.score}${s.streak >= 2 ? ` · 🔥 Serie ${s.streak}` : ''}</p>`}
      <p class="intro-diff">${diffBadge(g.question.d)}${g.points > 1 ? `<span class="muted small">zählt ${g.points} Punkte</span>` : ''}</p>
      ${phoneHint(c, g.active)}
      <button class="btn primary big" data-a="show">Frage zeigen</button>
    </div>`;
  }
  if (g.phase === 'question' || g.phase === 'revealed') {
    const revealed = g.phase === 'revealed';
    return `
    <div class="qwrap">
      <div class="who">${avatar(p, 'sm')}<strong>${esc(p.name)}</strong>${s.streak >= 2 ? `<span class="pill fire">🔥 ${s.streak}</span>` : ''}${g.points > 1 ? `<span class="pill gold">+${g.points}</span>` : ''}</div>
      ${!revealed ? timerBox(c) : ''}
      ${qcard(c, { showAnswer: revealed })}
      ${revealed ? `
        <div class="judge">
          <button class="btn no big" data-a="judge" data-ok="0">❌ Falsch</button>
          <button class="btn ok big" data-a="judge" data-ok="1">✅ Richtig</button>
        </div>` : `
        <button class="btn primary big" data-a="reveal">👀 Lösung zeigen</button>
        ${g.mode === 'klassik' && s.jokers > 0 ? `<button class="btn ghost" data-a="joker">🃏 Joker nutzen (${s.jokers} übrig)</button>` : ''}`}
    </div>`;
  }
  if (g.phase === 'steal') {
    return `
    <div class="intro pop">
      <div class="kicker">🫳 Klau-Chance</div>
      <h2 class="turn-name">Wer wusste es?</h2>
      <p class="muted">Lösung: <strong>${esc(g.question.answer)}</strong></p>
      <div class="steal-grid">
        ${g.scores.filter(x => x.pid !== g.active).map(x => {
          const o = c.P(x.pid);
          return `<button class="steal-btn" data-a="steal" data-pid="${o.id}" style="--pc:${esc(o.color)}">${avatar(o, 'lg')}<strong>${esc(o.name)}</strong><span class="muted small">+${g.points}</span></button>`;
        }).join('')}
      </div>
      <button class="btn ghost" data-a="steal" data-pid="-1">🙈 Keiner – weiter</button>
    </div>`;
  }
  if (g.phase === 'duelResult') return duelResult(c, `<button class="btn primary big" data-a="next">Weiter</button>`);
  return '';
}

export function duelResult(c, action = '') {
  const d = c.g.duel, r = d.result;
  const a = c.P(d.a), b = c.P(d.b);
  const winner = r.winner ? c.P(r.winner) : null;
  const both = r.a === 'ok' && r.b === 'ok';
  return `
  <div class="intro pop">
    <div class="kicker">⚔️ Duell-Ergebnis</div>
    <div class="vs">
      <div class="${r.a === 'ok' ? '' : 'dim'}">${avatar(a, 'xl')}<strong>${esc(a.name)}</strong><span class="res">${r.a === 'ok' ? '✅' : '❌'}</span></div>
      <span class="vs-badge">VS</span>
      <div class="${r.b === 'ok' ? '' : 'dim'}">${avatar(b, 'xl')}<strong>${esc(b.name)}</strong><span class="res">${r.b === 'ok' ? '✅' : '❌'}</span></div>
    </div>
    <h2 class="turn-name">${winner ? `🏆 ${esc(winner.name)} gewinnt! <span class="plus">+1</span>` : both ? '🤝 Beide richtig!' : '😅 Beide daneben!'}</h2>
    <p class="muted">${winner ? 'Extrapunkt für den Duell-Sieg' : 'Unentschieden – kein Extrapunkt'}</p>
    ${action}
  </div>`;
}

function peekAnswer(c) {
  const a = c.g.question.answer;
  if (!a) return '';
  return c.local.peek
    ? `<button class="peek open" data-a="peek"><span class="muted small">Lösung (nur für dich)</span><strong>${esc(a)}</strong></button>`
    : `<button class="peek" data-a="peek">👀 Lösung spicken</button>`;
}

function buzzerBody(c) {
  const g = c.g;
  if (g.phase === 'intro') return introCard(c, `<p class="muted">Alle Handys zeigen gleich die Frage und den Buzzer.</p><button class="btn primary big" data-a="show">Frage zeigen</button>`);
  if (g.phase === 'question') {
    const free = g.scores.filter(s => !g.locked.includes(s.pid));
    return `
    <div class="qwrap">
      ${timerBox(c)}
      ${qcard(c)}
      ${peekAnswer(c)}
      <div class="status-line pulse-soft">🔔 Warte auf den ersten Buzzer …</div>
      ${g.locked.length ? `<p class="muted small center">Gesperrt: ${g.locked.map(pid => name(c, pid)).join(', ')}</p>` : ''}
      <details class="buzz-for">
        <summary>Jemand ohne Handy hat sich gemeldet?</summary>
        <div class="steal-grid">${free.map(s => {
          const p = c.P(s.pid);
          return `<button class="steal-btn" data-a="buzzFor" data-pid="${p.id}" style="--pc:${esc(p.color)}">${avatar(p)}<strong>${esc(p.name)}</strong></button>`;
        }).join('')}</div>
      </details>
      <button class="btn ghost" data-a="reveal">🙈 Keiner weiß es – auflösen</button>
    </div>`;
  }
  if (g.phase === 'buzzed') {
    const p = c.P(g.buzz.pid);
    return `
    <div class="qwrap">
      <div class="buzzed-banner pop" style="--pc:${esc(p.color)}">${avatar(p, 'lg')}<div><span class="kicker">🔔 Gebuzzert</span><h2>${esc(p.name)}</h2></div></div>
      ${qcard(c, { showAnswer: true })}
      <div class="judge">
        <button class="btn no big" data-a="judge" data-ok="0">❌ Falsch</button>
        <button class="btn ok big" data-a="judge" data-ok="1">✅ Richtig</button>
      </div>
      <button class="link" data-a="undo">↩︎ War versehentlich – Buzzer wieder öffnen</button>
    </div>`;
  }
  if (g.phase === 'revealed') {
    const w = g.result?.winner != null ? c.P(g.result.winner) : null;
    return `
    <div class="qwrap">
      ${qcard(c, { showAnswer: true })}
      <div class="result-line pop">${w ? `${avatar(w, 'sm')} <strong>${esc(w.name)}</strong> holt ${g.points === 1 ? 'den Punkt' : g.points + ' Punkte'}!` : '😅 Diesmal keiner'}</div>
      <button class="btn primary big" data-a="next">${g.idx + 1 >= g.total ? '🏁 Zum Ergebnis' : 'Nächste Frage'}</button>
    </div>`;
  }
  return '';
}

function alleBody(c) {
  const g = c.g;
  if (g.phase === 'intro') return introCard(c, `<p class="muted">Alle tippen gleich ihre Antwort ins Handy.</p><button class="btn primary big" data-a="show">Frage zeigen</button>`);
  if (g.phase === 'question') {
    const done = g.submitted || [];
    return `
    <div class="qwrap">
      ${timerBox(c)}
      ${qcard(c)}
      ${peekAnswer(c)}
      <div class="sub-grid">${g.scores.map(s => {
        const p = c.P(s.pid);
        const ok = done.includes(s.pid);
        return `<div class="sub ${ok ? 'done' : ''}">${avatar(p, 'sm')}<span>${esc(p.name)}</span><b>${ok ? '✓' : p.kind === 'local' ? '🗣️' : '…'}</b></div>`;
      }).join('')}</div>
      <p class="muted small center">${done.length} von ${g.scores.filter(s => c.P(s.pid)?.kind === 'device').length} Handys haben geantwortet${g.scores.some(s => c.P(s.pid)?.kind === 'local') ? ' · 🗣️ = sagt die Antwort laut' : ''}</p>
      <button class="btn primary big" data-a="reveal">⏹ Antworten einsammeln</button>
    </div>`;
  }
  if (g.phase === 'review') {
    return `
    <div class="qwrap">
      ${qcard(c, { showAnswer: true })}
      <p class="muted small center">Tippe an, was zählt. Vorschlag: <span class="sugg">✨</span> = passt automatisch</p>
      <ul class="review">${(g.review || []).map(r => {
        const p = c.P(r.pid);
        return `<li class="${r.mark ? 'ok' : 'no'}">
          ${avatar(p, 'sm')}
          <div class="rv-text"><strong>${esc(p.name)}</strong><span>${r.text != null ? `„${esc(r.text)}“` : p.kind === 'local' ? '<i class="muted">sagt es laut</i>' : '<i class="muted">keine Antwort</i>'}${r.suggest ? ' <span class="sugg" title="automatischer Vorschlag">✨</span>' : ''}</span></div>
          <div class="rv-btns">
            <button class="rv no ${!r.mark ? 'on' : ''}" data-a="mark" data-pid="${r.pid}" data-ok="0" aria-label="falsch">✗</button>
            <button class="rv ok ${r.mark ? 'on' : ''}" data-a="mark" data-pid="${r.pid}" data-ok="1" aria-label="richtig">✓</button>
          </div>
        </li>`;
      }).join('')}</ul>
      <button class="btn primary big" data-a="score">✅ Werten & auflösen</button>
    </div>`;
  }
  if (g.phase === 'revealed') return alleResult(c, `<button class="btn primary big" data-a="next">${g.idx + 1 >= g.total ? '🏁 Zum Ergebnis' : 'Nächste Frage'}</button>`);
  return '';
}

export function alleResult(c, action = '') {
  const g = c.g, r = g.result;
  return `
  <div class="qwrap">
    ${qcard(c, { showAnswer: true })}
    <ul class="review static">${r.answers.map(a => {
      const p = c.P(a.pid);
      return `<li class="${a.ok ? 'ok' : 'no'} ${a.pid === c.v.you.pid ? 'me' : ''}">
        ${avatar(p, 'sm')}
        <div class="rv-text"><strong>${esc(p.name)}${r.fastest === a.pid ? ' ⚡' : ''}</strong><span>${a.text != null ? `„${esc(a.text)}“` : '<i class="muted">–</i>'}</span></div>
        <span class="rv-res">${a.ok ? '✅' : '❌'}</span>
      </li>`;
    }).join('')}</ul>
    ${action}
  </div>`;
}

export function hostEnd(c) {
  return endScreen(c, {
    actions: `
      <button class="btn primary big" data-a="rematch">🔁 Revanche (gleiche Spieler)</button>
      <button class="btn ghost" data-a="toLobby">⚙️ Neue Runde mit anderen Einstellungen</button>
      ${c.g.gameId ? `<a class="btn ghost" href="/stats/game/${c.g.gameId}" data-link>📊 Details in der Statistik</a>` : ''}
      ${c.g.canUndo ? `<button class="link" data-a="undo">↩︎ Letzte Bewertung rückgängig</button>` : ''}`,
  });
}
