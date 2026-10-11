import { prepareImage, recognize } from './ocr.js';
import { parseReceipt } from './receipt-parse.js';

// Planer-Ansichten: Assistent, Cockpit, Feiern, Gästeliste, Budget, Dienstleister, Geschenke, Zusagen.
// Alle Bereiche hängen über den Server zusammen (Feier ↔ Einladungen ↔ Zusagen ↔ Sitzplan ↔ Drucksachen,
// Dienstleister ↔ Aufgaben ↔ Budget ↔ Kalender).

const eur2 = n => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const eur = n => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const SCOPES = { alle: 'Alle Gäste', familie: 'Familie', frauen: 'Nur Frauen', klein: 'Kleiner Kreis (von Hand)' };
const GROUPS = ['Familie Braut', 'Familie Bräutigam', 'Freunde', 'Kollegen', 'Nachbarn', 'Verein', 'Sonstige'];
const VSTATUS = { offen: 'Noch offen', angefragt: 'Angefragt', angebot: 'Angebot liegt vor', gebucht: 'Gebucht', abgesagt: 'Abgesagt' };
const GIFT_KINDS = { geld: 'Geld', gold: 'Gold / Schmuck (Takı)', sache: 'Geschenk', gutschein: 'Gutschein', erlebnis: 'Erlebnis' };
const MENU_LABEL = { fleisch: 'Fleisch', fisch: 'Fisch', vegetarisch: 'Vegetarisch', vegan: 'Vegan', kind: 'Kindermenü' };
const ICON = {
  feiern: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/></svg>',
  budget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
  vendors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 21V9l8-5 8 5v12M9 21v-6h6v6"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="8" width="18" height="5"/><path d="M5 13v8h14v-8M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8zm0 0s2-5 4.5-3.5S15 8 12 8z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 11 7.6-3.8M8.2 13l7.6 3.8"/></svg>',
};

/* ================= Assistent ================= */
export async function renderWizard(ctx, { edit = false } = {}) {
  const { api, S, esc, toast, view, go, iso, addD } = ctx;
  const cat = S.catalog || (S.catalog = await api('/api/catalog'));
  const pr = edit ? S.w.profile : null;
  const W = {
    name1: edit ? S.w.name1 : (S.me.user.name.split(' ')[0] || ''), name2: edit ? S.w.name2 : '', date: edit ? S.w.date : iso(addD(new Date(), 300)), location: edit ? S.w.location : '',
    traditions: new Set(pr?.traditions || ['standesamt', 'frei']), guests: pr?.guests || 80, budget: edit ? (pr?.budget || '') : '',
    langs: pr?.langs?.length ? [...pr.langs] : ['de'], options: { kids: true, ...(pr?.options || {}) },
  };
  const groups = {}; for (const [k, t] of Object.entries(cat.traditions)) (groups[t.group] ||= []).push([k, t]);
  const islamic = () => ['islamisch', 'arabisch', 'tuerkisch', 'kurdisch'].some(k => W.traditions.has(k));
  let previewT;

  function draw() {
    view.innerHTML = `
    <div><span class="eyebrow">${edit ? 'Traditionen & Optionen' : `Hallo ${esc(S.me.user.name)}`}</span><h1>${edit ? 'Euren Plan anpassen' : 'Eure Hochzeit in drei Schritten'}</h1>
      <p class="muted">${edit ? 'Neue Traditionen ergänzen Feiern, Aufgaben, Budgetposten und Dienstleister. Was ihr schon eingetragen habt, bleibt erhalten.' : 'Aus wenigen Angaben entsteht euer kompletter Plan: Feiern mit Ablauf, Zeitplan, Budget, Dienstleister-Liste, Gästeliste und alle Drucksachen. Alles lässt sich danach anpassen.'}</p></div>
    <div class="wiz">
      <form class="stack" id="wizForm" autocomplete="off">
        ${edit ? '' : `<section class="card"><span class="step-no">1</span><h2>Wer und wann?</h2>
          <div class="fields2">
            <div class="field"><label for="wz-n1">Name 1</label><input id="wz-n1" required maxlength="40" value="${esc(W.name1)}"></div>
            <div class="field"><label for="wz-n2">Name 2</label><input id="wz-n2" required maxlength="40" value="${esc(W.name2)}"></div>
            <div class="field"><label for="wz-d">Datum der Hauptfeier</label><input id="wz-d" type="date" required value="${esc(W.date)}"></div>
            <div class="field"><label for="wz-l">Ort bzw. Location</label><input id="wz-l" maxlength="120" value="${esc(W.location)}" placeholder="z. B. Festsaal Köln"></div>
          </div></section>`}
        <section class="card"><span class="step-no">${edit ? 1 : 2}</span><h2>Welche Traditionen feiert ihr?</h2>
          <p class="small muted">Mehrfachauswahl ist ausdrücklich gewünscht: viele Paare verbinden zwei Kulturen.</p>
          ${Object.entries(groups).map(([g, list]) => `<div class="trad-group"><div class="lbl">${esc(g)}</div><div class="chips">${list.map(([k, t]) => `<button type="button" class="chip-t ${W.traditions.has(k) ? 'on' : ''}" data-t="${k}" aria-pressed="${W.traditions.has(k)}" title="${esc(t.desc)}">${esc(t.label)}</button>`).join('')}</div></div>`).join('')}
          <div class="trad-desc">${[...W.traditions].map(k => cat.traditions[k] && `<div><b>${esc(cat.traditions[k].label)}:</b> ${esc(cat.traditions[k].desc)}${cat.traditions[k].events.length ? ` <span class="muted">Feiern: ${cat.traditions[k].events.map(esc).join(', ')}</span>` : ''}</div>`).filter(Boolean).join('')}</div>
        </section>
        <section class="card"><span class="step-no">${edit ? 2 : 3}</span><h2>Eckdaten</h2>
          <div class="fields2">
            <div class="field"><label for="wz-g">Gäste (ungefähr)</label><input id="wz-g" type="number" min="2" max="2000" value="${W.guests}" inputmode="numeric"></div>
            <div class="field"><label for="wz-b">Budget in € (leer = Schätzung)</label><input id="wz-b" type="number" min="0" step="500" value="${esc(W.budget)}" inputmode="numeric" placeholder="automatisch"></div>
          </div>
          <div class="stack small">
            ${[['noAlcohol', 'Alkoholfreie Feier'], ['separated', 'Getrennte Bereiche für Damen und Herren'], ['kids', 'Kinder sind eingeladen'], ['international', 'Ein:e Partner:in hat keine deutsche Staatsangehörigkeit'], ['abroad', 'Wir heiraten im Ausland']].map(([k, l]) => `<label class="row"><input type="checkbox" data-o="${k}" ${W.options[k] ? 'checked' : ''}> ${l}</label>`).join('')}
            ${islamic() ? `<label class="row"><input type="checkbox" data-o="bismillah" ${W.options.bismillah ? 'checked' : ''}> „Bismillah“ auf den Einladungen</label>` : ''}
          </div>
          <div class="field"><label>Sprachen für Einladungen &amp; Drucksachen (bis zu 3)</label><div class="chips">${Object.entries(cat.langs).map(([k, l]) => `<button type="button" class="chip-t small ${W.langs.includes(k) ? 'on' : ''}" data-l="${k}" aria-pressed="${W.langs.includes(k)}">${l}</button>`).join('')}</div></div>
        </section>
        <p class="err" id="wzErr" hidden></p>
        <div class="row"><button class="btn" type="submit" id="wzGo">${edit ? 'Plan aktualisieren' : 'Plan erstellen'}</button>${edit ? `<a class="btn sec" href="#/w/${S.w.id}/einstellungen">Abbrechen</a>` : ''}</div>
      </form>
      <aside class="card wiz-preview" id="wzPrev"><span class="eyebrow">Das entsteht für euch</span><p class="small muted">Einen Moment …</p></aside>
    </div>`;
    bind(); preview();
  }
  function read() {
    if (!edit) { W.name1 = view.querySelector('#wz-n1').value.trim(); W.name2 = view.querySelector('#wz-n2').value.trim(); W.date = view.querySelector('#wz-d').value; W.location = view.querySelector('#wz-l').value.trim(); }
    W.guests = parseInt(view.querySelector('#wz-g').value) || 80; W.budget = view.querySelector('#wz-b').value;
  }
  const profile = () => ({ traditions: [...W.traditions], guests: W.guests, budget: Number(W.budget) || 0, langs: W.langs, options: W.options });
  function preview() {
    clearTimeout(previewT);
    previewT = setTimeout(async () => {
      read();
      const el = view.querySelector('#wzPrev'); if (!el) return;
      try {
        const p = await api('/api/plan-preview', { method: 'POST', body: { profile: profile(), date: edit ? S.w.date : W.date } });
        el.innerHTML = `<span class="eyebrow">Das entsteht für euch</span>
          <div class="stats"><div class="stat"><b>${p.events.length}</b><span>Feiern</span></div><div class="stat"><b>${p.tasks}</b><span>Aufgaben</span></div><div class="stat"><b>${p.vendors}</b><span>Dienstleister</span></div><div class="stat"><b>${(p.budget / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k</b><span>Budget €</span></div></div>
          <ul class="ev-mini">${p.events.map(e => `<li><span class="mono small">${e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }) : ''} ${e.time}</span><b>${esc(e.title)}</b><span class="small muted">${SCOPES[e.scope] || ''}</span></li>`).join('')}</ul>
          <p class="small muted">Dazu ${p.witnessTasks} Aufgaben für Trauzeug:innen, eine Gästeliste mit Zusage-Links und Drucksachen in ${W.langs.length > 1 ? 'mehreren Sprachen' : 'eurer Sprache'}.${W.budget ? '' : ` Budget geschätzt aus ${W.guests} Gästen.`}</p>
          ${p.warnings.map(w => `<p class="warn-note">${esc(w)}</p>`).join('')}`;
      } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    }, 250);
  }
  function bind() {
    view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const k = b.dataset.t; W.traditions.has(k) ? W.traditions.delete(k) : W.traditions.add(k); read(); draw(); });
    view.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { const k = b.dataset.l; if (W.langs.includes(k)) { if (W.langs.length > 1) W.langs = W.langs.filter(x => x !== k); } else if (W.langs.length < 3) W.langs.push(k); read(); draw(); });
    view.querySelectorAll('[data-o]').forEach(c => c.onchange = () => { W.options[c.dataset.o] = c.checked; read(); if (c.dataset.o === 'noAlcohol') preview(); else draw(); });
    view.querySelectorAll('#wizForm input:not([type=checkbox])').forEach(i => i.oninput = preview);
    view.querySelector('#wizForm').onsubmit = async e => {
      e.preventDefault(); read();
      const err = view.querySelector('#wzErr'); err.hidden = true;
      if (!W.traditions.size) { err.textContent = 'Bitte mindestens eine Tradition wählen.'; err.hidden = false; return; }
      const btn = view.querySelector('#wzGo'); btn.disabled = true; btn.textContent = 'Wird erstellt …';
      try {
        if (edit) { await api(`/api/w/${S.w.id}/profile`, { method: 'PATCH', body: profile() }); S.w = null; toast('Plan aktualisiert'); return go(`#/w/${S.wid || ctx.wid}/uebersicht`); }
        const r = await api('/api/weddings', { method: 'POST', body: { name1: W.name1, name2: W.name2, date: W.date, location: W.location, profile: profile() } });
        S.me = await api('/api/me'); toast(`Euer Plan steht: ${r.events} Feiern, ${r.tasks} Aufgaben`); go(`#/w/${r.id}/uebersicht`);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = edit ? 'Plan aktualisieren' : 'Plan erstellen'; }
    };
  }
  draw();
}

/* ================= Cockpit (Paar) ================= */
export async function vCockpit(ctx) {
  const { api, S, esc, view, fmt, parseD } = ctx;
  const [ov, gl] = await Promise.all([api(`/api/w/${S.w.id}/overview`), api(`/api/w/${S.w.id}/guests`)]);
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const evs = S.events;
  const next = ov.tasks.next;
  const card = (href, title, body) => `<a class="card cock" href="#/w/${S.w.id}/${href}"><div class="row between"><h3>${title}</h3><span class="small muted">›</span></div>${body}</a>`;
  view.innerHTML = `
  ${S.warnings?.length ? `<div class="stack">${S.warnings.map(w => `<p class="warn-note">${esc(w)}</p>`).join('')}</div>` : ''}
  <div class="grid2">
    <div class="stack">${ctx.countdownCard()}
      ${card('feiern', 'Eure Feiern', `<ul class="ev-mini">${evs.map(e => `<li><span class="mono small">${parseD(e.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} ${esc(e.time)}</span><b>${esc(e.title)}</b><span class="small muted">${esc(e.location || '')}</span></li>`).join('')}</ul>`)}
    </div>
    <div class="stack">
      <section class="card"><div class="row between"><h3>Als Nächstes dran</h3><a class="mini" href="#/w/${S.w.id}/zeitplan">Zeitplan</a></div>
        <div class="progress"><i style="width:${pct(ov.tasks.done, ov.tasks.total)}%"></i></div><p class="small muted">${ov.tasks.done} von ${ov.tasks.total} Aufgaben erledigt</p>
        <ul class="upnext">${next.map(t => { const d = parseD(t.due); const late = d < new Date(new Date().toDateString()); return `<li><div class="dbox ${late ? 'late' : ''}"><b>${d.getDate()}</b><span>${fmt(d, { month: 'short' })}</span></div><div><div style="font-weight:600">${esc(t.title)}</div>${late ? '<span class="pill late">überfällig</span>' : ''}</div></li>`; }).join('') || '<li class="empty">Alles erledigt!</li>'}</ul></section>
      ${card('gaeste', 'Gäste & Zusagen', `<p class="small muted">${ov.guests.entries} Einträge · ${ov.guests.persons} Personen eingeladen</p>
        <div class="evstats">${gl.perEvent.map(p => `<div><b>${esc(p.title)}</b><span class="pill ok">${p.personen} kommen</span><span class="pill">${p.offen} offen</span>${p.absage ? `<span class="pill late">${p.absage} Absagen</span>` : ''}</div>`).join('')}</div>`)}
      ${card('budget', 'Budget', `<div class="bbar"><i class="spent" style="width:${Math.min(100, pct(ov.budget.actual, ov.budget.total))}%"></i><i class="paid" style="width:${Math.min(100, pct(ov.budget.paid, ov.budget.total))}%"></i></div>
        <p class="small muted">${eur(ov.budget.actual)} voraussichtlich von ${eur(ov.budget.total)} · ${eur(ov.budget.paid)} bezahlt${ov.expenses?.n ? ` · ${ov.expenses.n} Belege` : ''}</p>
        ${ov.budget.nextPayments.length ? `<p class="small">Nächste Zahlung: <b>${esc(ov.budget.nextPayments[0].title)}</b> ${eur(ov.budget.nextPayments[0].amount)} bis ${fmt(parseD(ov.budget.nextPayments[0].due))}</p>` : ''}`)}
      ${card('dienstleister', 'Dienstleister', `<div class="progress"><i style="width:${pct(ov.vendors.booked, ov.vendors.total)}%"></i></div><p class="small muted">${ov.vendors.booked} von ${ov.vendors.total} gebucht</p>`)}
      ${card('druck', 'Drucksachen', `<p class="small muted">${ov.guests.withAddress} von ${ov.guests.entries} Gästen mit Adresse (für Einladungen & Etiketten) · ${ov.seating.assigned} von ${ov.seating.seats} Plätzen vergeben (für Tischkarten)</p>`)}
      ${card('geschenke', 'Geschenke & Danksagungen', `<p class="small muted">${ov.gifts.total} Geschenke erfasst · ${ov.gifts.thanked} bedankt</p>`)}
    </div>
  </div>${ctx.accountFoot()}`;
}

/* ================= Mehr ================= */
export function vMore(ctx) {
  const { S, view } = ctx;
  const tiles = [['feiern', 'Feiern & Abläufe', 'Termine, Orte, Gästekreis und Programm jeder Feier', ICON.feiern], ['budget', 'Budget & Kosten', 'Kostenrechner, Belege scannen, Zahlungen und Fristen', ICON.budget], ['dienstleister', 'Dienstleister', 'Anfragen, Angebote, Buchungen, Kontakte', ICON.vendors], ['druck', 'Druckerei', 'Einladungen, Karten, Etiketten, Schilder', ICON.print], ['geschenke', 'Geschenke', 'Wer hat was geschenkt, Danksagungen', ICON.gift], ['einstellungen', 'Einstellungen & Einladen', 'Daten, Traditionen, Codes, Kalender', ICON.gear]];
  view.innerHTML = `<div><span class="eyebrow">Alles für eure Hochzeit</span><h1>Mehr</h1></div>
  <div class="tiles">${tiles.map(([k, t, d, ic]) => `<a class="tile" href="#/w/${S.w.id}/${k}">${ic}<b>${t}</b><span>${d}</span></a>`).join('')}</div>${ctx.accountFoot()}`;
}

/* ================= Feiern & Abläufe ================= */
export async function vEvents(ctx) {
  const { api, S, esc, toast, view, fmt, parseD } = ctx;
  const editable = S.role === 'paar';
  const [{ items }, info] = await Promise.all([api(`/api/w/${S.w.id}/schedule`), api(`/api/w/${S.w.id}`)]);
  S.events = info.events;
  let editing = null, adding = false, confirmDel = null;
  function draw() {
    view.innerHTML = `<div class="row between"><div><span class="eyebrow">${S.events.length} ${S.events.length === 1 ? 'Feier' : 'Feiern'}</span><h1>${editable ? 'Feiern & Abläufe' : 'Programm'}</h1></div>${editable ? `<button class="btn sec small" id="evAdd">Feier hinzufügen</button>` : ''}</div>
    ${adding ? `<form class="card" id="evNew"><h3>Neue Feier</h3><div class="fields2"><div class="field"><label for="en-t">Titel</label><input id="en-t" name="title" required maxlength="80" placeholder="z. B. Brunch am Tag danach"></div><div class="field"><label for="en-d">Datum</label><input id="en-d" name="date" type="date" required value="${esc(S.w.date)}"></div><div class="field"><label for="en-z">Uhrzeit</label><input id="en-z" name="time" type="time" value="11:00"></div><div class="field"><label for="en-s">Gästekreis</label><select id="en-s" name="scope">${Object.entries(SCOPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div><div class="field"><label for="en-l">Ort</label><input id="en-l" name="location" maxlength="120"></div><div class="row"><button class="btn small">Anlegen</button><button type="button" class="btn sec small" id="evNewNo">Abbrechen</button></div></form>` : ''}
    <div class="events">${S.events.map(e => {
      const sched = items.filter(i => i.event_id === e.id);
      const d = parseD(e.date);
      return `<section class="card ev-card" id="ev-${e.id}">
        <div class="ev-head"><div class="ev-date"><b>${d.getDate()}</b><span>${fmt(d, { month: 'short' })}</span><small>${fmt(d, { weekday: 'short' })}</small></div>
          <div class="ev-title"><h2>${esc(e.title)}</h2><p class="small muted">${esc(e.time)} Uhr${e.location ? ' · ' + esc(e.location) : ''}${e.address ? ', ' + esc(e.address) : ''}</p>
          ${editable ? `<div class="meta"><span class="pill">${SCOPES[e.scope] || e.scope}</span>${e.custom_date ? '<span class="pill moved">Datum von Hand</span>' : e.key !== 'feier' && e.offset ? `<span class="pill">${e.offset > 0 ? '+' : ''}${e.offset} Tage zur Hauptfeier</span>` : ''}</div>` : ''}</div>
          ${editable ? `<button class="mini" data-ee="${e.id}">${editing === e.id ? 'Schließen' : 'Bearbeiten'}</button>` : ''}</div>
        ${e.address ? `<a class="mini" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.location, e.address].filter(Boolean).join(', '))}">Route planen</a>` : ''}
        ${editing === e.id ? `<form class="stack ev-edit" data-ef="${e.id}">
          <div class="fields2"><div class="field"><label>Titel</label><input name="title" required maxlength="80" value="${esc(e.title)}"></div><div class="field"><label>Datum</label><input name="date" type="date" required value="${esc(e.date)}"></div>
          <div class="field"><label>Uhrzeit</label><input name="time" type="time" required value="${esc(e.time)}"></div><div class="field"><label>Gästekreis</label><select name="scope">${Object.entries(SCOPES).map(([k, l]) => `<option value="${k}" ${e.scope === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
          <div class="field"><label>Ort</label><input name="location" maxlength="120" value="${esc(e.location)}"></div><div class="field"><label>Adresse</label><input name="address" maxlength="200" value="${esc(e.address)}"></div>
          <p class="small muted">${e.key === 'feier' ? 'Ändert ihr das Datum der Hauptfeier, wandern alle anderen Feiern und Aufgaben mit.' : 'Ein geändertes Datum verschiebt auch die Aufgaben, die zu dieser Feier gehören.'}</p>
          <div class="row"><button class="btn small">Speichern</button>${e.key !== 'feier' ? (confirmDel === e.id ? `<button type="button" class="btn danger small" data-edel="${e.id}">Wirklich löschen</button>` : `<button type="button" class="btn ghost small" data-edq="${e.id}">Feier löschen</button>`) : ''}</div></form>` : ''}
        <ul class="sched">${sched.map(s => `<li><b>${esc(s.time)}</b><div><div style="font-weight:600">${esc(s.title)}</div>${s.place ? `<span class="small muted">${esc(s.place)}</span>` : ''}</div>${editable ? `<button class="mini" data-sdel="${s.id}" aria-label="Programmpunkt löschen">×</button>` : '<span></span>'}</li>`).join('') || '<li class="empty" style="display:block">Programm folgt.</li>'}</ul>
        ${editable ? `<form class="row sched-add" data-sa="${e.id}"><input name="time" type="time" required value="18:00" style="max-width:120px" aria-label="Uhrzeit"><input name="title" required maxlength="100" placeholder="Programmpunkt hinzufügen" style="flex:1;min-width:150px" aria-label="Programmpunkt"><button class="btn sec small">+</button></form>` : ''}
      </section>`;
    }).join('')}</div>`;
    bind();
  }
  function bind() {
    const a = view.querySelector('#evAdd'); if (a) a.onclick = () => { adding = !adding; draw(); };
    const nn = view.querySelector('#evNewNo'); if (nn) nn.onclick = () => { adding = false; draw(); };
    const nf = view.querySelector('#evNew'); if (nf) nf.onsubmit = async ev => { ev.preventDefault(); try { await api(`/api/w/${S.w.id}/events`, { method: 'POST', body: Object.fromEntries(new FormData(nf)) }); toast('Feier angelegt'); S.w = null; ctx.reload(); } catch (e) { toast(e.message); } };
    view.querySelectorAll('[data-ee]').forEach(b => b.onclick = () => { editing = editing === +b.dataset.ee ? null : +b.dataset.ee; confirmDel = null; draw(); });
    view.querySelectorAll('[data-ef]').forEach(f => f.onsubmit = async ev => { ev.preventDefault(); try { const r = await api(`/api/events/${f.dataset.ef}`, { method: 'PATCH', body: Object.fromEntries(new FormData(f)) }); toast(r.moved ? `Gespeichert, ${r.moved} Aufgaben verschoben` : 'Gespeichert'); S.w = null; ctx.reload(); } catch (e) { toast(e.message); } });
    view.querySelectorAll('[data-edq]').forEach(b => b.onclick = () => { confirmDel = +b.dataset.edq; draw(); });
    view.querySelectorAll('[data-edel]').forEach(b => b.onclick = async () => { await api(`/api/events/${b.dataset.edel}`, { method: 'DELETE' }); toast('Feier gelöscht'); S.w = null; ctx.reload(); });
    view.querySelectorAll('[data-sdel]').forEach(b => b.onclick = async () => { await api(`/api/schedule/${b.dataset.sdel}`, { method: 'DELETE' }); ctx.reload(); });
    view.querySelectorAll('[data-sa]').forEach(f => f.onsubmit = async ev => { ev.preventDefault(); try { await api(`/api/w/${S.w.id}/schedule`, { method: 'POST', body: { ...Object.fromEntries(new FormData(f)), event_id: +f.dataset.sa } }); ctx.reload(); } catch (e) { toast(e.message); } });
  }
  draw();
}

/* ================= Gästeliste (Paar) ================= */
export async function vGuestManager(ctx) {
  const { api, S, esc, toast, view } = ctx;
  const editable = S.role === 'paar';
  let data = await api(`/api/w/${S.w.id}/guests`);
  const st = S.gl || (S.gl = { q: '', grp: '', status: '', open: null, confirm: null, bulk: false });
  const sep = S.w.profile?.options?.separated || data.events.some(e => e.scope === 'frauen');
  const evShort = e => e.title.length > 14 ? e.title.replace(/\s*\(.*\)/, '').slice(0, 14) : e.title;
  async function refresh() { data = await api(`/api/w/${S.w.id}/guests`); draw(); }
  function draw() {
    const groups = [...new Set([...GROUPS, ...data.guests.map(g => g.grp).filter(Boolean)])];
    const q = st.q.toLowerCase();
    const list = data.guests.filter(g => (!q || g.name.toLowerCase().includes(q) || g.grp.toLowerCase().includes(q)) && (!st.grp || g.grp === st.grp) && (!st.status || g.status === st.status));
    const persons = data.guests.reduce((s, g) => s + g.adults + g.kids, 0);
    view.innerHTML = `<div class="row between"><div><span class="eyebrow">${data.guests.length} Einträge · ${persons} Personen</span><h1>Gästeliste</h1></div>${editable ? `<button class="btn sec small" id="glBulk">${st.bulk ? 'Schließen' : 'Liste einfügen'}</button>` : ''}</div>
    <div class="evstats card">${data.perEvent.map(p => `<div><b>${esc(p.title)}</b><span class="pill ok">${p.personen} kommen</span><span class="pill">${p.offen} offen</span>${p.absage ? `<span class="pill late">${p.absage} Absagen</span>` : ''}${Object.keys(p.menus).length ? `<span class="small muted">${Object.entries(p.menus).map(([k, n]) => `${MENU_LABEL[k]} ${n}`).join(' · ')}</span>` : ''}</div>`).join('')}</div>
    ${editable && st.bulk ? `<form class="card" id="glImport"><h3>Viele Gäste auf einmal</h3><p class="small muted">Eine Zeile pro Gast oder Haushalt. Reihenfolge: <span class="mono">Name; Personen; Gruppe; E-Mail; Adresse</span>. Nur der Name ist Pflicht. Ihr könnt auch direkt aus Excel oder Google Tabellen einfügen.</p>
      <textarea name="text" required rows="7" placeholder="Familie Albers; 4; Familie Braut; albers@mail.de; Lindenweg 3, 50667 Köln&#10;Oma Ruth; 1; Familie Bräutigam&#10;Max Roth"></textarea>
      <div class="row"><select name="grp" aria-label="Gruppe für alle ohne Angabe"><option value="">Gruppe, falls nicht angegeben …</option>${groups.map(g => `<option>${esc(g)}</option>`).join('')}</select><button class="btn">Importieren</button></div></form>` : ''}
    ${editable ? `<form class="card guest-add" id="glAdd"><h3>Gast hinzufügen</h3>
      <div class="ga-row"><div class="field" style="flex:2"><label for="ga-n">Name oder Haushalt</label><input id="ga-n" name="name" required maxlength="80" placeholder="z. B. Familie Albers"></div>
        <div class="field ga-num"><label for="ga-a">Erw.</label><input id="ga-a" name="adults" type="number" min="1" max="30" value="1"></div><div class="field ga-num"><label for="ga-k">Kinder</label><input id="ga-k" name="kids" type="number" min="0" max="30" value="0"></div>
        <div class="field" style="flex:1.4"><label for="ga-g">Gruppe</label><input id="ga-g" name="grp" list="glGroups" maxlength="40" value="${esc(st.lastGrp || '')}"></div>
        ${sep ? `<div class="field ga-num"><label for="ga-s">Bereich</label><select id="ga-s" name="gender"><option value="">–</option><option value="w">Damen</option><option value="m">Herren</option></select></div>` : ''}
        <button class="btn" style="align-self:end">+</button></div>
      <details><summary class="small">E-Mail, Adresse & Anrede (für Einladungen und Etiketten)</summary><div class="fields2" style="margin-top:8px"><div class="field"><label>E-Mail</label><input name="email" type="email" maxlength="120"></div><div class="field"><label>Anrede auf der Einladung</label><input name="salutation" maxlength="120" placeholder="Liebe Familie Albers"></div></div><div class="field"><label>Adresse</label><textarea name="address" rows="2" maxlength="300"></textarea></div></details>
      <datalist id="glGroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></form>` : ''}
    <div class="row gl-filter"><input id="glQ" placeholder="Suchen …" value="${esc(st.q)}" style="flex:1;min-width:140px" aria-label="Gäste suchen"><select id="glG" aria-label="Gruppe"><option value="">Alle Gruppen</option>${groups.map(g => `<option ${st.grp === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select><select id="glS" aria-label="Status"><option value="">Alle Antworten</option><option value="zusage" ${st.status === 'zusage' ? 'selected' : ''}>Zusagen</option><option value="offen" ${st.status === 'offen' ? 'selected' : ''}>Offen</option><option value="absage" ${st.status === 'absage' ? 'selected' : ''}>Absagen</option></select></div>
    <ul class="glist">${list.map(g => `<li class="gl-item">
      <div class="row between"><div><b>${esc(g.name)}</b> <span class="small muted">${g.adults + g.kids} P.${g.kids ? ` (${g.kids} Kind${g.kids > 1 ? 'er' : ''})` : ''}${g.grp ? ' · ' + esc(g.grp) : ''}${g.gender ? ' · ' + (g.gender === 'w' ? 'Damen' : 'Herren') : ''}</span>${g.has_app ? ' <span class="pill">App</span>' : ''}${editable && !g.address ? ' <span class="pill warn-pill">ohne Adresse</span>' : ''}</div>
        ${editable ? `<div class="row"><button class="mini" data-copy="${esc(S.base + '/app#/r/' + g.token)}" title="Persönlichen Zusage-Link kopieren">Link</button><button class="mini" data-open="${g.id}">${st.open === g.id ? 'Schließen' : 'Bearbeiten'}</button></div>` : ''}</div>
      <div class="ev-chips">${data.events.map(e => { const inv = g.invites.find(i => i.event_id === e.id); return `<button class="evc ${inv ? 'inv ' + inv.status : ''}" ${editable ? `data-inv="${g.id}:${e.id}:${inv ? 0 : 1}"` : 'disabled'} title="${inv ? `${esc(e.title)}: ${inv.status}${inv.status === 'zusage' ? ', ' + inv.persons + ' Personen' : ''}` : `${esc(e.title)}: nicht eingeladen`}">${esc(evShort(e))}${inv?.status === 'zusage' ? ' ✓' : inv?.status === 'absage' ? ' ✗' : ''}</button>`; }).join('')}</div>
      ${(g.menu || g.allergies || g.message) ? `<p class="small muted">${g.menu ? MENU_LABEL[g.menu] : ''}${g.allergies ? ' · Allergien: ' + esc(g.allergies) : ''}${g.message ? ` · „${esc(g.message)}“` : ''}</p>` : ''}
      ${editable && st.open === g.id ? `<form class="stack gl-edit" data-gf="${g.id}"><div class="fields2"><div class="field"><label>Name</label><input name="name" required maxlength="80" value="${esc(g.name)}"></div><div class="field"><label>Anrede</label><input name="salutation" maxlength="120" value="${esc(g.salutation)}" placeholder="Liebe Familie …"></div>
        <div class="field"><label>Erwachsene</label><input name="adults" type="number" min="0" max="30" value="${g.adults}"></div><div class="field"><label>Kinder</label><input name="kids" type="number" min="0" max="30" value="${g.kids}"></div>
        <div class="field"><label>Gruppe</label><input name="grp" list="glGroups" maxlength="40" value="${esc(g.grp)}"></div><div class="field"><label>Bereich / Geschlecht</label><select name="gender"><option value="">–</option><option value="w" ${g.gender === 'w' ? 'selected' : ''}>Damen</option><option value="m" ${g.gender === 'm' ? 'selected' : ''}>Herren</option></select></div>
        <div class="field"><label>E-Mail</label><input name="email" type="email" maxlength="120" value="${esc(g.email)}"></div><div class="field"><label>Telefon</label><input name="phone" maxlength="40" value="${esc(g.phone)}"></div></div>
        <div class="field"><label>Adresse</label><textarea name="address" rows="2" maxlength="300">${esc(g.address)}</textarea></div>
        <div class="row"><button class="btn small">Speichern</button><select data-setst="${g.id}" aria-label="Antwort von Hand setzen"><option value="">Antwort von Hand setzen …</option><option value="zusage">Zusage für alle Feiern</option><option value="absage">Absage für alle Feiern</option><option value="offen">Zurück auf offen</option></select>
        ${st.confirm === g.id ? `<button type="button" class="btn danger small" data-gdel="${g.id}">Wirklich löschen</button>` : `<button type="button" class="btn ghost small" data-gdq="${g.id}">Löschen</button>`}</div></form>` : ''}
    </li>`).join('') || '<li class="empty">Noch keine Gäste. Fügt oben den ersten Gast hinzu oder fügt eine ganze Liste ein.</li>'}</ul>
    ${editable ? '<p class="small muted">Tippt auf eine Feier, um einen Gast dazu einzuladen oder wieder auszuladen. Jeder Gast hat einen persönlichen Zusage-Link (auch als QR-Code auf der gedruckten Einladung), Gäste brauchen dafür kein Konto.</p>' : ''}`;
    bind();
  }
  function bind() {
    const b = view.querySelector('#glBulk'); if (b) b.onclick = () => { st.bulk = !st.bulk; draw(); };
    const imp = view.querySelector('#glImport'); if (imp) imp.onsubmit = async e => { e.preventDefault(); try { const r = await api(`/api/w/${S.w.id}/guests/import`, { method: 'POST', body: Object.fromEntries(new FormData(imp)) }); toast(`${r.imported} Gäste importiert`); st.bulk = false; refresh(); } catch (x) { toast(x.message); } };
    const add = view.querySelector('#glAdd'); if (add) add.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(add)); st.lastGrp = d.grp; try { await api(`/api/w/${S.w.id}/guests`, { method: 'POST', body: d }); toast(`${d.name} hinzugefügt`); await refresh(); view.querySelector('#ga-n')?.focus(); } catch (x) { toast(x.message); } };
    const q = view.querySelector('#glQ'); q.oninput = () => { st.q = q.value; const pos = q.selectionStart; draw(); const n = view.querySelector('#glQ'); n.focus(); n.setSelectionRange(pos, pos); };
    view.querySelector('#glG').onchange = e => { st.grp = e.target.value; draw(); };
    view.querySelector('#glS').onchange = e => { st.status = e.target.value; draw(); };
    view.querySelectorAll('[data-open]').forEach(x => x.onclick = () => { st.open = st.open === +x.dataset.open ? null : +x.dataset.open; st.confirm = null; draw(); });
    view.querySelectorAll('[data-copy]').forEach(x => x.onclick = () => ctx.copy(x.dataset.copy));
    view.querySelectorAll('[data-inv]').forEach(x => x.onclick = async () => { const [gid, eid, on] = x.dataset.inv.split(':'); await api(`/api/guests/${gid}`, { method: 'PATCH', body: { invites: { [eid]: on === '1' } } }); refresh(); });
    view.querySelectorAll('[data-gf]').forEach(f => f.onsubmit = async e => { e.preventDefault(); try { await api(`/api/guests/${f.dataset.gf}`, { method: 'PATCH', body: Object.fromEntries(new FormData(f)) }); toast('Gespeichert'); st.open = null; refresh(); } catch (x) { toast(x.message); } });
    view.querySelectorAll('[data-setst]').forEach(s => s.onchange = async () => { if (!s.value) return; await api(`/api/guests/${s.dataset.setst}`, { method: 'PATCH', body: { status: s.value } }); toast('Antwort gesetzt'); refresh(); });
    view.querySelectorAll('[data-gdq]').forEach(x => x.onclick = () => { st.confirm = +x.dataset.gdq; draw(); });
    view.querySelectorAll('[data-gdel]').forEach(x => x.onclick = async () => { await api(`/api/guests/${x.dataset.gdel}`, { method: 'DELETE' }); toast('Gast gelöscht'); st.open = null; refresh(); });
  }
  draw();
}

/* ================= Budget ================= */
const budgetNav = (S, active) => `<nav class="seg subnav" aria-label="Budget">${[['budget', 'Übersicht'], ['kosten', 'Kostenrechner'], ['belege', 'Belege & Ausgaben']].map(([k, l]) => `<a href="#/w/${S.w.id}/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
export async function vBudget(ctx) {
  const { api, S, esc, toast, view, fmt, parseD } = ctx;
  let B = await api(`/api/w/${S.w.id}/budget`);
  async function refresh() { B = await api(`/api/w/${S.w.id}/budget`); draw(); }
  function draw() {
    const pct = v => B.total ? Math.min(100, v / B.total * 100) : 0;
    const over = B.actual > B.total;
    view.innerHTML = `${budgetNav(S, 'budget')}<div><span class="eyebrow">Budget & Zahlungen</span><h1>${eur(B.total)}</h1></div>
    <section class="card"><div class="bbar big"><i class="spent ${over ? 'over' : ''}" style="width:${pct(B.actual)}%"></i><i class="paid" style="width:${pct(B.paid)}%"></i></div>
      <div class="stats"><div class="stat"><b>${eur(B.planned)}</b><span>geplant</span></div><div class="stat ${over ? 'no' : ''}"><b>${eur(B.actual)}</b><span>voraussichtlich</span></div><div class="stat yes"><b>${eur(B.paid)}</b><span>bezahlt</span></div><div class="stat"><b>${eur(B.total - B.actual)}</b><span>${B.total - B.actual >= 0 ? 'Luft' : 'drüber'}</span></div></div>
      <form class="row" id="bTot"><label class="small" for="bt">Gesamtbudget</label><input id="bt" name="total" type="number" min="0" step="100" value="${B.total}" style="max-width:150px"><label class="row small"><input type="checkbox" name="rescale" checked> Posten anteilig anpassen</label><button class="btn sec small">Übernehmen</button></form>
      <p class="small muted">„Voraussichtlich“ nimmt die Preise gebuchter Dienstleister und eure erfassten Belege, sonst den geplanten Betrag. Zahlungen an Dienstleister und Belege zählen automatisch als bezahlt.</p>
      <div class="row"><a class="btn sec small" href="#/w/${S.w.id}/kosten">Kosten neu kalkulieren</a><a class="btn small" href="#/w/${S.w.id}/belege">Beleg scannen</a></div></section>
    ${B.payments.length ? `<section class="card"><h3>Zahlungen & Fristen</h3><ul class="paylist">${B.payments.map(p => `<li class="${p.paid ? 'done' : ''}"><label class="row"><input type="checkbox" data-pay="${p.vendor_id}:${p.kind}" ${p.paid ? 'checked' : ''}><span><b>${esc(p.title)}</b><br><span class="small muted">bis ${fmt(parseD(p.due))}</span></span></label><b class="mono">${eur(p.amount)}</b></li>`).join('')}</ul><p class="small muted">Offene Zahlungen stehen auch im Zeitplan und im Kalender-Abo.</p></section>` : ''}
    <section class="card"><h3>Posten</h3><div class="btable" role="table">
      <div class="brow bhead" role="row"><span>Posten</span><span>Geplant</span><span>Tatsächlich</span><span>Bezahlt</span></div>
      ${B.items.map(i => `<div class="brow" role="row"><span>${esc(i.label)}${i.vendors ? ` <span class="pill ok">${i.vendors} gebucht</span>` : ''}${i.receipts ? ` <a class="pill" href="#/w/${S.w.id}/belege">${i.receipts} Beleg${i.receipts > 1 ? 'e' : ''}</a>` : ''}${i.per_guest ? ' <span class="small muted">pro Gast</span>' : ''}</span>
        ${i.id ? `<input type="number" min="0" step="10" value="${i.planned}" data-b="${i.id}:planned" aria-label="${esc(i.label)} geplant"><input type="number" min="0" step="10" value="${i.manual_actual ?? ''}" placeholder="${i.actual != null ? i.actual : ''}" data-b="${i.id}:actual" aria-label="${esc(i.label)} tatsächlich"><span class="mono small">${eur(i.paid)}</span>` : `<span class="mono">–</span><span class="mono">${eur(i.actual)}</span><span class="mono small">${eur(i.paid)}</span>`}</div>`).join('')}
    </div>
    <form class="row" id="bAdd"><input name="label" required maxlength="80" placeholder="Eigener Posten, z. B. Hochzeitsreise" style="flex:1;min-width:160px"><input name="planned" type="number" min="0" step="10" placeholder="Betrag" style="max-width:120px"><button class="btn sec small">Hinzufügen</button></form></section>`;
    view.querySelector('#bTot').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); try { B = await api(`/api/w/${S.w.id}/budget-total`, { method: 'PATCH', body: { total: Number(f.get('total')), rescale: !!f.get('rescale') } }); toast('Budget angepasst'); draw(); } catch (x) { toast(x.message); } };
    view.querySelectorAll('[data-b]').forEach(inp => inp.onchange = async () => { const [id, k] = inp.dataset.b.split(':'); try { await api(`/api/budget/${id}`, { method: 'PATCH', body: { [k]: inp.value === '' ? null : Number(inp.value) } }); refresh(); } catch (x) { toast(x.message); } });
    view.querySelectorAll('[data-pay]').forEach(c => c.onchange = async () => { const [vid, kind] = c.dataset.pay.split(':'); await api(`/api/vendors/${vid}`, { method: 'PATCH', body: { [kind === 'deposit' ? 'deposit_paid' : 'rest_paid']: c.checked } }); toast(c.checked ? 'Als bezahlt markiert' : 'Wieder offen'); refresh(); });
    view.querySelector('#bAdd').onsubmit = async e => { e.preventDefault(); try { await api(`/api/w/${S.w.id}/budget`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); refresh(); } catch (x) { toast(x.message); } };
  }
  draw();
}

/* ================= Dienstleister ================= */
export async function vVendors(ctx) {
  const { api, S, esc, toast, view } = ctx;
  let D = await api(`/api/w/${S.w.id}/vendors`); let open = null;
  async function refresh() { D = await api(`/api/w/${S.w.id}/vendors`); draw(); }
  function draw() {
    const booked = D.vendors.filter(v => v.status === 'gebucht').length;
    const order = ['gebucht', 'angebot', 'angefragt', 'offen', 'abgesagt'];
    const vs = [...D.vendors].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    view.innerHTML = `<div><span class="eyebrow">${booked} von ${D.vendors.filter(v => v.status !== 'abgesagt').length} gebucht</span><h1>Dienstleister</h1>
      <p class="muted">Die Liste passt zu euren Traditionen. Sobald ihr jemanden als „Gebucht“ markiert, wird die passende Aufgabe im Zeitplan abgehakt. Preis und Anzahlung fließen ins Budget, Zahlungsfristen in Zeitplan und Kalender.</p></div>
    <ul class="vlist">${vs.map(v => `<li class="card vcard st-${v.status}">
      <div class="row between"><div><span class="eyebrow">${esc(v.label)}</span><h3>${v.name ? esc(v.name) : '<span class="muted">Noch niemand eingetragen</span>'}</h3>${v.price ? `<span class="small muted">${eur(v.price)}${v.deposit ? ` · Anzahlung ${eur(v.deposit)}` : ''}</span>` : ''}</div>
        <div class="row"><select data-vs="${v.id}" aria-label="Status ${esc(v.label)}">${Object.entries(VSTATUS).map(([k, l]) => `<option value="${k}" ${v.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="mini" data-vo="${v.id}">${open === v.id ? 'Schließen' : 'Details'}</button></div></div>
      ${open === v.id ? `<form class="stack" data-vf="${v.id}"><div class="fields2">
        <div class="field"><label>Name / Firma</label><input name="name" maxlength="100" value="${esc(v.name)}"></div><div class="field"><label>Ansprechperson</label><input name="contact" maxlength="100" value="${esc(v.contact)}"></div>
        <div class="field"><label>Telefon</label><input name="phone" maxlength="40" value="${esc(v.phone)}"></div><div class="field"><label>E-Mail</label><input name="email" type="email" maxlength="120" value="${esc(v.email)}"></div>
        <div class="field"><label>Preis gesamt (€)</label><input name="price" type="number" min="0" step="10" value="${v.price || ''}"></div><div class="field"><label>Anzahlung (€)</label><input name="deposit" type="number" min="0" step="10" value="${v.deposit || ''}"></div>
        <div class="field"><label>Anzahlung fällig</label><input name="deposit_due" type="date" value="${esc(v.deposit_due)}"></div><div class="field"><label>Restzahlung fällig</label><input name="rest_due" type="date" value="${esc(v.rest_due)}"></div></div>
        <div class="field"><label>Website</label><input name="website" maxlength="200" value="${esc(v.website)}"></div><div class="field"><label>Notizen (Angebot, Absprachen)</label><textarea name="notes" rows="3" maxlength="2000">${esc(v.notes)}</textarea></div>
        <div class="row"><button class="btn small">Speichern</button>${v.phone ? `<span class="small mono">${esc(v.phone)}</span>` : ''}<button type="button" class="btn ghost small" data-vdel="${v.id}">Entfernen</button></div></form>` : ''}
    </li>`).join('')}</ul>
    <form class="card row" id="vAdd"><select name="cat" required aria-label="Kategorie"><option value="">Weitere Kategorie …</option>${Object.entries(D.cats).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select><input name="name" maxlength="100" placeholder="Name (optional)" style="flex:1;min-width:140px"><button class="btn sec small">Hinzufügen</button></form>`;
    view.querySelectorAll('[data-vs]').forEach(s => s.onchange = async () => { await api(`/api/vendors/${s.dataset.vs}`, { method: 'PATCH', body: { status: s.value } }); if (s.value === 'gebucht') toast('Gebucht. Die Aufgabe im Zeitplan ist abgehakt.'); delete S.data.tasks; refresh(); });
    view.querySelectorAll('[data-vo]').forEach(b => b.onclick = () => { open = open === +b.dataset.vo ? null : +b.dataset.vo; draw(); });
    view.querySelectorAll('[data-vf]').forEach(f => f.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); for (const k of ['price', 'deposit']) d[k] = Number(d[k]) || 0; try { await api(`/api/vendors/${f.dataset.vf}`, { method: 'PATCH', body: d }); toast('Gespeichert'); open = null; refresh(); } catch (x) { toast(x.message); } });
    view.querySelectorAll('[data-vdel]').forEach(b => b.onclick = async () => { await api(`/api/vendors/${b.dataset.vdel}`, { method: 'DELETE' }); open = null; refresh(); });
    view.querySelector('#vAdd').onsubmit = async e => { e.preventDefault(); try { await api(`/api/w/${S.w.id}/vendors`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); refresh(); } catch (x) { toast(x.message); } };
  }
  draw();
}

/* ================= Geschenke ================= */
export async function vGifts(ctx) {
  const { api, S, esc, toast, view } = ctx;
  let [G, gl] = await Promise.all([api(`/api/w/${S.w.id}/gifts`), api(`/api/w/${S.w.id}/guests`)]);
  async function refresh() { G = await api(`/api/w/${S.w.id}/gifts`); draw(); }
  function draw() {
    const sum = G.gifts.reduce((s, g) => s + (g.amount || 0), 0);
    view.innerHTML = `<div class="row between"><div><span class="eyebrow">${G.gifts.length} Geschenke · ${G.gifts.filter(g => g.thanked).length} bedankt</span><h1>Geschenke</h1></div><a class="btn sec small" href="#/w/${S.w.id}/druck?typ=thanks">Danksagungen drucken</a></div>
    <form class="card" id="gfAdd"><h3>Geschenk eintragen</h3><div class="fields2">
      <div class="field"><label for="gf-g">Von</label><select id="gf-g" name="guest_id"><option value="">Gast wählen …</option>${gl.guests.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="gf-f">oder Name eintragen</label><input id="gf-f" name="from_name" maxlength="100"></div>
      <div class="field"><label for="gf-k">Art</label><select id="gf-k" name="kind">${Object.entries(GIFT_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="gf-a">Betrag (optional, €)</label><input id="gf-a" name="amount" type="number" min="0" step="1"></div></div>
      <div class="field"><label for="gf-d">Was?</label><input id="gf-d" name="description" maxlength="300" placeholder="z. B. Kaffeemaschine, Goldarmband, Beitrag zur Hochzeitsreise"></div>
      <button class="btn">Eintragen</button></form>
    <ul class="glist">${G.gifts.map(g => `<li class="gl-item ${g.thanked ? 'done' : ''}"><div class="row between"><label class="row"><input type="checkbox" data-th="${g.id}" ${g.thanked ? 'checked' : ''} aria-label="Bedankt"><span><b>${esc(g.guest_name || g.from_name)}</b><br><span class="small muted">${GIFT_KINDS[g.kind] || ''}${g.description ? ' · ' + esc(g.description) : ''}${g.amount ? ' · ' + eur(g.amount) : ''}</span></span></label><button class="mini" data-gfdel="${g.id}" aria-label="Löschen">×</button></div></li>`).join('') || '<li class="empty">Noch keine Geschenke eingetragen.</li>'}</ul>
    ${sum ? `<p class="small muted">Summe aller Geldbeträge: ${eur(sum)}</p>` : ''}`;
    view.querySelector('#gfAdd').onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.amount = Number(d.amount) || 0; d.guest_id = d.guest_id ? Number(d.guest_id) : null; try { await api(`/api/w/${S.w.id}/gifts`, { method: 'POST', body: d }); toast('Eingetragen'); refresh(); } catch (x) { toast(x.message); } };
    view.querySelectorAll('[data-th]').forEach(c => c.onchange = async () => { await api(`/api/gifts/${c.dataset.th}`, { method: 'PATCH', body: { thanked: c.checked } }); refresh(); });
    view.querySelectorAll('[data-gfdel]').forEach(b => b.onclick = async () => { await api(`/api/gifts/${b.dataset.gfdel}`, { method: 'DELETE' }); refresh(); });
  }
  draw();
}

/* ================= Zusage je Feier (Gast in der App oder über persönlichen Link) ================= */
function rsvpForm(esc, invites, common, opts = {}) {
  const menus = Object.entries(MENU_LABEL);
  return `<form class="stack" id="rsvpForm">
    ${invites.map(i => `<div class="card rsvp-ev"><div class="row between"><div><b>${esc(i.title)}</b><br><span class="small muted">${new Date(i.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })} · ${esc(i.time)} Uhr${i.location ? ' · ' + esc(i.location) : ''}</span></div>${i.status !== 'offen' ? `<span class="pill ${i.status === 'zusage' ? 'ok' : 'late'}">${i.status === 'zusage' ? 'zugesagt' : 'abgesagt'}</span>` : ''}</div>
      <div class="choice"><label><input type="radio" name="st-${i.event_id}" value="zusage" ${i.status === 'zusage' ? 'checked' : ''} required><span>Wir kommen</span></label><label><input type="radio" name="st-${i.event_id}" value="absage" ${i.status === 'absage' ? 'checked' : ''}><span>Leider nicht</span></label></div>
      <div class="field"><label for="ps-${i.event_id}">Personen</label><select id="ps-${i.event_id}" name="ps-${i.event_id}">${Array.from({ length: Math.max(opts.max || 1, i.persons || 1, 1) }, (_, k) => k + 1).map(n => `<option ${i.persons === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>`).join('')}
    <div class="card stack"><div class="field"><label for="r-m">Menüwunsch</label><select id="r-m" name="menu"><option value="">Egal</option>${menus.map(([k, l]) => `<option value="${k}" ${common.menu === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="r-a">Allergien oder Unverträglichkeiten</label><input id="r-a" name="allergies" maxlength="300" value="${esc(common.allergies || '')}"></div>
      <div class="field"><label for="r-s">Musikwunsch</label><input id="r-s" name="song" maxlength="150" value="${esc(common.song || '')}"></div>
      <div class="field"><label for="r-msg">Nachricht an das Paar</label><textarea id="r-msg" name="message" maxlength="1000">${esc(common.message || '')}</textarea></div>
      <p class="err" id="rErr" hidden></p><button class="btn">Antwort senden</button></div></form>`;
}
function readRsvp(form, invites) {
  const f = new FormData(form);
  return { answers: invites.map(i => ({ event_id: i.event_id, status: f.get('st-' + i.event_id), persons: Number(f.get('ps-' + i.event_id)) || 1 })).filter(a => a.status), menu: f.get('menu'), allergies: f.get('allergies'), song: f.get('song'), message: f.get('message') };
}
export async function vGuestRsvp(ctx) {
  const { api, S, esc, toast, view, fmt, parseD } = ctx;
  const r = await api(`/api/w/${S.w.id}/rsvp`);
  view.innerHTML = `<div><span class="eyebrow">Hochzeit ${esc(S.w.name1)} &amp; ${esc(S.w.name2)}</span><h1>Seid ihr dabei?</h1>${S.w.rsvp_until ? `<p class="muted">Bitte antwortet bis ${fmt(parseD(S.w.rsvp_until))}.</p>` : ''}</div>
    ${r.invites.length ? rsvpForm(esc, r.invites, r.rsvp, { max: 10 }) : '<p class="empty">Ihr seid noch zu keiner Feier eingeladen.</p>'}`;
  const f = view.querySelector('#rsvpForm');
  if (f) f.onsubmit = async e => { e.preventDefault(); const body = readRsvp(f, r.invites); if (body.answers.length < r.invites.length) { const er = view.querySelector('#rErr'); er.textContent = 'Bitte gebt für jede Feier eine Antwort.'; er.hidden = false; return; } try { await api(`/api/w/${S.w.id}/rsvp`, { method: 'PUT', body }); toast('Danke für eure Antwort!'); delete S.data.rsvp; ctx.go(`#/w/${S.w.id}/uebersicht`); } catch (x) { toast(x.message); } };
}
export async function renderPublicRsvp(ctx, token) {
  const { api, esc, toast, view } = ctx;
  let r;
  try { r = await api(`/api/rsvp/${encodeURIComponent(token)}`); }
  catch (e) { view.innerHTML = `<div class="card auth"><h2>Link ungültig</h2><p class="muted">${esc(e.message)}</p></div>`; return; }
  const w = r.wedding; const max = r.guest.adults + r.guest.kids;
  const draw = (done) => {
    view.innerHTML = `<section class="card center auth" style="max-width:640px"><span class="eyebrow">Einladung</span><div class="names">${esc(w.name1)} &amp; ${esc(w.name2)}</div>
      <p>${esc(r.guest.salutation || `Liebe:r ${r.guest.name}`)},</p><p class="muted">wir freuen uns, wenn ihr mit uns feiert. Bitte gebt uns für jede Feier Bescheid${w.rsvp_until ? `, am besten bis ${new Date(w.rsvp_until + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.</p>
      ${r.seat?.table ? `<p class="ok-note">Euer Platz: <b>${esc(r.seat.table)}</b>, Platz ${r.seat.seat}</p>` : ''}
      ${w.dresscode ? `<p class="small"><b>Dresscode:</b> ${esc(w.dresscode)}</p>` : ''}${w.info ? `<p class="small" style="white-space:pre-line">${esc(w.info)}</p>` : ''}</section>
      ${done ? '<p class="ok-note" style="max-width:640px;margin:0 auto">Danke! Eure Antwort ist angekommen. Ihr könnt sie über diesen Link jederzeit ändern.</p>' : ''}
      <div style="max-width:640px;margin:0 auto;width:100%">${rsvpForm(esc, r.invites, r.invites[0] || {}, { max })}
      <div class="card"><h3>In den Kalender</h3><div class="row">${r.invites.filter(i => i.status !== 'absage').map(i => { const d = i.date.replace(/-/g, ''); const [h, m] = i.time.split(':'); const url = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: `${i.title} · ${w.name1} & ${w.name2}`, dates: `${d}T${h}${m}00/${d}T${String(Math.min(23, +h + 4)).padStart(2, '0')}${m}00`, location: [i.location, i.address].filter(Boolean).join(', ') }); return `<a class="mini" target="_blank" rel="noopener" href="${url}">+ ${esc(i.title)}</a>`; }).join('')}</div></div></div>`;
    const f = view.querySelector('#rsvpForm');
    f.onsubmit = async e => { e.preventDefault(); const body = readRsvp(f, r.invites); if (body.answers.length < r.invites.length) { const er = view.querySelector('#rErr'); er.textContent = 'Bitte gebt für jede Feier eine Antwort.'; er.hidden = false; return; } try { await api(`/api/rsvp/${encodeURIComponent(token)}`, { method: 'PUT', body }); r = await api(`/api/rsvp/${encodeURIComponent(token)}`); toast('Danke!'); draw(true); window.scrollTo(0, 0); } catch (x) { toast(x.message); } };
  };
  draw(false);
}

/* ================= Kostenrechner ================= */
export async function vCosts(ctx) {
  const { api, S, esc, toast, view } = ctx;
  const M = await api(`/api/w/${S.w.id}/cost-model`);
  const st = S.calc || (S.calc = { level: 1, region: 'stadt', src: M.guests.confirmed ? 'confirmed' : M.guests.invited ? 'invited' : 'planned', over: {}, buffer: 8, confirm: false });
  const levels = ['Einfach', 'Mittel', 'Gehoben'];
  function calc() {
    const guests = Math.max(1, M.guests[st.src] || M.guests.planned);
    const f = M.regions[st.region].f;
    const rows = M.items.map(it => {
      const key = it.cat + ':' + it.type;
      const unit = st.over[key] ?? Math.round(it.p[st.level] * f * (it.type === 'guest' ? 100 : 1)) / (it.type === 'guest' ? 100 : 1);
      return { ...it, key, unit, total: Math.round(it.type === 'guest' ? unit * guests : unit), edited: st.over[key] != null };
    });
    const sub = rows.reduce((s, r) => s + r.total, 0);
    const buffer = Math.round(sub * st.buffer / 100);
    return { guests, rows, sub, buffer, total: sub + buffer };
  }
  function draw() {
    const c = calc(); const diff = M.budget ? c.total - M.budget : 0;
    view.innerHTML = `${budgetNav(S, 'kosten')}
    <div><span class="eyebrow">Kostenrechner</span><h1>${eur(c.total)}</h1><p class="muted">${eur(c.total / c.guests)} pro Gast · ${c.guests} Gäste${M.budget ? ` · ${diff > 0 ? `${eur(diff)} über` : `${eur(-diff)} unter`} eurem Budget von ${eur(M.budget)}` : ''}</p></div>
    <section class="card"><div class="calc-ctl">
      <div class="field"><label>Ausstattung</label><div class="seg">${levels.map((l, i) => `<button type="button" data-lv="${i}" aria-pressed="${st.level === i}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>Region</label><div class="seg">${Object.entries(M.regions).map(([k, r]) => `<button type="button" data-rg="${k}" aria-pressed="${st.region === k}">${r.label}</button>`).join('')}</div></div>
      <div class="field"><label for="kSrc">Gästezahl</label><select id="kSrc"><option value="planned" ${st.src === 'planned' ? 'selected' : ''}>Geplant: ${M.guests.planned}</option><option value="invited" ${st.src === 'invited' ? 'selected' : ''} ${M.guests.invited ? '' : 'disabled'}>Eingeladen: ${M.guests.invited}</option><option value="confirmed" ${st.src === 'confirmed' ? 'selected' : ''} ${M.guests.confirmed ? '' : 'disabled'}>Zugesagt: ${M.guests.confirmed}</option></select></div>
    </div>
    <p class="small muted">Richtwerte für Deutschland, abgestimmt auf eure Traditionen. Jeden Preis könnt ihr überschreiben, zum Beispiel mit einem echten Angebot.</p></section>
    <section class="card"><div class="ktable">
      <div class="krow khead"><span>Posten</span><span>Preis</span><span>Summe</span></div>
      ${c.rows.map(r => `<div class="krow ${r.edited ? 'edited' : ''}"><span>${esc(r.label)}<small class="muted">${r.type === 'guest' ? ` × ${c.guests} Gäste` : ' pauschal'}</small></span>
        <span class="kin"><input type="number" min="0" step="${r.type === 'guest' ? 0.5 : 50}" value="${r.unit}" data-k="${esc(r.key)}" aria-label="${esc(r.label)} Preis"><small class="muted">${r.type === 'guest' ? '€/Gast' : '€'}</small></span>
        <b class="mono">${eur(r.total)}</b></div>`).join('')}
      <div class="krow"><span>Puffer<small class="muted">für Unvorhergesehenes</small></span><span class="kin"><input type="number" min="0" max="30" value="${st.buffer}" id="kBuf" aria-label="Puffer in Prozent"><small class="muted">%</small></span><b class="mono">${eur(c.buffer)}</b></div>
      <div class="krow ktotal"><span>Gesamt</span><span></span><b class="mono">${eur(c.total)}</b></div>
    </div>
    <div class="row">${st.confirm ? `<span class="small">Geplante Beträge im Budget werden durch diese Kalkulation ersetzt.</span><button class="btn" id="kYes">Ja, übernehmen</button><button class="btn sec" id="kNo">Abbrechen</button>` : `<button class="btn" id="kApply">Als Budget übernehmen</button>`}${Object.keys(st.over).length ? '<button class="btn ghost small" id="kReset">Eigene Preise zurücksetzen</button>' : ''}</div></section>`;
    view.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { st.level = +b.dataset.lv; draw(); });
    view.querySelectorAll('[data-rg]').forEach(b => b.onclick = () => { st.region = b.dataset.rg; draw(); });
    view.querySelector('#kSrc').onchange = e => { st.src = e.target.value; draw(); };
    view.querySelectorAll('[data-k]').forEach(i => i.onchange = () => { st.over[i.dataset.k] = Math.max(0, Number(i.value) || 0); draw(); });
    view.querySelector('#kBuf').onchange = e => { st.buffer = Math.max(0, Math.min(30, Number(e.target.value) || 0)); draw(); };
    const r = view.querySelector('#kReset'); if (r) r.onclick = () => { st.over = {}; draw(); };
    const a = view.querySelector('#kApply'); if (a) a.onclick = () => { st.confirm = true; draw(); };
    const n = view.querySelector('#kNo'); if (n) n.onclick = () => { st.confirm = false; draw(); };
    const y = view.querySelector('#kYes'); if (y) y.onclick = async () => {
      const cc = calc(); const byCat = new Map();
      for (const row of cc.rows) { const prev = byCat.get(row.cat); if (prev) prev.planned += row.total; else byCat.set(row.cat, { cat: row.cat, label: row.label, planned: row.total }); }
      byCat.set('puffer', { cat: 'puffer', label: 'Puffer für Unvorhergesehenes', planned: cc.buffer });
      try { await api(`/api/w/${S.w.id}/budget/apply`, { method: 'POST', body: { items: [...byCat.values()], total: cc.total } }); S.w.profile.budget = cc.total; M.budget = cc.total; st.confirm = false; toast('Ins Budget übernommen'); ctx.go(`#/w/${S.w.id}/budget`); } catch (e) { toast(e.message); }
    };
  }
  draw();
}

/* ================= Belege & Ausgaben ================= */
export async function vReceipts(ctx) {
  const { api, S, esc, toast, view, fmt, parseD } = ctx;
  let D = await api(`/api/w/${S.w.id}/expenses`);
  let draft = null, progress = null, confirmDel = null, filter = '';
  const catLabel = c => D.cats.find(x => x.cat === c)?.label || (c ? c : 'Ohne Kategorie');
  async function refresh() { D = await api(`/api/w/${S.w.id}/expenses`); draw(); }
  function draw() {
    const list = D.expenses.filter(e => !filter || e.cat === filter);
    const sum = D.expenses.reduce((s, e) => s + e.amount, 0);
    const byCat = {}; const byPayer = {};
    for (const e of D.expenses) { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; if (e.paid_by) byPayer[e.paid_by] = (byPayer[e.paid_by] || 0) + e.amount; }
    view.innerHTML = `${budgetNav(S, 'belege')}
    <div><span class="eyebrow">${D.expenses.length} Belege</span><h1>${eur2(sum)} ausgegeben</h1></div>
    <section class="card scan-card">
      <div class="row"><label class="btn scan-btn" for="rcCam"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg> Foto aufnehmen</label>
        <input type="file" id="rcCam" accept="image/*" capture="environment" hidden>
        <label class="btn sec scan-btn" for="rcFile">Datei wählen</label><input type="file" id="rcFile" accept="image/*,application/pdf" hidden>
        <button class="btn sec" id="rcManual" type="button">Ohne Beleg eintragen</button></div>
      <p class="small muted">Fotografiert einen Kassenzettel oder ladet ein Foto bzw. eine PDF-Rechnung hoch. Betrag, Datum, Händler und Kategorie werden erkannt, ihr prüft sie nur noch. Die Texterkennung läuft auf eurem Gerät.</p>
      ${progress != null ? `<div class="progress"><i style="width:${Math.round(progress * 100)}%"></i></div><p class="small muted">Text wird erkannt … ${Math.round(progress * 100)} %</p>` : ''}
      ${draft ? `<form class="rc-form" id="rcForm">
        ${draft.preview ? `<img class="rc-prev" src="${draft.preview}" alt="Vorschau des Belegs">` : draft.pdf ? '<div class="rc-prev pdf">PDF</div>' : ''}
        <div class="stack">
          ${draft.found ? `<p class="${draft.found.sure ? 'ok-note' : 'warn-note'}">${draft.found.amount ? `Erkannt: <b>${eur2(draft.found.amount)}</b>${draft.found.date ? ` vom ${fmt(parseD(draft.found.date))}` : ''}${draft.found.merchant ? ` bei ${esc(draft.found.merchant)}` : ''}. ${draft.found.sure ? 'Bitte kurz prüfen.' : 'Bitte Betrag prüfen, der Gesamtbetrag war nicht eindeutig.'}` : 'Kein Betrag erkannt. Bitte von Hand eintragen.'}</p>` : draft.pdf ? '<p class="small muted">PDF-Rechnungen werden gespeichert, den Betrag tragt ihr bitte selbst ein.</p>' : ''}
          <div class="fields2"><div class="field"><label for="rc-a">Betrag (€)</label><input id="rc-a" name="amount" type="number" min="0" step="0.01" required value="${draft.amount ?? ''}" inputmode="decimal"></div><div class="field"><label for="rc-d">Datum</label><input id="rc-d" name="date" type="date" value="${esc(draft.date || '')}"></div></div>
          <div class="field"><label for="rc-m">Händler</label><input id="rc-m" name="merchant" maxlength="120" value="${esc(draft.merchant || '')}"></div>
          <div class="fields2"><div class="field"><label for="rc-c">Kategorie</label><select id="rc-c" name="cat"><option value="">Ohne Kategorie</option>${D.cats.map(c => `<option value="${esc(c.cat)}" ${draft.cat === c.cat ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
            <div class="field"><label for="rc-p">Bezahlt von</label><input id="rc-p" name="paid_by" maxlength="60" list="rcPayers" value="${esc(draft.paid_by || S.lastPayer || '')}" placeholder="z. B. ${esc(S.w.name1)}, Eltern"><datalist id="rcPayers">${[S.w.name1, S.w.name2, 'Eltern Braut', 'Eltern Bräutigam', ...Object.keys(byPayer)].filter((v, i, a) => v && a.indexOf(v) === i).map(v => `<option value="${esc(v)}">`).join('')}</datalist></div></div>
          ${D.vendors.length ? `<div class="field"><label for="rc-v">Zahlung an gebuchten Dienstleister (optional)</label><select id="rc-v" name="vendor_id"><option value="">Nein, eigene Ausgabe</option>${D.vendors.map(v => `<option value="${v.id}">${esc(v.label)}</option>`).join('')}</select><span class="small muted">Dann zählt der Beleg als Zahlung auf den vereinbarten Preis und nicht zusätzlich.</span></div>` : ''}
          <div class="field"><label for="rc-n">Notiz</label><input id="rc-n" name="note" maxlength="500" value="${esc(draft.note || '')}"></div>
          ${draft.text ? `<details><summary class="small">Erkannter Text</summary><pre class="ocr-text">${esc(draft.text)}</pre></details>` : ''}
          <div class="row"><button class="btn">Speichern</button><button type="button" class="btn sec" id="rcCancel">Verwerfen</button></div>
        </div></form>` : ''}
    </section>
    ${Object.keys(byCat).length ? `<section class="card"><h3>Nach Kategorie</h3><div class="chips">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<button class="chip-t small ${filter === c ? 'on' : ''}" data-f="${esc(c)}">${esc(catLabel(c))} · ${eur(v)}</button>`).join('')}${filter ? '<button class="chip-t small" data-f="">Alle</button>' : ''}</div>
      ${Object.keys(byPayer).length ? `<p class="small muted" style="margin-top:10px">Bezahlt von: ${Object.entries(byPayer).map(([p, v]) => `<b>${esc(p)}</b> ${eur(v)}`).join(' · ')}</p>` : ''}</section>` : ''}
    <ul class="glist">${list.map(e => `<li class="gl-item rc-item"><div class="row between"><div><b>${esc(e.merchant || 'Ausgabe')}</b> <span class="small muted">${e.date ? fmt(parseD(e.date)) : ''} · ${esc(catLabel(e.cat))}${e.paid_by ? ' · ' + esc(e.paid_by) : ''}${e.vendor_id ? ' · Zahlung an Dienstleister' : ''}</span>${e.note ? `<br><span class="small">${esc(e.note)}</span>` : ''}</div><b class="mono">${eur2(e.amount)}</b></div>
      <div class="row">${e.has_receipt ? `<a class="mini" target="_blank" rel="noopener" href="/api/expenses/${e.id}/receipt">Beleg ansehen</a>` : '<span class="small muted">ohne Beleg</span>'}${confirmDel === e.id ? `<button class="btn danger small" data-rdel="${e.id}">Wirklich löschen</button>` : `<button class="mini" data-rdq="${e.id}">Löschen</button>`}</div></li>`).join('') || '<li class="empty">Noch keine Ausgaben erfasst. Scannt euren ersten Beleg.</li>'}</ul>`;
    bind();
  }
  function bind() {
    const onFile = async f => {
      const file = f.files[0]; if (!file) return;
      if (file.type === 'application/pdf') { draft = { file, pdf: true }; return draw(); }
      try {
        const img = await prepareImage(file);
        draft = { blob: img.blob, preview: img.preview }; progress = 0; draw();
        const text = await recognize(img.ocrCanvas, m => { if (m.status === 'recognizing text') { progress = m.progress; const bar = view.querySelector('.scan-card .progress i'); if (bar) { bar.style.width = Math.round(m.progress * 100) + '%'; bar.parentElement.nextElementSibling.textContent = `Text wird erkannt … ${Math.round(m.progress * 100)} %`; } } });
        const found = parseReceipt(text, D.cats.map(c => c.cat));
        Object.assign(draft, { text, found, amount: found.amount, date: found.date, merchant: found.merchant, cat: found.cat });
      } catch (e) { toast(e.message); draft = draft || {}; }
      progress = null; draw(); view.querySelector('#rc-a')?.focus();
    };
    for (const id of ['#rcCam', '#rcFile']) { const f = view.querySelector(id); f.onchange = () => onFile(f); }
    view.querySelector('#rcManual').onclick = () => { draft = { date: new Date().toISOString().slice(0, 10) }; draw(); view.querySelector('#rc-a').focus(); };
    const c = view.querySelector('#rcCancel'); if (c) c.onclick = () => { draft = null; draw(); };
    const form = view.querySelector('#rcForm');
    if (form) form.onsubmit = async e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(form)); d.amount = Number(d.amount) || 0; d.vendor_id = d.vendor_id ? Number(d.vendor_id) : null; if (draft.text) d.ocr_text = draft.text.slice(0, 8000);
      const btn = form.querySelector('button.btn'); btn.disabled = true;
      try {
        const { id } = await api(`/api/w/${S.w.id}/expenses`, { method: 'POST', body: d });
        const file = draft.blob || draft.file;
        if (file) { const r = await fetch(`/api/expenses/${id}/receipt`, { method: 'PUT', headers: { 'Content-Type': draft.pdf ? 'application/pdf' : 'image/jpeg' }, body: file, credentials: 'same-origin' }); if (!r.ok) toast((await r.json().catch(() => ({}))).error || 'Beleg konnte nicht gespeichert werden.'); }
        S.lastPayer = d.paid_by; draft = null; toast('Ausgabe gespeichert'); refresh();
      } catch (x) { toast(x.message); btn.disabled = false; }
    };
    view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; draw(); });
    view.querySelectorAll('[data-rdq]').forEach(b => b.onclick = () => { confirmDel = +b.dataset.rdq; draw(); });
    view.querySelectorAll('[data-rdel]').forEach(b => b.onclick = async () => { await api(`/api/expenses/${b.dataset.rdel}`, { method: 'DELETE' }); confirmDel = null; toast('Gelöscht'); refresh(); });
  }
  draw();
}
