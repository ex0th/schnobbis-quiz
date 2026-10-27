// Startseite: Spiel erstellen, beitreten, weiterspielen
import { $app, esc, api, toast, patch } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { meta, loadMeta } from '../meta.js';

const DECO = `<div class="deco"><span class="d-arch"></span><span class="d-sun"></span><span class="d-pill"></span><span class="d-flower"><svg viewBox="0 0 100 100"><path d="M50 8c9 0 15 9 14 19 9-6 21-3 24 6s-3 18-12 20c9 4 12 15 6 23s-18 8-24 1c0 10-8 17-17 15s-14-11-11-20c-7 7-19 6-23-2s0-19 9-21c-9-3-13-14-8-22s17-8 23-1C40 16 42 8 50 8z"/></svg></span></div>`;

export function mount(params, { navigate }) {
  let resume = null;
  let busy = false;
  let joinErr = '';

  async function checkResume() {
    const s = store.lastSession();
    if (!s) return;
    try {
      const info = await api(`/api/rooms/${s.code}`);
      if (info.status === 'finished' && s.role !== 'host') return;
      resume = { ...s, ...info };
      render();
    } catch {
      store.dropSession(s.code);
    }
  }

  function render() {
    const sum = meta.summary;
    patch($app, `
    <div class="screen home">
      ${DECO}
      <div class="logo-wrap">
        <div class="logo">?</div>
        <h1>Schnobbis Quiz</h1>
        <p class="muted">Allgemeinwissen für den Spieleabend</p>
      </div>
      ${resume ? `
        <div class="card resume">
          <div class="row-between">
            <strong>${resume.role === 'host' ? '🎤 Dein Spiel' : '🎮 Dein Spiel'} <span class="code-pill">${esc(resume.code)}</span></strong>
            <span class="pill">${resume.status === 'lobby' ? 'Lobby' : resume.status === 'playing' ? 'läuft' : 'vorbei'}</span>
          </div>
          <p class="muted small">${resume.players} Spieler · ${resume.role === 'host' ? 'du bist Spielleiter' : 'du spielst mit'}</p>
          <button class="btn primary big" data-a="resume">▶️ Zurück ins Spiel</button>
        </div>` : ''}
      <button class="btn ${resume ? 'ghost' : 'primary big'}" data-a="create" ${busy ? 'disabled' : ''}>✨ Neues Spiel leiten</button>
      <form class="card join-card" data-form="join">
        <h3>📱 Spiel beitreten</h3>
        <div class="add-row">
          <input id="joinCode" class="code-input" data-input="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters"
            maxlength="4" placeholder="CODE" aria-label="Spiel-Code" ${params.join ? 'autofocus' : ''}>
          <button class="btn primary" type="submit">Los</button>
        </div>
        ${joinErr ? `<p class="err small">${esc(joinErr)}</p>` : `<p class="muted small hint">Code steht beim Spielleiter – oder einfach den QR-Code scannen.</p>`}
      </form>
      <div class="home-links">
        <a class="btn ghost" href="/stats" data-link>📊 Statistik</a>
        ${meta.admin ? `<a class="btn ghost" href="/admin" data-link>🗂️ Fragen</a>` : ''}
      </div>
      ${sum ? `
      <div class="card pool">
        <div class="row-between"><span>🎯 Fragen ungespielt</span><strong>${sum.unplayed} / ${sum.questions}</strong></div>
        <div class="diffcount">${sum.byDifficulty.map(d => `<span class="diff d${d.v}">${d.icon} ${d.label} <b>${d.count}</b></span>`).join('')}</div>
        <div class="row-between"><span>⚔️ Duell-Paare ungespielt</span><strong>${sum.unplayedPairs} / ${sum.pairs}</strong></div>
      </div>` : ''}
    </div>`);
  }

  async function create() {
    if (busy) return;
    busy = true; render();
    try {
      const r = await api('/api/rooms', { method: 'POST' });
      store.setSession(r.code, { role: 'host', token: r.hostToken });
      navigate(`/host/${r.code}`, { replace: params.create });
    } catch (e) {
      toast('⚠️ ' + e.message);
    } finally {
      busy = false;
    }
  }

  render();
  if (params.create) create();
  else { checkResume(); loadMeta().then(render); }

  return {
    onAction(a) {
      if (a === 'create') create();
      if (a === 'resume' && resume) navigate(resume.role === 'host' ? `/host/${resume.code}` : `/join/${resume.code}`);
    },
    async onSubmit(form) {
      if (form !== 'join') return;
      const code = document.getElementById('joinCode').value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) { joinErr = 'Der Code hat 4 Buchstaben.'; render(); return; }
      try {
        await api(`/api/rooms/${code}`);
        navigate(`/join/${code}`);
      } catch (e) {
        joinErr = e.status === 404 ? `Kein Spiel mit dem Code ${code} gefunden.` : e.message;
        render();
      }
    },
    onInput(name, el) {
      if (name === 'code') el.value = el.value.toUpperCase();
    },
  };
}
