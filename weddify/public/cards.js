// Tischkarten-Generator: erzeugt aus dem Sitzplan druckfertige Platzkarten, Tischnummern und einen Sitzplan-Aushang
// in den Designs der weddify-Kollektionen. Gedruckt wird über den Browser (A4, auch als PDF speicherbar).
import { buildPeople } from './seating.js';

export const DESIGNS = {
  klassisch: { label: 'Klassisch', note: 'Schreibschrift, feine Doppellinie' },
  botanisch: { label: 'Botanisch', note: 'Eukalyptus-Zweig, Salbeigrün' },
  modern: { label: 'Modern', note: 'Klare Versalien, kräftige Linie' },
  nacht: { label: 'Gold & Nacht', note: 'Dunkelblau mit Gold' },
};
const MENU_ICON = { fleisch: 'Fleisch', fisch: 'Fisch', vegetarisch: 'Vegetarisch', vegan: 'Vegan', kind: 'Kindermenü' };
const SPRIG = '<svg class="sprig" viewBox="0 0 120 40" aria-hidden="true"><path d="M4 30 C40 26 80 18 116 8" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
  [18, 34, 50, 66, 82, 98].map((x, i) => { const y = 30 - (x - 4) * 0.19; return `<ellipse cx="${x}" cy="${y + (i % 2 ? 6 : -6)}" rx="7" ry="3.6" transform="rotate(${i % 2 ? 25 : -35} ${x} ${y + (i % 2 ? 6 : -6)})" fill="currentColor" opacity=".75"/>`; }).join('') + '</svg>';

export async function vCards({ api, S, esc, toast, view }) {
  const wid = S.w.id; const editable = S.role === 'paar';
  const [{ data }, guestsRes] = await Promise.all([api(`/api/w/${wid}/seating`), api(`/api/w/${wid}/guests`)]);
  if (!data || !Array.isArray(data.items) || !data.items.some(i => i.kind === 'table')) {
    view.innerHTML = `<div class="card"><span class="eyebrow">Tischkarten</span><h2>Zuerst den Sitzplan anlegen</h2><p class="muted">Die Tischkarten entstehen aus dem Sitzplan. Legt dort Tische an und setzt die Gäste auf ihre Plätze.</p><a class="btn" href="#/w/${wid}/sitzplan">Zum Sitzplan</a></div>`;
    return;
  }
  const P = data; P.names = P.names || {}; P.design = P.design || 'klassisch';
  const { people, names } = buildPeople(S.w, guestsRes, P);
  const menuOf = key => { const g = guestsRes.guests.find(x => `u${x.id}` === key.split('#')[0]); return g?.menu || ''; };
  const nameOf = key => P.names[key] || names.get(key) || '';
  const hostOf = key => people.get(key)?.split(' · ')[0] || '';
  const opt = { type: 'platz', menu: true, table: true, ...(S.cardOpt || {}) }; S.cardOpt = opt;

  const tables = P.items.filter(i => i.kind === 'table').sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const seated = tables.flatMap(t => t.guests.map((k, i) => k && { key: k, table: t.name, seat: i + 1 }).filter(Boolean));
  const missingNames = seated.filter(s => !nameOf(s.key));
  const unseated = [...people.keys()].filter(k => !seated.some(s => s.key === k));
  const initials = `${S.w.name1[0] || ''} & ${S.w.name2[0] || ''}`;
  const dateTxt = new Date(S.w.date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const tableNo = n => { const m = /^Tisch\s+(\S+)$/i.exec(n); return m ? m[1] : null; };

  const placeCard = s => {
    const n = nameOf(s.key);
    return `<div class="pc ${n ? '' : 'missing'}"><div class="pc-back"><span>${esc(initials)}</span></div>
      <div class="pc-front">${P.design === 'botanisch' ? SPRIG : ''}<div class="pc-name">${n ? esc(n) : `Begleitung von ${esc(hostOf(s.key))}`}</div>
      ${opt.table || (opt.menu && menuOf(s.key)) ? `<div class="pc-meta">${opt.table ? esc(s.table) : ''}${opt.table && opt.menu && menuOf(s.key) ? ' · ' : ''}${opt.menu && menuOf(s.key) ? MENU_ICON[menuOf(s.key)] : ''}</div>` : ''}</div></div>`;
  };
  const numberCard = t => {
    const no = tableNo(t.name);
    return `<div class="tn">${P.design === 'botanisch' ? SPRIG : ''}${no ? `<div class="tn-lbl">Tisch</div><div class="tn-no">${esc(no)}</div>` : `<div class="tn-name">${esc(t.name)}</div>`}
      <div class="tn-foot">${esc(S.w.name1)} &amp; ${esc(S.w.name2)} · ${esc(dateTxt)}</div></div>`;
  };
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  // Aushang: Begleitungen ohne Namen werden beim Gast mitgezählt („Tante Hilde (+1)“), wenn sie am selben Tisch sitzen
  const alpha = [];
  for (const s of seated) {
    if (nameOf(s.key)) { alpha.push({ key: s.key, n: nameOf(s.key), t: s.table, plus: 0 }); continue; }
  }
  for (const s of seated) {
    if (nameOf(s.key)) continue;
    const host = alpha.find(a => a.key === s.key.split('#')[0] && a.t === s.table);
    if (host) host.plus++; else alpha.push({ key: s.key, n: `Begleitung von ${hostOf(s.key)}`, t: s.table, plus: 0 });
  }
  alpha.forEach(a => { if (a.plus) a.n += ` (+${a.plus})`; });
  alpha.sort((a, b) => a.n.localeCompare(b.n, 'de'));

  function render() {
    let sheets = '';
    if (opt.type === 'platz') sheets = chunk(seated, 6).map(c => `<div class="sheet sheet-platz">${c.map(placeCard).join('')}</div>`).join('');
    if (opt.type === 'nummer') sheets = chunk(tables, 4).map(c => `<div class="sheet sheet-nummer">${c.map(numberCard).join('')}</div>`).join('');
    if (opt.type === 'aushang') {
      const letters = [...new Set(alpha.map(a => a.n[0].toUpperCase()))];
      sheets = `<div class="sheet sheet-aushang"><div class="ah">${P.design === 'botanisch' ? SPRIG : ''}<div class="ah-title">Findet euren Platz</div><div class="ah-sub">${esc(S.w.name1)} &amp; ${esc(S.w.name2)} · ${esc(dateTxt)}</div>
        <div class="ah-cols">${letters.map(L => `<div class="ah-group"><div class="ah-letter">${esc(L)}</div>${alpha.filter(a => a.n[0].toUpperCase() === L).map(a => `<div class="ah-row"><span>${esc(a.n)}</span><b>${esc(a.t)}</b></div>`).join('')}</div>`).join('')}</div></div></div>`;
    }
    const counts = { platz: `${seated.length} Platzkarten auf ${Math.ceil(seated.length / 6)} Seiten`, nummer: `${tables.length} Tischnummern auf ${Math.ceil(tables.length / 4)} Seiten`, aushang: `${alpha.length} Namen, alphabetisch` }[opt.type];
    view.innerHTML = `
    <div class="no-print"><a class="mini" href="#/w/${wid}/sitzplan">← Sitzplan</a></div>
    <div class="no-print"><span class="eyebrow">Tischkarten</span><h1>Automatisch aus eurem Sitzplan</h1>
      <p class="muted">Jede Karte zeigt den Namen vom Stuhl im Sitzplan. Ändert ihr den Sitzplan, ändern sich die Karten mit. Gedruckt wird auf A4, als Faltkarten zum Ausschneiden. Im Druckdialog könnt ihr auch „Als PDF speichern“ wählen.</p></div>
    <div class="card no-print">
      <div class="field"><label>Was drucken?</label><div class="seg" id="cdType">${[['platz', 'Platzkarten'], ['nummer', 'Tischnummern'], ['aushang', 'Sitzplan-Aushang']].map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${opt.type === k}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>Design</label><div class="designs" id="cdDesign">${Object.entries(DESIGNS).map(([k, d]) => `<button type="button" class="design-pick d-${k}" data-v="${k}" aria-pressed="${P.design === k}"><span class="swatch"><span>Aa</span></span><b>${d.label}</b><small>${d.note}</small></button>`).join('')}</div></div>
      ${opt.type === 'platz' ? `<div class="row small"><label class="row"><input type="checkbox" id="cdTable" ${opt.table ? 'checked' : ''}> Tisch auf der Karte</label><label class="row"><input type="checkbox" id="cdMenu" ${opt.menu ? 'checked' : ''}> Menüwahl auf der Karte (hilft dem Service)</label></div>` : ''}
      ${missingNames.length && opt.type !== 'nummer' ? `<p class="err">${missingNames.length} Begleitungen haben noch keinen Namen. Tragt die Namen im Sitzplan direkt am Stuhl ein, sonst steht „Begleitung von …“ auf der Karte.</p>` : ''}
      ${unseated.length && opt.type !== 'nummer' ? `<p class="ok-note" style="background:var(--gold-soft);color:var(--gold)">${unseated.length} Personen haben noch keinen Platz und bekommen deshalb keine Karte.</p>` : ''}
      <div class="row between"><span class="small muted">${counts}</span><div class="row"><button class="btn" id="cdPrint">Drucken / PDF</button><a class="btn sec" href="/#shop">Gedruckt bei weddify bestellen</a></div></div>
    </div>
    <div id="cardSheets" class="sheets design-${esc(P.design)}">${sheets || '<p class="empty">Noch niemand sitzt an einem Tisch.</p>'}</div>`;
    view.querySelectorAll('#cdType button').forEach(b => b.onclick = () => { opt.type = b.dataset.v; render(); });
    view.querySelectorAll('#cdDesign button').forEach(b => b.onclick = async () => {
      P.design = b.dataset.v; render();
      if (editable) { try { await api(`/api/w/${wid}/seating`, { method: 'PUT', body: { data: P } }); } catch (e) { toast(e.message); } }
    });
    const t = view.querySelector('#cdTable'); if (t) t.onchange = () => { opt.table = t.checked; render(); };
    const m = view.querySelector('#cdMenu'); if (m) m.onchange = () => { opt.menu = m.checked; render(); };
    view.querySelector('#cdPrint').onclick = () => { document.body.dataset.print = opt.type; window.print(); };
  }
  render();
}
