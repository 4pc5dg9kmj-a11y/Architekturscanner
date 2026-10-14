// Druckerei: alle Drucksachen entstehen aus denselben Daten (Feiern, Gästeliste, Sitzplan, Geschenke, Profil).
// Gedruckt wird über den Browser auf A4 (oder als PDF gespeichert). Mehrsprachig inkl. Arabisch/Persisch (RTL).
import { buildPeople } from './seating.js';

export const DESIGNS = {
  klassisch: { label: 'Klassisch', note: 'Schreibschrift, feine Doppellinie' },
  botanisch: { label: 'Botanisch', note: 'Eukalyptus-Zweig, Salbeigrün' },
  modern: { label: 'Modern', note: 'Klare Versalien, kräftige Linie' },
  nacht: { label: 'Gold & Nacht', note: 'Dunkelblau mit Gold' },
};
const RTL = new Set(['ar', 'fa']);
const LOCALE = { de: 'de-DE', en: 'en-GB', tr: 'tr-TR', ar: 'ar', pl: 'pl-PL', it: 'it-IT', es: 'es-ES', ru: 'ru-RU', fa: 'fa-IR' };
const T = {
  de: { marry: 'Wir heiraten', invite: 'Wir freuen uns sehr, diesen Tag mit euch zu feiern.', rsvp: 'Bitte antwortet bis', rsvpScan: 'Zusage per QR-Code', welcome: 'Willkommen zur Hochzeit von', thanks: 'Danke', table: 'Tisch', seat: 'Findet euren Platz', program: 'Ablauf', menu: 'Menü', std: 'Save the Date', invitation: 'Einladung', dear: 'Liebe', gift: 'Danke, dass ihr da wart', giftFor: 'für', inviteTo: 'Wir laden euch herzlich ein:' },
  en: { marry: 'We are getting married', invite: 'We would love to celebrate this day with you.', rsvp: 'Kindly reply by', rsvpScan: 'Reply via QR code', welcome: 'Welcome to the wedding of', thanks: 'Thank you', table: 'Table', seat: 'Find your seat', program: 'Programme', menu: 'Menu', std: 'Save the Date', invitation: 'Invitation', dear: 'Dear', gift: 'Thank you for celebrating with us', giftFor: 'for', inviteTo: 'You are warmly invited to:' },
  tr: { marry: 'Evleniyoruz', invite: 'Bu mutlu günümüzü sizinle paylaşmaktan mutluluk duyarız.', rsvp: 'Lütfen şu tarihe kadar yanıt verin:', rsvpScan: 'QR kod ile yanıt', welcome: 'Düğünümüze hoş geldiniz', thanks: 'Teşekkürler', table: 'Masa', seat: 'Yerinizi bulun', program: 'Program', menu: 'Menü', std: 'Tarihi kaydedin', invitation: 'Davetiye', dear: 'Sevgili', gift: 'Bizimle olduğunuz için teşekkürler', giftFor: 'için', inviteTo: 'Sizleri davet ediyoruz:' },
  ar: { marry: 'دعوة زفاف', invite: 'يسعدنا أن تشاركونا فرحتنا في هذا اليوم.', rsvp: 'يرجى الرد قبل', rsvpScan: 'الرد عبر رمز QR', welcome: 'أهلاً وسهلاً بكم في حفل زفاف', thanks: 'شكراً', table: 'طاولة', seat: 'ابحثوا عن مقاعدكم', program: 'برنامج الحفل', menu: 'قائمة الطعام', std: 'احفظوا التاريخ', invitation: 'دعوة', dear: 'الأعزاء', gift: 'شكراً لمشاركتكم فرحتنا', giftFor: 'على', inviteTo: 'يسعدنا دعوتكم إلى:' },
  pl: { marry: 'Pobieramy się', invite: 'Z radością zapraszamy Was do świętowania z nami.', rsvp: 'Prosimy o odpowiedź do', rsvpScan: 'Odpowiedź przez kod QR', welcome: 'Witamy na weselu', thanks: 'Dziękujemy', table: 'Stół', seat: 'Znajdź swoje miejsce', program: 'Program', menu: 'Menu', std: 'Zapisz datę', invitation: 'Zaproszenie', dear: 'Drodzy', gift: 'Dziękujemy, że byliście z nami', giftFor: 'za', inviteTo: 'Serdecznie zapraszamy na:' },
  it: { marry: 'Ci sposiamo', invite: 'Saremo felici di festeggiare questo giorno con voi.', rsvp: 'Si prega di rispondere entro il', rsvpScan: 'Rispondi con il codice QR', welcome: 'Benvenuti al matrimonio di', thanks: 'Grazie', table: 'Tavolo', seat: 'Trova il tuo posto', program: 'Programma', menu: 'Menù', std: 'Save the Date', invitation: 'Invito', dear: 'Cari', gift: 'Grazie per aver festeggiato con noi', giftFor: 'per', inviteTo: 'Siete invitati a:' },
  es: { marry: 'Nos casamos', invite: 'Nos encantaría celebrar este día con vosotros.', rsvp: 'Por favor, confirmad antes del', rsvpScan: 'Confirmad con el código QR', welcome: 'Bienvenidos a la boda de', thanks: 'Gracias', table: 'Mesa', seat: 'Encuentra tu sitio', program: 'Programa', menu: 'Menú', std: 'Reserva la fecha', invitation: 'Invitación', dear: 'Queridos', gift: 'Gracias por celebrar con nosotros', giftFor: 'por', inviteTo: 'Os invitamos a:' },
  ru: { marry: 'Мы женимся', invite: 'Будем рады разделить этот день с вами.', rsvp: 'Пожалуйста, ответьте до', rsvpScan: 'Ответ по QR-коду', welcome: 'Добро пожаловать на свадьбу', thanks: 'Спасибо', table: 'Стол', seat: 'Найдите своё место', program: 'Программа', menu: 'Меню', std: 'Сохраните дату', invitation: 'Приглашение', dear: 'Дорогие', gift: 'Спасибо, что были с нами', giftFor: 'за', inviteTo: 'Приглашаем вас на:' },
  fa: { marry: 'ما ازدواج می‌کنیم', invite: 'خوشحال می‌شویم در جشن ما حضور داشته باشید.', rsvp: 'لطفاً پاسخ دهید تا', rsvpScan: 'پاسخ با کد QR', welcome: 'به جشن عروسی خوش آمدید', thanks: 'سپاس', table: 'میز', seat: 'جای خود را پیدا کنید', program: 'برنامه', menu: 'منو', std: 'تاریخ را به خاطر بسپارید', invitation: 'دعوت‌نامه', dear: 'عزیزان', gift: 'سپاس از حضور شما', giftFor: 'برای', inviteTo: 'شما را دعوت می‌کنیم به:' },
};
const BISMILLAH = 'بسم الله الرحمن الرحيم';
const MENU_ICON = { fleisch: 'Fleisch', fisch: 'Fisch', vegetarisch: 'Vegetarisch', vegan: 'Vegan', kind: 'Kindermenü' };
const SPRIG = '<svg class="sprig" viewBox="0 0 120 40" aria-hidden="true"><path d="M4 30 C40 26 80 18 116 8" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
  [18, 34, 50, 66, 82, 98].map((x, i) => { const y = 30 - (x - 4) * 0.19; return `<ellipse cx="${x}" cy="${y + (i % 2 ? 6 : -6)}" rx="7" ry="3.6" transform="rotate(${i % 2 ? 25 : -35} ${x} ${y + (i % 2 ? 6 : -6)})" fill="currentColor" opacity=".75"/>`; }).join('') + '</svg>';

// QR-Code als skalierbares SVG (Bibliothek: vendor/qrcode.js, MIT)
export function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '';
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const TYPES = [
  ['std', 'Save the Date', 'pro Haushalt, 4 pro A4'], ['invite', 'Einladungen', 'persönlich mit Zusage-QR, 4 pro A4'], ['program', 'Programm / Kirchenheft', 'je Feier'], ['menu', 'Menükarten', '2 pro A4'],
  ['place', 'Platzkarten', 'Faltkarten aus dem Sitzplan, 6 pro A4'], ['nummer', 'Tischnummern', '4 pro A4'], ['aushang', 'Sitzplan-Aushang', 'alphabetisch'], ['welcome', 'Willkommensschild', 'A4, je Feier'],
  ['tags', 'Gastgeschenk-Anhänger', 'Nikah şekeri, Bomboniere, Koufeta: 20 pro A4'], ['labels', 'Adressetiketten', '70 × 37 mm, 24 pro A4'], ['thanks', 'Danksagungen', 'aus der Geschenkeliste'],
];

export async function vPrint(ctx) {
  const { api, S, esc, toast, view } = ctx;
  const wid = S.w.id; const editable = S.role === 'paar';
  const [seat, guestsRes, giftsRes] = await Promise.all([api(`/api/w/${wid}/seating`), api(`/api/w/${wid}/guests`), editable ? api(`/api/w/${wid}/gifts`) : Promise.resolve({ gifts: [] })]);
  const P = seat.data || { items: [], names: {} }; P.names = P.names || {}; P.items = P.items || [];
  const prof = S.w.profile || {}; const pset = { ...(prof.print || {}) };
  const langs = prof.langs?.length ? prof.langs : ['de'];
  const opt = Object.assign({ type: 'invite', menu: true, table: true, design: pset.design || P.design || 'klassisch', event: guestsRes.events.find(e => e.key === 'feier')?.id }, S.printOpt || {});
  const q = new URLSearchParams(location.hash.split('?')[1] || ''); if (q.get('typ')) opt.type = q.get('typ');
  S.printOpt = opt;
  const events = guestsRes.events; const guests = guestsRes.guests;
  const { people, names } = buildPeople(S.w, guestsRes, P);
  const nameOf = k => P.names[k] || names.get(k) || '';
  const hostOf = k => people.get(k)?.split(' · ')[0] || '';
  const menuOf = k => guests.find(g => `g${g.id}` === k.split('#')[0])?.menu || '';
  const couple = `${S.w.name1} & ${S.w.name2}`;
  const initials = `${S.w.name1[0] || ''} & ${S.w.name2[0] || ''}`;
  const dfmt = (iso, l = langs[0], o = { day: 'numeric', month: 'long', year: 'numeric' }) => new Date(iso + 'T12:00:00').toLocaleDateString(LOCALE[l] || 'de-DE', o);
  const tr = (key, l) => (T[l] || T.de)[key];
  // Mehrsprachige Zeile: erste Sprache groß, weitere klein darunter
  const ml = (key, cls = '') => langs.map((l, i) => `<div class="${i ? 'ml2' : cls}" dir="${RTL.has(l) ? 'rtl' : 'ltr'}" lang="${l}">${esc(tr(key, l))}</div>`).join('');
  const deco = () => opt.design === 'botanisch' ? SPRIG : '';
  const bism = prof.options?.bismillah ? `<div class="bism" lang="ar" dir="rtl">${BISMILLAH}</div>` : '';
  const tables = P.items.filter(i => i.kind === 'table').sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const seated = tables.flatMap(t => (t.guests || []).map((k, i) => k && { key: k, table: t.name, seat: i + 1 }).filter(Boolean));
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const main = events.find(e => e.key === 'feier');
  const ev = events.find(e => e.id === +opt.event) || main;
  const sal = g => g.salutation || `${tr('dear', langs[0])} ${g.name}`;

  const R = {
    std: () => chunk(guests.length ? guests : [{ name: '' }], 4).map(c => `<div class="sheet sheet-a6">${c.map(g => `<div class="pc6 std">${deco()}<div class="k-eyebrow">${esc(tr('std', langs[0]))}</div><div class="k-names">${esc(S.w.name1)}<br>&amp; ${esc(S.w.name2)}</div><div class="k-date">${esc(dfmt(main.date))}</div><div class="k-small">${esc(main.location || '')}</div>${langs.slice(1).map(l => `<div class="ml2" dir="${RTL.has(l) ? 'rtl' : 'ltr'}">${esc(tr('std', l))} · ${esc(dfmt(main.date, l))}</div>`).join('')}<div class="k-foot">${g.name ? esc(g.name) + ' · ' : ''}${esc(tr('invitation', langs[0]))} folgt</div></div>`).join('')}</div>`).join(''),
    invite: () => chunk(guests, 4).map(c => `<div class="sheet sheet-a6">${c.map(g => {
      const inv = events.filter(e => g.invites.some(i => i.event_id === e.id));
      return `<div class="pc6 inv">${bism}${deco()}<div class="k-eyebrow">${ml('marry')}</div><div class="k-names">${esc(S.w.name1)} &amp; ${esc(S.w.name2)}</div>
        <div class="k-sal">${esc(sal(g))},</div><div class="k-text">${langs.map((l, i) => `<div class="${i ? 'ml2' : ''}" dir="${RTL.has(l) ? 'rtl' : 'ltr'}">${esc(pset.inviteText && !i ? pset.inviteText : tr('invite', l))}</div>`).join('')}</div>
        <ul class="k-events">${inv.map(e => `<li><b>${esc(e.title)}</b><span>${esc(dfmt(e.date, langs[0], { weekday: 'short', day: 'numeric', month: 'long' }))} · ${esc(e.time)}${e.location ? ' · ' + esc(e.location) : ''}</span></li>`).join('')}</ul>
        <div class="k-rsvp">${g.token ? qrSvg(`${S.base}/app#/r/${g.token}`) : ''}<div>${ml('rsvpScan')}${S.w.rsvp_until ? `<div class="k-small">${esc(tr('rsvp', langs[0]))} ${esc(dfmt(S.w.rsvp_until))}</div>` : ''}<div class="k-url">${esc((S.base || '').replace(/^https?:\/\//, ''))}/app#/r/${esc(g.token || '')}</div></div></div></div>`;
    }).join('')}</div>`).join('') || '<p class="empty">Legt zuerst Gäste in der Gästeliste an. Jede Einladung trägt dann Anrede, eingeladene Feiern und den persönlichen QR-Code zur Zusage.</p>',
    program: () => `<div class="sheet sheet-a6">${(events.filter(e => opt.event === 'all' || e.id === ev.id)).map(e => `<div class="pc6 prog">${bism}${deco()}<div class="k-eyebrow">${ml('program')}</div><div class="k-names small">${esc(e.title)}</div><div class="k-small">${esc(dfmt(e.date))} · ${esc(e.location || '')}</div><ul class="k-sched" id="prog-${e.id}"></ul><div class="k-foot">${esc(couple)}</div></div>`).join('')}</div>`,
    menu: () => `<div class="sheet sheet-dl">${[0, 1].map(() => `<div class="dl">${deco()}<div class="k-eyebrow">${ml('menu')}</div><div class="k-menu">${esc(pset.menuText || 'Vorspeise\nHauptgang\nDessert').split('\n').map(l => `<p>${l || '&nbsp;'}</p>`).join('')}</div>${[(prof.traditions || []).some(t => ['islamisch', 'arabisch', 'tuerkisch', 'kurdisch'].includes(t)) ? 'Alle Speisen sind halal.' : '', prof.options?.noAlcohol ? 'Alkoholfreie Getränke' : ''].filter(Boolean).map(x => `<div class="k-small">${x}</div>`).join('')}<div class="k-foot">${esc(couple)} · ${esc(dfmt(ev.date))}</div></div>`).join('')}</div>`,
    place: () => chunk(seated, 6).map(c => `<div class="sheet sheet-platz">${c.map(s => { const n = nameOf(s.key); return `<div class="pc ${n ? '' : 'missing'}"><div class="pc-back"><span>${esc(initials)}</span></div><div class="pc-front">${deco()}<div class="pc-name">${n ? esc(n) : `Begleitung von ${esc(hostOf(s.key))}`}</div>${opt.table || (opt.menu && menuOf(s.key)) ? `<div class="pc-meta">${opt.table ? esc(s.table) : ''}${opt.table && opt.menu && menuOf(s.key) ? ' · ' : ''}${opt.menu && menuOf(s.key) ? MENU_ICON[menuOf(s.key)] : ''}</div>` : ''}</div></div>`; }).join('')}</div>`).join('') || '<p class="empty">Noch niemand sitzt an einem Tisch. Legt im Sitzplan Tische an und verteilt die Gäste.</p>',
    nummer: () => chunk(tables, 4).map(c => `<div class="sheet sheet-nummer">${c.map(t => { const no = /^Tisch\s+(\S+)/i.exec(t.name)?.[1]; return `<div class="tn">${deco()}${no ? `<div class="tn-lbl">${langs.map(l => esc(tr('table', l))).join(' · ')}</div><div class="tn-no">${esc(no)}</div>` : `<div class="tn-name">${esc(t.name)}</div>`}<div class="tn-foot">${esc(couple)} · ${esc(dfmt(main.date))}</div></div>`; }).join('')}</div>`).join('') || '<p class="empty">Noch keine Tische im Sitzplan.</p>',
    aushang: () => {
      const alpha = []; for (const s of seated) if (nameOf(s.key)) alpha.push({ key: s.key, n: nameOf(s.key), t: s.table, plus: 0 });
      for (const s of seated) { if (nameOf(s.key)) continue; const h = alpha.find(a => a.key === s.key.split('#')[0] && a.t === s.table); if (h) h.plus++; else alpha.push({ key: s.key, n: `Begleitung von ${hostOf(s.key)}`, t: s.table, plus: 0 }); }
      alpha.forEach(a => { if (a.plus) a.n += ` (+${a.plus})`; }); alpha.sort((a, b) => a.n.localeCompare(b.n, 'de'));
      const L = [...new Set(alpha.map(a => a.n[0].toUpperCase()))];
      return `<div class="sheet sheet-aushang"><div class="ah">${deco()}<div class="ah-title">${langs.map((l, i) => `<div class="${i ? 'ml2' : ''}" dir="${RTL.has(l) ? 'rtl' : 'ltr'}">${esc(tr('seat', l))}</div>`).join('')}</div><div class="ah-sub">${esc(couple)} · ${esc(dfmt(main.date))}</div><div class="ah-cols">${L.map(x => `<div class="ah-group"><div class="ah-letter">${esc(x)}</div>${alpha.filter(a => a.n[0].toUpperCase() === x).map(a => `<div class="ah-row"><span>${esc(a.n)}</span><b>${esc(a.t)}</b></div>`).join('')}</div>`).join('')}</div></div></div>`;
    },
    welcome: () => `<div class="sheet sheet-a4">${(opt.event === 'all' ? events : [ev]).map(e => `<div class="a4 welcome">${bism}${deco()}<div class="k-eyebrow">${ml('welcome')}</div><div class="k-names big">${esc(S.w.name1)}<br>&amp; ${esc(S.w.name2)}</div><div class="k-date">${esc(e.title)} · ${esc(dfmt(e.date))}</div></div>`).join('')}</div>`,
    tags: () => `<div class="sheet sheet-tags">${Array.from({ length: 20 }, () => `<div class="tag">${deco()}<div class="tag-names">${esc(S.w.name1)} &amp; ${esc(S.w.name2)}</div><div class="tag-date">${esc(dfmt(main.date, langs[0], { day: '2-digit', month: '2-digit', year: 'numeric' }))}</div><div class="tag-thx">${langs.map(l => `<span dir="${RTL.has(l) ? 'rtl' : 'ltr'}">${esc(tr('thanks', l))}</span>`).join(' · ')}</div></div>`).join('')}</div>`,
    labels: () => { const withAddr = guests.filter(g => g.address); return chunk(withAddr, 24).map(c => `<div class="sheet sheet-labels">${c.map(g => `<div class="lbl37"><b>${esc(g.name)}</b><span>${esc(g.address).replace(/\n/g, '<br>')}</span></div>`).join('')}</div>`).join('') || '<p class="empty">Noch keine Gäste mit Adresse. Adressen tragt ihr in der Gästeliste ein.</p>'; },
    thanks: () => chunk(giftsRes.gifts.filter(g => !g.thanked || opt.allThanks), 4).map(c => `<div class="sheet sheet-a6">${c.map(g => `<div class="pc6 thx">${deco()}<div class="k-names">${ml('thanks', 'k-thx')}</div><div class="k-sal">${esc(g.salutation || `${tr('dear', langs[0])} ${g.guest_name || g.from_name}`)},</div><div class="k-text">${esc(tr('gift', langs[0]))}${g.description ? ` – und ${esc(tr('giftFor', langs[0]))} ${esc(g.description)}` : ''}.</div><div class="k-sign">${esc(couple)}</div></div>`).join('')}</div>`).join('') || '<p class="empty">Alle Geschenke sind bedankt, oder es sind noch keine eingetragen.</p>',
  };

  function render() {
    const t = TYPES.find(x => x[0] === opt.type) || TYPES[0];
    view.innerHTML = `<div class="no-print"><span class="eyebrow">Druckerei</span><h1>Alle Drucksachen aus eurem Plan</h1>
      <p class="muted">Gäste, Feiern, Sitzplan und Geschenke fließen automatisch ein. Sprachen: ${langs.map(l => `<b>${l.toUpperCase()}</b>`).join(', ')} (änderbar unter Einstellungen → Traditionen). Druckt auf A4 oder speichert als PDF.</p></div>
    <div class="card no-print"><div class="print-types">${TYPES.map(([k, l, d]) => `<button type="button" class="ptype ${opt.type === k ? 'on' : ''}" data-ty="${k}" aria-pressed="${opt.type === k}"><b>${l}</b><span>${d}</span></button>`).join('')}</div>
      <div class="field"><label>Design</label><div class="designs">${Object.entries(DESIGNS).map(([k, d]) => `<button type="button" class="design-pick d-${k}" data-de="${k}" aria-pressed="${opt.design === k}"><span class="swatch"><span>Aa</span></span><b>${d.label}</b><small>${d.note}</small></button>`).join('')}</div></div>
      ${['program', 'welcome', 'menu'].includes(opt.type) ? `<div class="field"><label for="pEv">Feier</label><select id="pEv">${opt.type !== 'menu' ? `<option value="all" ${opt.event === 'all' ? 'selected' : ''}>Alle Feiern</option>` : ''}${events.map(e => `<option value="${e.id}" ${+opt.event === e.id ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select></div>` : ''}
      ${opt.type === 'invite' && editable ? `<div class="field"><label for="pIt">Einladungstext (erste Sprache)</label><textarea id="pIt" rows="2" maxlength="400" placeholder="${esc(tr('invite', langs[0]))}">${esc(pset.inviteText || '')}</textarea></div>` : ''}
      ${opt.type === 'menu' && editable ? `<div class="field"><label for="pMt">Menü (eine Zeile pro Gang)</label><textarea id="pMt" rows="5" maxlength="1200">${esc(pset.menuText || '')}</textarea></div>` : ''}
      ${opt.type === 'place' ? `<div class="row small"><label class="row"><input type="checkbox" id="pTab" ${opt.table ? 'checked' : ''}> Tisch auf der Karte</label><label class="row"><input type="checkbox" id="pMenu" ${opt.menu ? 'checked' : ''}> Menüwahl auf der Karte</label></div>` : ''}
      ${opt.type === 'thanks' ? `<label class="row small"><input type="checkbox" id="pAll" ${opt.allThanks ? 'checked' : ''}> Auch bereits bedankte Geschenke</label>` : ''}
      <div class="row between"><span class="small muted">${esc(t[1])}: ${esc(t[2])}</span><div class="row"><button class="btn" id="pPrint">Drucken / PDF</button><a class="btn sec" href="/#shop">Gedruckt bei weddify bestellen</a></div></div></div>
    <div id="cardSheets" class="sheets design-${esc(opt.design)}">${R[opt.type]()}</div>`;
    if (opt.type === 'program') fillPrograms();
    view.querySelectorAll('[data-ty]').forEach(b => b.onclick = () => { opt.type = b.dataset.ty; history.replaceState(null, '', `#/w/${wid}/druck`); render(); });
    view.querySelectorAll('[data-de]').forEach(b => b.onclick = () => { opt.design = b.dataset.de; pset.design = opt.design; save(); render(); });
    const pe = view.querySelector('#pEv'); if (pe) pe.onchange = () => { opt.event = pe.value === 'all' ? 'all' : +pe.value; render(); };
    const it = view.querySelector('#pIt'); if (it) it.onchange = () => { pset.inviteText = it.value.trim(); save(); render(); };
    const mt = view.querySelector('#pMt'); if (mt) mt.onchange = () => { pset.menuText = mt.value; save(); render(); };
    for (const [id, k] of [['#pTab', 'table'], ['#pMenu', 'menu'], ['#pAll', 'allThanks']]) { const c = view.querySelector(id); if (c) c.onchange = () => { opt[k] = c.checked; render(); }; }
    view.querySelector('#pPrint').onclick = () => window.print();
  }
  async function fillPrograms() {
    const { items } = await api(`/api/w/${wid}/schedule`);
    for (const ul of view.querySelectorAll('.k-sched')) { const id = +ul.id.slice(5); ul.innerHTML = items.filter(i => i.event_id === id).map(i => `<li><b>${esc(i.time)}</b><span>${esc(i.title)}</span></li>`).join(''); }
  }
  async function save() { if (!editable) return; try { await api(`/api/w/${wid}/profile`, { method: 'PATCH', body: { print: pset } }); S.w.profile.print = { ...pset }; } catch (e) { toast(e.message); } }
  render();
}
