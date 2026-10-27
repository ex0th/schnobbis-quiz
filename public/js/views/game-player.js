// Ansicht auf dem Handy eines Spielers + Beitreten
import { esc, avatar } from '../lib/dom.js';
import { meta, MODE_INFO, diffBadge } from '../meta.js';
import { topbar, scoreStrip, qcard, introCard, finalBadge, timerBox, endScreen, name } from './game-common.js';
import { duelResult, alleResult } from './game-host.js';

// ---------------------------------------------------------------------------
// Beitreten (noch kein Spieler)
// ---------------------------------------------------------------------------
export function joinScreen(v, local) {
  const taken = new Set(v.takenEmojis || []);
  const pick = local.emoji && !taken.has(local.emoji) ? local.emoji : meta.emojis.find(e => !taken.has(e));
  const canJoin = v.lateJoin;
  return `
  <div class="screen join">
    <header class="topbar"><a class="icon-btn" href="/" data-link aria-label="Startseite">⌂</a><h2>Spiel <span class="code-pill">${esc(v.code)}</span></h2><span class="spacer"></span></header>
    ${v.reclaimable?.length ? `
    <section class="card">
      <h3>🔌 Wieder einsteigen</h3>
      <p class="muted small">Akku leer oder neues Handy? Tippe auf deinen Namen.</p>
      <div class="steal-grid">${v.reclaimable.map(pid => {
        const p = v.players.find(x => x.id === pid);
        return `<button class="steal-btn" data-a="reclaim" data-pid="${pid}" style="--pc:${esc(p.color)}">${avatar(p, 'lg')}<strong>${esc(p.name)}</strong></button>`;
      }).join('')}</div>
    </section>` : ''}
    ${canJoin ? `
    <form class="card" data-form="join">
      <h3>👋 Wie heißt du?</h3>
      <div class="add-row"><input id="joinName" type="text" maxlength="16" autocomplete="given-name" enterkeyhint="go" placeholder="Dein Name" value="${esc(local.lastName || '')}" required></div>
      <h3 class="mt">Dein Tier</h3>
      <div class="emoji-grid">${meta.emojis.map(e => `<button type="button" class="emoji-btn ${e === pick ? 'on' : ''}" data-a="pickEmoji" data-v="${e}" ${taken.has(e) ? 'disabled' : ''}>${e}</button>`).join('')}</div>
      <button class="btn primary big mt" type="submit">🎉 Mitspielen</button>
      ${v.status === 'playing' ? `<p class="muted small hint">Das Spiel läuft schon – du steigst bei der nächsten Frage ein.</p>` : ''}
    </form>` : `
    <div class="card center-text">
      <div class="big-emoji">⏳</div>
      <h3>Das Spiel läuft schon</h3>
      <p class="muted">In Klassik und Duell kann man mittendrin nicht mehr einsteigen. Der Spielleiter kann dich für die nächste Runde aufnehmen – lass die Seite offen.</p>
    </div>`}
    ${v.players.length ? `<section class="card"><h3>Schon dabei</h3><div class="avatars">${v.players.map(p => `<span class="mini">${avatar(p, 'sm')}<span>${esc(p.name)}</span></span>`).join('')}</div></section>` : ''}
    <a class="link center" href="/tv/${esc(v.code)}" data-link>📺 Nur zuschauen (TV-Ansicht)</a>
  </div>`;
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
export function playerLobby(c) {
  const v = c.v, me = c.me, s = v.settings;
  const m = MODE_INFO[s.mode];
  const taken = new Set(v.players.filter(p => p.id !== me.id).map(p => p.emoji));
  const turnMode = s.mode === 'klassik' || s.mode === 'duell';
  return `
  <div class="screen lobby">
    <header class="topbar"><a class="icon-btn" href="/" data-link aria-label="Startseite">⌂</a><h2>Spiel <span class="code-pill">${esc(v.code)}</span></h2><span class="spacer"></span></header>
    <div class="intro pop">
      ${avatar(me, 'xxl')}
      <h2 class="turn-name">${esc(me.name)}</h2>
      <p class="muted">Du bist dabei! Gleich geht's los.</p>
    </div>
    ${c.local.editProfile ? `
    <form class="card" data-form="profile">
      <h3>✏️ Name & Tier</h3>
      <div class="add-row"><input id="profName" type="text" maxlength="16" value="${esc(me.name)}" data-keep="no"><button class="btn primary" type="submit">OK</button></div>
      <div class="emoji-grid mt">${meta.emojis.map(e => `<button type="button" class="emoji-btn ${e === me.emoji ? 'on' : ''}" data-a="setEmoji" data-v="${e}" ${taken.has(e) ? 'disabled' : ''}>${e}</button>`).join('')}</div>
    </form>` : `<button class="link center" data-a="editProfile">✏️ Name oder Tier ändern</button>`}
    <section class="card">
      <div class="row-between"><h3>${m.icon} ${m.name}</h3><span class="muted small">${turnMode ? `${s.perPlayer} Fragen pro Spieler` : `${s.questions} Fragen`}${s.timer ? ` · ⏱️ ${s.timer}s` : ''}</span></div>
      <p class="muted small">${m.desc}</p>
    </section>
    <section class="card">
      <h3>👥 Mitspieler (${v.players.length})</h3>
      <ul class="plist compact">${v.players.map(p => `<li class="${p.id === me.id ? 'me' : ''}">${avatar(p, 'sm')}<span class="pname">${esc(p.name)}${p.isHost ? ' <span class="tag">Spielleiter</span>' : ''}</span>${p.kind === 'device' ? `<span class="dot ${p.connected ? 'on' : ''}"></span>` : '<span class="tag muted">ohne Handy</span>'}</li>`).join('')}</ul>
    </section>
    <p class="muted center small">${v.hostOnline ? '⏳ Warte auf den Spielleiter …' : '⚠️ Der Spielleiter ist gerade nicht verbunden'}</p>
    <button class="link center danger" data-a="leave">Spiel verlassen</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Spiel
// ---------------------------------------------------------------------------
export function playerPlay(c) {
  const g = c.g;
  const body = { klassik: turnBody, duell: turnBody, buzzer: buzzerBody, alle: alleBody }[g.mode](c);
  return `
  <div class="screen play player ${g.final ? 'is-final' : ''}">
    ${topbar(c, { left: `<a class="icon-btn" href="/" data-link aria-label="Startseite">⌂</a>`, right: `<button class="icon-btn" data-a="sheet" aria-label="Punkte">🏅</button>` })}
    ${scoreStrip(c, { activePid: g.active ?? g.buzz?.pid ?? null })}
    <main class="stage">${body}</main>
  </div>`;
}

const waitLine = txt => `<div class="status-line">${txt}</div>`;

function turnBody(c) {
  const g = c.g, me = c.v.you.pid;
  const mine = g.active === me;
  const p = c.P(g.active), s = c.S(me);
  if (g.phase === 'intro') {
    if (g.duel && g.duel.side === 0 && (g.duel.a === me || g.duel.b === me)) {
      const other = c.P(g.duel.a === me ? g.duel.b : g.duel.a);
      return `
      <div class="intro pop">
        ${finalBadge(g)}
        <div class="kicker">⚔️ Duell</div>
        <div class="vs"><div>${avatar(c.me, 'xl')}<strong>Du</strong></div><span class="vs-badge">VS</span><div>${avatar(other, 'xl')}<strong>${esc(other.name)}</strong></div></div>
        <p class="cat-hint">Thema: <strong>${esc(g.duel.topic)}</strong></p>
        <p class="muted">${g.duel.a === me ? 'Du fängst an!' : `${esc(other.name)} fängt an`}</p>
      </div>`;
    }
    if (mine) {
      return `
      <div class="intro pop your-turn">
        ${finalBadge(g)}
        ${avatar(c.me, 'xxl')}
        <h2 class="turn-name">Du bist dran! 🎯</h2>
        <p class="intro-diff">${diffBadge(g.question.d)}${g.points > 1 ? `<span class="muted small">zählt ${g.points} Punkte</span>` : ''}</p>
        ${g.duel ? `<p class="cat-hint">Thema: <strong>${esc(g.duel.topic)}</strong></p>` : ''}
        ${waitLine('Die Frage kommt, sobald der Spielleiter sie aufdeckt …')}
      </div>`;
    }
    return `
    <div class="intro pop">
      ${finalBadge(g)}
      ${avatar(p, 'xl')}
      <h2 class="turn-name">${esc(p.name)} ist dran</h2>
      ${g.nextPid === me ? `<p class="pill gold">Du bist als Nächstes dran</p>` : ''}
      <p class="muted">Deine Punkte: ${s?.score ?? 0}</p>
    </div>`;
  }
  if (g.phase === 'question') {
    return `
    <div class="qwrap">
      <div class="who">${mine ? '<strong>Deine Frage</strong>' : `${avatar(p, 'sm')}<strong>Frage für ${esc(p.name)}</strong>`}${g.points > 1 ? `<span class="pill gold">+${g.points}</span>` : ''}</div>
      ${timerBox(c)}
      ${qcard(c)}
      ${mine ? `${waitLine('Sag deine Antwort laut! 🗣️')}${g.mode === 'klassik' && s.jokers > 0 ? `<button class="btn ghost" data-a="joker">🃏 Joker: andere Frage (${s.jokers} übrig)</button>` : ''}` : waitLine('Psst – nicht vorsagen 🤫')}
    </div>`;
  }
  if (g.phase === 'revealed') {
    return `<div class="qwrap">${qcard(c, { showAnswer: true })}${waitLine(mine ? 'Der Spielleiter wertet deine Antwort …' : `Der Spielleiter wertet ${esc(p.name)}s Antwort …`)}</div>`;
  }
  if (g.phase === 'steal') {
    return `
    <div class="intro pop">
      <div class="kicker">🫳 Klau-Chance</div>
      <h2 class="turn-name">${mine ? 'Schade!' : 'Wusstest du es?'}</h2>
      <p class="muted">Lösung: <strong>${esc(g.question.answer)}</strong></p>
      ${mine ? '' : waitLine('Ruf laut „Ich!“ – der Spielleiter gibt dir den Punkt.')}
    </div>`;
  }
  if (g.phase === 'duelResult') return duelResult(c);
  return '';
}

function buzzerBody(c) {
  const g = c.g, me = c.v.you.pid;
  if (g.phase === 'intro') return introCard(c, waitLine('Finger an den Buzzer! 🔔'));
  if (g.phase === 'question') {
    const locked = g.locked.includes(me);
    return `
    <div class="qwrap">
      ${timerBox(c)}
      ${qcard(c)}
      ${locked
        ? `<div class="buzzer locked" aria-disabled="true"><span>🔒</span><small>Diesmal gesperrt</small></div>`
        : `<button class="buzzer" data-a="buzz" style="--pc:${esc(c.me.color)}"><span>${esc(c.me.emoji)}</span><small>BUZZ!</small></button>`}
    </div>`;
  }
  if (g.phase === 'buzzed') {
    const p = c.P(g.buzz.pid);
    const mine = g.buzz.pid === me;
    return `
    <div class="qwrap">
      ${qcard(c)}
      <div class="buzzed-banner pop ${mine ? 'mine' : ''}" style="--pc:${esc(p.color)}">${avatar(p, 'lg')}<div><span class="kicker">🔔 Gebuzzert</span><h2>${mine ? 'Du! Antworte laut 🗣️' : esc(p.name)}</h2></div></div>
    </div>`;
  }
  if (g.phase === 'revealed') {
    const w = g.result?.winner != null ? c.P(g.result.winner) : null;
    return `
    <div class="qwrap">
      ${qcard(c, { showAnswer: true })}
      <div class="result-line pop">${w ? (w.id === me ? `🎉 <strong>Du</strong> holst den Punkt!` : `${avatar(w, 'sm')} <strong>${esc(w.name)}</strong> holt den Punkt`) : '😅 Diesmal keiner'}</div>
    </div>`;
  }
  return '';
}

function alleBody(c) {
  const g = c.g;
  if (g.phase === 'intro') return introCard(c, waitLine('Gleich kommt die Frage – Daumen bereit ✍️'));
  if (g.phase === 'question') {
    const sent = g.mine;
    return `
    <div class="qwrap">
      ${timerBox(c)}
      ${qcard(c)}
      <form class="answer-form" data-form="submit">
        <input id="answerInput-${g.idx}" class="answer-input" type="text" maxlength="120" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="Deine Antwort" aria-label="Deine Antwort">
        <button class="btn primary" type="submit">${sent ? 'Ändern' : 'Senden'}</button>
      </form>
      ${sent ? `<div class="sent pop">✓ Abgegeben: <strong>„${esc(sent)}“</strong><span class="muted small">Du kannst sie bis zum Ende noch ändern.</span></div>` : ''}
      <p class="muted small center">${(g.submitted || []).length} von ${g.scores.filter(s => c.P(s.pid)?.kind === 'device').length} haben geantwortet</p>
    </div>`;
  }
  if (g.phase === 'review') {
    return `<div class="qwrap">${qcard(c)}${g.mine ? `<div class="sent">Deine Antwort: <strong>„${esc(g.mine)}“</strong></div>` : ''}${waitLine('Der Spielleiter prüft die Antworten …')}</div>`;
  }
  if (g.phase === 'revealed') return alleResult(c);
  return '';
}

export function playerEnd(c) {
  return endScreen(c, {
    actions: `<p class="muted center">${c.v.hostOnline ? 'Revanche? Der Spielleiter kann gleich neu starten.' : ''}</p>
      ${c.g.gameId ? `<a class="btn ghost" href="/stats/game/${c.g.gameId}" data-link>📊 Details in der Statistik</a>` : ''}
      <a class="btn ghost" href="/" data-link>⌂ Startseite</a>`,
  });
}
