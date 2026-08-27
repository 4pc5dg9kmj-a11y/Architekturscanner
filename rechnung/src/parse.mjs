/* Textanalyse: erkennt Buchungsdaten in kopiertem Text aus Booking.com,
 * Airbnb oder aus einer Gast-Nachricht ("Bitte stellen Sie die Rechnung auf ...").
 *
 * Das ist eine Hilfe fuer den manuellen Weg. Werden Screenshots an Claude
 * gegeben, liefert Claude die Felder direkt als JSON.
 */

import { isoDatum, naechteZwischen, parseBetrag } from './invoice.mjs';

const MONATE = {
  jan: 1, januar: 1, feb: 2, februar: 2, mar: 3, mär: 3, maer: 3, march: 3, marz: 3, märz: 3,
  apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10,
  nov: 11, november: 11, dez: 12, dec: 12, dezember: 12,
};

const RECHTSFORMEN = /\b(GmbH|AG|UG|mbH|KG|OHG|GbR|e\.?K\.?|SE|Ltd|B\.?V\.?|GmbH & Co)\b/i;

function monatNummer(name) {
  const key = String(name).toLowerCase().replace(/\.$/, '').trim();
  return MONATE[key] || MONATE[key.slice(0, 3)] || null;
}

/** Findet alle Daten im Text und gibt ISO-Strings in Reihenfolge zurueck. */
export function findeDaten(text) {
  const treffer = [];
  const jahrFallback = (new Date()).getFullYear();

  // 10.08.2026 / 10.8.26
  for (const m of text.matchAll(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})\b/g)) {
    let jahr = Number(m[3]);
    if (jahr < 100) jahr += 2000;
    treffer.push({ index: m.index, iso: isoDatum(new Date(jahr, Number(m[2]) - 1, Number(m[1]))) });
  }
  // 10. Aug. 2026 / 10 Aug 2026 / 10. August
  for (const m of text.matchAll(/\b(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,9})\.?\s*(\d{4})?\b/g)) {
    const monat = monatNummer(m[2]);
    if (!monat) continue;
    const jahr = m[3] ? Number(m[3]) : jahrFallback;
    treffer.push({ index: m.index, iso: isoDatum(new Date(jahr, monat - 1, Number(m[1]))) });
  }
  // 2026-08-10
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    treffer.push({ index: m.index, iso: `${m[1]}-${m[2]}-${m[3]}` });
  }

  treffer.sort((a, b) => a.index - b.index);
  const gesehen = new Set();
  return treffer.map((t) => t.iso).filter((iso) => {
    if (!iso || gesehen.has(iso)) return false;
    gesehen.add(iso);
    return true;
  });
}

function findeAdresse(zeilen) {
  const adresse = { firma: '', name: '', strasse: '', plz: '', ort: '' };
  for (let i = 0; i < zeilen.length; i += 1) {
    const plzZeile = zeilen[i].match(/^(\d{5})\s+([A-Za-zÄÖÜäöüß .'-]{2,})$/);
    if (!plzZeile) continue;
    adresse.plz = plzZeile[1];
    adresse.ort = plzZeile[2].trim();
    for (let k = i - 1; k >= 0 && k >= i - 4; k -= 1) {
      const zeile = zeilen[k].trim();
      if (!zeile) continue;
      if (!adresse.strasse && /\d/.test(zeile) && !/^\d{5}/.test(zeile) && zeile.length < 60) {
        adresse.strasse = zeile;
        continue;
      }
      if (adresse.strasse && !adresse.firma) {
        if (RECHTSFORMEN.test(zeile) || /^[A-ZÄÖÜ][\wÄÖÜäöüß&.\- ]{2,}$/.test(zeile)) {
          adresse.firma = zeile;
        }
        break;
      }
    }
    break;
  }
  if (!adresse.firma) {
    const firmenZeile = zeilen.find((z) => RECHTSFORMEN.test(z) && z.length < 60);
    if (firmenZeile) adresse.firma = firmenZeile.trim();
  }
  return adresse;
}

/**
 * Analysiert kopierten Text und liefert ein Teil-Rechnungsobjekt.
 * Alles, was nicht sicher erkannt wird, bleibt leer.
 */
export function analysiereText(rohtext) {
  const text = String(rohtext || '');
  const zeilen = text.split(/\r?\n/).map((z) => z.trim());
  const ergebnis = { gast: {}, rechnung: {}, positionen: [], intern: {} };

  const nummer = text.match(/(?:Best(?:ä|ae)tigungs|Buchungs|Reservierungs|Bestätigungs)?nummer\s*[:#]?\s*(\d{6,})/i)
    || text.match(/\b(\d{9,11})\b/);
  if (nummer) ergebnis.rechnung.buchungsnummer = nummer[1];

  const code = text.match(/\b(?:Code|Bestätigungscode)\s*[:#]?\s*([A-Z0-9]{6,12})\b/);
  if (!ergebnis.rechnung.buchungsnummer && code) ergebnis.rechnung.buchungsnummer = code[1];

  if (/booking/i.test(text)) ergebnis.rechnung.portal = 'Booking.com';
  else if (/airbnb/i.test(text)) ergebnis.rechnung.portal = 'Airbnb';

  const daten = findeDaten(text);
  if (daten.length >= 2) {
    const [anreise, abreise] = daten;
    ergebnis.rechnung.anreise = anreise;
    ergebnis.rechnung.abreise = abreise;
    ergebnis.rechnung.naechte = naechteZwischen(anreise, abreise);
  } else if (daten.length === 1) {
    ergebnis.rechnung.anreise = daten[0];
  }

  const naechte = text.match(/(\d{1,2})\s*(?:N(?:ä|a)chte?|Übernachtung)/i);
  if (naechte) ergebnis.rechnung.naechte = Number(naechte[1]);

  const gaeste = text.match(/(\d{1,2})\s*(?:Erwachsene[rn]?|G(?:ä|ae)st(?:e|en)?)/i);
  if (gaeste) ergebnis.rechnung.gaeste = Number(gaeste[1]);

  const gesamt = text.match(/Gesamtpreis(?:\s+der\s+Buchung)?\s*[:€]*\s*€?\s*([\d.,]+)/i)
    || text.match(/(?:Gesamt|Summe|Total)\s*[:€]*\s*€?\s*([\d.,]+)/i)
    || text.match(/€\s*([\d.,]+)/);
  if (gesamt) ergebnis.intern.gesamtpreis = parseBetrag(gesamt[1]);

  const kommission = text.match(/(?:Kommission|Provision|Servicegebühr)\s*[:€]*\s*€?\s*([\d.,]+)/i);
  if (kommission) ergebnis.intern.kommission = parseBetrag(kommission[1]);

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  if (email) ergebnis.gast.email = email[0];

  const adresse = findeAdresse(zeilen);
  Object.assign(ergebnis.gast, Object.fromEntries(
    Object.entries(adresse).filter(([, wert]) => wert),
  ));

  return ergebnis;
}
