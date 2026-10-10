// weddify Planer – Single-Page-App ohne Framework.
// Bereiche: Paar, Trauzeug:innen, Gäste. Daten kommen vom eigenen Server (/api).

const $ = s => document.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- API ---------------- */
async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body ?? {}); }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Das hat nicht geklappt. Bitte versucht es noch einmal.'); e.status = r.status; throw e; }
  return data;
}

/* ---------------- Datum ---------------- */
const parseD = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 864e5);
const fmt = (d, o = { day: 'numeric', month: 'long', year: 'numeric' }) => d.toLocaleDateString('de-DE', o);
const fmtShort = d => fmt(d, { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------- Zustand ---------------- */
const S = { me: null, w: null, role: null, data: {}, editing: null, confirm: null, filter: 'all' };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
S.filter = store.get('wfy-filter', 'all');

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }
const go = h => { if (location.hash === h) render(); else location.hash = h; };

/* ---------------- Icons ---------------- */
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3v18M6 6h12M6 12h9M6 18h12"/></svg>',
  guests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 1.2V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 22.8 10H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
};
const TABS = {
  paar: [['uebersicht', 'Übersicht', I.home], ['zeitplan', 'Zeitplan', I.plan], ['gaeste', 'Gäste', I.guests], ['ablauf', 'Ablauf', I.clock], ['einstellungen', 'Mehr', I.gear]],
  trauzeuge: [['uebersicht', 'Übersicht', I.home], ['zeitplan', 'Zeitplan', I.plan], ['gaeste', 'Gäste', I.guests], ['beitraege', 'Zeitung', I.pen], ['ablauf', 'Ablauf', I.clock]],
  gast: [['uebersicht', 'Übersicht', I.home], ['zusage', 'Zusage', I.mail], ['ablauf', 'Ablauf', I.clock], ['beitrag', 'Zeitung', I.pen]],
};
const ROLE_LABEL = { paar: 'Brautpaar', trauzeuge: 'Trauzeug:in', gast: 'Gast' };
const PRODUCT = { card: 'Save-the-Date-Karten', invite: 'Einladungskarten', time: 'Tagesablauf-Schild', sign: 'Willkommensschild', menu: 'Menükarten', seat: 'Sitzplan-Poster', place: 'Tischkarten', thanks: 'Danksagungskarten', anni: 'Jahrestag-Poster', news: 'Hochzeitszeitung', quiz: 'Hochzeitsquiz' };
const MENU_LABEL = { fleisch: 'Fleisch', fisch: 'Fisch', vegetarisch: 'Vegetarisch', vegan: 'Vegan', kind: 'Kindermenü' };
const KIND_LABEL = { geschichte: 'Geschichte', gruss: 'Gruß & Wunsch', 'foto-idee': 'Foto-Idee', raetsel: 'Rätselfrage' };

/* ---------------- Router ---------------- */
window.addEventListener('hashchange', render);
async function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [page, a, b] = parts;
  if (page === 'join' && a) sessionStorage.setItem('wfy-join', a);
  try {
    if (!S.me) S.me = await api('/api/me').catch(e => { if (e.status === 401) return null; throw e; });
    if (!S.me) return renderAuth(page === 'register' || page === 'join' ? 'register' : 'login');
    const pending = sessionStorage.getItem('wfy-join');
    if (pending) {
      sessionStorage.removeItem('wfy-join');
      try { const j = await api('/api/join', { method: 'POST', body: { code: pending } }); S.me = await api('/api/me'); toast(j.already ? 'Ihr seid schon dabei.' : `Willkommen als ${ROLE_LABEL[j.role]}!`); return go(`#/w/${j.id}/uebersicht`); }
      catch (e) { toast(e.message); }
    }
    if (page === 'w' && a) return await renderWedding(a, b || 'uebersicht');
    if (page === 'start' || !S.me.weddings.length) return renderStart();
    const last = store.get('wfy-last', null);
    const w = S.me.weddings.find(x => x.id === last) || S.me.weddings[0];
    return go(`#/w/${w.id}/uebersicht`);
  } catch (e) {
    view.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button class="btn sec" data-act="reload">Neu laden</button></div>`;
  }
}

function setChrome({ tabs = null, active = '' } = {}) {
  const tb = $('#tabbar');
  if (tabs) {
    tb.innerHTML = tabs.map(([k, l, ic]) => `<a href="#/w/${S.w.id}/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${ic}<span>${l}</span></a>`).join('');
    tb.hidden = false;
  } else tb.hidden = true;
  const tr = $('#topRight');
  if (S.me && S.w) {
    const many = S.me.weddings.length > 1;
    tr.innerHTML = `${many ? `<select class="switch" id="switchW" aria-label="Hochzeit wechseln">${S.me.weddings.map(w => `<option value="${esc(w.id)}" ${w.id === S.w.id ? 'selected' : ''}>${esc(w.name1)} & ${esc(w.name2)}</option>`).join('')}</select>` : ''}<span class="role-chip ${S.role}">${ROLE_LABEL[S.role]}</span>`;
    const sw = $('#switchW'); if (sw) sw.onchange = () => go(`#/w/${sw.value}/uebersicht`);
  } else tr.innerHTML = S.me ? `<button class="btn ghost small" data-act="logout">Abmelden</button>` : '';
}

/* ---------------- Anmeldung ---------------- */
function renderAuth(mode) {
  S.w = null; setChrome();
  const invited = !!sessionStorage.getItem('wfy-join');
  view.innerHTML = `<section class="auth card">
    <div class="hello">${mode === 'login' ? 'Schön, dass ihr da seid' : 'Willkommen bei weddify'}</div>
    ${invited ? '<p class="ok-note">Ihr wurdet zu einer Hochzeit eingeladen. Legt ein Konto an oder meldet euch an, dann seid ihr automatisch dabei.</p>' : ''}
    <div class="roles3"><div><b>Paar</b>Zeitplan, Gäste, Ablauf</div><div><b>Trauzeug:innen</b>JGA, Zeitung, Rede</div><div><b>Gäste</b>Zusage, Infos, Grüße</div></div>
    <div class="seg" role="tablist"><button data-act="auth" data-v="login" aria-pressed="${mode === 'login'}">Anmelden</button><button data-act="auth" data-v="register" aria-pressed="${mode === 'register'}">Konto erstellen</button></div>
    <form class="stack" data-form="${mode}">
      ${mode === 'register' ? '<div class="field"><label for="f-name">Euer Name</label><input id="f-name" name="name" autocomplete="name" required maxlength="60"></div>' : ''}
      <div class="field"><label for="f-mail">E-Mail</label><input id="f-mail" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="f-pw">Passwort</label><input id="f-pw" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required>${mode === 'register' ? '<span class="small muted">Mindestens 8 Zeichen.</span>' : ''}</div>
      <p class="err" data-err hidden></p>
      <button class="btn" type="submit">${mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</button>
    </form></section>`;
}

/* ---------------- Start: Hochzeit anlegen oder beitreten ---------------- */
function renderStart() {
  S.w = null; setChrome();
  const next = iso(addD(new Date(), 300));
  view.innerHTML = `
  <div><span class="eyebrow">Hallo ${esc(S.me.user.name)}</span><h1>Wie seid ihr dabei?</h1></div>
  <div class="grid2">
    <form class="card" data-form="create">
      <h2>Wir heiraten</h2>
      <p class="muted small">Gebt euer Datum ein. Euer Zeitstrahl mit allen Schritten wird automatisch erstellt, und ihr könnt jeden Schritt danach anpassen.</p>
      <div class="fields2">
        <div class="field"><label for="c-n1">Name 1</label><input id="c-n1" name="name1" required maxlength="40" value="${esc(S.me.user.name.split(' ')[0])}"></div>
        <div class="field"><label for="c-n2">Name 2</label><input id="c-n2" name="name2" required maxlength="40"></div>
        <div class="field"><label for="c-d">Hochzeitsdatum</label><input id="c-d" name="date" type="date" required value="${next}"></div>
        <div class="field"><label for="c-t">Uhrzeit Trauung</label><input id="c-t" name="time" type="time" value="14:00"></div>
      </div>
      <div class="field"><label for="c-l">Location</label><input id="c-l" name="location" maxlength="120" placeholder="z. B. Gut Sonnenhof, Lüneburg"></div>
      <p class="err" data-err hidden></p>
      <button class="btn" type="submit">Zeitplan erstellen</button>
    </form>
    <form class="card" data-form="join">
      <h2>Wir sind eingeladen</h2>
      <p class="muted small">Ihr habt vom Brautpaar einen Code bekommen? Der Code bestimmt, ob ihr als Gast, Trauzeug:in oder als zweite Hälfte des Paares beitretet.</p>
      <div class="field"><label for="j-c">Einladungscode</label><input id="j-c" name="code" required placeholder="G-ABC123" autocapitalize="characters" class="mono"></div>
      <p class="err" data-err hidden></p>
      <button class="btn sec" type="submit">Beitreten</button>
    </form>
  </div>
  ${S.me.weddings.length ? `<div class="card"><h3>Eure Hochzeiten</h3><ul class="list">${S.me.weddings.map(w => `<li><a href="#/w/${esc(w.id)}/uebersicht"><b>${esc(w.name1)} & ${esc(w.name2)}</b></a><span class="small muted">${fmt(parseD(w.date))} · ${ROLE_LABEL[w.role]}</span></li>`).join('')}</ul></div>` : ''}
  <div class="row"><button class="btn ghost small" data-act="logout">Abmelden</button></div>`;
}

/* ---------------- Hochzeit ---------------- */
async function renderWedding(wid, tab) {
  if (!S.w || S.w.id !== wid) {
    const d = await api(`/api/w/${wid}`);
    S.w = d.wedding; S.role = d.role; S.cal = d.calendar_url; S.base = d.public_url; S.counts = d.counts; S.data = {}; S.editing = null;
    store.set('wfy-last', wid);
  }
  const tabs = TABS[S.role];
  if (!tabs.some(t => t[0] === tab)) tab = 'uebersicht';
  S.tab = tab;
  setChrome({ tabs, active: tab });
  const fn = { uebersicht: vOverview, zeitplan: vTimeline, gaeste: vGuests, ablauf: vSchedule, einstellungen: vSettings, zusage: vRsvp, beitrag: vContrib, beitraege: vContrib }[tab];
  await fn();
  tick();
}
const couple = () => `${S.w.name1} & ${S.w.name2}`;
const wedDay = () => parseD(S.w.date);
const wedMoment = () => { const d = wedDay(); const [h, m] = (S.w.time || '14:00').split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
async function load(key, url, force) { if (force || !S.data[key]) S.data[key] = await api(url); return S.data[key]; }

function countdownCard() {
  return `<section class="card">
    <div class="names">${esc(S.w.name1)} &amp; ${esc(S.w.name2)}</div>
    <div class="ring"><svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="96" fill="none" stroke="var(--bg)" stroke-width="12"/><circle id="ringArc" cx="110" cy="110" r="96" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray="603.2" stroke-dashoffset="603.2"/></svg>
      <div class="in"><span class="lab" id="cdTop">Noch</span><span class="days" id="cdDays">–</span><span class="lab" id="cdBot">Tage</span></div></div>
    <div class="ticks"><div><b id="cdH">00</b><span>Stunden</span></div><div><b id="cdM">00</b><span>Minuten</span></div><div><b id="cdS">00</b><span>Sekunden</span></div></div>
    <p class="when">${fmt(wedDay(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${esc(S.w.time)} Uhr${S.w.location ? ' · ' + esc(S.w.location) : ''}</p>
    <div class="facts"><div class="fact"><b id="fWe">–</b><span>Wochenenden bis zum Ja</span></div><div class="fact"><b id="fSleep">–</b><span>Mal schlafen</span></div></div>
  </section>`;
}
function tick() {
  const days = $('#cdDays'); if (!days || !S.w) return;
  const now = new Date(), w = wedMoment(), ms = w - now, past = ms < 0, a = Math.abs(ms);
  const d = Math.floor(a / 864e5), h = Math.floor(a % 864e5 / 36e5), m = Math.floor(a % 36e5 / 6e4), s = Math.floor(a % 6e4 / 1e3);
  days.textContent = d.toLocaleString('de-DE');
  $('#cdTop').textContent = past ? 'Verheiratet seit' : 'Noch'; $('#cdBot').textContent = d === 1 ? 'Tag' : 'Tage';
  $('#cdH').textContent = String(h).padStart(2, '0'); $('#cdM').textContent = String(m).padStart(2, '0'); $('#cdS').textContent = String(s).padStart(2, '0');
  const eng = parseD(S.w.engaged_on) || addD(w, -365);
  const pct = past ? 1 : Math.min(1, Math.max(0, (now - eng) / (w - eng)));
  $('#ringArc').setAttribute('stroke-dashoffset', (603.2 * (1 - pct)).toFixed(1));
  let we = 0; if (!past) for (let x = dayStart(addD(now, 1)); x <= w; x = addD(x, 1)) if (x.getDay() === 6) we++;
  $('#fWe').textContent = we; $('#fSleep').textContent = past ? 0 : daysBetween(now, w);
}
setInterval(tick, 1000);

function calendarCard() {
  const webcal = S.cal.replace(/^https?:/, 'webcal:');
  const what = S.role === 'gast' ? 'den Hochzeitstermin' : 'alle offenen Aufgaben eures Zeitplans und den Hochzeitstermin';
  return `<section class="card"><span class="eyebrow">Erinnerungen</span><h3>Kalender abonnieren</h3>
    <p class="small muted">Euer Kalender zeigt ${what}, jeweils mit Erinnerung am Vortag. Änderungen hier tauchen nach einigen Stunden automatisch im Kalender auf.</p>
    <div class="row"><a class="btn" href="${esc(webcal)}">Im Kalender öffnen</a><button class="btn sec" data-act="copy" data-v="${esc(S.cal)}">Link kopieren</button></div>
    <p class="small muted">Google Kalender: „Weitere Kalender“ → „Per URL“ und den kopierten Link einfügen.</p></section>`;
}

/* ---------- Übersicht ---------- */
async function vOverview() {
  let side = '';
  if (S.role !== 'gast') {
    const { tasks } = await load('tasks', `/api/w/${S.w.id}/tasks`);
    const open = tasks.filter(t => !t.done).slice(0, 4), done = tasks.filter(t => t.done).length;
    const g = await load('guests', `/api/w/${S.w.id}/guests`);
    side = `<section class="card"><div class="row between"><h3>Als Nächstes dran</h3><a class="mini" href="#/w/${S.w.id}/zeitplan">Zeitplan</a></div>
      <div class="progress"><i style="width:${tasks.length ? done / tasks.length * 100 : 0}%"></i></div><p class="small muted">${done} von ${tasks.length} Schritten erledigt</p>
      ${open.length ? `<ul class="upnext">${open.map(t => { const d = parseD(t.due); const [c, l] = status(t); return `<li><div class="dbox"><b>${d.getDate()}</b><span>${fmt(d, { month: 'short' })}</span></div><div><div style="font-weight:600">${esc(t.title)}</div><span class="pill ${c}">${l}</span></div></li>`; }).join('')}</ul>` : '<p class="empty">Alles erledigt. Wunderbar!</p>'}</section>
      <section class="card"><div class="row between"><h3>Zusagen</h3><a class="mini" href="#/w/${S.w.id}/gaeste">Alle Gäste</a></div>${statsHtml(g.stats)}
      ${!g.stats.eingeladen && S.role === 'paar' ? `<p class="small muted">Noch keine Gäste dabei. Unter „Mehr“ findet ihr den Gäste-Code zum Verschicken.</p>` : ''}</section>`;
  } else {
    const { rsvp } = await load('rsvp', `/api/w/${S.w.id}/rsvp`);
    const { items } = await load('schedule', `/api/w/${S.w.id}/schedule`);
    const st = { offen: ['Ihr habt noch nicht geantwortet.', 'Jetzt zu- oder absagen'], zusage: ['Ihr habt zugesagt. Wir freuen uns auf euch!', 'Zusage ändern'], absage: ['Ihr habt abgesagt. Schade, dass ihr nicht dabei sein könnt.', 'Antwort ändern'] }[rsvp.status];
    const addr = [S.w.location, S.w.address].filter(Boolean).join(', ');
    side = `<section class="card"><span class="eyebrow">Eure Antwort</span><p>${st[0]}</p>${S.w.rsvp_until && rsvp.status === 'offen' ? `<p class="small muted">Bitte antwortet bis ${fmt(parseD(S.w.rsvp_until))}.</p>` : ''}<a class="btn ${rsvp.status === 'offen' ? '' : 'sec'}" href="#/w/${S.w.id}/zusage">${st[1]}</a></section>
      <section class="card"><span class="eyebrow">Gut zu wissen</span>
        ${addr ? `<div><div class="lbl">Wo</div><p>${esc(addr)}</p><a class="mini" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}">Route planen</a></div>` : ''}
        ${S.w.dresscode ? `<div><div class="lbl">Dresscode</div><p>${esc(S.w.dresscode)}</p></div>` : ''}
        ${S.w.info ? `<div><div class="lbl">Hinweise vom Paar</div><p style="white-space:pre-line">${esc(S.w.info)}</p></div>` : ''}
        ${!addr && !S.w.dresscode && !S.w.info ? '<p class="small muted">Das Paar ergänzt hier bald Anfahrt, Dresscode und weitere Infos.</p>' : ''}
      </section>
      <section class="card"><div class="row between"><h3>Der Tag</h3><a class="mini" href="#/w/${S.w.id}/ablauf">Ganzer Ablauf</a></div>${schedList(items.slice(0, 3), false)}</section>`;
  }
  view.innerHTML = `<div class="grid2"><div class="stack">${countdownCard()}${calendarCard()}</div><div class="stack">${side}</div></div>${accountFoot()}`;
}
function accountFoot() {
  return `<div class="row between small muted"><span>Angemeldet als ${esc(S.me.user.name)}</span><span class="row"><a class="mini" href="#/start">Weitere Hochzeit</a><button class="mini" data-act="logout">Abmelden</button></span></div>`;
}
function statsHtml(s) {
  return `<div class="stats"><div class="stat yes"><b>${s.zusage}</b><span>Zusagen</span></div><div class="stat no"><b>${s.absage}</b><span>Absagen</span></div><div class="stat"><b>${s.offen}</b><span>Offen</span></div><div class="stat"><b>${s.personen}</b><span>Personen kommen</span></div></div>`;
}

/* ---------- Zeitstrahl ---------- */
function status(t) {
  if (t.done) return ['ok', 'erledigt'];
  const diff = daysBetween(new Date(), parseD(t.due));
  if (diff < 0) return ['late', `${-diff} ${diff === -1 ? 'Tag' : 'Tage'} überfällig`];
  if (diff === 0) return ['soon', 'heute fällig'];
  if (diff <= 14) return ['soon', `in ${diff} ${diff === 1 ? 'Tag' : 'Tagen'}`];
  return ['', `bis ${fmtShort(parseD(t.due))}`];
}
function phaseOf(due) {
  const d = daysBetween(wedDay(), parseD(due));
  if (d < -270) return [0, 'Mehr als 9 Monate vorher'];
  if (d < -180) return [1, '9 bis 6 Monate vorher'];
  if (d < -90) return [2, '6 bis 3 Monate vorher'];
  if (d < -30) return [3, '3 Monate bis 4 Wochen vorher'];
  if (d < -7) return [4, 'Der letzte Monat'];
  if (d < 0) return [5, 'Die letzte Woche'];
  if (d === 0) return [6, 'Der große Tag'];
  return [7, 'Nach der Hochzeit'];
}
function gcal(t) {
  const d = parseD(t.due); const y = x => iso(x).replace(/-/g, '');
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: `Hochzeit: ${t.title}`, dates: `${y(d)}/${y(addD(d, 1))}`, details: t.note || '' });
}

async function vTimeline() {
  const { tasks } = await load('tasks', `/api/w/${S.w.id}/tasks`);
  const done = tasks.filter(t => t.done).length;
  const groups = new Map();
  for (const t of tasks) { const [k, label] = phaseOf(t.due); if (!groups.has(k)) groups.set(k, { label, items: [] }); groups.get(k).items.push(t); }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const todayPhase = phaseOf(iso(new Date()))[0];
  let html = '', placed = false;
  for (const k of keys) {
    const g = groups.get(k);
    if (!placed && k > todayPhase) { html += todayMarker(); placed = true; }
    const allDone = g.items.every(t => t.done);
    const items = g.items.filter(t => S.filter === 'all' || !t.done);
    const now = k === todayPhase && !allDone;
    html += `<li class="ph ${allDone ? 'done' : now ? 'now' : ''}"><span class="node">${allDone || now ? I.heart : ''}</span>
      <div class="ph-h"><h3>${g.label}</h3><span class="small muted mono">${g.items.filter(t => t.done).length}/${g.items.length}</span></div>
      ${items.length ? items.map(taskHtml).join('') : '<p class="small muted">Alles erledigt in dieser Phase.</p>'}</li>`;
    if (!placed && k === todayPhase) { html += todayMarker(); placed = true; }
  }
  if (!placed) html += todayMarker();
  const who = S.role === 'paar' ? 'euer Hochzeitsdatum' : `das Hochzeitsdatum von ${esc(couple())}`;
  view.innerHTML = `
  <div><span class="eyebrow">${S.role === 'paar' ? 'Euer Zeitstrahl' : 'Zeitstrahl für Trauzeug:innen'}</span><h1>Schritt für Schritt zum Ja</h1></div>
  <div class="banner">${I.spark}<div>Automatisch erstellt für ${who} am <b>${fmt(wedDay())}</b>. Tippt auf „Bearbeiten“, um Titel, Datum oder Notiz eines Schritts anzupassen. ${S.role === 'trauzeuge' ? 'Das Paar sieht diesen Zeitplan nicht.' : 'Wenn ihr das Hochzeitsdatum ändert, wandern alle Schritte mit, außer denen, die ihr von Hand verschoben habt.'}</div></div>
  <div class="grid2">
    <section class="card" style="grid-column:1/-1">
      <div class="row between"><span class="small muted">${done} von ${tasks.length} Schritten erledigt</span>
        <div class="seg"><button data-act="filter" data-v="all" aria-pressed="${S.filter === 'all'}">Alle</button><button data-act="filter" data-v="open" aria-pressed="${S.filter === 'open'}">Nur offene</button></div></div>
      <div class="progress"><i style="width:${tasks.length ? done / tasks.length * 100 : 0}%"></i></div>
      <ol class="tl">${html}</ol>
    </section>
    <form class="card" data-form="addtask"><h3>Eigenen Schritt hinzufügen</h3>
      <div class="field"><label for="n-t">Was ist zu tun?</label><input id="n-t" name="title" required maxlength="140" placeholder="z. B. Brautstrauß bestellen"></div>
      <div class="field"><label for="n-d">Bis wann?</label><input id="n-d" name="due" type="date" required value="${iso(addD(new Date(), 14))}"></div>
      <div class="field"><label for="n-n">Notiz</label><textarea id="n-n" name="note" maxlength="1000" style="min-height:70px"></textarea></div>
      <p class="err" data-err hidden></p><button class="btn" type="submit">Hinzufügen</button></form>
    <section class="card"><h3>Zeitplan neu erstellen</h3><p class="small muted">Löscht alle Schritte ${S.role === 'trauzeuge' ? 'des Trauzeugen-Zeitplans' : 'eures Zeitplans'}, auch eigene und erledigte, und erstellt die Vorlage für das aktuelle Datum neu.</p>
      ${S.confirm === 'regen' ? `<div class="row"><button class="btn danger" data-act="regen-yes">Ja, neu erstellen</button><button class="btn sec" data-act="confirm-no">Abbrechen</button></div>` : `<button class="btn sec" data-act="regen">Neu erstellen …</button>`}</section>
  </div>`;
}
const todayMarker = () => `<li class="today"><span class="node"></span><span>Heute · ${fmt(new Date())}</span></li>`;
function taskHtml(t) {
  const [c, l] = status(t);
  const editing = S.editing === t.id;
  return `<div class="task ${t.done ? 'is-done' : ''}" id="task-${t.id}">
    <input type="checkbox" data-act="toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="${esc(t.title)} erledigt">
    <div class="body"><span class="tt">${esc(t.title)}</span>${t.note && (!t.done || editing) ? `<span class="tn">${esc(t.note)}</span>` : ''}
      <div class="meta"><span class="pill ${c}">${l}</span>${t.custom_due && t.auto ? '<span class="pill moved">von euch verschoben</span>' : ''}${!t.auto ? '<span class="pill">eigener Schritt</span>' : ''}
        ${editing ? '' : `<button class="mini" data-act="edit" data-id="${t.id}">Bearbeiten</button>`}
        ${!t.done && !editing ? `<a class="mini" target="_blank" rel="noopener" href="${esc(gcal(t))}">+ Google</a>` : ''}
        ${t.product && !t.done && !editing ? `<a class="mini acc" href="/#shop">${esc(PRODUCT[t.product] || 'Im Shop')} ansehen</a>` : ''}</div></div>
    ${editing ? `<form class="edit" data-form="edittask" data-id="${t.id}">
      <div class="field"><label for="e-t">Titel</label><input id="e-t" name="title" required maxlength="140" value="${esc(t.title)}"></div>
      <div class="field"><label for="e-d">Fällig am</label><input id="e-d" name="due" type="date" required value="${esc(t.due)}"></div>
      <div class="field"><label for="e-n">Notiz</label><textarea id="e-n" name="note" maxlength="1000">${esc(t.note)}</textarea></div>
      <p class="err" data-err hidden></p>
      <div class="row"><button class="btn small" type="submit">Speichern</button><button class="btn sec small" type="button" data-act="edit-cancel">Abbrechen</button>
        ${t.auto && t.custom_due ? `<button class="btn ghost small" type="button" data-act="reset-due" data-id="${t.id}">Automatisches Datum</button>` : ''}
        ${S.confirm === 'del-' + t.id ? `<button class="btn danger small" type="button" data-act="del-yes" data-id="${t.id}">Wirklich löschen</button>` : `<button class="btn ghost small" type="button" data-act="del" data-id="${t.id}">Löschen</button>`}</div>
    </form>` : ''}
  </div>`;
}

/* ---------- Gäste ---------- */
async function vGuests() {
  const g = await load('guests', `/api/w/${S.w.id}/guests`, true);
  const menus = Object.entries(g.stats.menus);
  const allergies = g.guests.filter(x => x.status === 'zusage' && x.allergies);
  const songs = g.guests.filter(x => x.song);
  view.innerHTML = `<div><span class="eyebrow">Gäste</span><h1>Wer kommt?</h1></div>
  <div class="grid2">
    <section class="card">${statsHtml(g.stats)}
      ${menus.length ? `<div><div class="lbl">Menüwünsche</div><div class="meta">${menus.map(([k, n]) => `<span class="pill">${MENU_LABEL[k]}: ${n}</span>`).join('')}</div></div>` : ''}
      ${S.w.guest_code ? `<div class="code-box"><span class="lbl">Gäste einladen mit Code</span><span class="code">${esc(S.w.guest_code)}</span><div class="row"><button class="btn small" data-act="copy" data-v="${esc(inviteLink(S.w.guest_code))}">Einladungslink kopieren</button></div></div>` : ''}
    </section>
    <section class="card"><h3>Alle Antworten</h3>
      ${g.guests.length ? `<ul class="list">${g.guests.map(x => `<li><div class="row between"><b>${esc(x.name)}</b><span class="pill ${x.status === 'zusage' ? 'ok' : x.status === 'absage' ? 'late' : ''}">${x.status === 'zusage' ? `kommt${x.persons > 1 ? ' zu ' + x.persons : ''}` : x.status === 'absage' ? 'sagt ab' : 'offen'}</span></div>
        ${x.menu ? `<span class="small muted">${MENU_LABEL[x.menu]}</span>` : ''}${x.message ? `<span class="small" style="white-space:pre-line">„${esc(x.message)}“</span>` : ''}</li>`).join('')}</ul>` : '<p class="empty">Noch keine Gäste. Verschickt den Einladungslink, dann erscheinen die Antworten hier.</p>'}
    </section>
    ${allergies.length ? `<section class="card"><h3>Allergien & Unverträglichkeiten</h3><ul class="list">${allergies.map(x => `<li><b>${esc(x.name)}</b><span class="small">${esc(x.allergies)}</span></li>`).join('')}</ul></section>` : ''}
    ${songs.length ? `<section class="card"><h3>Musikwünsche</h3><ul class="list">${songs.map(x => `<li><span>${esc(x.song)}</span><span class="small muted">${esc(x.name)}</span></li>`).join('')}</ul></section>` : ''}
    ${g.team.length ? `<section class="card"><h3>Team</h3><ul class="list">${g.team.map(x => `<li class="row between"><span>${esc(x.name)}</span><span class="role-chip ${x.role}">${ROLE_LABEL[x.role]}</span></li>`).join('')}</ul></section>` : ''}
  </div>`;
}
const inviteLink = c => `${S.base}/app#/join/${c}`;

/* ---------- Ablauf ---------- */
function schedList(items, editable) {
  if (!items.length) return '<p class="empty">Der Ablauf folgt bald.</p>';
  return `<ul class="sched">${items.map(s => S.editing === 's' + s.id ? `<li style="grid-template-columns:1fr"><form class="stack" data-form="editsched" data-id="${s.id}">
      <div class="fields2"><div class="field"><label for="s-t-${s.id}">Uhrzeit</label><input id="s-t-${s.id}" name="time" type="time" required value="${esc(s.time)}"></div><div class="field"><label for="s-p-${s.id}">Ort</label><input id="s-p-${s.id}" name="place" maxlength="120" value="${esc(s.place)}"></div></div>
      <div class="field"><label for="s-n-${s.id}">Programmpunkt</label><input id="s-n-${s.id}" name="title" required maxlength="100" value="${esc(s.title)}"></div>
      <div class="row"><button class="btn small" type="submit">Speichern</button><button class="btn sec small" type="button" data-act="edit-cancel">Abbrechen</button><button class="btn ghost small" type="button" data-act="sched-del" data-id="${s.id}">Löschen</button></div></form></li>`
    : `<li><b>${esc(s.time)}</b><div><div style="font-weight:600">${esc(s.title)}</div>${s.place ? `<span class="small muted">${esc(s.place)}</span>` : ''}</div>${editable ? `<button class="mini" data-act="sched-edit" data-id="${s.id}">Ändern</button>` : '<span></span>'}</li>`).join('')}</ul>`;
}
async function vSchedule() {
  const { items } = await load('schedule', `/api/w/${S.w.id}/schedule`, true);
  const editable = S.role === 'paar';
  view.innerHTML = `<div><span class="eyebrow">${fmt(wedDay(), { weekday: 'long', day: 'numeric', month: 'long' })}</span><h1>Ablauf des Tages</h1></div>
  <div class="grid2"><section class="card">${schedList(items, editable)}${editable ? '<p class="small muted">Diesen Ablauf sehen alle Gäste und Trauzeug:innen.</p>' : ''}</section>
  ${editable ? `<form class="card" data-form="addsched"><h3>Programmpunkt hinzufügen</h3>
    <div class="fields2"><div class="field"><label for="a-t">Uhrzeit</label><input id="a-t" name="time" type="time" required value="18:00"></div><div class="field"><label for="a-p">Ort</label><input id="a-p" name="place" maxlength="120"></div></div>
    <div class="field"><label for="a-n">Programmpunkt</label><input id="a-n" name="title" required maxlength="100" placeholder="z. B. Gruppenfoto"></div>
    <p class="err" data-err hidden></p><button class="btn" type="submit">Hinzufügen</button></form>` : ''}</div>`;
}

/* ---------- Zusage (Gäste) ---------- */
async function vRsvp() {
  const { rsvp } = await load('rsvp', `/api/w/${S.w.id}/rsvp`, true);
  const yes = rsvp.status !== 'absage';
  view.innerHTML = `<div><span class="eyebrow">Hochzeit ${esc(couple())}</span><h1>Seid ihr dabei?</h1>${S.w.rsvp_until ? `<p class="muted">Bitte antwortet bis ${fmt(parseD(S.w.rsvp_until))}.</p>` : ''}</div>
  <form class="card" data-form="rsvp">
    <div class="choice"><label><input type="radio" name="status" value="zusage" ${rsvp.status === 'zusage' ? 'checked' : ''} required><span>Wir kommen gern</span><small>Zusage</small></label>
      <label><input type="radio" name="status" value="absage" ${rsvp.status === 'absage' ? 'checked' : ''}><span>Leider nicht</span><small>Absage</small></label></div>
    <div class="stack" data-yes ${yes ? '' : 'hidden'}>
      <div class="fields2"><div class="field"><label for="r-p">Personen</label><select id="r-p" name="persons">${[1, 2, 3, 4, 5, 6].map(n => `<option ${rsvp.persons === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label for="r-m">Menü</label><select id="r-m" name="menu"><option value="">Egal</option>${Object.entries(MENU_LABEL).map(([k, l]) => `<option value="${k}" ${rsvp.menu === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label for="r-a">Allergien oder Unverträglichkeiten</label><input id="r-a" name="allergies" maxlength="300" value="${esc(rsvp.allergies)}"></div>
      <div class="field"><label for="r-s">Euer Musikwunsch</label><input id="r-s" name="song" maxlength="150" value="${esc(rsvp.song)}" placeholder="Titel und Interpret"></div>
    </div>
    <div class="field"><label for="r-msg">Nachricht an das Paar</label><textarea id="r-msg" name="message" maxlength="1000">${esc(rsvp.message)}</textarea></div>
    <p class="err" data-err hidden></p><button class="btn" type="submit">Antwort senden</button>
    ${rsvp.status !== 'offen' ? `<p class="small muted">Zuletzt geändert: ${esc(new Date(rsvp.updated_at.replace(' ', 'T') + 'Z').toLocaleString('de-DE'))}</p>` : ''}
  </form>`;
  view.querySelectorAll('input[name=status]').forEach(r => r.onchange = () => { view.querySelector('[data-yes]').hidden = r.value !== 'zusage' || !r.checked; });
}

/* ---------- Hochzeitszeitung ---------- */
async function vContrib() {
  const { items } = await load('contrib', `/api/w/${S.w.id}/contributions`, true);
  const tz = S.role === 'trauzeuge';
  view.innerHTML = `<div><span class="eyebrow">Hochzeitszeitung</span><h1>${tz ? 'Beiträge der Gäste' : 'Euer Beitrag zur Hochzeitszeitung'}</h1>
    <p class="muted">${tz ? 'Hier sammeln sich Geschichten, Grüße und Rätselfragen der Gäste. Das Paar sieht sie nicht, die Überraschung bleibt also sicher.' : 'Die Trauzeug:innen gestalten eine Zeitung für das Paar. Erzählt eine Geschichte, schreibt einen Gruß oder schickt eine Rätselfrage. Das Paar sieht euren Beitrag erst in der gedruckten Zeitung.'}</p></div>
  <div class="grid2">
    <form class="card" data-form="contrib"><h3>${tz ? 'Selbst etwas beitragen' : 'Beitrag schreiben'}</h3>
      <div class="field"><label for="b-k">Art</label><select id="b-k" name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="b-t">Text</label><textarea id="b-t" name="text" required maxlength="3000" placeholder="Wie wir uns kennengelernt haben …"></textarea></div>
      <p class="err" data-err hidden></p><button class="btn" type="submit">Beitrag senden</button></form>
    <section class="card"><div class="row between"><h3>${tz ? `${items.length} Beiträge` : 'Eure Beiträge'}</h3>${tz ? '<a class="mini acc" href="/#zeitung">Zeitung gestalten</a>' : ''}</div>
      ${items.length ? `<ul class="list">${items.map(c => `<li><div class="row between"><span class="pill">${KIND_LABEL[c.kind] || c.kind}</span><button class="mini" data-act="contrib-del" data-id="${c.id}">Löschen</button></div><p style="white-space:pre-line">${esc(c.text)}</p><span class="small muted">${esc(c.name)}</span></li>`).join('')}</ul>` : '<p class="empty">Noch keine Beiträge.</p>'}</section>
  </div>`;
}

/* ---------- Einstellungen (Paar) ---------- */
async function vSettings() {
  const w = S.w;
  const codes = [['Gäste', w.guest_code, 'Für alle Gäste: Zusage, Infos, Ablauf und Beiträge zur Zeitung.'], ['Trauzeug:innen', w.witness_code, 'Eigener Zeitplan für JGA, Zeitung und Rede. Ihr seht ihn nicht.'], ['Partner:in', w.partner_code, 'Für die zweite Hälfte von euch: gleiche Rechte wie ihr.']];
  view.innerHTML = `<div><span class="eyebrow">Einstellungen</span><h1>Eure Hochzeit</h1></div>
  <div class="grid2">
    <form class="card" data-form="wedding"><h3>Daten</h3>
      <div class="fields2">
        <div class="field"><label for="w-n1">Name 1</label><input id="w-n1" name="name1" required maxlength="40" value="${esc(w.name1)}"></div>
        <div class="field"><label for="w-n2">Name 2</label><input id="w-n2" name="name2" required maxlength="40" value="${esc(w.name2)}"></div>
        <div class="field"><label for="w-d">Hochzeitsdatum</label><input id="w-d" name="date" type="date" required value="${esc(w.date)}"></div>
        <div class="field"><label for="w-t">Uhrzeit Trauung</label><input id="w-t" name="time" type="time" required value="${esc(w.time)}"></div>
        <div class="field"><label for="w-e">Verlobt seit</label><input id="w-e" name="engaged_on" type="date" value="${esc(w.engaged_on)}"></div>
        <div class="field"><label for="w-r">Zusagen bis</label><input id="w-r" name="rsvp_until" type="date" value="${esc(w.rsvp_until)}"></div>
      </div>
      <div class="field"><label for="w-l">Location</label><input id="w-l" name="location" maxlength="120" value="${esc(w.location)}"></div>
      <div class="field"><label for="w-a">Adresse</label><input id="w-a" name="address" maxlength="200" value="${esc(w.address)}"></div>
      <div class="field"><label for="w-dc">Dresscode</label><input id="w-dc" name="dresscode" maxlength="120" value="${esc(w.dresscode)}"></div>
      <div class="field"><label for="w-i">Hinweise für Gäste</label><textarea id="w-i" name="info" maxlength="2000" placeholder="Parken, Hotels, Kinderbetreuung …">${esc(w.info)}</textarea></div>
      <p class="err" data-err hidden></p><p class="ok-note" data-ok hidden></p>
      <button class="btn" type="submit">Speichern</button>
    </form>
    <div class="stack">
      <section class="card"><span class="eyebrow">Einladen</span><h3>Codes für alle Bereiche</h3>
        ${codes.map(([l, c, d]) => `<div class="code-box"><span class="lbl">${l}</span><span class="code">${esc(c)}</span><span class="small muted">${d}</span><div class="row"><button class="btn small" data-act="copy" data-v="${esc(inviteLink(c))}">Link kopieren</button><button class="btn sec small" data-act="copy" data-v="${esc(c)}">Code kopieren</button></div></div>`).join('')}
      </section>
      ${calendarCard()}
      ${accountFoot()}
    </div>
  </div>`;
}

/* ---------------- Ereignisse ---------------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = Number(el.dataset.id);
  try {
    switch (act) {
      case 'reload': return location.reload();
      case 'auth': return renderAuth(el.dataset.v);
      case 'logout': await api('/api/logout', { method: 'POST' }); S.me = null; S.w = null; return go('#/login');
      case 'copy': {
        const v = el.dataset.v;
        try { await navigator.clipboard.writeText(v); toast('Kopiert'); } catch { window.prompt('Zum Kopieren markieren:', v); }
        return;
      }
      case 'filter': S.filter = el.dataset.v; store.set('wfy-filter', S.filter); return vTimeline();
      case 'edit': S.editing = id; S.confirm = null; await vTimeline(); document.getElementById('e-t')?.focus(); return;
      case 'edit-cancel': S.editing = null; S.confirm = null; return S.tab === 'ablauf' ? vSchedule() : vTimeline();
      case 'del': S.confirm = 'del-' + id; return vTimeline();
      case 'del-yes': await api(`/api/tasks/${id}`, { method: 'DELETE' }); S.data.tasks.tasks = S.data.tasks.tasks.filter(t => t.id !== id); S.editing = null; S.confirm = null; toast('Schritt gelöscht'); return vTimeline();
      case 'reset-due': return updateTask(id, { reset_due: true }, 'Datum wieder automatisch');
      case 'regen': S.confirm = 'regen'; return vTimeline();
      case 'confirm-no': S.confirm = null; return vTimeline();
      case 'regen-yes': await api(`/api/w/${S.w.id}/tasks/regenerate`, { method: 'POST' }); S.confirm = null; delete S.data.tasks; await load('tasks', `/api/w/${S.w.id}/tasks`); toast('Zeitplan neu erstellt'); return vTimeline();
      case 'sched-edit': S.editing = 's' + id; return vSchedule();
      case 'sched-del': await api(`/api/schedule/${id}`, { method: 'DELETE' }); S.editing = null; return vSchedule();
      case 'contrib-del': await api(`/api/contributions/${id}`, { method: 'DELETE' }); toast('Beitrag gelöscht'); return vContrib();
    }
  } catch (err) { toast(err.message); }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.act === 'toggle') {
    const t = S.data.tasks.tasks.find(x => x.id === Number(el.dataset.id));
    await updateTask(t.id, { done: el.checked }, el.checked ? 'Erledigt, weiter so!' : null);
  }
});

async function updateTask(id, patch, msg) {
  try {
    const { task } = await api(`/api/tasks/${id}`, { method: 'PATCH', body: patch });
    const list = S.data.tasks.tasks; list[list.findIndex(t => t.id === id)] = task;
    list.sort((a, b) => a.due.localeCompare(b.due) || a.id - b.id);
    if (msg) toast(msg);
  } catch (err) { toast(err.message); }
  return vTimeline();
}

document.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]'); if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  const err = form.querySelector('[data-err]'); if (err) err.hidden = true;
  const btn = form.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    switch (kind) {
      case 'login': case 'register':
        await api(`/api/${kind}`, { method: 'POST', body: data }); S.me = null; return go('#/');
      case 'create': {
        const r = await api('/api/weddings', { method: 'POST', body: data });
        S.me = await api('/api/me'); toast('Euer Zeitplan ist fertig!'); return go(`#/w/${r.id}/zeitplan`);
      }
      case 'join': {
        const r = await api('/api/join', { method: 'POST', body: data });
        S.me = await api('/api/me'); toast(`Willkommen als ${ROLE_LABEL[r.role]}!`); return go(`#/w/${r.id}/uebersicht`);
      }
      case 'addtask': {
        const { task } = await api(`/api/w/${S.w.id}/tasks`, { method: 'POST', body: data });
        S.data.tasks.tasks.push(task); S.data.tasks.tasks.sort((a, b) => a.due.localeCompare(b.due) || a.id - b.id);
        toast('Schritt hinzugefügt'); return vTimeline();
      }
      case 'edittask': {
        S.editing = null; S.confirm = null;
        const t = S.data.tasks.tasks.find(x => x.id === Number(form.dataset.id));
        const patch = { title: data.title, note: data.note };
        if (data.due !== t.due) patch.due = data.due;
        return updateTask(t.id, patch, 'Gespeichert');
      }
      case 'addsched': await api(`/api/w/${S.w.id}/schedule`, { method: 'POST', body: data }); toast('Hinzugefügt'); return vSchedule();
      case 'editsched': await api(`/api/schedule/${form.dataset.id}`, { method: 'PATCH', body: data }); S.editing = null; return vSchedule();
      case 'rsvp': {
        const body = { ...data, persons: Number(data.persons || 1) };
        await api(`/api/w/${S.w.id}/rsvp`, { method: 'PUT', body });
        delete S.data.rsvp; toast(data.status === 'zusage' ? 'Danke für eure Zusage!' : 'Danke für eure Antwort'); return go(`#/w/${S.w.id}/uebersicht`);
      }
      case 'contrib': await api(`/api/w/${S.w.id}/contributions`, { method: 'POST', body: data }); toast('Danke für euren Beitrag!'); return vContrib();
      case 'wedding': {
        const r = await api(`/api/w/${S.w.id}`, { method: 'PATCH', body: data });
        S.w = r.wedding; S.data = {}; S.me = await api('/api/me');
        await vSettings();
        const ok = view.querySelector('[data-ok]'); ok.hidden = false;
        ok.textContent = r.moved ? `Gespeichert. ${r.moved} Schritte im Zeitplan sind mit dem neuen Datum mitgewandert.` : 'Gespeichert.';
        return;
      }
    }
  } catch (ex) {
    if (err) { err.textContent = ex.message; err.hidden = false; } else toast(ex.message);
  } finally { if (btn && btn.isConnected) btn.disabled = false; }
});

render();
