// Fragenverwaltung im Browser (ADMIN_TOKEN)
import { $app, esc, api, toast, patch, openSheet, closeSheet, pct } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { meta, loadMeta, diffBadge, catIcon } from '../meta.js';

export function mount(params, { navigate }) {
  let token = store.get('adminToken', '');
  let authed = false;
  let tab = 'questions';
  let filter = { search: '', category: '', difficulty: 0, active: 'all' };
  let page = 0;
  const PAGE = 30;
  let data = { total: 0, items: [] };
  let pairs = [];
  let people = [];
  let loading = false;
  let err = '';
  let searchT;

  const A = (path, opts = {}) => api(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });

  async function login() {
    try {
      await A('/api/admin/check');
      authed = true;
      err = '';
      store.set('adminToken', token);
      await loadMeta();
      await load();
    } catch (e) {
      authed = false;
      err = e.status === 403 ? e.message : token ? 'Das Token stimmt nicht.' : '';
      render();
    }
  }

  async function load() {
    loading = true; render();
    try {
      if (tab === 'questions') {
        const q = new URLSearchParams({ search: filter.search, category: filter.category, difficulty: filter.difficulty || '', active: filter.active, limit: PAGE, offset: page * PAGE });
        data = await A(`/api/questions?${q}`);
      } else if (tab === 'pairs') {
        pairs = await A('/api/pairs');
      } else if (tab === 'people') {
        people = await A('/api/people');
      }
    } catch (e) { toast('⚠️ ' + e.message); }
    loading = false;
    render();
  }

  function catOptions(sel, withAll = false) {
    return (withAll ? `<option value="">Alle Kategorien</option>` : '') +
      meta.categories.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${catIcon(c)} ${esc(c)}</option>`).join('');
  }

  function questionForm(q = {}) {
    const isNew = !q.id;
    return `
    <form class="qform" data-form="${isNew ? 'create' : 'update'}" data-id="${q.id || ''}">
      <label>Frage<textarea id="f-question" rows="3" maxlength="500" required data-keep="no">${esc(q.question || '')}</textarea></label>
      <label>Lösung<input id="f-answer" type="text" maxlength="500" required value="${esc(q.answer || '')}" data-keep="no">
        <small class="muted">Tipp: Alternativen in Klammern, z. B. „Nil (Amazonas auch gelten lassen)“</small></label>
      <div class="two">
        <label>Kategorie<select id="f-category" data-keep="no">${catOptions(q.category || meta.categories[0])}<option value="__new">＋ Neue Kategorie …</option></select></label>
        <label>Schwierigkeit<select id="f-difficulty" data-keep="no">${meta.diffs.map(d => `<option value="${d.v}" ${(q.difficulty || 2) === d.v ? 'selected' : ''}>${d.icon} ${d.label}</option>`).join('')}</select></label>
      </div>
      ${!isNew ? `<label class="check"><input id="f-active" type="checkbox" ${q.active ? 'checked' : ''} data-keep="no"> Aktiv (wird im Spiel verwendet)</label>` : ''}
      <button class="btn primary" type="submit">${isNew ? '＋ Frage speichern' : '💾 Änderungen speichern'}</button>
      ${!isNew ? `<p class="muted small">ID ${q.id}${q.times ? ` · ${q.times}× gespielt · ${pct(q.rate)} richtig` : ' · noch nie gespielt'}${q.source ? ` · Quelle: ${esc(q.source)}` : ''}</p>` : ''}
    </form>`;
  }

  function readForm() {
    let category = document.getElementById('f-category').value;
    if (category === '__new') {
      category = (prompt('Name der neuen Kategorie:') || '').trim();
      if (!category) return null;
    }
    const out = {
      question: document.getElementById('f-question').value,
      answer: document.getElementById('f-answer').value,
      category,
      difficulty: +document.getElementById('f-difficulty').value,
    };
    const act = document.getElementById('f-active');
    if (act) out.active = act.checked;
    return out;
  }

  function render() {
    if (!authed) {
      patch($app, `
      <div class="screen admin">
        <header class="topbar"><a class="icon-btn" href="/" data-link aria-label="Startseite">⌂</a><h2>🗂️ Fragen verwalten</h2><span class="spacer"></span></header>
        <form class="card" data-form="login">
          <h3>🔑 Anmelden</h3>
          <p class="muted small">Das Admin-Token steht in der Server-Konfiguration (<code>ADMIN_TOKEN</code>).</p>
          <div class="add-row"><input id="tok" type="password" autocomplete="current-password" placeholder="Admin-Token" value="${esc(token)}"><button class="btn primary" type="submit">Los</button></div>
          ${err ? `<p class="err small">${esc(err)}</p>` : ''}
        </form>
      </div>`);
      return;
    }
    const pages = Math.max(1, Math.ceil(data.total / PAGE));
    let body = '';
    if (tab === 'questions') {
      body = `
      <details class="card new-q" ${data.total === 0 ? 'open' : ''}>
        <summary><h3>＋ Neue Frage</h3></summary>
        ${questionForm()}
      </details>
      <section class="card">
        <div class="filters">
          <input id="search" type="search" placeholder="🔍 Suchen (Frage, Lösung, ID)" data-input="search" value="${esc(filter.search)}">
          <select data-change="category">${catOptions(filter.category, true)}</select>
          <select data-change="difficulty"><option value="0">Alle Stufen</option>${meta.diffs.map(d => `<option value="${d.v}" ${filter.difficulty === d.v ? 'selected' : ''}>${d.icon} ${d.label}</option>`).join('')}</select>
          <select data-change="active"><option value="all" ${filter.active === 'all' ? 'selected' : ''}>Aktiv & inaktiv</option><option value="1" ${filter.active === '1' ? 'selected' : ''}>Nur aktive</option><option value="0" ${filter.active === '0' ? 'selected' : ''}>Nur inaktive</option></select>
        </div>
        <p class="muted small">${data.total} Fragen${loading ? ' · lädt …' : ''}</p>
        <ul class="qlist admin-list">${data.items.map(q => `
          <li data-a="edit" data-id="${q.id}" class="${q.active ? '' : 'inactive'}">
            <div class="qmeta"><span class="cat">${catIcon(q.category)} ${esc(q.category)}</span><span>${diffBadge(q.difficulty)} ${q.pair_id ? '<span class="tag">⚔️ Duell</span>' : ''} ${q.active ? '' : '<span class="tag muted">inaktiv</span>'}</span></div>
            <p><strong>${esc(q.question)}</strong></p>
            <p class="muted small">→ ${esc(q.answer)} <span class="id">#${q.id}${q.times ? ` · ${pct(q.rate)} richtig (${q.times}×)` : ''}</span></p>
          </li>`).join('')}</ul>
        ${pages > 1 ? `<div class="pager"><button class="btn ghost slim" data-a="page" data-d="-1" ${page === 0 ? 'disabled' : ''}>‹ zurück</button><span class="muted small">Seite ${page + 1} / ${pages}</span><button class="btn ghost slim" data-a="page" data-d="1" ${page + 1 >= pages ? 'disabled' : ''}>weiter ›</button></div>` : ''}
      </section>`;
    } else if (tab === 'pairs') {
      body = `
      <form class="card" data-form="pair">
        <h3>＋ Neues Duell-Paar</h3>
        <p class="muted small">Zwei vergleichbare Fragen zum selben Thema – die IDs findest du in der Fragenliste (#123).</p>
        <label>Thema<input id="p-topic" type="text" maxlength="60" placeholder="z. B. Hauptstädte Afrika" required data-keep="no"></label>
        <div class="two"><label>Frage A (ID)<input id="p-a" type="number" min="1" required data-keep="no"></label><label>Frage B (ID)<input id="p-b" type="number" min="1" required data-keep="no"></label></div>
        <button class="btn primary" type="submit">Paar speichern</button>
      </form>
      <section class="card"><h3>⚔️ ${pairs.length} Duell-Paare</h3>
        <ul class="qlist">${pairs.map(p => `
          <li class="${p.active ? '' : 'inactive'}">
            <div class="row-between"><strong>${esc(p.topic)}</strong><button class="icon-btn s danger" data-a="delPair" data-id="${p.id}" aria-label="Paar löschen">✕</button></div>
            <p class="small">A #${p.a}: ${esc(p.a_question)}</p>
            <p class="small">B #${p.b}: ${esc(p.b_question)}</p>
          </li>`).join('')}</ul>
      </section>`;
    } else if (tab === 'people') {
      body = `
      <section class="card"><h3>👥 Spieler in der Statistik</h3>
        <p class="muted small">Spieler werden am Namen erkannt. Hat jemand mal „Ben“ und mal „Benni“ getippt, kannst du die beiden hier zusammenlegen.</p>
        <form class="merge" data-form="merge">
          <select id="m-from">${people.map(p => `<option value="${p.id}">${esc(p.emoji || '')} ${esc(p.name)} (${p.games})</option>`).join('')}</select>
          <span>→</span>
          <select id="m-into">${people.map(p => `<option value="${p.id}">${esc(p.emoji || '')} ${esc(p.name)} (${p.games})</option>`).join('')}</select>
          <button class="btn primary slim" type="submit">Zusammenlegen</button>
        </form>
        <ul class="results mt">${people.map(p => `<li><span class="pname">${esc(p.emoji || '')} ${esc(p.name)}</span><span class="muted small">${p.games} Spiele</span></li>`).join('')}</ul>
      </section>`;
    } else {
      body = `
      <section class="card"><h3>⬇️ Export</h3>
        <p class="muted small">Alle Fragen, Kategorien und Duell-Paare als JSON – gut als Backup oder zum Bearbeiten in einem Editor.</p>
        <button class="btn ghost" data-a="export">Fragen exportieren</button>
      </section>
      <form class="card" data-form="import">
        <h3>⬆️ Import</h3>
        <p class="muted small">JSON im selben Format wie der Export. Fragen mit vorhandener ID werden aktualisiert, alle anderen neu angelegt.</p>
        <input id="importFile" type="file" accept="application/json,.json" data-keep="no">
        <button class="btn primary mt" type="submit">Importieren</button>
      </form>
      <section class="card"><h3>🤖 API für Automatisierungen</h3>
        <p class="muted small">Mit dem Admin-Token als <code>Authorization: Bearer …</code> kannst du z. B. aus n8n Fragen anlegen:</p>
        <pre class="code">POST /api/questions
{ "question": "…", "answer": "…",
  "category": "Geografie", "difficulty": 2,
  "source": "n8n" }</pre>
        <p class="muted small">Mehr im README.</p>
      </section>`;
    }
    patch($app, `
    <div class="screen admin">
      <header class="topbar"><a class="icon-btn" href="/" data-link aria-label="Startseite">⌂</a><h2>🗂️ Fragen verwalten</h2><button class="icon-btn" data-a="logout" aria-label="Abmelden">⎋</button></header>
      <div class="tabs">
        ${[['questions', '❓ Fragen'], ['pairs', '⚔️ Duelle'], ['people', '👥 Spieler'], ['io', '⇅ Import']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}
      </div>
      ${body}
    </div>`, { keepScroll: true });
  }

  async function openEdit(id) {
    try {
      const q = data.items.find(x => x.id === id) || await A(`/api/questions/${id}`);
      openSheet(`<h3>✏️ Frage bearbeiten</h3>${questionForm(q)}<button class="btn ghost" data-a="closeSheet">Abbrechen</button>`);
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  if (token) login(); else render();

  return {
    async onAction(a, el) {
      const d = el.dataset;
      if (a === 'tab') { tab = d.v; page = 0; load(); }
      if (a === 'logout') { store.set('adminToken', ''); token = ''; authed = false; render(); }
      if (a === 'edit') openEdit(+d.id);
      if (a === 'page') { page = Math.max(0, page + +d.d); load(); window.scrollTo(0, 0); }
      if (a === 'delPair') {
        if (!confirm('Duell-Paar löschen? (Die Fragen bleiben erhalten)')) return;
        try { await A(`/api/pairs/${d.id}`, { method: 'DELETE' }); toast('Paar gelöscht'); load(); } catch (e) { toast('⚠️ ' + e.message); }
      }
      if (a === 'export') {
        try {
          const res = await fetch('/api/export', { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error('Export fehlgeschlagen');
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `schnobbis-fragen-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { toast('⚠️ ' + e.message); }
      }
    },
    onInput(name, el) {
      if (name === 'search') {
        clearTimeout(searchT);
        searchT = setTimeout(() => { filter.search = el.value.trim(); page = 0; load(); }, 300);
      }
    },
    onChange(name, el) {
      if (name === 'category') filter.category = el.value;
      if (name === 'difficulty') filter.difficulty = +el.value;
      if (name === 'active') filter.active = el.value;
      page = 0;
      load();
    },
    async onSubmit(form, f) {
      try {
        if (form === 'login') { token = document.getElementById('tok').value.trim(); await login(); return; }
        if (form === 'create') {
          const body = readForm(); if (!body) return;
          const q = await A('/api/questions', { method: 'POST', body: { ...body, source: 'admin' } });
          toast(`✅ Frage #${q.id} gespeichert`);
          await loadMeta();
          f.reset();
          load();
        }
        if (form === 'update') {
          const body = readForm(); if (!body) return;
          await A(`/api/questions/${f.dataset.id}`, { method: 'PATCH', body });
          toast('💾 Gespeichert');
          closeSheet();
          await loadMeta();
          load();
        }
        if (form === 'pair') {
          await A('/api/pairs', { method: 'POST', body: { topic: document.getElementById('p-topic').value, a: +document.getElementById('p-a').value, b: +document.getElementById('p-b').value } });
          toast('⚔️ Duell-Paar gespeichert');
          f.reset();
          load();
        }
        if (form === 'merge') {
          const from = document.getElementById('m-from').value, into = document.getElementById('m-into').value;
          const names = [from, into].map(id => people.find(p => p.id === +id)?.name);
          if (!confirm(`„${names[0]}“ in „${names[1]}“ aufgehen lassen? Das kann man nicht rückgängig machen.`)) return;
          await A('/api/people/merge', { method: 'POST', body: { from: +from, into: +into } });
          toast('👥 Zusammengelegt');
          load();
        }
        if (form === 'import') {
          const file = document.getElementById('importFile').files[0];
          if (!file) return toast('Bitte eine JSON-Datei wählen');
          const json = JSON.parse(await file.text());
          const r = await A('/api/import', { method: 'POST', body: json });
          toast(`⬆️ ${r.created} neu, ${r.updated} aktualisiert, ${r.pairs} Paare${r.errors.length ? `, ${r.errors.length} Fehler` : ''}`, 5000);
          await loadMeta();
        }
      } catch (e) {
        toast('⚠️ ' + e.message, 4000);
      }
    },
  };
}
