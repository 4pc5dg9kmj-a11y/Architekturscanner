/* Bedienoberflaeche der Rechnungs-App (laeuft nur im Browser).
 *
 * Fuenf Schritte: Scan einfuegen, Rechnung erzeugen, aendern, speichern,
 * versenden. Alles andere liegt hinter "Mehr".
 */

import {
  baueRechnungPdf, dateiname, formatDatum, formatEuro, heuteIso, leereRechnung,
  naechteZwischen, normalisiere, parseBetrag,
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
let sampeln = null;
let bildGrenzen = null;
let leseAbbruch = null;
let phase = 'scan';
let editorOffen = false;
let naechteManuell = false;
let zeichnenTimer = null;

/* ------------------------------------------------------------------ Speicher */

function lade(schluessel, vorgabe) {
  try {
    const roh = localStorage.getItem(schluessel);
    return roh ? JSON.parse(roh) : vorgabe;
  } catch { return vorgabe; }
}

function speichere(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch { /* Kontingent */ }
}

/* -------------------------------------------------------------------- Hilfen */

function melde(text) {
  const el = $('#meldung');
  el.textContent = text;
  el.classList.add('auf');
  clearTimeout(melde._t);
  melde._t = setTimeout(() => el.classList.remove('auf'), 2600);
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
  $('#ustFelder').hidden = Boolean(daten.vermieter.kleinunternehmer);
}

function escape(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* ---------------------------------------------------------------- Positionen */

const VORLAGEN = {
  reinigung: { titel: 'Endreinigung', details: [], menge: 1, einheit: 'Pauschale', einzelpreis: 0 },
  kurtaxe: { titel: 'Kurtaxe / Gästebeitrag', details: [], menge: 1, einheit: 'Person/Nacht', einzelpreis: 0 },
  fruehstueck: { titel: 'Frühstück', details: [], menge: 1, einheit: 'Person', einzelpreis: 0 },
  parkplatz: { titel: 'Stellplatz', details: [], menge: 1, einheit: 'Nacht', einzelpreis: 0 },
  leer: { titel: '', details: [], menge: 1, einheit: '', einzelpreis: 0 },
};

function preisText(wert) {
  const zahl = Number(wert) || 0;
  const gerundet = Math.round(zahl * 100) / 100;
  return String(Math.abs(zahl - gerundet) < 0.0001 ? gerundet.toFixed(2) : zahl).replace('.', ',');
}

function zeichnePositionen() {
  const box = $('#positionen');
  box.innerHTML = '';
  daten.positionen.forEach((position, index) => {
    const el = document.createElement('div');
    el.className = 'position';
    el.innerHTML = `
      <div class="kopfzeile">
        <span class="nr">${index + 1}</span>
        <span class="zeilensumme" data-summe>${formatEuro(position.menge * position.einzelpreis)}</span>
        <button class="weg" data-weg>Entfernen</button>
      </div>
      <div class="feld"><label>Bezeichnung</label>
        <input data-feld="titel" value="${escape(position.titel)}" placeholder="Übernachtung im Wohlfühlapartment"></div>
      <div class="feld"><label>Details (eine Zeile je Angabe)</label>
        <textarea data-feld="details" rows="2">${escape((position.details || []).join('\n'))}</textarea></div>
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
        position.auto = false;
        el.querySelector('[data-summe]').textContent = formatEuro(position.menge * position.einzelpreis);
        aktualisiere();
      });
    }
    box.appendChild(el);
  });
}

/* --------------------------------------------------------------- Vorschau/PDF */

function baueModell() {
  return normalisiere(daten);
}

function aktualisiere({ sofort = false } = {}) {
  const modell = baueModell();
  $('#kopfSumme').textContent = modell.rechnung.nummer ? `Nr. ${modell.rechnung.nummer}` : '';
  $('#fussSumme').childNodes[0].nodeValue = formatEuro(modell.summen.gesamt);
  $('#fussDetail').textContent = modell.rechnung.bezahlt
    ? 'bereits bezahlt'
    : modell.faelligkeit ? `fällig ${formatDatum(modell.faelligkeit)}` : 'gesamt';

  const empfaenger = daten.gast.firma || daten.gast.name;
  const zeitraum = [formatDatum(daten.rechnung.anreise), formatDatum(daten.rechnung.abreise)]
    .filter(Boolean).join(' – ');
  $('#vorschauNeben').textContent = [empfaenger, zeitraum].filter(Boolean).join(' · ');

  const kommission = parseBetrag(daten.intern.kommission);
  $('#auszahlung').textContent = kommission
    ? `Auszahlung nach Kommission: ${formatEuro(modell.summen.gesamt - kommission)}`
    : '';

  speichere(SPEICHER.entwurf, daten);
  speichere(SPEICHER.profil, daten.vermieter);

  clearTimeout(zeichnenTimer);
  zeichnenTimer = setTimeout(() => zeichneVorschau(modell), sofort ? 0 : 250);
}

function zeichneVorschau(modell) {
  const leer = !modell.zeilen.length;
  const blaetter = $('#blaetter');
  $('#vorschauLeer').hidden = !leer;
  blaetter.hidden = leer;
  $('#vorschauInfo').textContent = modell.rechnung.nummer
    ? `Rechnung ${modell.rechnung.nummer}` : 'Rechnung';
  if (leer) return;

  try {
    const doc = baueRechnungPdf(modell, { alsDokument: true });
    const breite = Math.max(240, blaetter.clientWidth || 520);
    const skala = Math.min(1.5, breite / doc.width);
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

/* ------------------------------------------------------- Speichern, Versenden */

async function ueberClaudeSpeichern(bytes, name) {
  try {
    const speicherer = await window.claude?.use?.('downloads');
    if (!speicherer) return 'nicht-verfuegbar';
    await speicherer.save({ filename: name, data: bytes });
    return 'gespeichert';
  } catch (fehler) {
    if (fehler && fehler.code === 'declined') return 'abgebrochen';
    return 'nicht-verfuegbar';
  }
}

async function sichere(modell, { still = false } = {}) {
  const bytes = baueRechnungPdf(modell);
  const name = dateiname(modell);
  const ergebnis = await ueberClaudeSpeichern(bytes, name);
  if (ergebnis === 'abgebrochen') return false;
  if (ergebnis === 'nicht-verfuegbar') {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  merkeHistorie(modell);
  if (!still) melde('Rechnung gespeichert.');
  return true;
}

function mailText(modell) {
  const v = modell.vermieter;
  const zeitraum = [formatDatum(modell.rechnung.anreise), formatDatum(modell.rechnung.abreise)]
    .filter(Boolean).join(' bis ');
  const zeilen = [
    'Guten Tag,',
    '',
    `anbei die Rechnung ${modell.rechnung.nummer} über ${formatEuro(modell.summen.gesamt)} für Ihren Aufenthalt${zeitraum ? ` vom ${zeitraum}` : ''} im ${v.objekt}.`,
  ];
  zeilen.push('');
  zeilen.push(modell.rechnung.bezahlt
    ? 'Der Betrag ist bereits bezahlt – die Rechnung dient nur Ihrer Unterlage.'
    : `Bitte überweisen Sie den Betrag${modell.faelligkeit ? ` bis zum ${formatDatum(modell.faelligkeit)}` : ''} auf ${v.iban} unter Angabe der Rechnungsnummer.`);
  zeilen.push('', 'Freundliche Grüße', v.name);
  return zeilen.join('\n');
}

async function versenden() {
  const modell = baueModell();
  if (!modell.zeilen.length) { melde('Noch keine Position auf der Rechnung.'); return; }

  const bytes = baueRechnungPdf(modell);
  const name = dateiname(modell);
  const betreff = `Rechnung ${modell.rechnung.nummer} · ${modell.vermieter.objekt}`;
  const text = mailText(modell);

  try {
    const datei = new File([bytes], name, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [datei] })) {
      await navigator.share({ files: [datei], title: betreff, text });
      merkeHistorie(modell);
      melde('Weitergegeben.');
      return;
    }
  } catch (fehler) {
    if (fehler && (fehler.name === 'AbortError' || fehler.name === 'NotAllowedError')) return;
  }

  const gesichert = await sichere(modell, { still: true });
  if (!gesichert) return;
  const brief = document.createElement('a');
  brief.href = `mailto:${encodeURIComponent(modell.gast.email || '')}`
    + `?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
  brief.target = '_blank';
  brief.rel = 'noopener';
  document.body.appendChild(brief);
  brief.click();
  brief.remove();
  melde('Rechnung gespeichert – im Mailprogramm nur noch anhängen.');
}

/* ------------------------------------------------------------------ Historie */

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
    zeile.className = 'eintrag';
    zeile.innerHTML = `<span class="num">${escape(eintrag.nummer || '—')}</span>
      <span style="color:var(--muted)">${escape(eintrag.empfaenger || '')}</span>
      <span class="wachs"></span>
      <span class="num">${formatEuro(eintrag.betrag)}</span>
      <button class="knopf klein rand" data-laden>Öffnen</button>`;
    zeile.querySelector('[data-laden]').addEventListener('click', () => {
      daten = normalisierenEingang(historie[index].daten);
      naechteManuell = true;
      schreibeFelder();
      zeichnePositionen();
      setzePhase('rechnung');
      aktualisiere({ sofort: true });
      melde(`Rechnung ${eintrag.nummer} geöffnet.`);
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
  return `${jahr}-${String((nummern.length ? Math.max(...nummern) : 0) + 1).padStart(3, '0')}`;
}

/* -------------------------------------------------------------------- Kunden */

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

/* -------------------------------------------------------------------- Import */

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

function leerRaus(objekt) {
  return Object.fromEntries(Object.entries(objekt || {})
    .filter(([, wert]) => wert !== '' && wert !== null && wert !== undefined));
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

/* --------------------------------------------------- Scans von Claude lesen */

const PROMPT_BILDER = `Die Bilder sind Screenshots oder Scans einer Ferienwohnungs-Buchung (Booking.com, Airbnb) und/oder einer Nachricht des Gasts. Lies sie aus und antworte NUR mit diesem JSON, ohne Erklärung:

{
  "gast": {"firma":"","name":"","strasse":"","plz":"","ort":"","land":"","email":""},
  "rechnung": {"portal":"","buchungsnummer":"","anreise":"JJJJ-MM-TT","abreise":"JJJJ-MM-TT","naechte":0,"gaeste":1,"hinweis":""},
  "intern": {"gesamtpreis":0,"kommission":0}
}

Regeln:
- Alle Bilder gehören zu derselben Buchung.
- "gesamtpreis" ist der Gesamtpreis der Buchung, also das, was der Gast zahlt. Die Kommission des Portals wird NICHT abgezogen, sie gehört nach "kommission".
- Nennt der Gast in einer Nachricht eine abweichende Rechnungsanschrift ("Bitte stellen Sie die Rechnung auf …"), gilt diese statt des Namens aus der Buchung.
- Datumsangaben wie "Mo., 10. Aug. 2026" ins Format JJJJ-MM-TT umrechnen.
- Was nicht erkennbar ist, bleibt leer bzw. 0. Nichts erfinden.`;

const LESEFEHLER = {
  not_granted: 'Ohne Erlaubnis kann ich die Bilder nicht lesen – Text einfügen geht weiterhin.',
  sampling_disabled: 'Für dieses Konto steht das Lesen der Bilder nicht zur Verfügung.',
  images_unavailable: 'Diese Ansicht kann keine Bilder lesen.',
  image_rejected: 'Mit diesen Bildern komme ich nicht zurecht – bitte andere Aufnahmen.',
  rate_limited: 'Gerade zu viele Anfragen. Bitte in einer Minute noch einmal.',
  session_expired: 'Bitte neu bei Claude anmelden und noch einmal versuchen.',
  invalid_json: 'Die Antwort war unvollständig. Bitte noch einmal versuchen.',
  refused: 'Die Bilder wurden nicht ausgewertet. Bitte Text einfügen.',
  empty_completion: 'Keine Antwort erhalten. Bitte noch einmal versuchen.',
  prompt_too_large: 'Zu viele Bilder auf einmal – bitte weniger auswählen.',
};

async function leseScans() {
  const grenze = bildGrenzen?.maxCount ?? 4;
  const dateien = bilder.slice(0, grenze).map((bild) => bild.datei);
  const status = $('#bilderStatus');
  const start = Date.now();
  const takt = setInterval(() => {
    status.textContent = `Ich lese den Scan … ${Math.round((Date.now() - start) / 1000)} s`;
  }, 1000);

  leseAbbruch = new AbortController();
  status.textContent = 'Ich lese den Scan …';
  $('#btnErzeugen').disabled = true;
  $('#btnBilderStop').hidden = false;

  try {
    const gelesen = await sampeln.json(PROMPT_BILDER, {
      images: dateien,
      signal: leseAbbruch.signal,
    });
    uebernehmen(gelesen, { ersetzen: true });
    setzePhase('rechnung');
    const fehlt = [
      !daten.gast.firma && !daten.gast.name ? 'den Empfänger' : '',
      !daten.positionen.length ? 'den Betrag' : '',
    ].filter(Boolean);
    if (fehlt.length) {
      oeffneEditor(true);
      melde(`Bitte ${fehlt.join(' und ')} ergänzen.`);
    } else {
      melde('Fertig – bitte kurz prüfen.');
    }
    if (bilder.length > grenze) melde(`Nur die ersten ${grenze} Scans wurden gelesen.`);
    status.textContent = '';
  } catch (fehler) {
    const code = fehler && fehler.code;
    status.textContent = code === 'cancelled'
      ? 'Abgebrochen.'
      : LESEFEHLER[code] || 'Das Lesen hat nicht geklappt. Bitte noch einmal versuchen.';
  } finally {
    clearInterval(takt);
    leseAbbruch = null;
    $('#btnErzeugen').disabled = false;
    $('#btnBilderStop').hidden = true;
  }
}

/* ------------------------------------------------------------------- Bilder */

function zeigeBilder() {
  const box = $('#bilder');
  box.innerHTML = '';
  bilder.forEach((bild, index) => {
    const figur = document.createElement('figure');
    figur.innerHTML = `<img src="${bild.url}" alt="Scan ${index + 1}"><button title="Entfernen">×</button>`;
    figur.querySelector('img').addEventListener('click', () => {
      $('#lupe img').src = bild.url;
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
    leser.onload = () => { bilder.push({ url: leser.result, datei }); zeigeBilder(); };
    leser.readAsDataURL(datei);
  }
}

/* ------------------------------------------------------------ Schritte/Phase */

function setzePhase(neu) {
  phase = neu;
  $('#schrittScan').hidden = neu !== 'scan';
  $('#schrittRechnung').hidden = neu !== 'rechnung';
  $('#aktionen').hidden = neu !== 'rechnung';
  $('#btnZuruecksetzen').hidden = neu !== 'rechnung';
  if (neu === 'rechnung') aktualisiere({ sofort: true });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function oeffneEditor(offen) {
  editorOffen = offen;
  $('#editor').hidden = !offen;
  $('#schrittRechnung').classList.toggle('mit-editor', offen);
  $('#btnAendern').textContent = offen ? 'Fertig' : 'Ändern';
  if (offen) aktualisiere({ sofort: true });
}

function jsonAusText(roh) {
  const text = String(roh || '').trim();
  const start = text.indexOf('{');
  const ende = text.lastIndexOf('}');
  if (start < 0 || ende < start) return null;
  try { return JSON.parse(text.slice(start, ende + 1)); } catch { return null; }
}

async function erzeuge() {
  const text = $('#textEingabe').value.trim();

  if (bilder.length && sampeln && bildGrenzen) { await leseScans(); return; }

  if (bilder.length && !text) {
    $('#textweg').hidden = false;
    $('#bilderStatus').textContent = 'Hier kann ich die Bilder nicht lesen – bitte den Text einfügen.';
    return;
  }

  if (text) {
    const alsJson = jsonAusText(text);
    uebernehmen(alsJson || analysiereText(text), { ersetzen: Boolean(alsJson) });
    setzePhase('rechnung');
    if (!daten.positionen.length) {
      oeffneEditor(true);
      melde('Betrag fehlt noch – bitte ergänzen.');
    } else {
      melde('Fertig – bitte kurz prüfen.');
    }
    return;
  }

  neueRechnung();
  setzePhase('rechnung');
  oeffneEditor(true);
}

function neueRechnung() {
  const profil = lade(SPEICHER.profil, null);
  daten = leereRechnung();
  if (profil) daten.vermieter = { ...daten.vermieter, ...profil };
  daten.rechnung.nummer = naechsteNummer();
  naechteManuell = false;
  bilder = [];
  zeigeBilder();
  $('#textEingabe').value = '';
  $('#bilderStatus').textContent = '';
  schreibeFelder();
  zeichnePositionen();
  aktualisiere({ sofort: true });
}

/* ---------------------------------------------------------------- Ereignisse */

function bindeEreignisse() {
  document.addEventListener('input', (ereignis) => {
    const el = ereignis.target.closest('[data-pfad]');
    if (!el) return;
    setze(daten, el.dataset.pfad, leseFeld(el));
    if (el.dataset.pfad === 'rechnung.naechte') naechteManuell = true;
    if ((el.dataset.pfad === 'rechnung.anreise' || el.dataset.pfad === 'rechnung.abreise') && !naechteManuell) {
      daten.rechnung.naechte = naechteZwischen(daten.rechnung.anreise, daten.rechnung.abreise);
      $('[data-pfad="rechnung.naechte"]').value = daten.rechnung.naechte || '';
    }
    if (el.dataset.pfad === 'vermieter.kleinunternehmer') {
      $('#ustFelder').hidden = Boolean(daten.vermieter.kleinunternehmer);
    }
    aktualisiere();
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
    if (dateien.length) { nimmDateien(dateien); melde('Scan eingefügt.'); }
  });
  $('#lupe').addEventListener('click', () => $('#lupe').classList.remove('auf'));

  $('#btnErzeugen').addEventListener('click', erzeuge);
  $('#btnBilderStop').addEventListener('click', () => leseAbbruch?.abort());
  $('#wegText').addEventListener('click', () => {
    $('#textweg').hidden = false;
    $('#textEingabe').focus();
  });
  $('#wegLeer').addEventListener('click', () => {
    neueRechnung();
    setzePhase('rechnung');
    oeffneEditor(true);
  });
  $('#wegPrompt').addEventListener('click', () => {
    const text = `${PROMPT_BILDER}\n\n(Die Screenshots hier anhängen.)`;
    navigator.clipboard?.writeText(text)
      .then(() => melde('Prompt kopiert – mit den Screenshots an Claude schicken.'))
      .catch(() => melde('Kopieren nicht möglich.'));
  });

  $('#btnAendern').addEventListener('click', () => oeffneEditor(!editorOffen));
  $('#btnPdf').addEventListener('click', () => sichere(baueModell()));
  $('#btnVersenden').addEventListener('click', versenden);
  $('#btnZuruecksetzen').addEventListener('click', () => {
    neueRechnung();
    oeffneEditor(false);
    setzePhase('scan');
  });

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
    melde('Gast gemerkt.');
  });
  $('#btnKundeLoeschen').addEventListener('click', () => {
    const wahl = $('#kundenwahl').value;
    if (wahl === '') { melde('Bitte zuerst einen Gast auswählen.'); return; }
    const kunden = lade(SPEICHER.kunden, []);
    kunden.splice(Number(wahl), 1);
    speichere(SPEICHER.kunden, kunden);
    zeichneKunden();
    melde('Gast gelöscht.');
  });
  $('#kundenwahl').addEventListener('change', (e) => {
    if (e.target.value === '') return;
    const kunde = lade(SPEICHER.kunden, [])[Number(e.target.value)];
    if (!kunde) return;
    daten.gast = { ...leereRechnung().gast, ...kunde };
    schreibeFelder();
    aktualisiere();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (phase === 'rechnung') sichere(baueModell());
    }
  });

  let groesseTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(groesseTimer);
    groesseTimer = setTimeout(() => { if (phase === 'rechnung') aktualisiere({ sofort: true }); }, 200);
  });
}

/* -------------------------------------------------------------------- Start */

async function passeUmgebungAn() {
  sampeln = await window.claude?.use?.('sample').catch(() => null);
  bildGrenzen = sampeln ? (await sampeln.limits().catch(() => null))?.images : null;

  if (bildGrenzen) {
    $('#dateiEingabe').accept = bildGrenzen.mediaTypes.join(',');
    $('#ablageNeben').textContent = bildGrenzen.maxCount > 1
      ? `Bis zu ${bildGrenzen.maxCount} Bilder – Buchung und Nachricht des Gasts`
      : 'Ein Bild der Buchung';
    return;
  }

  // Ohne Leseerlaubnis fuehrt der Weg ueber Text oder Claude im Chat.
  $('#startUnter').textContent = 'Text aus der Buchung einfügen – oder die Scans von Claude lesen lassen.';
  $('#ablageNeben').textContent = 'Hier dienen die Bilder als Vorlage zum Abtippen';
  $('#wegPrompt').hidden = false;
}

function ausHash() {
  const treffer = location.hash.match(/daten=([^&]+)/);
  if (!treffer) return null;
  try {
    const binaer = atob(treffer[1].replace(/-/g, '+').replace(/_/g, '/'));
    const prozent = Array.from(binaer, (z) => `%${z.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
    return JSON.parse(decodeURIComponent(prozent));
  } catch { return null; }
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
  if (uebergabe && !daten.positionen.length && parseBetrag(daten.intern.gesamtpreis)) {
    daten.positionen = [standardPosition(daten)];
  }
  naechteManuell = Boolean(daten.rechnung.naechte)
    && daten.rechnung.naechte !== naechteZwischen(daten.rechnung.anreise, daten.rechnung.abreise);

  bindeEreignisse();
  passeUmgebungAn();
  schreibeFelder();
  zeichnePositionen();
  zeichneKunden();
  zeichneHistorie();
  setzePhase(daten.positionen.length ? 'rechnung' : 'scan');
  aktualisiere({ sofort: true });

  const alsApp = document.querySelector('link[rel="manifest"]');
  if (alsApp && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline optional */ });
  }
}

document.addEventListener('DOMContentLoaded', start);
