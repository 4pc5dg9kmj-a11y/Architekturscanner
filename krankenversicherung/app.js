"use strict";
/* =====================================================================
   Beihilfe- & PKV-Rechnungsprüfer
   Lokale Web-App ohne Server: Daten in localStorage, Anhänge in IndexedDB.
   ===================================================================== */

/* ------------------------------ Konstanten ------------------------------ */

const MAX_PERSONEN = 10;

const KATEGORIEN = [
  { id: "ambulant",      name: "Ambulante Behandlung" },
  { id: "stationaer",    name: "Stationäre Behandlung" },
  { id: "wahlleistung",  name: "Wahlleistungen (Chefarzt, Zimmer)" },
  { id: "zahn",          name: "Zahnbehandlung" },
  { id: "zahnersatz",    name: "Zahnersatz / Kieferorthopädie" },
  { id: "arznei",        name: "Arznei- & Verbandmittel" },
  { id: "heilmittel",    name: "Heilmittel (Physio, Ergo, Logo)" },
  { id: "hilfsmittel",   name: "Hilfsmittel" },
  { id: "sehhilfe",      name: "Sehhilfen (Brille, Kontaktlinsen)" },
  { id: "heilpraktiker", name: "Heilpraktiker" },
  { id: "psychotherapie",name: "Psychotherapie" },
  { id: "vorsorge",      name: "Vorsorge / Impfungen" },
  { id: "fahrtkosten",   name: "Fahrtkosten" },
  { id: "sonstiges",     name: "Sonstiges" },
];
const katName = id => (KATEGORIEN.find(k => k.id === id) || { name: id }).name;

const ROLLEN = [
  { id: "selbst",     name: "Beihilfeberechtigte/r (Beamter/Beamtin)", defaultSatz: 50 },
  { id: "selbst2k",   name: "Beihilfeberechtigte/r mit ≥ 2 Kindern",   defaultSatz: 70 },
  { id: "versorgung", name: "Versorgungsempfänger/in (Pension)",       defaultSatz: 70 },
  { id: "partner",    name: "Ehe-/Lebenspartner/in",                   defaultSatz: 70 },
  { id: "kind",       name: "Kind",                                    defaultSatz: 80 },
];
const rolleName = id => (ROLLEN.find(r => r.id === id) || { name: id }).name;

/* Hinweise sind Orientierungswerte (Stand der Programmierung) – die Sätze
   sind pro Person frei einstellbar und maßgeblich ist immer der Bescheid. */
const BUNDESLAENDER = [
  { id: "bund", name: "Bund (Bundesbeamte)",
    hinweis: "Regelsätze: 50 % selbst, 70 % mit ≥ 2 Kindern bzw. als Versorgungsempfänger, 70 % Ehepartner, 80 % Kinder. Keine Kostendämpfungspauschale." },
  { id: "bw", name: "Baden-Württemberg",
    hinweis: "Für ab 2013 neu eingestellte Beamte gilt einheitlich 50 % (auch Ehepartner); Kinder 80 %. Altfälle: Regelsätze wie Bund. Eigene Heilmittel-Höchstbeträge." },
  { id: "by", name: "Bayern",
    hinweis: "Regelsätze wie Bund (50/70/70/80 %). Keine Kostendämpfungspauschale." },
  { id: "be", name: "Berlin",
    hinweis: "Regelsätze wie Bund. Weitgehende Anlehnung an die Bundesbeihilfeverordnung." },
  { id: "bb", name: "Brandenburg",
    hinweis: "Regelsätze wie Bund; Bundesbeihilfeverordnung gilt weitgehend entsprechend." },
  { id: "hb", name: "Bremen",
    hinweis: "Regelsätze wie Bund. Kostendämpfungspauschale je nach Besoldungsgruppe wird vom Erstattungsbetrag abgezogen." },
  { id: "hh", name: "Hamburg",
    hinweis: "Regelsätze wie Bund. Für ab 2018 neu Eingestellte Wahlmöglichkeit pauschale Beihilfe (GKV-Zuschuss-Modell)." },
  { id: "he", name: "Hessen",
    hinweis: "Eigenes Modell: Grundsatz 50 %, +5 % je berücksichtigungsfähigem Kind (max. 70 %); Versorgungsempfänger +10 %. Kostendämpfungspauschale nach Besoldungsgruppe." },
  { id: "mv", name: "Mecklenburg-Vorpommern",
    hinweis: "Regelsätze wie Bund; Bundesrecht gilt weitgehend entsprechend." },
  { id: "ni", name: "Niedersachsen",
    hinweis: "Regelsätze wie Bund. Kostendämpfungspauschale wurde abgeschafft; eigene Beihilfeverordnung (NBhVO)." },
  { id: "nw", name: "Nordrhein-Westfalen",
    hinweis: "Regelsätze wie Bund. Kostendämpfungspauschale je nach Besoldungsgruppe (jährlich, vom Erstattungsbetrag abgezogen); Selbstbehalte bei Arzneimitteln möglich." },
  { id: "rp", name: "Rheinland-Pfalz",
    hinweis: "Regelsätze wie Bund. Kostendämpfungspauschale nach Besoldungsgruppe." },
  { id: "sl", name: "Saarland",
    hinweis: "Regelsätze wie Bund. Kostendämpfungspauschale nach Besoldungsgruppe." },
  { id: "sn", name: "Sachsen",
    hinweis: "Regelsätze wie Bund; eigene Sächsische Beihilfeverordnung." },
  { id: "st", name: "Sachsen-Anhalt",
    hinweis: "Regelsätze wie Bund; Bundesrecht gilt weitgehend entsprechend." },
  { id: "sh", name: "Schleswig-Holstein",
    hinweis: "Regelsätze wie Bund. Kostendämpfungspauschale wurde abgeschafft." },
  { id: "th", name: "Thüringen",
    hinweis: "Regelsätze wie Bund; eigene Thüringer Beihilfeverordnung." },
];
const landName = id => (BUNDESLAENDER.find(b => b.id === id) || { name: id }).name;

/* Dienstherren mit Kostendämpfungspauschale: ein jährlicher Eigenbehalt, der
   vom errechneten Beihilfe-Erstattungsbetrag abgezogen wird. Höhe richtet sich
   nach der Besoldungsgruppe und wird je Person eingetragen. */
const LAENDER_MIT_KDP = new Set(["hb", "he", "nw", "rp", "sl"]);

const PERSON_FARBEN = ["#1a6fb0", "#1d8a4b", "#b07a12", "#8e44ad", "#c0392b",
                       "#16a085", "#d35400", "#2c3e50", "#7f8c8d", "#c2185b"];

const EPS = 0.005; // Rundungstoleranz in Euro

/* ------------------------------ Speicher ------------------------------ */

const LS_KEY = "kvpruefer-v1";

function defaultStore() {
  return {
    settings: {
      bundesland: "bund",
      bagatellgrenze: 200,      // € – darunter wird kein Beihilfeantrag gestellt (0 = aus)
      antragsfristMonate: 12,   // Frist für den Beihilfeantrag ab Rechnungsdatum
      widerspruchsfristTage: 30,// Widerspruch gegen den Beihilfebescheid
      nachfrageTage: 42,        // ohne Erstattung nach Einreichung → nachhaken
    },
    persons: [],
    vertraege: [],
    rechnungen: [],
  };
}

let store = (() => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return Object.assign(defaultStore(), JSON.parse(raw));
  } catch (e) { console.error("Store konnte nicht geladen werden:", e); }
  return defaultStore();
})();

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) {
    toast("⚠️ Speichern fehlgeschlagen (Speicher voll?): " + e.message);
  }
}

/* --- IndexedDB für Rechnungs-Anhänge (PDF/Fotos) --- */
const idb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open("kvpruefer-anhaenge", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("files", { keyPath: "id" });
      rq.onsuccess = () => { this._db = rq.result; res(this._db); };
      rq.onerror = () => rej(rq.error);
    });
  },
  async put(file) { const db = await this.open(); return req(db.transaction("files", "readwrite").objectStore("files").put(file)); },
  async get(id)   { const db = await this.open(); return req(db.transaction("files").objectStore("files").get(id)); },
  async del(id)   { const db = await this.open(); return req(db.transaction("files", "readwrite").objectStore("files").delete(id)); },
  async all()     { const db = await this.open(); return req(db.transaction("files").objectStore("files").getAll()); },
  async clear()   { const db = await this.open(); return req(db.transaction("files", "readwrite").objectStore("files").clear()); },
};
function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

/* ------------------------------ Hilfsfunktionen ------------------------------ */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = sel => document.querySelector(sel);

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const fmtEUR = n => EUR.format(Math.round((n + Number.EPSILON) * 100) / 100);

function parseBetrag(s) {
  if (typeof s === "number") return s;
  s = String(s || "").trim().replace(/€/g, "").trim();
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const fmtBetragInput = n => (n == null || n === "" ? "" : n.toFixed(2).replace(".", ","));

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = iso => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("de-DE") : "–");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3200);
}

const personById  = id => store.persons.find(p => p.id === id);
const vertragById = id => store.vertraege.find(v => v.id === id);
const rechnungById= id => store.rechnungen.find(r => r.id === id);
const personFarbe = p => PERSON_FARBEN[store.persons.indexOf(p) % PERSON_FARBEN.length];

/* ------------------------------ Berechnungslogik ------------------------------ */

/** Aktive Vertragsbausteine einer Person für eine Kategorie (höchster Satz gewinnt). */
function bausteinFuer(person, kategorie) {
  if (!person || !person.vertragId) return null;
  const vertrag = vertragById(person.vertragId);
  if (!vertrag) return null;
  let best = null;
  for (const b of vertrag.bausteine || []) {
    if (!b.aktiv) continue;
    if (person.bausteinAktiv && person.bausteinAktiv[b.id] === false) continue;
    if (!(b.kategorien || []).includes(kategorie)) continue;
    if (!best || (b.satz || 0) > (best.satz || 0)) best = b;
  }
  return best;
}

/**
 * Analysiert eine Rechnung. `usage` (Map "bausteinId|jahr" → bereits verplanter
 * Betrag) sorgt dafür, dass Jahres-Höchstgrenzen über alle Rechnungen hinweg
 * berücksichtigt werden.
 */
function analyseRechnung(r, usage) {
  const person = personById(r.personId);
  const jahr = (r.datum || todayISO()).slice(0, 4);
  const positionen = [];
  let sumBetrag = 0, sumBeihilfefaehig = 0, erwBeihilfe = 0, erwPKV = 0;
  const hinweise = [];

  for (const pos of r.positionen || []) {
    const betrag = pos.betrag || 0;
    const posHinweise = [];
    const satzB = pos.beihilfefaehig && person ? (person.beihilfesatz || 0) : 0;
    let eB = betrag * satzB / 100;

    let baustein = null, satzP = 0, eP = 0;
    if (pos.pkvFaehig && person) {
      baustein = bausteinFuer(person, pos.kategorie);
      if (baustein) {
        satzP = baustein.satz || 0;
        eP = betrag * satzP / 100;
        if (baustein.jahresLimit > 0 && usage) {
          const key = baustein.id + "|" + jahr;
          const frei = Math.max(0, baustein.jahresLimit - (usage.get(key) || 0));
          if (eP > frei + EPS) {
            posHinweise.push(`Jahres-Höchstgrenze des Bausteins „${baustein.name}“ (${fmtEUR(baustein.jahresLimit)}/Jahr) erreicht – PKV-Erwartung gekürzt.`);
            eP = frei;
          }
          usage.set(key, (usage.get(key) || 0) + eP);
        }
      } else if (person.vertragId) {
        posHinweise.push(`Kein aktiver Vertragsbaustein deckt „${katName(pos.kategorie)}“ – mögliche Deckungslücke.`);
      } else {
        posHinweise.push("Person hat keinen PKV-Vertrag zugeordnet.");
      }
    }

    if (eB + eP > betrag + EPS) {
      eP = Math.max(0, betrag - eB);
      posHinweise.push("Erwartung auf 100 % des Rechnungsbetrags gedeckelt.");
    }

    const erwartet = eB + eP;
    const istB = pos.istBeihilfe != null ? pos.istBeihilfe : null;
    const istP = pos.istPKV != null ? pos.istPKV : null;

    positionen.push({
      pos, betrag, satzB, satzP,
      baustein: baustein ? baustein.name : null,
      erwBeihilfe: eB, erwPKV: eP, erwartet,
      istB, istP,
      deltaB: istB != null ? eB - istB : null,
      deltaP: istP != null ? eP - istP : null,
      hinweise: posHinweise,
    });
    sumBetrag += betrag;
    if (pos.beihilfefaehig) sumBeihilfefaehig += betrag;
    erwBeihilfe += eB;
    erwPKV += eP;
  }

  /* Jahres-Eigenbehalte: Die Kostendämpfungspauschale (Beihilfe) und der
     PKV-Selbstbehalt sind Jahresbeträge, keine Kürzung je Position. Sie werden
     chronologisch über alle Rechnungen des Jahres verbraucht – deshalb läuft
     die Analyse über `usage` und muss nach Datum sortiert aufgerufen werden. */
  const erwBeihilfeBrutto = erwBeihilfe;
  const erwPKVBrutto = erwPKV;
  let kdpAbzug = 0, sbAbzug = 0;
  if (person && usage) {
    const kdpJahr = person.kostendaempfung || 0;
    if (kdpJahr > 0 && erwBeihilfe > EPS) {
      const key = "kdp|" + person.id + "|" + jahr;
      const frei = Math.max(0, kdpJahr - (usage.get(key) || 0));
      kdpAbzug = Math.min(erwBeihilfe, frei);
      erwBeihilfe -= kdpAbzug;
      usage.set(key, (usage.get(key) || 0) + kdpAbzug);
    }
    const sbJahr = person.selbstbehalt || 0;
    if (sbJahr > 0 && erwPKV > EPS) {
      const key = "sb|" + person.id + "|" + jahr;
      const frei = Math.max(0, sbJahr - (usage.get(key) || 0));
      sbAbzug = Math.min(erwPKV, frei);
      erwPKV -= sbAbzug;
      usage.set(key, (usage.get(key) || 0) + sbAbzug);
    }
  }
  if (kdpAbzug > EPS || sbAbzug > EPS)
    hinweise.push("Jahres-Eigenbehalte wurden von der Gesamterwartung abgezogen – die Erwartungswerte je Position oben sind Bruttowerte ohne diesen Abzug.");

  const istBeihilfe = (r.erstattungen || []).filter(e => e.quelle === "beihilfe").reduce((s, e) => s + (e.betrag || 0), 0);
  const istPKV      = (r.erstattungen || []).filter(e => e.quelle === "pkv").reduce((s, e) => s + (e.betrag || 0), 0);
  const deltaBeihilfe = erwBeihilfe - istBeihilfe;
  const deltaPKV      = erwPKV - istPKV;
  const eigenanteil   = sumBetrag - erwBeihilfe - erwPKV;

  /* Status-Ampel */
  let status;
  const hatErstattung = istBeihilfe > EPS || istPKV > EPS;
  if (!hatErstattung && !r.eingereichtBeihilfe && !r.eingereichtPKV) status = "offen";
  else if (deltaBeihilfe > EPS || deltaPKV > EPS) status = "fehlt";
  else if (deltaBeihilfe < -EPS || deltaPKV < -EPS) status = "pruefen";
  else status = "ok";

  /* Quer-Check: positionsweise Ist-Werte vs. erfasste Erstattungen */
  const posIstB = positionen.reduce((s, p) => s + (p.istB || 0), 0);
  const posIstP = positionen.reduce((s, p) => s + (p.istP || 0), 0);
  if (positionen.some(p => p.istB != null) && Math.abs(posIstB - istBeihilfe) > 0.01)
    hinweise.push(`Summe der Beihilfe-Ist-Werte je Position (${fmtEUR(posIstB)}) weicht von den erfassten Beihilfe-Erstattungen (${fmtEUR(istBeihilfe)}) ab.`);
  if (positionen.some(p => p.istP != null) && Math.abs(posIstP - istPKV) > 0.01)
    hinweise.push(`Summe der PKV-Ist-Werte je Position (${fmtEUR(posIstP)}) weicht von den erfassten PKV-Erstattungen (${fmtEUR(istPKV)}) ab.`);

  return { person, positionen, sumBetrag, sumBeihilfefaehig,
           erwBeihilfe, erwPKV, erwBeihilfeBrutto, erwPKVBrutto, kdpAbzug, sbAbzug,
           istBeihilfe, istPKV, deltaBeihilfe, deltaPKV, eigenanteil,
           status, hinweise, jahr };
}

/* ---------------------- Fristen und Einreich-Grenzen ---------------------- */

const tagesDiff = (vonISO, bisISO) =>
  Math.round((new Date(bisISO + "T00:00:00") - new Date(vonISO + "T00:00:00")) / 86400000);

function plusMonate(iso, monate) {
  const d = new Date(iso + "T00:00:00");
  const tag = d.getDate();
  d.setMonth(d.getMonth() + monate);
  if (d.getDate() < tag) d.setDate(0);   // 31.01. + 1 Monat → 28./29.02.
  return d.toISOString().slice(0, 10);
}

/**
 * Fristen einer Rechnung: Antragsfrist Beihilfe, Widerspruchsfrist nach
 * Bescheid, überfällige Erstattung nach Einreichung.
 * Liefert Einträge mit `stufe`: "bad" (abgelaufen/dringend) oder "warn".
 */
function fristenFuer(r, a) {
  const s = store.settings, heute = todayISO(), out = [];

  if (r.datum && !r.eingereichtBeihilfe && (s.antragsfristMonate || 0) > 0 &&
      a.person && (a.person.beihilfesatz || 0) > 0) {
    const frist = plusMonate(r.datum, s.antragsfristMonate);
    const rest = tagesDiff(heute, frist);
    if (rest < 0)
      out.push({ stufe: "bad", text: `Antragsfrist bei der Beihilfe am ${fmtDate(frist)} abgelaufen – Erstattung ist verfallen.` });
    else if (rest <= 60)
      out.push({ stufe: rest <= 21 ? "bad" : "warn", text: `Noch ${rest} Tage für den Beihilfeantrag (Frist ${fmtDate(frist)}).` });
  }

  if (a.deltaBeihilfe > EPS && (s.widerspruchsfristTage || 0) > 0) {
    const bescheide = (r.erstattungen || []).filter(e => e.quelle === "beihilfe" && e.datum).map(e => e.datum).sort();
    if (bescheide.length) {
      const frist = new Date(new Date(bescheide[bescheide.length - 1] + "T00:00:00").getTime() +
                             s.widerspruchsfristTage * 86400000).toISOString().slice(0, 10);
      const rest = tagesDiff(heute, frist);
      if (rest < 0)
        out.push({ stufe: "warn", text: `Widerspruchsfrist gegen den Beihilfebescheid lief am ${fmtDate(frist)} ab.` });
      else
        out.push({ stufe: rest <= 10 ? "bad" : "warn", text: `Noch ${rest} Tage für einen Widerspruch gegen den Beihilfebescheid (Frist ${fmtDate(frist)}).` });
    }
  }

  const nach = s.nachfrageTage || 0;
  if (nach > 0) {
    if (r.eingereichtBeihilfe && r.eingereichtBeihilfeDatum && a.istBeihilfe <= EPS) {
      const d = tagesDiff(r.eingereichtBeihilfeDatum, heute);
      if (d >= nach) out.push({ stufe: "warn", text: `Seit ${d} Tagen bei der Beihilfe eingereicht, noch keine Erstattung erfasst.` });
    }
    if (r.eingereichtPKV && r.eingereichtPKVDatum && a.istPKV <= EPS) {
      const d = tagesDiff(r.eingereichtPKVDatum, heute);
      if (d >= nach) out.push({ stufe: "warn", text: `Seit ${d} Tagen bei der PKV eingereicht, noch keine Erstattung erfasst.` });
    }
  }
  return out;
}

/**
 * Sammelstand bis zur Beihilfe-Bagatellgrenze: Aufwendungen aller noch nicht
 * eingereichten Rechnungen einer Person.
 */
function bagatellStatus(person, analysen) {
  const grenze = store.settings.bagatellgrenze || 0;
  if (!grenze || !person) return null;
  let summe = 0, anzahl = 0;
  for (const r of store.rechnungen) {
    if (r.personId !== person.id || r.eingereichtBeihilfe) continue;
    const a = analysen.get(r.id);
    if (!a || a.sumBeihilfefaehig <= 0) continue;
    summe += a.sumBeihilfefaehig;
    anzahl++;
  }
  if (!anzahl) return null;
  return { summe, anzahl, grenze, fehlt: Math.max(0, grenze - summe), erreicht: summe + EPS >= grenze };
}

/** Analysiert alle Rechnungen chronologisch (für Jahres-Höchstgrenzen). */
function analyseAlle() {
  const usage = new Map();
  const result = new Map();
  const sortiert = [...store.rechnungen].sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
  for (const r of sortiert) result.set(r.id, analyseRechnung(r, usage));
  return result;
}

function statusBadge(status) {
  switch (status) {
    case "ok":      return '<span class="badge b-ok">vollständig erstattet</span>';
    case "fehlt":   return '<span class="badge b-bad">Erstattung fehlt</span>';
    case "pruefen": return '<span class="badge b-warn">mehr erhalten als erwartet</span>';
    default:        return '<span class="badge b-mut">offen</span>';
  }
}

/* ------------------------------ Router ------------------------------ */

function route() {
  const hash = location.hash.replace(/^#\/?/, "") || "uebersicht";
  const [view, arg] = hash.split("/");
  document.querySelectorAll(".sidebar a").forEach(a =>
    a.classList.toggle("active", a.dataset.nav === view ||
      (view === "rechnung" && a.dataset.nav === "rechnungen")));
  const main = $("#main");
  switch (view) {
    case "personen":      main.innerHTML = viewPersonen(); break;
    case "vertraege":     main.innerHTML = viewVertraege(); break;
    case "rechnungen":    main.innerHTML = viewRechnungen(); break;
    case "rechnung":      main.innerHTML = viewRechnungDetail(arg); afterRechnungRender(arg); break;
    case "einstellungen": main.innerHTML = viewEinstellungen(); break;
    default:              main.innerHTML = viewUebersicht();
  }
}
window.addEventListener("hashchange", route);

/* ------------------------------ Ansicht: Übersicht ------------------------------ */

function viewUebersicht() {
  const analysen = analyseAlle();
  let fehltB = 0, fehltP = 0, offenArzt = 0, anzahlFehlt = 0, anzahlOffen = 0;
  for (const r of store.rechnungen) {
    const a = analysen.get(r.id);
    if (!a) continue;
    if (a.deltaBeihilfe > EPS) fehltB += a.deltaBeihilfe;
    if (a.deltaPKV > EPS)      fehltP += a.deltaPKV;
    if (a.status === "fehlt")  anzahlFehlt++;
    if (a.status === "offen")  anzahlOffen++;
    if (!r.bezahltAnArzt)      offenArzt += a.sumBetrag;
  }

  const markierte = [];
  for (const r of store.rechnungen)
    for (const pos of r.positionen || [])
      if (pos.markiert) markierte.push({ r, pos });

  let html = `
    <div class="page-head"><div>
      <h1>Übersicht</h1>
      <p class="sub">Beihilfe (${esc(landName(store.settings.bundesland))}) und private Krankenversicherung im Blick.</p>
    </div></div>
    <div class="cards">
      <div class="card ${fehltB > EPS ? "c-bad" : "c-ok"}">
        <div class="card-label">Fehlende Beihilfe</div>
        <div class="card-value">${fmtEUR(fehltB)}</div>
        <div class="card-hint">erwartet, aber (noch) nicht ausgezahlt</div>
      </div>
      <div class="card ${fehltP > EPS ? "c-bad" : "c-ok"}">
        <div class="card-label">Fehlende PKV-Erstattung</div>
        <div class="card-value">${fmtEUR(fehltP)}</div>
        <div class="card-hint">erwartet, aber (noch) nicht ausgezahlt</div>
      </div>
      <div class="card ${offenArzt > EPS ? "c-warn" : "c-ok"}">
        <div class="card-label">Noch nicht an Arzt bezahlt</div>
        <div class="card-value">${fmtEUR(offenArzt)}</div>
        <div class="card-hint">Rechnungen ohne Zahlungshaken</div>
      </div>
      <div class="card">
        <div class="card-label">Rechnungen</div>
        <div class="card-value">${store.rechnungen.length}</div>
        <div class="card-hint">${anzahlFehlt} mit fehlender Erstattung, ${anzahlOffen} offen</div>
      </div>
    </div>`;

  if (!store.persons.length) {
    html += `<div class="hint"><b>Erste Schritte:</b>
      1. Unter <a href="#/einstellungen">Einstellungen</a> das Bundesland wählen. &nbsp;
      2. Unter <a href="#/vertraege">Verträge</a> den PKV-Vertrag mit seinen Bausteinen anlegen. &nbsp;
      3. Unter <a href="#/personen">Personen</a> die Familienmitglieder mit Beihilfesatz und Vertrag anlegen. &nbsp;
      4. Unter <a href="#/rechnungen">Rechnungen</a> Arztrechnungen erfassen und Erstattungen gegenprüfen.</div>`;
  }

  /* Pro-Person-Zusammenfassung */
  if (store.persons.length) {
    const rows = store.persons.map(p => {
      let sum = 0, eB = 0, eP = 0, dB = 0, dP = 0, n = 0;
      for (const r of store.rechnungen) {
        if (r.personId !== p.id) continue;
        const a = analysen.get(r.id); if (!a) continue;
        n++; sum += a.sumBetrag; eB += a.erwBeihilfe; eP += a.erwPKV;
        if (a.deltaBeihilfe > EPS) dB += a.deltaBeihilfe;
        if (a.deltaPKV > EPS)      dP += a.deltaPKV;
      }
      const vertrag = vertragById(p.vertragId);
      return `<tr>
        <td style="min-width:220px"><span class="person-dot" style="background:${personFarbe(p)}"></span><b>${esc(p.name)}</b>
            <div class="small muted">${esc(rolleName(p.rolle))} · Beihilfesatz ${p.beihilfesatz} %${vertrag ? " · " + esc(vertrag.name) : ""}</div></td>
        <td class="num">${n}</td>
        <td class="num">${fmtEUR(sum)}</td>
        <td class="num">${fmtEUR(eB)}</td>
        <td class="num">${fmtEUR(eP)}</td>
        <td class="num ${dB > EPS ? "pos-neg" : "pos-ok"}">${fmtEUR(dB)}</td>
        <td class="num ${dP > EPS ? "pos-neg" : "pos-ok"}">${fmtEUR(dP)}</td>
      </tr>`;
    }).join("");
    html += `<div class="panel"><h2>Personen</h2><div class="table-wrap"><table>
      <thead><tr><th>Person</th><th class="num">Rechnungen</th><th class="num">Rechnungssumme</th>
      <th class="num">Erwartet Beihilfe</th><th class="num">Erwartet PKV</th>
      <th class="num">Fehlt Beihilfe</th><th class="num">Fehlt PKV</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
  }

  /* Fristen über alle Rechnungen */
  const fristenListe = [];
  for (const r of store.rechnungen) {
    const a = analysen.get(r.id);
    if (!a) continue;
    for (const f of fristenFuer(r, a)) fristenListe.push({ r, a, f });
  }
  fristenListe.sort((x, y) => (x.f.stufe === y.f.stufe ? 0 : x.f.stufe === "bad" ? -1 : 1));

  if (fristenListe.length) {
    html += `<div class="panel"><h2>Fristen im Blick</h2>
      <div class="table-wrap"><table>
      <thead><tr><th>Rechnung</th><th>Person</th><th>Hinweis</th></tr></thead><tbody>
      ${fristenListe.map(({ r, a, f }) => `
        <tr class="clickable" data-action="open-rechnung" data-id="${r.id}">
          <td>${fmtDate(r.datum)} · ${esc(r.arzt || "–")}</td>
          <td>${esc(a.person ? a.person.name : "?")}</td>
          <td><span class="badge ${f.stufe === "bad" ? "b-bad" : "b-warn"}">${f.stufe === "bad" ? "dringend" : "beachten"}</span>
              <span style="margin-left:8px">${esc(f.text)}</span></td>
        </tr>`).join("")}
      </tbody></table></div></div>`;
  }

  /* Sammelstand bis zur Beihilfe-Bagatellgrenze */
  const sammel = store.persons.map(p => ({ p, b: bagatellStatus(p, analysen) })).filter(x => x.b);
  if (sammel.length) {
    html += `<div class="panel"><h2>Sammelstand für den Beihilfeantrag</h2>
      <p class="panel-sub">Noch nicht eingereichte, beihilfefähige Aufwendungen gegen die Bagatellgrenze von ${fmtEUR(store.settings.bagatellgrenze || 0)}.</p>
      <div class="table-wrap"><table>
      <thead><tr><th>Person</th><th class="num">Rechnungen</th><th class="num">Gesammelt</th><th class="num">Fehlt noch</th><th>Stand</th></tr></thead><tbody>
      ${sammel.map(({ p, b }) => `<tr>
        <td><span class="person-dot" style="background:${personFarbe(p)}"></span><b>${esc(p.name)}</b></td>
        <td class="num">${b.anzahl}</td>
        <td class="num">${fmtEUR(b.summe)}</td>
        <td class="num">${b.erreicht ? "–" : fmtEUR(b.fehlt)}</td>
        <td style="min-width:170px">
          ${b.erreicht ? '<span class="badge b-ok">Antrag lohnt sich</span>' : '<span class="badge b-mut">noch sammeln</span>'}
          <div class="progress" style="margin-top:6px"><div class="${b.erreicht ? "p-full" : ""}" style="width:${Math.min(100, b.summe / b.grenze * 100)}%"></div></div>
        </td>
      </tr>`).join("")}
      </tbody></table></div></div>`;
  }

  /* Jahres-Eigenbehalte (Kostendämpfungspauschale, Selbstbehalt) */
  const jahrJetzt = todayISO().slice(0, 4);
  const eigenbehalte = [];
  for (const p of store.persons) {
    if (!(p.kostendaempfung > 0) && !(p.selbstbehalt > 0)) continue;
    let kdpVerbraucht = 0, sbVerbraucht = 0;
    for (const r of store.rechnungen) {
      if (r.personId !== p.id || (r.datum || "").slice(0, 4) !== jahrJetzt) continue;
      const a = analysen.get(r.id);
      if (!a) continue;
      kdpVerbraucht += a.kdpAbzug; sbVerbraucht += a.sbAbzug;
    }
    eigenbehalte.push({ p, kdpVerbraucht, sbVerbraucht });
  }
  if (eigenbehalte.length) {
    html += `<div class="panel"><h2>Jahres-Eigenbehalte ${jahrJetzt}</h2>
      <p class="panel-sub">Kostendämpfungspauschale und PKV-Selbstbehalt werden einmal jährlich verrechnet. Ist der Topf aufgebraucht, erstatten Beihilfe und PKV wieder voll.</p>
      <div class="table-wrap"><table>
      <thead><tr><th>Person</th><th class="num">Kostendämpfungspauschale</th><th class="num">davon verbraucht</th>
        <th class="num">PKV-Selbstbehalt</th><th class="num">davon verbraucht</th></tr></thead><tbody>
      ${eigenbehalte.map(({ p, kdpVerbraucht, sbVerbraucht }) => `<tr>
        <td><span class="person-dot" style="background:${personFarbe(p)}"></span><b>${esc(p.name)}</b></td>
        <td class="num">${p.kostendaempfung > 0 ? fmtEUR(p.kostendaempfung) : "–"}</td>
        <td class="num">${p.kostendaempfung > 0 ? fmtEUR(kdpVerbraucht) + (kdpVerbraucht + EPS >= p.kostendaempfung ? " ✓" : "") : "–"}</td>
        <td class="num">${p.selbstbehalt > 0 ? fmtEUR(p.selbstbehalt) : "–"}</td>
        <td class="num">${p.selbstbehalt > 0 ? fmtEUR(sbVerbraucht) + (sbVerbraucht + EPS >= p.selbstbehalt ? " ✓" : "") : "–"}</td>
      </tr>`).join("")}
      </tbody></table></div></div>`;
  }

  /* Rechnungen mit Handlungsbedarf */
  /* „offen“ zählt nur als Handlungsbedarf, wenn die Einreichgrenze erreicht ist –
     sonst ist Sammeln der richtige Zustand und keine Aufgabe. */
  const sammelErreicht = new Map(store.persons.map(p => {
    const b = bagatellStatus(p, analysen);
    return [p.id, !b || b.erreicht];
  }));
  const kritisch = store.rechnungen
    .map(r => ({ r, a: analysen.get(r.id) }))
    .filter(x => x.a && (x.a.status === "fehlt" || !x.r.bezahltAnArzt ||
                         (x.a.status === "offen" && sammelErreicht.get(x.r.personId) !== false)))
    .sort((x, y) => (y.r.datum || "").localeCompare(x.r.datum || ""));
  if (kritisch.length) {
    html += `<div class="panel"><h2>Handlungsbedarf</h2><div class="table-wrap"><table>
      <thead><tr><th>Datum</th><th>Person</th><th>Arzt / Erbringer</th><th class="num">Betrag</th>
      <th class="num">Fehlt B/PKV</th><th>Status</th><th>Arzt bezahlt?</th></tr></thead><tbody>
      ${kritisch.map(({ r, a }) => `
        <tr class="clickable" data-action="open-rechnung" data-id="${r.id}">
          <td>${fmtDate(r.datum)}</td>
          <td>${esc(a.person ? a.person.name : "?")}</td>
          <td>${esc(r.arzt || "–")}</td>
          <td class="num">${fmtEUR(a.sumBetrag)}</td>
          <td class="num">${a.deltaBeihilfe > EPS || a.deltaPKV > EPS
              ? `<span class="pos-neg">${fmtEUR(Math.max(0, a.deltaBeihilfe) + Math.max(0, a.deltaPKV))}</span>` : "–"}</td>
          <td>${statusBadge(a.status)}</td>
          <td>${r.bezahltAnArzt ? '<span class="badge b-ok">bezahlt</span>' : '<span class="badge b-warn">offen</span>'}</td>
        </tr>`).join("")}
      </tbody></table></div></div>`;
  }

  /* Markierte Positionen */
  if (markierte.length) {
    html += `<div class="panel"><h2>Markierte Positionen</h2>
      <p class="panel-sub" style="margin-top:4px">Von dir markierte Deltas / fehlende Auszahlungen.</p>
      <div class="table-wrap"><table>
      <thead><tr><th>Rechnung</th><th>Position</th><th class="num">Betrag</th><th>Notiz</th></tr></thead><tbody>
      ${markierte.map(({ r, pos }) => `
        <tr class="clickable" data-action="open-rechnung" data-id="${r.id}">
          <td>${fmtDate(r.datum)} · ${esc(r.arzt || "")}</td>
          <td>${esc(pos.ziffer ? pos.ziffer + " – " : "")}${esc(pos.beschreibung || "")}</td>
          <td class="num">${fmtEUR(pos.betrag || 0)}</td>
          <td>${esc(pos.notiz || "")}</td>
        </tr>`).join("")}
      </tbody></table></div></div>`;
  }

  return html;
}

/* ------------------------------ Ansicht: Personen ------------------------------ */

function viewPersonen() {
  let html = `
    <div class="page-head">
      <div>
        <h1>Personen</h1>
        <p class="sub">Bis zu ${MAX_PERSONEN} Familienmitglieder mit eigenem Beihilfesatz, Vertrag und Bausteinen.</p>
      </div>
      <div class="page-actions">
        <span class="muted small">${store.persons.length} / ${MAX_PERSONEN}</span>
        <button class="primary" data-action="person-neu" ${store.persons.length >= MAX_PERSONEN ? "disabled" : ""}>+ Person anlegen</button>
      </div>
    </div>`;

  if (!store.persons.length) {
    html += `<div class="panel"><div class="empty">Noch keine Personen angelegt.</div></div>`;
    return html;
  }

  html += store.persons.map(p => {
    const vertrag = vertragById(p.vertragId);
    const bausteine = (vertrag?.bausteine || []).filter(b =>
      b.aktiv && (!p.bausteinAktiv || p.bausteinAktiv[b.id] !== false));
    const nRechnungen = store.rechnungen.filter(r => r.personId === p.id).length;
    return `<div class="panel">
      <div class="panel-head">
        <h2><span class="person-dot" style="background:${personFarbe(p)}"></span>${esc(p.name)}</h2>
        <span class="badge b-info">${esc(rolleName(p.rolle))}</span>
        <span class="badge b-mut">Beihilfesatz ${p.beihilfesatz} %</span>
        ${p.kostendaempfung > 0 ? `<span class="badge b-warn">Kostendämpfung ${fmtEUR(p.kostendaempfung)}/Jahr</span>` : ""}
        ${p.selbstbehalt > 0 ? `<span class="badge b-warn">Selbstbehalt ${fmtEUR(p.selbstbehalt)}/Jahr</span>` : ""}
        <div class="spacer"></div>
        <button class="small" data-action="person-edit" data-id="${p.id}">Bearbeiten</button>
        <button class="small danger" data-action="person-del" data-id="${p.id}">Löschen</button>
      </div>
      <div class="small muted">
        ${p.geburtsdatum ? "geb. " + fmtDate(p.geburtsdatum) + " · " : ""}
        ${nRechnungen} Rechnung(en)
      </div>
      <div style="margin-top:8px">
        <b>PKV-Vertrag:</b> ${vertrag ? esc(vertrag.name) + (vertrag.versicherer ? " (" + esc(vertrag.versicherer) + ")" : "") : '<span class="badge b-warn">kein Vertrag zugeordnet</span>'}
      </div>
      ${vertrag ? `<div class="chips" style="margin-top:6px">
        ${bausteine.length ? bausteine.map(b => `<span class="chip">✓ ${esc(b.name)} · ${b.satz} %</span>`).join("")
                           : '<span class="badge b-warn">keine aktiven Bausteine</span>'}
      </div>` : ""}
      ${p.notiz ? `<div class="small muted" style="margin-top:6px">Notiz: ${esc(p.notiz)}</div>` : ""}
    </div>`;
  }).join("");
  return html;
}

function personModal(person) {
  const isNew = !person;
  const p = person || {
    id: uid(), name: "", geburtsdatum: "", rolle: "selbst",
    beihilfesatz: 50, vertragId: "", bausteinAktiv: {},
    kostendaempfung: 0, selbstbehalt: 0, notiz: "",
  };
  const land = BUNDESLAENDER.find(b => b.id === store.settings.bundesland);

  const bausteinChecks = vertragId => {
    const v = vertragById(vertragId);
    if (!v) return '<span class="muted small">Erst Vertrag wählen – Bausteine werden dann hier aktivierbar.</span>';
    if (!(v.bausteine || []).length) return '<span class="muted small">Dieser Vertrag hat noch keine Bausteine (unter „Verträge“ anlegen).</span>';
    return v.bausteine.map(b => `
      <label class="chk">
        <input type="checkbox" name="baustein" value="${b.id}"
          ${b.aktiv && (!p.bausteinAktiv || p.bausteinAktiv[b.id] !== false) ? "checked" : ""}
          ${!b.aktiv ? "disabled" : ""}>
        ${esc(b.name)} – ${b.satz} % (${(b.kategorien || []).map(katName).map(esc).join(", ")})
        ${!b.aktiv ? '<span class="badge b-mut">im Vertrag deaktiviert</span>' : ""}
      </label>`).join("");
  };

  openModal(`
    <h2>${isNew ? "Person anlegen" : "Person bearbeiten"}</h2>
    <form id="person-form">
      <div class="frow">
        <label class="f"><span>Name *</span><input type="text" name="name" required value="${esc(p.name)}"></label>
        <label class="f"><span>Geburtsdatum</span><input type="date" name="geburtsdatum" value="${esc(p.geburtsdatum)}"></label>
      </div>
      <div class="frow">
        <label class="f"><span>Rolle (für Beihilfesatz-Vorschlag)</span>
          <select name="rolle">${ROLLEN.map(r => `<option value="${r.id}" ${r.id === p.rolle ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
        </label>
        <label class="f"><span>Beihilfesatz in % *</span>
          <input type="number" name="beihilfesatz" min="0" max="100" step="1" required value="${p.beihilfesatz}">
        </label>
      </div>
      <div class="hint small">Beihilfe-Hinweis ${esc(land ? land.name : "")}: ${esc(land ? land.hinweis : "")}<br>
      <i>Ohne Gewähr – maßgeblich ist dein Beihilfebescheid. Der Satz oben ist frei einstellbar.</i></div>

      <div class="frow">
        <label class="f"><span>Kostendämpfungspauschale in € pro Jahr</span>
          <input type="text" name="kostendaempfung" value="${fmtBetragInput(p.kostendaempfung || 0)}" placeholder="0,00">
        </label>
        <label class="f"><span>PKV-Selbstbehalt in € pro Jahr</span>
          <input type="text" name="selbstbehalt" value="${fmtBetragInput(p.selbstbehalt || 0)}" placeholder="0,00">
        </label>
      </div>
      <div class="${LAENDER_MIT_KDP.has(store.settings.bundesland) ? "warnbox" : "hint"} small">
        ${LAENDER_MIT_KDP.has(store.settings.bundesland)
          ? `In ${esc(landName(store.settings.bundesland))} gibt es eine <b>Kostendämpfungspauschale</b>: einen jährlichen Eigenbehalt nach Besoldungsgruppe, den die Beihilfestelle vom Erstattungsbetrag abzieht. Trage sie hier ein – sonst meldet die App zu Unrecht „Erstattung fehlt“.`
          : `Für ${esc(landName(store.settings.bundesland))} ist keine Kostendämpfungspauschale hinterlegt – Feld auf 0 lassen.`}
        Beide Beträge sind <b>Jahresbeträge</b> und werden chronologisch über die Rechnungen des Jahres verrechnet.
      </div>

      <label class="f"><span>PKV-Vertrag</span>
        <select name="vertragId" id="person-vertrag">
          <option value="">– kein Vertrag –</option>
          ${store.vertraege.map(v => `<option value="${v.id}" ${v.id === p.vertragId ? "selected" : ""}>${esc(v.name)}${v.versicherer ? " (" + esc(v.versicherer) + ")" : ""}</option>`).join("")}
        </select>
      </label>
      <div class="f"><span class="small muted" style="font-weight:600">Aktivierte Vertragsbausteine für diese Person</span>
        <div id="person-bausteine">${bausteinChecks(p.vertragId)}</div>
      </div>
      <label class="f"><span>Notiz</span><textarea name="notiz">${esc(p.notiz || "")}</textarea></label>
      <div class="modal-actions">
        <button type="button" data-action="modal-close">Abbrechen</button>
        <button type="submit" class="primary">Speichern</button>
      </div>
    </form>`);

  $("#person-vertrag").addEventListener("change", e => {
    $("#person-bausteine").innerHTML = bausteinChecks(e.target.value);
  });
  $("#person-form select[name=rolle]").addEventListener("change", e => {
    const r = ROLLEN.find(x => x.id === e.target.value);
    if (r) $("#person-form input[name=beihilfesatz]").value = r.defaultSatz;
  });
  $("#person-form").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    p.name = fd.get("name").trim();
    p.geburtsdatum = fd.get("geburtsdatum");
    p.rolle = fd.get("rolle");
    p.beihilfesatz = Math.min(100, Math.max(0, parseFloat(fd.get("beihilfesatz")) || 0));
    p.kostendaempfung = Math.max(0, parseBetrag(fd.get("kostendaempfung")));
    p.selbstbehalt = Math.max(0, parseBetrag(fd.get("selbstbehalt")));
    p.vertragId = fd.get("vertragId");
    const checked = new Set(fd.getAll("baustein"));
    p.bausteinAktiv = {};
    const v = vertragById(p.vertragId);
    for (const b of v?.bausteine || []) if (b.aktiv) p.bausteinAktiv[b.id] = checked.has(b.id);
    p.notiz = fd.get("notiz").trim();
    if (isNew) store.persons.push(p);
    save(); closeModal(); route();
    toast(isNew ? "Person angelegt." : "Person gespeichert.");
  });
}

/* ------------------------------ Ansicht: Verträge ------------------------------ */

function viewVertraege() {
  let html = `
    <div class="page-head">
      <div>
        <h1>Verträge</h1>
        <p class="sub">PKV-Verträge mit ihren Tarif-Bausteinen. Bausteine lassen sich hier global und zusätzlich pro Person aktivieren/deaktivieren.</p>
      </div>
      <div class="page-actions"><button class="primary" data-action="vertrag-neu">+ Vertrag anlegen</button></div>
    </div>`;

  if (!store.vertraege.length) {
    html += `<div class="panel"><div class="empty">Noch keine Verträge angelegt.</div></div>`;
    return html;
  }

  html += store.vertraege.map(v => {
    const nutzer = store.persons.filter(p => p.vertragId === v.id);
    return `<div class="panel">
      <div class="panel-head">
        <h2>${esc(v.name)}</h2>
        ${v.versicherer ? `<span class="badge b-info">${esc(v.versicherer)}</span>` : ""}
        ${v.tarif ? `<span class="badge b-mut">Tarif ${esc(v.tarif)}</span>` : ""}
        <div class="spacer"></div>
        <button class="small" data-action="vertrag-edit" data-id="${v.id}">Bearbeiten</button>
        <button class="small danger" data-action="vertrag-del" data-id="${v.id}">Löschen</button>
      </div>
      <div class="small muted">
        ${v.gueltigAb ? "gültig ab " + fmtDate(v.gueltigAb) + " · " : ""}
        genutzt von: ${nutzer.length ? nutzer.map(p => esc(p.name)).join(", ") : "niemandem"}
      </div>
      ${v.notiz ? `<div class="small muted" style="margin-top:4px">Notiz: ${esc(v.notiz)}</div>` : ""}
      <h3>Bausteine</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Aktiv</th><th>Baustein</th><th>Leistungsbereiche</th>
          <th class="num">Erstattungssatz</th><th class="num">Jahres-Höchstgrenze</th><th></th></tr></thead>
        <tbody>
        ${(v.bausteine || []).map(b => `<tr>
          <td><input type="checkbox" data-action="baustein-aktiv" data-vertrag="${v.id}" data-id="${b.id}" ${b.aktiv ? "checked" : ""}></td>
          <td style="min-width:220px"><b>${esc(b.name)}</b>${b.notiz ? `<div class="small muted">${esc(b.notiz)}</div>` : ""}</td>
          <td style="min-width:220px">${(b.kategorien || []).map(katName).map(esc).join(", ") || "–"}</td>
          <td class="num">${b.satz} %</td>
          <td class="num">${b.jahresLimit > 0 ? fmtEUR(b.jahresLimit) + "/Jahr" : "–"}</td>
          <td style="white-space:nowrap">
            <button class="small" data-action="baustein-edit" data-vertrag="${v.id}" data-id="${b.id}">Bearbeiten</button>
            <button class="small danger" data-action="baustein-del" data-vertrag="${v.id}" data-id="${b.id}">✕</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="6" class="muted">Noch keine Bausteine.</td></tr>`}
        </tbody></table></div>
      <div class="toolbar">
        <button class="small" data-action="baustein-neu" data-vertrag="${v.id}">+ Baustein</button>
        ${!(v.bausteine || []).length ? `<button class="small ghost" data-action="baustein-vorlage" data-vertrag="${v.id}">Typische Restkosten-Bausteine einfügen</button>` : ""}
      </div>
    </div>`;
  }).join("");
  return html;
}

function vertragModal(vertrag) {
  const isNew = !vertrag;
  const v = vertrag || { id: uid(), name: "", versicherer: "", tarif: "", gueltigAb: "", notiz: "", bausteine: [] };
  openModal(`
    <h2>${isNew ? "Vertrag anlegen" : "Vertrag bearbeiten"}</h2>
    <form id="vertrag-form">
      <label class="f"><span>Bezeichnung *</span><input type="text" name="name" required value="${esc(v.name)}" placeholder="z. B. PKV Restkostentarif Familie"></label>
      <div class="frow">
        <label class="f"><span>Versicherer</span><input type="text" name="versicherer" value="${esc(v.versicherer)}"></label>
        <label class="f"><span>Tarifkennung</span><input type="text" name="tarif" value="${esc(v.tarif)}"></label>
        <label class="f"><span>Gültig ab</span><input type="date" name="gueltigAb" value="${esc(v.gueltigAb)}"></label>
      </div>
      <label class="f"><span>Notiz</span><textarea name="notiz">${esc(v.notiz || "")}</textarea></label>
      <div class="modal-actions">
        <button type="button" data-action="modal-close">Abbrechen</button>
        <button type="submit" class="primary">Speichern</button>
      </div>
    </form>`);
  $("#vertrag-form").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    v.name = fd.get("name").trim();
    v.versicherer = fd.get("versicherer").trim();
    v.tarif = fd.get("tarif").trim();
    v.gueltigAb = fd.get("gueltigAb");
    v.notiz = fd.get("notiz").trim();
    if (isNew) store.vertraege.push(v);
    save(); closeModal(); route();
    toast(isNew ? "Vertrag angelegt." : "Vertrag gespeichert.");
  });
}

function bausteinModal(vertrag, baustein) {
  const isNew = !baustein;
  const b = baustein || { id: uid(), name: "", kategorien: [], satz: 50, jahresLimit: 0, aktiv: true, notiz: "" };
  openModal(`
    <h2>${isNew ? "Baustein anlegen" : "Baustein bearbeiten"} <span class="muted small">(${esc(vertrag.name)})</span></h2>
    <form id="baustein-form">
      <div class="frow">
        <label class="f"><span>Bezeichnung *</span><input type="text" name="name" required value="${esc(b.name)}" placeholder="z. B. Ambulant 50 %"></label>
        <label class="f"><span>Erstattungssatz in % *</span><input type="number" name="satz" min="0" max="100" step="1" required value="${b.satz}"></label>
        <label class="f"><span>Jahres-Höchstgrenze in € (0 = keine)</span><input type="text" name="jahresLimit" value="${b.jahresLimit ? fmtBetragInput(b.jahresLimit) : "0"}"></label>
      </div>
      <div class="f"><span class="small muted" style="font-weight:600">Abgedeckte Leistungsbereiche *</span>
        <div style="columns:2; column-gap:24px">
        ${KATEGORIEN.map(k => `<label class="chk"><input type="checkbox" name="kat" value="${k.id}" ${b.kategorien.includes(k.id) ? "checked" : ""}> ${esc(k.name)}</label>`).join("")}
        </div>
      </div>
      <label class="chk"><input type="checkbox" name="aktiv" ${b.aktiv ? "checked" : ""}> Baustein aktiv (global für alle Personen mit diesem Vertrag)</label>
      <label class="f"><span>Notiz</span><textarea name="notiz">${esc(b.notiz || "")}</textarea></label>
      <div class="modal-actions">
        <button type="button" data-action="modal-close">Abbrechen</button>
        <button type="submit" class="primary">Speichern</button>
      </div>
    </form>`);
  $("#baustein-form").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    b.name = fd.get("name").trim();
    b.satz = Math.min(100, Math.max(0, parseFloat(fd.get("satz")) || 0));
    b.jahresLimit = Math.max(0, parseBetrag(fd.get("jahresLimit")));
    b.kategorien = fd.getAll("kat");
    b.aktiv = fd.get("aktiv") === "on";
    b.notiz = fd.get("notiz").trim();
    if (!b.kategorien.length) { toast("Bitte mindestens einen Leistungsbereich wählen."); return; }
    if (isNew) (vertrag.bausteine = vertrag.bausteine || []).push(b);
    save(); closeModal(); route();
    toast(isNew ? "Baustein angelegt." : "Baustein gespeichert.");
  });
}

function bausteinVorlagen(vertrag) {
  const vorlagen = [
    { name: "Ambulant (Restkosten)",  kategorien: ["ambulant", "vorsorge", "psychotherapie", "fahrtkosten", "sonstiges"], satz: 50 },
    { name: "Stationär (Restkosten)", kategorien: ["stationaer", "wahlleistung"], satz: 50 },
    { name: "Zahn (Restkosten)",      kategorien: ["zahn", "zahnersatz"], satz: 50 },
    { name: "Arznei & Heilmittel",    kategorien: ["arznei", "heilmittel"], satz: 50 },
    { name: "Hilfsmittel & Sehhilfen",kategorien: ["hilfsmittel", "sehhilfe"], satz: 50, jahresLimit: 0 },
    { name: "Heilpraktiker",          kategorien: ["heilpraktiker"], satz: 50 },
  ];
  vertrag.bausteine = vorlagen.map(t => ({
    id: uid(), name: t.name, kategorien: t.kategorien, satz: t.satz,
    jahresLimit: t.jahresLimit || 0, aktiv: true,
    notiz: "Vorlage – Satz an deinen Tarif anpassen (üblich: 100 % minus Beihilfesatz).",
  }));
  save(); route();
  toast("Vorlagen eingefügt – bitte Sätze an den Tarif anpassen.");
}

/* ------------------------------ Ansicht: Rechnungen (Liste) ------------------------------ */

function viewRechnungen() {
  const analysen = analyseAlle();
  const filterPerson = viewRechnungen._filterPerson || "";
  const filterStatus = viewRechnungen._filterStatus || "";

  let liste = [...store.rechnungen].sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  if (filterPerson) liste = liste.filter(r => r.personId === filterPerson);
  if (filterStatus) liste = liste.filter(r => (analysen.get(r.id) || {}).status === filterStatus);

  let html = `
    <div class="page-head">
      <div>
        <h1>Rechnungen</h1>
        <p class="sub">Arztrechnungen erfassen, Erstattungen von Beihilfe und PKV gegenprüfen.</p>
      </div>
      <div class="page-actions">
        <select id="filter-person" style="width:auto">
          <option value="">Alle Personen</option>
          ${store.persons.map(p => `<option value="${p.id}" ${p.id === filterPerson ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
        </select>
        <select id="filter-status" style="width:auto">
          <option value="">Alle Status</option>
          <option value="offen"   ${filterStatus === "offen" ? "selected" : ""}>offen</option>
          <option value="fehlt"   ${filterStatus === "fehlt" ? "selected" : ""}>Erstattung fehlt</option>
          <option value="pruefen" ${filterStatus === "pruefen" ? "selected" : ""}>prüfen</option>
          <option value="ok"      ${filterStatus === "ok" ? "selected" : ""}>vollständig</option>
        </select>
        <button class="primary" data-action="rechnung-neu">+ Rechnung erfassen</button>
      </div>
    </div>`;

  if (!liste.length) {
    html += `<div class="panel"><div class="empty">Keine Rechnungen ${filterPerson || filterStatus ? "für diesen Filter" : "erfasst"}.</div></div>`;
    return html;
  }

  html += `<div class="panel"><div class="table-wrap"><table>
    <thead><tr>
      <th>Datum</th><th>Person</th><th>Arzt / Erbringer</th><th>Nr.</th>
      <th class="num">Betrag</th><th class="num">Erstattet</th><th class="num">Delta</th>
      <th>Status</th><th>Arzt bezahlt</th><th>Eingereicht</th>
    </tr></thead><tbody>
    ${liste.map(r => {
      const a = analysen.get(r.id);
      const p = personById(r.personId);
      const delta = Math.max(0, a.deltaBeihilfe) + Math.max(0, a.deltaPKV);
      return `<tr class="clickable ${r.positionen?.some(x => x.markiert) ? "row-marked" : ""}" data-action="open-rechnung" data-id="${r.id}">
        <td>${fmtDate(r.datum)}</td>
        <td>${p ? `<span class="person-dot" style="background:${personFarbe(p)}"></span>${esc(p.name)}` : "?"}</td>
        <td>${esc(r.arzt || "–")}</td>
        <td>${esc(r.nummer || "–")}</td>
        <td class="num">${fmtEUR(a.sumBetrag)}</td>
        <td class="num">${fmtEUR(a.istBeihilfe + a.istPKV)}</td>
        <td class="num">${delta > EPS ? `<span class="pos-neg">${fmtEUR(delta)}</span>` : '<span class="pos-ok">–</span>'}</td>
        <td>${statusBadge(a.status)}</td>
        <td>${r.bezahltAnArzt ? '<span class="badge b-ok">✓</span>' : '<span class="badge b-warn">✕</span>'}</td>
        <td class="small">${r.eingereichtBeihilfe ? "B ✓" : "B ✕"} / ${r.eingereichtPKV ? "PKV ✓" : "PKV ✕"}</td>
      </tr>`;
    }).join("")}
    </tbody></table></div></div>`;
  return html;
}

function rechnungNeu() {
  if (!store.persons.length) { toast("Bitte zuerst unter „Personen“ mindestens eine Person anlegen."); return; }
  const r = {
    id: uid(),
    personId: store.persons[0].id,
    arzt: "", nummer: "", datum: todayISO(),
    bezahltAnArzt: false, bezahltDatum: "",
    eingereichtBeihilfe: false, eingereichtBeihilfeDatum: "",
    eingereichtPKV: false, eingereichtPKVDatum: "",
    positionen: [], erstattungen: [], anhaenge: [], notiz: "",
  };
  store.rechnungen.push(r);
  save();
  location.hash = "#/rechnung/" + r.id;
}

/* ------------------------------ Ansicht: Rechnung (Detail) ------------------------------ */

function viewRechnungDetail(id) {
  const r = rechnungById(id);
  if (!r) return `<h1>Rechnung nicht gefunden</h1><p><a href="#/rechnungen">← zurück zur Liste</a></p>`;
  const analysen = analyseAlle();
  const a = analysen.get(id);
  const p = personById(r.personId);

  const posRows = a.positionen.map((ap, i) => {
    const pos = ap.pos;
    const deltaTxt = d => d == null ? "" : (Math.abs(d) <= 0.01 ? '<span class="pos-ok">0,00 €</span>'
      : `<span class="${d > 0 ? "pos-neg" : "pos-ok"}">${fmtEUR(d)}</span>`);
    return `<tr class="${pos.markiert ? "row-marked" : ""}">
      <td><input type="date" class="w-130" data-pos="${pos.id}" data-field="datum" value="${esc(pos.datum || "")}"></td>
      <td><input type="text" class="w-70" data-pos="${pos.id}" data-field="ziffer" value="${esc(pos.ziffer || "")}" placeholder="GOÄ"></td>
      <td><input type="text" style="min-width:140px" data-pos="${pos.id}" data-field="beschreibung" value="${esc(pos.beschreibung || "")}"></td>
      <td><select data-pos="${pos.id}" data-field="kategorie" style="min-width:130px">
        ${KATEGORIEN.map(k => `<option value="${k.id}" ${k.id === pos.kategorie ? "selected" : ""}>${esc(k.name)}</option>`).join("")}
      </select></td>
      <td class="num"><input type="text" class="w-90" style="text-align:right" data-pos="${pos.id}" data-field="betrag" value="${fmtBetragInput(pos.betrag)}"></td>
      <td style="text-align:center"><input type="checkbox" data-pos="${pos.id}" data-field="beihilfefaehig" ${pos.beihilfefaehig ? "checked" : ""} title="beihilfefähig"></td>
      <td style="text-align:center"><input type="checkbox" data-pos="${pos.id}" data-field="pkvFaehig" ${pos.pkvFaehig ? "checked" : ""} title="PKV-erstattungsfähig"></td>
      <td class="num small">${fmtEUR(ap.erwBeihilfe)}<div class="muted">${ap.satzB} %</div></td>
      <td class="num small">${fmtEUR(ap.erwPKV)}<div class="muted">${ap.baustein ? esc(ap.baustein) + " · " + ap.satzP + " %" : (pos.pkvFaehig ? "—" : "")}</div></td>
      <td class="num"><input type="text" class="w-70" style="text-align:right" data-pos="${pos.id}" data-field="istBeihilfe" value="${pos.istBeihilfe != null ? fmtBetragInput(pos.istBeihilfe) : ""}" placeholder="–"></td>
      <td class="num"><input type="text" class="w-70" style="text-align:right" data-pos="${pos.id}" data-field="istPKV" value="${pos.istPKV != null ? fmtBetragInput(pos.istPKV) : ""}" placeholder="–"></td>
      <td class="num small">${deltaTxt(ap.deltaB)}${ap.deltaB != null && ap.deltaP != null ? "<br>" : ""}${deltaTxt(ap.deltaP)}</td>
      <td style="text-align:center"><input type="checkbox" data-pos="${pos.id}" data-field="markiert" ${pos.markiert ? "checked" : ""} title="markieren (Delta / fehlende Auszahlung)"></td>
      <td><input type="text" class="w-110" data-pos="${pos.id}" data-field="notiz" value="${esc(pos.notiz || "")}" placeholder="Notiz"></td>
      <td><button class="small danger" data-action="pos-del" data-id="${pos.id}" title="Position löschen">✕</button></td>
    </tr>
    ${ap.hinweise.length ? `<tr><td colspan="15" class="small" style="color:var(--warn); border-top:none; padding-top:0">⚠ ${ap.hinweise.map(esc).join(" · ")}</td></tr>` : ""}`;
  }).join("");

  const erstRows = (r.erstattungen || []).map(e => `<tr>
    <td><select data-erst="${e.id}" data-field="quelle">
      <option value="beihilfe" ${e.quelle === "beihilfe" ? "selected" : ""}>Beihilfe</option>
      <option value="pkv" ${e.quelle === "pkv" ? "selected" : ""}>PKV</option>
    </select></td>
    <td><input type="date" class="w-130" data-erst="${e.id}" data-field="datum" value="${esc(e.datum || "")}"></td>
    <td class="num"><input type="text" class="w-90" style="text-align:right" data-erst="${e.id}" data-field="betrag" value="${fmtBetragInput(e.betrag)}"></td>
    <td><input type="text" data-erst="${e.id}" data-field="bemerkung" value="${esc(e.bemerkung || "")}" placeholder="z. B. Bescheid-Nr., Kürzungsgrund"></td>
    <td><button class="small danger" data-action="erst-del" data-id="${e.id}">✕</button></td>
  </tr>`).join("");

  const quote = a.sumBetrag > 0 ? Math.min(100, (a.istBeihilfe + a.istPKV) / a.sumBetrag * 100) : 0;
  const fristen = fristenFuer(r, a);
  const bagatell = !r.eingereichtBeihilfe ? bagatellStatus(p, analysen) : null;

  return `
    <a class="backlink" href="#/rechnungen">← Alle Rechnungen</a>
    <div class="page-head">
      <div>
        <h1>Rechnung ${esc(r.nummer || "")} ${statusBadge(a.status)}</h1>
        <p class="sub">${esc(r.arzt || "Ohne Leistungserbringer")} · ${fmtDate(r.datum)} · ${p ? esc(p.name) : "?"}</p>
      </div>
      <div class="page-actions">
        <button class="danger" data-action="rechnung-del" data-id="${r.id}">Rechnung löschen</button>
      </div>
    </div>

    <div class="panel">
      <div class="frow">
        <label class="f"><span>Person</span>
          <select data-rfield="personId">${store.persons.map(x => `<option value="${x.id}" ${x.id === r.personId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
        </label>
        <label class="f"><span>Arzt / Leistungserbringer</span><input type="text" data-rfield="arzt" value="${esc(r.arzt)}"></label>
        <label class="f"><span>Rechnungsnummer</span><input type="text" data-rfield="nummer" value="${esc(r.nummer)}"></label>
        <label class="f"><span>Rechnungsdatum</span><input type="date" data-rfield="datum" value="${esc(r.datum)}"></label>
      </div>
      <div class="frow">
        <div class="f" style="flex:1">
          <label class="chk"><input type="checkbox" data-rfield="bezahltAnArzt" ${r.bezahltAnArzt ? "checked" : ""}> <b>An Arzt bezahlt</b></label>
          <input type="date" data-rfield="bezahltDatum" value="${esc(r.bezahltDatum || "")}" ${r.bezahltAnArzt ? "" : "disabled"} title="Zahlungsdatum">
        </div>
        <div class="f" style="flex:1">
          <label class="chk"><input type="checkbox" data-rfield="eingereichtBeihilfe" ${r.eingereichtBeihilfe ? "checked" : ""}> <b>Bei Beihilfe eingereicht</b></label>
          <input type="date" data-rfield="eingereichtBeihilfeDatum" value="${esc(r.eingereichtBeihilfeDatum || "")}" ${r.eingereichtBeihilfe ? "" : "disabled"} title="Einreichdatum Beihilfe">
        </div>
        <div class="f" style="flex:1">
          <label class="chk"><input type="checkbox" data-rfield="eingereichtPKV" ${r.eingereichtPKV ? "checked" : ""}> <b>Bei PKV eingereicht</b></label>
          <input type="date" data-rfield="eingereichtPKVDatum" value="${esc(r.eingereichtPKVDatum || "")}" ${r.eingereichtPKV ? "" : "disabled"} title="Einreichdatum PKV">
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Rechnungspositionen</h2>
      <p class="panel-sub">„Ist B/PKV“ optional je Position ausfüllen, um Deltas genau zu verorten. Erwartungswerte ergeben sich aus Beihilfesatz (${p ? p.beihilfesatz : "?"} %) und den aktiven Vertragsbausteinen.</p>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Datum</th><th>Ziffer</th><th>Beschreibung</th><th>Kategorie</th>
          <th class="num">Betrag</th><th title="beihilfefähig">Beih.-fähig</th><th title="PKV-erstattungsfähig">PKV-fähig</th>
          <th class="num">Erwartet B</th><th class="num">Erwartet PKV</th>
          <th class="num">Ist B</th><th class="num">Ist PKV</th><th class="num">Delta</th>
          <th>🔖</th><th>Notiz</th><th></th>
        </tr></thead>
        <tbody>${posRows || `<tr><td colspan="15" class="muted">Noch keine Positionen – Rechnung aus dem Beleg abtippen (je Zeile eine Leistung).</td></tr>`}</tbody>
        <tfoot><tr>
          <td colspan="4">Summe</td>
          <td class="num">${fmtEUR(a.sumBetrag)}</td><td></td><td></td>
          <td class="num">${fmtEUR(a.erwBeihilfe)}</td>
          <td class="num">${fmtEUR(a.erwPKV)}</td>
          <td colspan="6"></td>
        </tr></tfoot>
      </table></div>
      <div class="toolbar"><button data-action="pos-neu">+ Position</button></div>
    </div>

    <div class="panel">
      <h2>Erhaltene Erstattungen</h2>
      <p class="panel-sub">Auszahlungen laut Beihilfebescheid und PKV-Leistungsabrechnung eintragen.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Quelle</th><th>Datum</th><th class="num">Betrag</th><th>Bemerkung</th><th></th></tr></thead>
        <tbody>${erstRows || `<tr><td colspan="5" class="muted">Noch keine Erstattungen erfasst.</td></tr>`}</tbody>
      </table></div>
      <div class="toolbar">
        <button data-action="erst-neu" data-quelle="beihilfe">+ Beihilfe-Zahlung</button>
        <button data-action="erst-neu" data-quelle="pkv">+ PKV-Zahlung</button>
      </div>
    </div>

    <div class="panel">
      <h2>Soll-Ist-Vergleich</h2>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th class="num">Erwartet (Soll)</th><th class="num">Erhalten (Ist)</th><th class="num">Delta</th></tr></thead>
        <tbody>
          <tr><td><b>Beihilfe</b> (${esc(landName(store.settings.bundesland))}, Satz ${p ? p.beihilfesatz : "?"} %)
            ${a.kdpAbzug > EPS ? `<div class="small muted">${fmtEUR(a.erwBeihilfeBrutto)} abzgl. Kostendämpfungspauschale ${fmtEUR(a.kdpAbzug)}</div>` : ""}</td>
            <td class="num">${fmtEUR(a.erwBeihilfe)}</td><td class="num">${fmtEUR(a.istBeihilfe)}</td>
            <td class="num ${a.deltaBeihilfe > EPS ? "pos-neg" : "pos-ok"}">${fmtEUR(a.deltaBeihilfe)}</td></tr>
          <tr><td><b>Private Krankenversicherung</b>${p && vertragById(p.vertragId) ? " (" + esc(vertragById(p.vertragId).name) + ")" : ""}
            ${a.sbAbzug > EPS ? `<div class="small muted">${fmtEUR(a.erwPKVBrutto)} abzgl. Selbstbehalt ${fmtEUR(a.sbAbzug)}</div>` : ""}</td>
            <td class="num">${fmtEUR(a.erwPKV)}</td><td class="num">${fmtEUR(a.istPKV)}</td>
            <td class="num ${a.deltaPKV > EPS ? "pos-neg" : "pos-ok"}">${fmtEUR(a.deltaPKV)}</td></tr>
          <tr><td><b>Erwarteter Eigenanteil</b></td>
            <td class="num">${fmtEUR(a.eigenanteil)}</td><td class="num muted">–</td><td class="num muted">–</td></tr>
        </tbody>
        <tfoot><tr><td>Gesamt (Rechnungsbetrag ${fmtEUR(a.sumBetrag)})</td>
          <td class="num">${fmtEUR(a.erwBeihilfe + a.erwPKV)}</td>
          <td class="num">${fmtEUR(a.istBeihilfe + a.istPKV)}</td>
          <td class="num ${a.deltaBeihilfe + a.deltaPKV > EPS ? "pos-neg" : "pos-ok"}">${fmtEUR(a.deltaBeihilfe + a.deltaPKV)}</td></tr></tfoot>
      </table></div>
      <div class="progress" title="Erstattungsquote"><div class="${quote >= 99.9 ? "p-full" : ""}" style="width:${quote}%"></div></div>
      <div class="small muted" style="margin-top:4px">${quote.toFixed(0)} % des Rechnungsbetrags erstattet.</div>
      ${a.deltaBeihilfe > EPS ? `<div class="warnbox">▲ Von der <b>Beihilfe</b> fehlen noch <b>${fmtEUR(a.deltaBeihilfe)}</b> gegenüber der Erwartung${r.eingereichtBeihilfe ? "" : " – Rechnung ist noch nicht als bei der Beihilfe eingereicht markiert"}.</div>` : ""}
      ${a.deltaPKV > EPS ? `<div class="warnbox">▲ Von der <b>PKV</b> fehlen noch <b>${fmtEUR(a.deltaPKV)}</b> gegenüber der Erwartung${r.eingereichtPKV ? "" : " – Rechnung ist noch nicht als bei der PKV eingereicht markiert"}.</div>` : ""}
      ${(() => {
        /* Überzahlung je Quelle melden – auch wenn die andere Quelle noch
           offen ist und der Gesamtstatus deshalb „Erstattung fehlt“ lautet. */
        const ueber = [];
        if (a.deltaBeihilfe < -EPS) ueber.push(`Beihilfe ${fmtEUR(-a.deltaBeihilfe)}`);
        if (a.deltaPKV < -EPS) ueber.push(`PKV ${fmtEUR(-a.deltaPKV)}`);
        return ueber.length
          ? `<div class="hint">Es wurde <b>mehr erstattet als erwartet</b> (${ueber.join(", ")}) – prüfe, ob Beihilfesatz, Vertragsbausteine und Jahres-Eigenbehalte korrekt hinterlegt sind.</div>`
          : "";
      })()}
      ${a.hinweise.map(h => `<div class="warnbox">${esc(h)}</div>`).join("")}
      ${fristen.map(f => `<div class="${f.stufe === "bad" ? "warnbox fristbox-bad" : "warnbox"}">${esc(f.text)}</div>`).join("")}
      ${bagatell && !bagatell.erreicht ? `<div class="hint">Noch nicht bei der Beihilfe eingereicht: ${bagatell.anzahl} Rechnung(en) mit zusammen <b>${fmtEUR(bagatell.summe)}</b> beihilfefähigen Aufwendungen. Bis zur Bagatellgrenze von ${fmtEUR(bagatell.grenze)} fehlen noch <b>${fmtEUR(bagatell.fehlt)}</b> – so lange lohnt ein Antrag in der Regel nicht.</div>` : ""}
      ${bagatell && bagatell.erreicht ? `<div class="hint">Einreichgrenze erreicht: ${bagatell.anzahl} noch nicht eingereichte Rechnung(en) mit <b>${fmtEUR(bagatell.summe)}</b> – ein Beihilfeantrag lohnt sich jetzt.</div>` : ""}
      <div class="small muted" style="margin-top:8px">Hinweis: Erwartungswerte sind eine Plausibilitätsrechnung (Satz × Betrag). Beihilfe/PKV können nach Gebührenordnung (GOÄ/GOZ), Höchstbeträgen oder Eigenbehalten (z. B. Kostendämpfungspauschale) abweichend kürzen – solche Kürzungen als Bemerkung bei der Erstattung dokumentieren.</div>
    </div>

    <div class="panel">
      <h2>Beleg / Anhänge</h2>
      <p class="panel-sub">Original-Rechnung (PDF oder Foto) hereinladen – wird lokal im Browser gespeichert.</p>
      <input type="file" id="anhang-file" accept="application/pdf,image/*" multiple>
      <ul class="attach-list" id="anhang-liste">
        ${(r.anhaenge || []).map(x => `<li><a href="#" data-action="anhang-open" data-id="${x.id}">${esc(x.name)}</a>
          <span class="muted small">${x.size ? (x.size / 1024).toFixed(0) + " kB" : ""}</span>
          <button class="small danger" data-action="anhang-del" data-id="${x.id}">✕</button></li>`).join("")}
      </ul>
    </div>

    <div class="panel">
      <h2>Notiz zur Rechnung</h2>
      <textarea data-rfield="notiz" placeholder="z. B. Widerspruch eingelegt am …">${esc(r.notiz || "")}</textarea>
    </div>`;
}

function afterRechnungRender(id) {
  const r = rechnungById(id);
  if (!r) return;
  const fileInput = $("#anhang-file");
  if (fileInput) fileInput.addEventListener("change", async e => {
    for (const f of e.target.files) {
      const attId = uid();
      try {
        await idb.put({ id: attId, name: f.name, type: f.type, blob: f });
        (r.anhaenge = r.anhaenge || []).push({ id: attId, name: f.name, type: f.type, size: f.size });
      } catch (err) { toast("Anhang konnte nicht gespeichert werden: " + err.message); }
    }
    save(); route();
    toast("Anhang gespeichert.");
  });
}

/* ------------------------------ Ansicht: Einstellungen ------------------------------ */

function viewEinstellungen() {
  const land = BUNDESLAENDER.find(b => b.id === store.settings.bundesland);
  return `
    <div class="page-head"><div>
      <h1>Einstellungen</h1>
      <p class="sub">Beihilfe-Träger, Datensicherung.</p>
    </div></div>
    <div class="panel">
      <h2>Beihilfe</h2>
      <label class="f" style="max-width:420px"><span>Bundesland / Dienstherr</span>
        <select id="set-bundesland">
          ${BUNDESLAENDER.map(b => `<option value="${b.id}" ${b.id === store.settings.bundesland ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
        </select>
      </label>
      <div class="hint" id="land-hinweis">${esc(land ? land.hinweis : "")}</div>
      <div class="small muted">Die Hinweise sind unverbindliche Orientierung. Der tatsächliche Beihilfesatz sowie Kostendämpfungspauschale und Selbstbehalt werden pro Person unter „Personen“ eingestellt.</div>
    </div>
    <div class="panel">
      <h2>Fristen und Grenzwerte</h2>
      <p class="panel-sub">Steuern Warnungen und den Sammelstand. Die Vorgaben orientieren sich am Bund – bitte an deinen Dienstherrn anpassen.</p>
      <div class="frow">
        <label class="f"><span>Bagatellgrenze Beihilfeantrag in € (0 = aus)</span>
          <input type="text" data-setting="bagatellgrenze" value="${fmtBetragInput(store.settings.bagatellgrenze || 0)}">
        </label>
        <label class="f"><span>Antragsfrist in Monaten ab Rechnungsdatum</span>
          <input type="number" min="0" step="1" data-setting="antragsfristMonate" value="${store.settings.antragsfristMonate || 0}">
        </label>
        <label class="f"><span>Widerspruchsfrist in Tagen ab Bescheid</span>
          <input type="number" min="0" step="1" data-setting="widerspruchsfristTage" value="${store.settings.widerspruchsfristTage || 0}">
        </label>
        <label class="f"><span>Nachhaken nach … Tagen ohne Erstattung</span>
          <input type="number" min="0" step="1" data-setting="nachfrageTage" value="${store.settings.nachfrageTage || 0}">
        </label>
      </div>
      <div class="hint small">
        <b>Bagatellgrenze:</b> Die Beihilfe zahlt vielerorts erst ab dieser Summe an Aufwendungen. Die App zeigt dann je Person, wie viel bis zur lohnenden Einreichung noch fehlt, statt jede Einzelrechnung anzumahnen.<br>
        <b>Antragsfrist:</b> Beim Bund ein Jahr ab Rechnungsdatum – wird sie versäumt, verfällt die Beihilfe vollständig. Die Länder weichen ab.
      </div>
    </div>
    <div class="panel">
      <h2>Datensicherung</h2>
      <p class="small muted mt0">Alle Daten liegen ausschließlich lokal in diesem Browser. Für Backups oder Gerätewechsel exportieren.</p>
      <div class="toolbar">
        <button data-action="export-json">⬇ Export (nur Daten)</button>
        <button data-action="export-full">⬇ Export inkl. Anhänge</button>
        <label class="btn" style="display:inline-block">
          ⬆ Import … <input type="file" id="import-file" accept="application/json" hidden>
        </label>
      </div>
    </div>
    <div class="panel">
      <h2>Zurücksetzen</h2>
      <button class="danger" data-action="reset-all">Alle Daten unwiderruflich löschen</button>
    </div>`;
}

/* ------------------------------ Export / Import ------------------------------ */

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function exportFull() {
  toast("Anhänge werden eingesammelt …");
  const files = await idb.all();
  const attachments = [];
  for (const f of files) {
    const b64 = await new Promise((res, rej) => {
      const rd = new FileReader();
      rd.onload = () => res(rd.result.split(",")[1]);
      rd.onerror = () => rej(rd.error);
      rd.readAsDataURL(f.blob);
    });
    attachments.push({ id: f.id, name: f.name, type: f.type, dataB64: b64 });
  }
  downloadJSON({ format: "kvpruefer-backup", version: 1, store, attachments },
    `kvpruefer-backup-${todayISO()}.json`);
}

async function importJSON(file) {
  try {
    const data = JSON.parse(await file.text());
    const neu = data.format === "kvpruefer-backup" ? data.store : data;
    if (!neu || !Array.isArray(neu.persons) || !Array.isArray(neu.rechnungen))
      throw new Error("Unbekanntes Dateiformat.");
    if (!confirm("Import ersetzt alle vorhandenen Daten. Fortfahren?")) return;
    store = Object.assign(defaultStore(), neu);
    save();
    if (Array.isArray(data.attachments)) {
      for (const att of data.attachments) {
        const bin = atob(att.dataB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await idb.put({ id: att.id, name: att.name, type: att.type, blob: new Blob([bytes], { type: att.type }) });
      }
    }
    route();
    toast("Import erfolgreich.");
  } catch (e) {
    toast("Import fehlgeschlagen: " + e.message);
  }
}

/* ------------------------------ Modal-Helfer ------------------------------ */

function openModal(inner) {
  $("#modal-root").innerHTML = `<div class="modal-overlay" data-action="modal-overlay"><div class="modal">${inner}</div></div>`;
}
function closeModal() { $("#modal-root").innerHTML = ""; }

/* ------------------------------ Globale Event-Handler ------------------------------ */

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  /* Modal schließen bei Klick auf Overlay (nicht auf Inhalt) */
  if (action === "modal-overlay") { if (e.target === el) closeModal(); return; }
  if (action === "modal-close") { closeModal(); return; }

  const hashId = () => location.hash.split("/")[2];

  switch (action) {
    case "open-rechnung": location.hash = "#/rechnung/" + id; break;

    /* Personen */
    case "person-neu":
      if (store.persons.length >= MAX_PERSONEN) { toast(`Maximal ${MAX_PERSONEN} Personen möglich.`); break; }
      personModal(null); break;
    case "person-edit": personModal(personById(id)); break;
    case "person-del": {
      const p = personById(id);
      const n = store.rechnungen.filter(r => r.personId === id).length;
      if (!confirm(`„${p.name}“ löschen?${n ? ` ${n} zugeordnete Rechnung(en) bleiben erhalten, verlieren aber die Person.` : ""}`)) break;
      store.persons = store.persons.filter(x => x.id !== id);
      save(); route(); toast("Person gelöscht.");
      break;
    }

    /* Verträge & Bausteine */
    case "vertrag-neu": vertragModal(null); break;
    case "vertrag-edit": vertragModal(vertragById(id)); break;
    case "vertrag-del": {
      const v = vertragById(id);
      const nutzer = store.persons.filter(p => p.vertragId === id);
      if (!confirm(`Vertrag „${v.name}“ löschen?${nutzer.length ? ` Er ist ${nutzer.length} Person(en) zugeordnet.` : ""}`)) break;
      store.vertraege = store.vertraege.filter(x => x.id !== id);
      for (const p of nutzer) p.vertragId = "";
      save(); route(); toast("Vertrag gelöscht.");
      break;
    }
    case "baustein-neu": bausteinModal(vertragById(el.dataset.vertrag), null); break;
    case "baustein-edit": {
      const v = vertragById(el.dataset.vertrag);
      bausteinModal(v, (v.bausteine || []).find(b => b.id === id));
      break;
    }
    case "baustein-del": {
      const v = vertragById(el.dataset.vertrag);
      const b = (v.bausteine || []).find(x => x.id === id);
      if (!confirm(`Baustein „${b.name}“ löschen?`)) break;
      v.bausteine = v.bausteine.filter(x => x.id !== id);
      save(); route(); toast("Baustein gelöscht.");
      break;
    }
    case "baustein-vorlage": bausteinVorlagen(vertragById(el.dataset.vertrag)); break;

    /* Rechnungen */
    case "rechnung-neu": rechnungNeu(); break;
    case "rechnung-del": {
      const r = rechnungById(id);
      if (!confirm("Diese Rechnung mit allen Positionen, Erstattungen und Anhängen löschen?")) break;
      for (const att of r.anhaenge || []) { try { await idb.del(att.id); } catch (_) {} }
      store.rechnungen = store.rechnungen.filter(x => x.id !== id);
      save(); location.hash = "#/rechnungen"; toast("Rechnung gelöscht.");
      break;
    }
    case "pos-neu": {
      const r = rechnungById(hashId());
      r.positionen.push({
        id: uid(), datum: r.datum, ziffer: "", beschreibung: "",
        kategorie: "ambulant", betrag: 0, beihilfefaehig: true, pkvFaehig: true,
        istBeihilfe: null, istPKV: null, markiert: false, notiz: "",
      });
      save(); route();
      break;
    }
    case "pos-del": {
      const r = rechnungById(hashId());
      r.positionen = r.positionen.filter(x => x.id !== id);
      save(); route();
      break;
    }
    case "erst-neu": {
      const r = rechnungById(hashId());
      r.erstattungen.push({ id: uid(), quelle: el.dataset.quelle || "beihilfe", datum: todayISO(), betrag: 0, bemerkung: "" });
      save(); route();
      break;
    }
    case "erst-del": {
      const r = rechnungById(hashId());
      r.erstattungen = r.erstattungen.filter(x => x.id !== id);
      save(); route();
      break;
    }
    case "anhang-open": {
      e.preventDefault();
      try {
        const f = await idb.get(id);
        if (!f) { toast("Anhang nicht gefunden."); break; }
        const url = URL.createObjectURL(f.blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (err) { toast("Anhang konnte nicht geöffnet werden: " + err.message); }
      break;
    }
    case "anhang-del": {
      const r = rechnungById(hashId());
      if (!confirm("Anhang löschen?")) break;
      try { await idb.del(id); } catch (_) {}
      r.anhaenge = (r.anhaenge || []).filter(x => x.id !== id);
      save(); route();
      break;
    }

    /* Vertragsbaustein-Schnellschalter in der Vertragsliste */
    case "baustein-aktiv": {
      const v = vertragById(el.dataset.vertrag);
      const b = (v.bausteine || []).find(x => x.id === id);
      b.aktiv = el.checked;
      save(); route();
      break;
    }

    /* Einstellungen */
    case "export-json": downloadJSON({ format: "kvpruefer-backup", version: 1, store }, `kvpruefer-daten-${todayISO()}.json`); break;
    case "export-full": exportFull(); break;
    case "reset-all":
      if (!confirm("Wirklich ALLE Daten (Personen, Verträge, Rechnungen, Anhänge) löschen?")) break;
      if (!confirm("Letzte Warnung – das kann nicht rückgängig gemacht werden. Fortfahren?")) break;
      store = defaultStore(); save();
      try { await idb.clear(); } catch (_) {}
      route(); toast("Alle Daten gelöscht.");
      break;
  }
});

/* Inline-Änderungen (Rechnung-Detail, Filter, Einstellungen) */
document.addEventListener("change", e => {
  const el = e.target;

  /* Filter in der Rechnungsliste */
  if (el.id === "filter-person") { viewRechnungen._filterPerson = el.value; route(); return; }
  if (el.id === "filter-status") { viewRechnungen._filterStatus = el.value; route(); return; }

  /* Bundesland */
  if (el.id === "set-bundesland") {
    store.settings.bundesland = el.value;
    save();
    const land = BUNDESLAENDER.find(b => b.id === el.value);
    const h = $("#land-hinweis");
    if (h && land) h.textContent = land.hinweis;
    toast("Bundesland gespeichert: " + (land ? land.name : el.value));
    return;
  }

  /* Fristen und Grenzwerte */
  if (el.dataset.setting) {
    const f = el.dataset.setting;
    store.settings[f] = f === "bagatellgrenze"
      ? Math.max(0, parseBetrag(el.value))
      : Math.max(0, parseInt(el.value, 10) || 0);
    save(); toast("Einstellung gespeichert.");
    return;
  }

  /* Import */
  if (el.id === "import-file") { if (el.files[0]) importJSON(el.files[0]); el.value = ""; return; }

  /* Rechnungs-Kopffelder */
  if (el.dataset.rfield) {
    const r = rechnungById(location.hash.split("/")[2]);
    if (!r) return;
    const f = el.dataset.rfield;
    if (el.type === "checkbox") {
      r[f] = el.checked;
      /* Datum automatisch setzen/leeren */
      const datumFeld = { bezahltAnArzt: "bezahltDatum", eingereichtBeihilfe: "eingereichtBeihilfeDatum", eingereichtPKV: "eingereichtPKVDatum" }[f];
      if (datumFeld) r[datumFeld] = el.checked ? (r[datumFeld] || todayISO()) : "";
    } else {
      r[f] = el.value;
    }
    save(); route();
    return;
  }

  /* Rechnungspositionen */
  if (el.dataset.pos) {
    const r = rechnungById(location.hash.split("/")[2]);
    if (!r) return;
    const pos = r.positionen.find(x => x.id === el.dataset.pos);
    if (!pos) return;
    const f = el.dataset.field;
    if (el.type === "checkbox") pos[f] = el.checked;
    else if (f === "betrag") pos[f] = parseBetrag(el.value);
    else if (f === "istBeihilfe" || f === "istPKV") pos[f] = el.value.trim() === "" ? null : parseBetrag(el.value);
    else pos[f] = el.value;
    save(); route();
    return;
  }

  /* Erstattungen */
  if (el.dataset.erst) {
    const r = rechnungById(location.hash.split("/")[2]);
    if (!r) return;
    const erst = r.erstattungen.find(x => x.id === el.dataset.erst);
    if (!erst) return;
    const f = el.dataset.field;
    erst[f] = f === "betrag" ? parseBetrag(el.value) : el.value;
    save(); route();
    return;
  }
});

/* Import-Button (label) klickt verstecktes File-Input */
document.addEventListener("click", e => {
  const label = e.target.closest("label.btn");
  if (label && label.querySelector("#import-file") && e.target !== label.querySelector("#import-file"))
    label.querySelector("#import-file").click();
});

/* Escape schließt Modal */
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ------------------------------ Start ------------------------------ */
route();
