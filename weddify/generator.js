// Erzeugt aus wenigen Angaben (Traditionen, Datum, Gästezahl, Optionen) einen vollständigen, verknüpften Plan:
// Feiern mit Ablauf, Aufgaben für Paar und Trauzeug:innen, Budget nach Kategorien und Dienstleister-Checkliste.
import { TRADITIONS, COMMON, OPTION_TASKS, EVENT_DEFS, BASE_BUDGET, VENDOR_CATS, scheduleFor, dateWarnings } from './traditions.js';

const CEREMONY_KEYS = ['kirche', 'freie_trauung', 'orthodox', 'chuppa', 'pheras', 'anand', 'aghd'];
const BASE_VENDORS = ['location', 'catering', 'fotograf', 'dj', 'florist', 'styling', 'brautmode', 'herrenmode', 'ringe', 'torte', 'papeterie', 'transport'];

export function normalizeProfile(p = {}) {
  const traditions = (Array.isArray(p.traditions) ? p.traditions : []).filter(k => TRADITIONS[k]);
  const o = p.options || {};
  return {
    traditions: traditions.length ? [...new Set(traditions)] : ['standesamt', 'frei'],
    guests: Math.max(2, Math.min(2000, parseInt(p.guests) || 80)),
    budget: Math.max(0, Math.min(10_000_000, Number(p.budget) || 0)),
    langs: (Array.isArray(p.langs) ? p.langs : ['de']).filter(l => typeof l === 'string' && l.length <= 3).slice(0, 3),
    options: { noAlcohol: !!o.noAlcohol, separated: !!o.separated, kids: o.kids !== false, international: !!o.international, abroad: !!o.abroad, bismillah: !!o.bismillah },
    print: typeof p.print === 'object' && p.print ? p.print : {},
  };
}

export const estimateBudget = guests => Math.round((guests * 170 + 3500) / 500) * 500;

export function buildPlan(profileIn) {
  const profile = normalizeProfile(profileIn);
  const T = profile.traditions.map(k => ({ key: k, ...TRADITIONS[k] }));
  const opt = profile.options;
  const okCond = c => !c || (c === 'kids' ? opt.kids : !!opt[c]);

  // Hauptfeier: Titel und Uhrzeit von der Tradition mit höchster Priorität
  const mainT = T.filter(t => t.mainTitle).sort((a, b) => (b.mainPrio || 0) - (a.mainPrio || 0))[0];
  const events = new Map();
  const ceremonyToday = T.some(t => t.events.some(e => CEREMONY_KEYS.includes(e) && (EVENT_DEFS[e]?.offset ?? 1) === 0));
  const main = { key: 'feier', ...EVENT_DEFS.feier, title: mainT?.mainTitle || 'Hochzeitsfeier', time: mainT?.mainTime || (ceremonyToday ? '17:00' : EVENT_DEFS.feier.time) };
  let mainSched = scheduleFor(mainT?.mainSched || 'feier');
  if (ceremonyToday && !mainT?.mainSched) mainSched = mainSched.filter(([, t]) => !/Trauung|Zeremonie/.test(t)).map(([tm, tt], i) => [i === 0 ? main.time : tm, tt]);
  events.set('feier', { ...main, schedule: mainSched });
  for (const t of T) for (const e of t.events) {
    if (events.has(e)) continue;
    const def = EVENT_DEFS[e]; if (!def) continue;
    events.set(e, { key: e, ...def, title: t.eventTitles?.[e] || def.title, schedule: scheduleFor(e) });
  }
  if (opt.separated && events.has('henna')) events.get('henna').scope = 'frauen';

  // Aufgaben: Traditionen zuerst, damit sie allgemeine „Buchen“-Aufgaben derselben Kategorie ersetzen
  const tasks = []; const seen = new Set(); const bookedCats = new Set();
  const add = (x, aud = 'paar') => {
    if (seen.has(x.k) || !okCond(x.cond)) return;
    if (x.book && x.v && aud === 'paar') { if (bookedCats.has(x.v)) return; bookedCats.add(x.v); }
    seen.add(x.k);
    tasks.push({ k: x.k, ev: x.ev && events.has(x.ev) ? x.ev : 'feier', o: x.o, t: x.t, n: x.n || '', p: x.p || '', v: x.v || '', book: !!x.book, aud });
  };
  for (const t of T) for (const x of t.tasks) add(x);
  for (const x of OPTION_TASKS) add(x);
  for (const x of COMMON.tasks) add(x);
  for (const x of COMMON.witness) add(x, 'trauzeuge');

  // Dienstleister-Checkliste
  const vendors = [...new Set([...BASE_VENDORS, ...T.flatMap(t => t.vendors || []), ...tasks.filter(t => t.book && t.v).map(t => t.v), ...(opt.kids ? ['kinder'] : [])])].filter(c => VENDOR_CATS[c]);

  // Budget: Anteile normieren, Gesamtbudget aus Gästezahl schätzen, wenn nichts angegeben
  const total = profile.budget || estimateBudget(profile.guests);
  const rows = new Map();
  for (const b of BASE_BUDGET) rows.set(b.cat, { ...b });
  if (opt.noAlcohol) rows.get('getraenke').share = 4;
  for (const t of T) for (const b of t.budget || []) { const r = rows.get(b.cat); if (r) r.share += b.share; else rows.set(b.cat, { ...b }); }
  const sum = [...rows.values()].reduce((s, r) => s + r.share, 0);
  const budget = [...rows.values()].map((r, i) => ({ cat: r.cat, label: r.label, planned: Math.round(total * r.share / sum / 10) * 10, perGuest: !!r.perGuest, sort: i }));

  const warnings = [];
  if (!profile.traditions.includes('standesamt') && !opt.abroad) warnings.push('Ohne Standesamt ist die Ehe in Deutschland rechtlich nicht gültig. Fügt „Standesamt“ hinzu, falls ihr noch nicht standesamtlich verheiratet seid.');

  return { profile, events: [...events.values()], tasks, vendors, budget, total, warnings, dateWarnings: d => dateWarnings(d, profile.traditions) };
}
