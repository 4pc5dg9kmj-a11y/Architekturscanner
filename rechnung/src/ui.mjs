/* Bedienoberflaeche der Rechnungs-App (laeuft nur im Browser). */

import {
  baueRechnungPdf, dateiname, formatEuro, heuteIso, isoDatum, leereRechnung,
  naechteZwischen, normalisiere, parseBetrag, formatDatum,
} from './invoice.mjs';
import { zeichneSeite } from './pdf.mjs';
import { standardPosition } from './positionen.mjs';
import { analysiereText } from './parse.mjs';

const SPEICHER = {
  profil: 'rechnung.profil',
  kunden: 'rechnung.kunden',
  entwurf: 'rechnung.entwurf',
  historie: 'rechnung.historie',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let daten = leereRechnung();
let bilder = [];
let naechteManuell = false;
let zeichnenTimer = null;

/* ------------------------------------------------------------- Speicher */

function lade(schluessel, vorgabe) {
  try {
    const roh = localStorage.getItem(schluessel);
    return roh ? JSON.parse(roh) : vorgabe;
  } catch { return vorgabe; }
}

function speichere(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch { /* Kontingent */ }
}

/* ----------------------------------------------------------------- Hilfen */

function melde(text) {
  const el = $('#meldung');
  el.textContent = text;
  el.classList.add('auf');
  clearTimeout(melde._t);
  melde._t = setTimeout(() => el.classList.remove('auf'), 2200);
}

function hole(objekt, pfad) {
  return pfad.split('.').reduce((o, teil) => (o == null ? o : o[teil]), objekt);
}

function setze(objekt, pfad, wert) {
  const teile = pfad.split('.');
  const letzt = teile.pop();
  let ziel = objekt;
  for (const teil of teile) {
    if (typeof ziel[teil] !== 'object' || ziel[teil] === null) ziel[teil] = {};
    ziel = ziel[teil];
  }
  ziel[letzt] = wert;
}

const ZAHLENFELDER = new Set([
  'rechnung.naechte', 'rechnung.gaeste', 'rechnung.zahlungsziel', 'vermieter.ustSatz',
]);

function leseFeld(el) {
  const pfad = el.dataset.pfad;
  if (el.type === 'checkbox') return el.checked;
  if (pfad === 'vermieter.preiseInklUst') return el.value === 'true';
  if (pfad === 'intern.kommission') return el.value ? parseBetrag(el.value) : null;
  if (ZAHLENFELDER.has(pfad)) return el.value === '' ? 0 : Number(el.value);
  return el.value;
}

function schreibeFelder() {
  for (const el of $$('[data-pfad]')) {
    const wert = hole(daten, el.dataset.pfad);
    if (el.type === 'checkbox') el.checked = Boolean(wert);
    else if (el.dataset.pfad === 'vermieter.preiseInklUst') el.value = wert === false ? 'false' : 'true';
    else if (el.dataset.pfad === 'intern.kommission') el.value = wert == null || wert === '' ? '' : String(wert).replace('.', ',');
    else el.value = wert == null ? '' : String(wert);
  }
  $('#ustFelder').style.display = daten.vermieter.kleinunternehmer ? 'none' : '';
}

/* -------------------------------------------------------------- Positionen */

const VORLAGEN = {
  reinigung: { titel: 'Endreinigung', details: [], menge: 1, einheit: 'Pauschale', einzelpreis: 0 },
  kurtaxe: { titel: 'Kurtaxe / Gästebeitrag', details: [], menge: 1, einheit: 'Person/Nacht', einzelpreis: 0 },
  fruehstueck: { titel: 'Frühstück', details: [], menge: 1, einheit: 'Person', einzelpreis: 0 },
  parkplatz: { titel: 'Stellplatz', details: [], menge: 1, einheit: 'Nacht', einzelpreis: 0 },
  leer: { titel: '', details: [], menge: 1, einheit: '', einzelpreis: 0 },
};

function zeichnePositionen() {
  const box = $('#positionen');
  box.innerHTML = '';
  daten.positionen.forEach((position, index) => {
    const el = document.createElement('div');
    el.className = 'position';
    el.innerHTML = `
      <div class="kopfzeile">
        <span class="nr">${index + 1}</span>
        <strong style="font-size:13px;color:var(--grau)">Position</strong>
        <span class="zeilensumme" data-summe>${formatEuro(position.menge * position.einzelpreis)}</span>
        <button class="weg" data-weg title="Position entfernen">Entfernen</button>
      </div>
      <div class="feld"><label>Bezeichnung</label>
        <input data-feld="titel" value="${escape(position.titel)}" placeholder="Übernachtung im Wohlfühlapartment"></div>
      <div class="feld"><label>Details (eine Zeile je Angabe)</label>
        <textarea data-feld="details" rows="3" placeholder="Guxhagen (Zeitraum: …)&#10;1 Übernachtung&#10;Buchungsnr.: …">${escape((position.details || []).join('\n'))}</textarea></div>
      <div class="reihe z3">
        <div class="feld"><label>Menge</label><input data-feld="menge" inputmode="decimal" value="${escape(String(position.menge).replace('.', ','))}"></div>
        <div class="feld"><label>Einheit</label><input data-feld="einheit" value="${escape(position.einheit || '')}" placeholder="Nächte"></div>
        <div class="feld"><label>Einzelpreis (€)</label><input data-feld="einzelpreis" inputmode="decimal" value="${escape(preisText(position.einzelpreis))}"></div>
      </div>`;

    el.querySelector('[data-weg]').addEventListener('click', () => {
      daten.positionen.splice(index, 1);
      zeichnePositionen();
      aktualisiere();
    });

    for (const feld of el.querySelectorAll('[data-feld]')) {
      feld.addEventListener('input', () => {
        const name = feld.dataset.feld;
        if (name === 'details') position.details = feld.value.split('\n').map((z) => z.trim()).filter(Boolean);
        else if (name === 'menge' || name === 'einzelpreis') position[name] = parseBetrag(feld.value);
        else position[name] = feld.value;
        el.querySelector('[data-summe]').textContent = formatEuro(position.menge * position.einzelpreis);
        aktualisiere();
      });
    }
    box.appendChild(el);
  });
}

function preisText(wert) {
  const zahl = Number(wert) || 0;
  const gerundet = Math.round(zahl * 100) / 100;
  return String(Math.abs(zahl - gerundet) < 0.0001 ? gerundet.toFixed(2) : zahl).replace('.', ',');
}

function escape(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* ------------------------------------------------------------- Vorschau/PDF */

function baueModell() {
  return normalisiere(daten);
}

function aktualisiere({ sofort = false } = {}) {
  const modell = baueModell();
  $('#kopfSumme').textContent = formatEuro(modell.summen.gesamt);
  $('#fussSumme').childNodes[0].nodeValue = formatEuro(modell.summen.gesamt);
  $('#fussDetail').textContent = modell.rechnung.bezahlt
    ? 'Bereits bezahlt'
    : modell.faelligkeit ? `Fällig am ${formatDatum(modell.faelligkeit)}` : 'Gesamt zu zahlen';

  const kommission = parseBetrag(daten.intern.kommission);
  $('#auszahlung').textContent = kommission
    ? `Auszahlung nach Kommission: ${formatEuro(modell.summen.gesamt - kommission)} (Kommission ${formatEuro(kommission)}).`
    : '';

  speichere(SPEICHER.entwurf, daten);
  speichere(SPEICHER.profil, daten.vermieter);

  clearTimeout(zeichnenTimer);
  zeichnenTimer = setTimeout(() => zeichneVorschau(modell), sofort ? 0 : 250);
}

function pdfBlob(modell) {
  return new Blob([baueRechnungPdf(modell)], { type: 'application/pdf' });
}

function zeichneVorschau(modell) {
  const leer = !modell.zeilen.length;
  const blaetter = $('#blaetter');
  $('#vorschauLeer').hidden = !leer;
  blaetter.style.display = leer ? 'none' : '';
  $('#vorschauInfo').textContent = leer
    ? 'Live-Vorschau'
    : `Live-Vorschau · ${modell.rechnung.nummer || 'ohne Nummer'}`;
  if (leer) return;

  try {
    // Dieselben Zeichenbefehle wie im PDF – nur auf den Bildschirm.
    const doc = baueRechnungPdf(modell, { alsDokument: true });
    const breite = Math.max(240, blaetter.clientWidth - 28);
    const skala = Math.min(1.6, breite / doc.width);
    const dichte = Math.min(2, window.devicePixelRatio || 1);
    blaetter.innerHTML = '';
    for (let seite = 0; seite < doc.pageCount; seite += 1) {
      const leinwand = document.createElement('canvas');
      leinwand.setAttribute('role', 'img');
      leinwand.setAttribute('aria-label', `Rechnung Seite ${seite + 1}`);
      blaetter.appendChild(leinwand);
      zeichneSeite(doc, seite, leinwand, { skala, dichte });
    }
  } catch (fehler) {
    melde(`Vorschau fehlgeschlagen: ${fehler.message}`);
  }
}

async function herunterladen() {
  const modell = baueModell();
  if (!modell.zeilen.length) { melde('Bitte zuerst eine Position anlegen.'); return; }
  const name = dateiname(modell);
  const ergebnis = await ueberClaudeSpeichern(baueRechnungPdf(modell), name);
  if (ergebnis === 'abgebrochen') return;
  if (ergebnis === 'nicht-verfuegbar') {
    const url = URL.createObjectURL(pdfBlob(modell));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  merkeHistorie(modell);
  melde('PDF gespeichert.');
}

/* In der Claude-Vorschau darf die Seite den Download nicht selbst starten –
 * dort uebernimmt das die Speichern-Funktion der Umgebung. Ueberall sonst
 * greift der normale Browser-Download. */
async function ueberClaudeSpeichern(bytes, name) {
  try {
    const speichern = await window.claude?.use?.('downloads');
    if (!speichern) return 'nicht-verfuegbar';
    await speichern.save({ filename: name, data: bytes });
    return 'gespeichert';
  } catch (fehler) {
    if (fehler && fehler.code === 'declined') { melde('Speichern abgebrochen.'); return 'abgebrochen'; }
    return 'nicht-verfuegbar';
  }
}

function drucken() {
  const modell = baueModell();
  if (!modell.zeilen.length) { melde('Bitte zuerst eine Position anlegen.'); return; }
  const url = URL.createObjectURL(pdfBlob(modell));
  const fenster = window.open(url, '_blank');
  if (!fenster) melde('Bitte Pop-ups erlauben.');
}

/* ---------------------------------------------------------------- Historie */

function merkeHistorie(modell) {
  const historie = lade(SPEICHER.historie, []);
  const eintrag = {
    nummer: modell.rechnung.nummer,
    datum: modell.rechnung.datum,
    empfaenger: modell.gast.firma || modell.gast.name,
    betrag: modell.summen.gesamt,
    daten,
  };
  const vorhanden = historie.findIndex((h) => h.nummer && h.nummer === eintrag.nummer);
  if (vorhanden >= 0) historie[vorhanden] = eintrag; else historie.unshift(eintrag);
  speichere(SPEICHER.historie, historie.slice(0, 60));
  zeichneHistorie();
}

function zeichneHistorie() {
  const historie = lade(SPEICHER.historie, []);
  const box = $('#historie');
  if (!historie.length) { box.innerHTML = '<p class="hinweis">Noch keine Rechnung gespeichert.</p>'; return; }
  box.innerHTML = '';
  historie.forEach((eintrag, index) => {
    const zeile = document.createElement('div');
    zeile.className = 'position';
    zeile.style.padding = '10px 12px';
    zeile.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <strong>${escape(eintrag.nummer || '—')}</strong>
        <span style="color:var(--grau)">${escape(eintrag.empfaenger || '')}</span>
        <span style="margin-left:auto;font-weight:700">${formatEuro(eintrag.betrag)}</span>
        <button class="knopf klein leise" style="background:var(--gruen-hell);color:var(--gruen)" data-laden>Laden</button>
      </div>`;
    zeile.querySelector('[data-laden]').addEventListener('click', () => {
      daten = normalisierenEingang(historie[index].daten);
      naechteManuell = true;
      schreibeFelder();
      zeichnePositionen();
      aktualisiere({ sofort: true });
      melde(`Rechnung ${eintrag.nummer} geladen.`);
    });
    box.appendChild(zeile);
  });
}

function naechsteNummer() {
  const historie = lade(SPEICHER.historie, []);
  const jahr = new Date().getFullYear();
  const nummern = historie
    .map((h) => String(h.nummer || '').match(new RegExp(`^${jahr}-(\\d+)$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const naechste = (nummern.length ? Math.max(...nummern) : 0) + 1;
  return `${jahr}-${String(naechste).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------ Kunden */

function zeichneKunden() {
  const kunden = lade(SPEICHER.kunden, []);
  const wahl = $('#kundenwahl');
  wahl.innerHTML = '<option value="">– auswählen –</option>';
  kunden.forEach((kunde, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = [kunde.firma, kunde.name, kunde.ort].filter(Boolean).join(' · ');
    wahl.appendChild(option);
  });
}

/* ------------------------------------------------------------------ Import */

function normalisierenEingang(eingang) {
  const basis = leereRechnung();
  const profil = lade(SPEICHER.profil, null);
  return {
    vermieter: { ...basis.vermieter, ...(profil || {}), ...(eingang.vermieter || {}) },
    gast: { ...basis.gast, ...(eingang.gast || {}) },
    rechnung: { ...basis.rechnung, ...(eingang.rechnung || {}) },
    positionen: Array.isArray(eingang.positionen) ? eingang.positionen.map((p) => ({
      auto: Boolean(p.auto),
      titel: p.titel || '',
      details: Array.isArray(p.details) ? p.details : (p.details ? [String(p.details)] : []),
      menge: Number(p.menge) || 0,
      einheit: p.einheit || '',
      einzelpreis: parseBetrag(p.einzelpreis),
    })) : [],
    intern: { ...basis.intern, ...(eingang.intern || {}) },
  };
}

function uebernehmen(teil, { ersetzen = false } = {}) {
  const neu = normalisierenEingang({
    vermieter: { ...daten.vermieter, ...(teil.vermieter || {}) },
    gast: ersetzen ? (teil.gast || {}) : { ...daten.gast, ...leerRaus(teil.gast) },
    rechnung: { ...daten.rechnung, ...leerRaus(teil.rechnung) },
    positionen: daten.positionen,
    intern: { ...daten.intern, ...leerRaus(teil.intern) },
  });

  if (!neu.rechnung.nummer) neu.rechnung.nummer = naechsteNummer();
  if (!neu.rechnung.datum) neu.rechnung.datum = heuteIso();
  if (!neu.rechnung.naechte) neu.rechnung.naechte = naechteZwischen(neu.rechnung.anreise, neu.rechnung.abreise);

  // Positionen: mitgelieferte gewinnen, sonst wird aus dem Gesamtpreis die
  // Uebernachtungszeile neu gebaut. Von Hand ergaenzte Zeilen bleiben erhalten.
  const gesamt = parseBetrag((teil.intern || {}).gesamtpreis);
  const vonHand = neu.positionen.filter((position) => !position.auto);
  if (teil.positionen && teil.positionen.length) {
    neu.positionen = normalisierenEingang({ positionen: teil.positionen }).positionen;
  } else if (gesamt) {
    neu.positionen = [standardPosition(neu), ...vonHand];
  }

  daten = neu;
  schreibeFelder();
  zeichnePositionen();
  aktualisiere({ sofort: true });
}

function leerRaus(objekt) {
  return Object.fromEntries(Object.entries(objekt || {})
    .filter(([, wert]) => wert !== '' && wert !== null && wert !== undefined));
}

const PROMPT = `Lies die angehängten Screenshots (Booking.com / Airbnb) und gib mir NUR dieses JSON zurück – keine Erklärung:

{
  "gast": {"firma":"","name":"","strasse":"","plz":"","ort":"","land":"","email":""},
  "rechnung": {"portal":"Booking.com","buchungsnummer":"","anreise":"JJJJ-MM-TT","abreise":"JJJJ-MM-TT","naechte":0,"gaeste":1,"hinweis":""},
  "intern": {"gesamtpreis":0,"kommission":0}
}

Regeln: "gesamtpreis" ist der Gesamtpreis der Buchung (das, was der Gast zahlt) – die Kommission wird NICHT abgezogen. Wenn der Gast in einer Nachricht eine abweichende Rechnungsanschrift nennt, nimm diese. Felder, die nicht erkennbar sind, leer lassen.`;

function kopiere(text, meldung) {
  const fertig = () => melde(meldung);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(fertig).catch(() => ersatzKopie(text, fertig));
  } else ersatzKopie(text, fertig);
}

function ersatzKopie(text, fertig) {
  const feld = document.createElement('textarea');
  feld.value = text;
  document.body.appendChild(feld);
  feld.select();
  try { document.execCommand('copy'); fertig(); } catch { melde('Kopieren nicht möglich.'); }
  feld.remove();
}

function jsonAusText(roh) {
  const text = String(roh || '').trim();
  const start = text.indexOf('{');
  const ende = text.lastIndexOf('}');
  if (start < 0 || ende < start) throw new Error('Kein JSON gefunden');
  return JSON.parse(text.slice(start, ende + 1));
}

function zeigeBilder() {
  const box = $('#bilder');
  box.innerHTML = '';
  bilder.forEach((quelle, index) => {
    const figur = document.createElement('figure');
    figur.innerHTML = `<img src="${quelle}" alt="Screenshot ${index + 1}"><button title="Entfernen">×</button>`;
    figur.querySelector('img').addEventListener('click', () => {
      $('#lupe img').src = quelle;
      $('#lupe').classList.add('auf');
    });
    figur.querySelector('button').addEventListener('click', () => {
      bilder.splice(index, 1);
      zeigeBilder();
    });
    box.appendChild(figur);
  });
}

function nimmDateien(dateien) {
  for (const datei of dateien) {
    if (!datei.type.startsWith('image/')) continue;
    const leser = new FileReader();
    leser.onload = () => { bilder.push(leser.result); zeigeBilder(); };
    leser.readAsDataURL(datei);
  }
}

/* -------------------------------------------------------------------- Start */

function bindeEreignisse() {
  document.addEventListener('input', (ereignis) => {
    const el = ereignis.target.closest('[data-pfad]');
    if (!el) return;
    setze(daten, el.dataset.pfad, leseFeld(el));
    if (el.dataset.pfad === 'rechnung.naechte') naechteManuell = true;
    if (el.dataset.pfad === 'rechnung.anreise' || el.dataset.pfad === 'rechnung.abreise') {
      if (!naechteManuell) {
        daten.rechnung.naechte = naechteZwischen(daten.rechnung.anreise, daten.rechnung.abreise);
        $('[data-pfad="rechnung.naechte"]').value = daten.rechnung.naechte || '';
      }
    }
    if (el.dataset.pfad === 'vermieter.kleinunternehmer') {
      $('#ustFelder').style.display = daten.vermieter.kleinunternehmer ? 'none' : '';
    }
    aktualisiere();
  });

  $('#btnPdf').addEventListener('click', herunterladen);
  $('#btnPdfOben').addEventListener('click', herunterladen);
  $('#btnDrucken').addEventListener('click', drucken);
  $('#btnOeffnen').addEventListener('click', drucken);

  $$('.importreiter button').forEach((knopf) => {
    knopf.addEventListener('click', () => {
      $$('.importreiter button').forEach((b) => b.classList.toggle('aktiv', b === knopf));
      $$('[data-importfeld]').forEach((feld) => {
        feld.hidden = feld.dataset.importfeld !== knopf.dataset.import;
      });
    });
  });

  $('#btnPrompt').addEventListener('click', () => kopiere(PROMPT, 'Prompt kopiert – zusammen mit den Screenshots an Claude schicken.'));
  $('#btnJson').addEventListener('click', () => {
    try {
      uebernehmen(jsonAusText($('#jsonEingabe').value), { ersetzen: true });
      melde('Daten übernommen.');
    } catch (fehler) {
      melde(`JSON nicht lesbar: ${fehler.message}`);
    }
  });
  $('#btnText').addEventListener('click', () => {
    const text = $('#textEingabe').value;
    if (!text.trim()) { melde('Bitte zuerst Text einfügen.'); return; }
    uebernehmen(analysiereText(text));
    melde('Erkannte Daten übernommen – bitte prüfen.');
  });

  $('#ablage').addEventListener('click', () => $('#dateiEingabe').click());
  $('#dateiEingabe').addEventListener('change', (e) => nimmDateien(e.target.files));
  ['dragenter', 'dragover'].forEach((typ) => $('#ablage').addEventListener(typ, (e) => {
    e.preventDefault(); $('#ablage').classList.add('hover');
  }));
  ['dragleave', 'drop'].forEach((typ) => $('#ablage').addEventListener(typ, (e) => {
    e.preventDefault(); $('#ablage').classList.remove('hover');
    if (typ === 'drop') nimmDateien(e.dataTransfer.files);
  }));
  window.addEventListener('paste', (e) => {
    const dateien = Array.from(e.clipboardData?.files || []);
    if (dateien.length) { nimmDateien(dateien); melde('Screenshot eingefügt.'); }
  });
  $('#lupe').addEventListener('click', () => $('#lupe').classList.remove('auf'));

  $$('.schnellwahl button').forEach((knopf) => knopf.addEventListener('click', () => {
    const art = knopf.dataset.vorlage;
    daten.positionen.push(art === 'uebernachtung'
      ? standardPosition(normalisiere(daten))
      : { ...VORLAGEN[art], details: [] });
    zeichnePositionen();
    aktualisiere();
  }));

  $('#btnKundeMerken').addEventListener('click', () => {
    const kunden = lade(SPEICHER.kunden, []);
    const kunde = { ...daten.gast };
    if (!kunde.firma && !kunde.name) { melde('Bitte Firma oder Name eingeben.'); return; }
    const index = kunden.findIndex((k) => k.firma === kunde.firma && k.name === kunde.name);
    if (index >= 0) kunden[index] = kunde; else kunden.push(kunde);
    speichere(SPEICHER.kunden, kunden);
    zeichneKunden();
    melde('Kunde gespeichert.');
  });
  $('#btnKundeLoeschen').addEventListener('click', () => {
    const wahl = $('#kundenwahl').value;
    if (wahl === '') { melde('Bitte zuerst einen Kunden auswählen.'); return; }
    const kunden = lade(SPEICHER.kunden, []);
    kunden.splice(Number(wahl), 1);
    speichere(SPEICHER.kunden, kunden);
    zeichneKunden();
    melde('Kunde gelöscht.');
  });
  $('#kundenwahl').addEventListener('change', (e) => {
    if (e.target.value === '') return;
    const kunde = lade(SPEICHER.kunden, [])[Number(e.target.value)];
    if (!kunde) return;
    daten.gast = { ...leereRechnung().gast, ...kunde };
    schreibeFelder();
    aktualisiere();
  });

  $('#btnJsonKopieren').addEventListener('click', () => kopiere(JSON.stringify(daten, null, 2), 'JSON kopiert.'));
  $('#btnZuruecksetzen').addEventListener('click', () => {
    const profil = lade(SPEICHER.profil, null);
    daten = leereRechnung();
    if (profil) daten.vermieter = { ...daten.vermieter, ...profil };
    daten.rechnung.nummer = naechsteNummer();
    naechteManuell = false;
    bilder = [];
    zeigeBilder();
    schreibeFelder();
    zeichnePositionen();
    aktualisiere({ sofort: true });
    melde('Neue Rechnung angelegt.');
  });

  $('#reiterDaten').addEventListener('click', () => {
    document.body.classList.remove('zeigt-vorschau');
    $('#reiterDaten').classList.add('aktiv');
    $('#reiterVorschau').classList.remove('aktiv');
  });
  $('#reiterVorschau').addEventListener('click', () => {
    document.body.classList.add('zeigt-vorschau');
    $('#reiterVorschau').classList.add('aktiv');
    $('#reiterDaten').classList.remove('aktiv');
    aktualisiere({ sofort: true });
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); herunterladen(); }
  });

  let groesseTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(groesseTimer);
    groesseTimer = setTimeout(() => aktualisiere({ sofort: true }), 200);
  });
}

/* In der Claude-Vorschau lassen sich keine neuen Fenster oeffnen – dort fuehrt
 * nur der Speichern-Weg zum Ziel. */
async function passeUmgebungAn() {
  const speichern = await window.claude?.use?.('downloads').catch(() => null);
  if (!speichern) return;
  $('#btnDrucken').hidden = true;
  $('#btnOeffnen').hidden = true;
}

function ausHash() {
  const treffer = location.hash.match(/daten=([^&]+)/);
  if (!treffer) return null;
  try {
    const text = decodeURIComponent(escapeDecode(atob(treffer[1].replace(/-/g, '+').replace(/_/g, '/'))));
    return JSON.parse(text);
  } catch { return null; }
}

function escapeDecode(binaer) {
  return Array.from(binaer, (zeichen) => `%${zeichen.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
}

export function start() {
  const profil = lade(SPEICHER.profil, null);
  const entwurf = lade(SPEICHER.entwurf, null);
  const uebergabe = ausHash();

  daten = leereRechnung();
  if (profil) daten.vermieter = { ...daten.vermieter, ...profil };
  if (entwurf && !uebergabe) daten = normalisierenEingang(entwurf);
  if (uebergabe) daten = normalisierenEingang({ ...uebergabe, vermieter: { ...daten.vermieter, ...(uebergabe.vermieter || {}) } });

  if (!daten.rechnung.nummer) daten.rechnung.nummer = naechsteNummer();
  if (!daten.rechnung.datum) daten.rechnung.datum = heuteIso();
  if (!daten.rechnung.naechte) {
    daten.rechnung.naechte = naechteZwischen(daten.rechnung.anreise, daten.rechnung.abreise);
  }
  if (uebergabe && !daten.positionen.length) {
    const gesamt = parseBetrag(daten.intern.gesamtpreis);
    if (gesamt) daten.positionen = [standardPosition(daten)];
  }
  naechteManuell = Boolean(daten.rechnung.naechte)
    && daten.rechnung.naechte !== naechteZwischen(daten.rechnung.anreise, daten.rechnung.abreise);

  bindeEreignisse();
  schreibeFelder();
  zeichnePositionen();
  zeichneKunden();
  zeichneHistorie();
  aktualisiere({ sofort: true });

  passeUmgebungAn();

  const alsApp = document.querySelector('link[rel="manifest"]');
  if (alsApp && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline optional */ });
  }
}

document.addEventListener('DOMContentLoaded', start);
