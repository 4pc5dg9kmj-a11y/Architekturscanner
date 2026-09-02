/* Rechnungsmodell + PDF-Layout.
 *
 * Reine Logik ohne DOM: wird sowohl von der Web-App als auch von der
 * Kommandozeile (cli.mjs) benutzt, damit Vorschau und Download identisch sind.
 */

import { A4, FONTS, PdfDoc, measure, wrapText } from './pdf.mjs';

/* -------------------------------------------------------------- Farben/Raster */

const C = {
  ink: [21, 24, 26],
  mid: [61, 68, 63],
  muted: [139, 145, 142],
  hair: [228, 231, 229],
  rule: [21, 24, 26],
  accent: [31, 95, 70],
  white: [255, 255, 255],
};

// Alle Masse in Punkt (1 pt = 1/72 Zoll). A4 = 595,28 x 841,89 pt.
const M = { left: 54, right: 54, top: 48, bottom: 42 };
const CONTENT_W = A4.w - M.left - M.right;
const SPALTE_W = 201;                 // rechte Spalte: Eckdaten und Summe
const SPALTE_X = A4.w - M.right - SPALTE_W;

/* ------------------------------------------------------------------ Vorgaben */

export const VERMIETER_VORGABE = {
  objekt: 'Wohlfühlapartment Guxhagen',
  name: 'Anne & Andreas Steffen',
  strasse: 'Dörnhagener Str. 11',
  plz: '34302',
  ort: 'Guxhagen',
  land: 'DE',
  steuernummer: '024 482 44529',
  ustId: '',
  telefon: '01728869146',
  email: 'service.steffen@outlook.de',
  iban: 'DE23 7603 0080 0230 4925 43',
  bic: '',
  bank: '',
  kleinunternehmer: true,
  ustSatz: 7,
  preiseInklUst: true,
  grussformel: 'Vielen Dank für Ihren Besuch!',
};

export function leereRechnung() {
  return {
    vermieter: { ...VERMIETER_VORGABE },
    gast: { firma: '', name: '', strasse: '', plz: '', ort: '', land: '', email: '' },
    rechnung: {
      nummer: '',
      datum: heuteIso(),
      portal: '',
      buchungsnummer: '',
      anreise: '',
      abreise: '',
      naechte: 0,
      gaeste: 1,
      zahlungsziel: 14,
      bezahlt: false,
      hinweis: '',
    },
    positionen: [],
    intern: { kommission: null, notiz: '' },
  };
}

/* ------------------------------------------------------------------- Helfer */

export function heuteIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Akzeptiert "2026-08-10", "10.08.2026", "10.8.26" -> Date | null */
export function parseDatum(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = text.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(m[2]) - 1, Number(m[1]));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isoDatum(value) {
  const d = parseDatum(value);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDatum(value) {
  const d = parseDatum(value);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function naechteZwischen(anreise, abreise) {
  const a = parseDatum(anreise);
  const b = parseDatum(abreise);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function plusTage(value, tage) {
  const d = parseDatum(value);
  if (!d) return null;
  return new Date(d.getTime() + tage * 86400000);
}

export function formatEuro(amount) {
  const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return `${n.toFixed(2).replace('.', ',')} €`;
}

export function formatMenge(n) {
  const value = Number(n) || 0;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
}

/** Wandelt "1.234,50", "€ 69", "69.00" in eine Zahl. */
export function parseBetrag(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').replace(/[^\d,.-]/g, '');
  if (!text) return 0;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/* --------------------------------------------------------- Modell + Rechnung */

/** Fuellt fehlende Felder, berechnet Summen. Veraendert die Eingabe nicht. */
export function normalisiere(input) {
  const basis = leereRechnung();
  const data = {
    vermieter: { ...basis.vermieter, ...(input.vermieter || {}) },
    gast: { ...basis.gast, ...(input.gast || {}) },
    rechnung: { ...basis.rechnung, ...(input.rechnung || {}) },
    positionen: (input.positionen || []).map((p) => ({
      auto: Boolean(p.auto),
      titel: p.titel || '',
      details: Array.isArray(p.details) ? p.details.filter(Boolean) : (p.details ? [String(p.details)] : []),
      menge: Number(p.menge) || 0,
      einheit: p.einheit || '',
      einzelpreis: parseBetrag(p.einzelpreis),
    })),
    intern: { ...basis.intern, ...(input.intern || {}) },
  };

  const r = data.rechnung;
  r.datum = isoDatum(r.datum) || heuteIso();
  r.anreise = isoDatum(r.anreise);
  r.abreise = isoDatum(r.abreise);
  if (!Number(r.naechte)) r.naechte = naechteZwischen(r.anreise, r.abreise);

  const zeilen = data.positionen.map((p) => ({
    ...p,
    summe: Math.round(p.menge * p.einzelpreis * 100) / 100,
  }));
  const brutto = Math.round(zeilen.reduce((s, z) => s + z.summe, 0) * 100) / 100;

  const v = data.vermieter;
  const satz = v.kleinunternehmer ? 0 : Number(v.ustSatz) || 0;
  let netto = brutto;
  let steuer = 0;
  let gesamt = brutto;
  if (satz > 0) {
    if (v.preiseInklUst === false) {
      netto = brutto;
      steuer = Math.round(netto * (satz / 100) * 100) / 100;
      gesamt = Math.round((netto + steuer) * 100) / 100;
    } else {
      netto = Math.round((brutto / (1 + satz / 100)) * 100) / 100;
      steuer = Math.round((brutto - netto) * 100) / 100;
      gesamt = brutto;
    }
  }

  const faellig = r.bezahlt || !Number(r.zahlungsziel)
    ? null
    : plusTage(r.datum, Number(r.zahlungsziel));

  return {
    ...data,
    zeilen,
    summen: { netto, steuer, satz, gesamt, zwischensumme: brutto },
    faelligkeit: faellig ? isoDatum(faellig) : '',
  };
}

/** Dateiname fuer den Download. */
export function dateiname(model) {
  const nummer = (model.rechnung.nummer || 'Rechnung').replace(/[^\w.-]+/g, '-');
  const wer = (model.gast.firma || model.gast.name || '').replace(/[^\wÄÖÜäöüß -]+/g, '').trim();
  const teil = wer ? `_${wer.replace(/\s+/g, '-')}` : '';
  return `Rechnung_${nummer}${teil}.pdf`;
}

/* ------------------------------------------------------------------ Layout
 *
 * Reduzierte Gestaltung: weisses Blatt, Haarlinien statt Flaechen, Farbe nur
 * als schmaler Strich ueber der Summe. Alles ruht auf einer Spaltenkante.
 */

const LABEL = { font: FONTS.bold, size: 8.25, color: C.muted, charSpacing: 1.15 };

function label(doc, text, x, y, { farbe = C.muted, align = 'left' } = {}) {
  doc.text(text.toUpperCase(), x, y, { ...LABEL, color: farbe, align });
}

function anschrift(block) {
  const zeilen = [];
  if (block.firma) zeilen.push(block.firma);
  if (block.name) zeilen.push(block.name);
  if (block.strasse) zeilen.push(block.strasse);
  const ort = [block.plz, block.ort].filter(Boolean).join(' ');
  if (ort) zeilen.push(ort);
  if (block.land && block.land.toUpperCase() !== 'DE') zeilen.push(block.land);
  return zeilen;
}

function kopfzeile(doc, model) {
  const v = model.vermieter;
  doc.text((v.objekt || 'Ferienwohnung').toUpperCase(), M.left, M.top + 10, {
    font: FONTS.bold, size: 9.4, color: C.ink, charSpacing: 1.7,
  });
  const rechts = [model.rechnung.nummer ? `Rechnung ${model.rechnung.nummer}` : 'Rechnung'];
  label(doc, rechts[0], A4.w - M.right, M.top + 10, { align: 'right' });
}

function fusszeile(doc, model, seite, seiten) {
  const v = model.vermieter;
  const y = A4.h - M.bottom;
  doc.line(M.left, y - 20, A4.w - M.right, y - 20, { color: C.hair, width: 0.6 });
  const links = [
    v.name,
    v.strasse,
    [v.plz, v.ort].filter(Boolean).join(' '),
    v.steuernummer ? `Steuernr. ${v.steuernummer}` : '',
    v.ustId ? `USt-IdNr. ${v.ustId}` : '',
  ].filter(Boolean).join(' · ');
  doc.text(links, M.left, y - 6, { size: 8.6, color: C.muted });
  const rechts = seiten > 1 ? `${v.telefon} · Seite ${seite}/${seiten}` : v.telefon;
  doc.text(rechts, A4.w - M.right, y - 6, { size: 8.6, color: C.muted, align: 'right' });
}

/** Empfaengeranschrift links; gibt die Unterkante zurueck. */
function empfaenger(doc, model, y) {
  label(doc, 'Rechnung an', M.left, y);
  let cursor = y + 22;
  anschrift(model.gast).forEach((zeile, index) => {
    doc.text(zeile, M.left, cursor, {
      font: index === 0 ? FONTS.bold : FONTS.regular,
      size: index === 0 ? 12 : 11.25,
      color: index === 0 ? C.ink : C.mid,
    });
    cursor += index === 0 ? 18 : 15;
  });
  if (model.gast.email) {
    doc.text(model.gast.email, M.left, cursor + 4, { size: 9.75, color: C.muted });
    cursor += 18;
  }
  return cursor;
}

/** Eckdaten rechts als Label-Wert-Zeilen; gibt die Unterkante zurueck. */
function eckdaten(doc, model, y) {
  const r = model.rechnung;
  const zeitraum = [formatDatum(r.anreise), formatDatum(r.abreise)].filter(Boolean).join(' – ');
  const gaeste = [
    r.naechte ? `${r.naechte} ${r.naechte === 1 ? 'Nacht' : 'Nächte'}` : '',
    r.gaeste ? `${r.gaeste} ${Number(r.gaeste) === 1 ? 'Gast' : 'Gäste'}` : '',
  ].filter(Boolean).join(' · ');

  const zeilen = [
    ['Rechnungsdatum', formatDatum(r.datum)],
    ['Buchungsnummer', r.buchungsnummer],
    ['Gebucht über', r.portal],
    ['Zeitraum', zeitraum],
    ['Aufenthalt', gaeste],
  ].filter(([, wert]) => wert);

  let cursor = y;
  for (const [name, wert] of zeilen) {
    doc.text(name, SPALTE_X, cursor, { size: 9.75, color: C.muted });
    doc.text(wert, A4.w - M.right, cursor, { size: 9.75, color: C.ink, align: 'right' });
    cursor += 14;
  }
  return cursor;
}

function tabellenkopf(doc, y) {
  label(doc, 'Leistung', M.left, y);
  label(doc, 'Betrag', A4.w - M.right, y, { align: 'right' });
  doc.line(M.left, y + 8, A4.w - M.right, y + 8, { color: C.rule, width: 0.75 });
  return y + 8;
}

/** Zusatzzeile "3 Nächte × 85,00 €" – nur wenn die Menge es verlangt. */
function mengenzeile(zeile) {
  if (Number(zeile.menge) === 1 && !zeile.einheit) return '';
  const menge = `${formatMenge(zeile.menge)}${zeile.einheit ? ` ${zeile.einheit}` : ''}`;
  return Number(zeile.menge) === 1 ? '' : `${menge} × ${formatEuro(zeile.einzelpreis)}`;
}

function detailZeilen(zeile) {
  const zusatz = mengenzeile(zeile);
  return [...(zusatz ? [zusatz] : []), ...zeile.details];
}

function zeilenhoehe(zeile) {
  const breite = SPALTE_X - M.left - 30;
  const titelZeilen = wrapText(zeile.titel || '', FONTS.regular, 11.6, breite).length || 1;
  const details = detailZeilen(zeile)
    .reduce((summe, d) => summe + wrapText(d, FONTS.regular, 9.4, breite).length, 0);
  return 22 + titelZeilen * 15 + details * 13 + 6;
}

function zeichneZeile(doc, zeile, y) {
  const hoehe = zeilenhoehe(zeile);
  const breite = SPALTE_X - M.left - 30;
  let cursor = y + 22;
  for (const stueck of wrapText(zeile.titel || '', FONTS.regular, 11.6, breite)) {
    doc.text(stueck, M.left, cursor, { size: 11.6, color: C.ink });
    cursor += 15;
  }
  cursor += 2;
  for (const detail of detailZeilen(zeile)) {
    for (const stueck of wrapText(detail, FONTS.regular, 9.4, breite)) {
      doc.text(stueck, M.left, cursor, { size: 9.4, color: C.muted });
      cursor += 13;
    }
  }
  doc.text(formatEuro(zeile.summe), A4.w - M.right, y + 22, {
    size: 11.6, color: C.ink, align: 'right',
  });
  doc.line(M.left, y + hoehe, A4.w - M.right, y + hoehe, { color: C.hair, width: 0.6 });
  return y + hoehe;
}

function summenblock(doc, model, y) {
  const s = model.summen;
  const rechts = A4.w - M.right;
  let cursor = y + 20;

  const zeile = (name, wert) => {
    doc.text(name, SPALTE_X, cursor, { size: 9.75, color: C.muted });
    doc.text(wert, rechts, cursor, { size: 9.75, color: C.ink, align: 'right' });
    cursor += 14;
  };

  if (s.satz > 0) {
    const inklusive = model.vermieter.preiseInklUst !== false;
    zeile('Nettobetrag', formatEuro(s.netto));
    zeile(`${inklusive ? 'enthaltene' : 'zzgl.'} ${formatMenge(s.satz)} % USt.`, formatEuro(s.steuer));
    cursor += 4;
  } else if (model.zeilen.length > 1) {
    zeile('Zwischensumme', formatEuro(s.zwischensumme));
    cursor += 4;
  }

  doc.rect(SPALTE_X, cursor, SPALTE_W, 1.5, { fill: C.accent });
  cursor += 20;
  label(doc, 'Gesamt', SPALTE_X, cursor, { farbe: C.ink });
  doc.text(formatEuro(s.gesamt), rechts, cursor + 4, {
    font: FONTS.bold, size: 19.5, color: C.ink, align: 'right',
  });
  cursor += 22;

  const hinweis = model.vermieter.kleinunternehmer
    ? 'Im Rechnungsbetrag ist gemäß § 19 UStG keine Umsatzsteuer enthalten.'
    : `Umsatzsteuer ${formatMenge(s.satz)} % auf die Beherbergungsleistung${
      model.vermieter.preiseInklUst !== false ? ' im Rechnungsbetrag enthalten' : ' zusätzlich berechnet'}.`;
  doc.text(hinweis, M.left, cursor, { size: 8.6, color: C.muted });
  return cursor + 10;
}

function zahlungsblock(doc, model, y) {
  const v = model.vermieter;
  const r = model.rechnung;
  let cursor = y + 30;

  if (r.bezahlt) {
    doc.text('Bereits bezahlt – dieser Beleg dient nur Ihrer Unterlage.', M.left, cursor, {
      size: 10.5, color: C.ink,
    });
    return cursor + 14;
  }

  const faellig = model.faelligkeit
    ? `Bitte bis zum ${formatDatum(model.faelligkeit)} überweisen.`
    : 'Bitte zeitnah überweisen.';
  doc.text(faellig, M.left, cursor, { size: 10.5, color: C.ink });
  cursor += 26;

  const felder = [
    ['Empfänger', v.name],
    ['IBAN', v.iban],
    [v.bic ? 'BIC' : 'Verwendungszweck', v.bic || (r.nummer ? `Rechnung ${r.nummer}` : '')],
  ].filter(([, wert]) => wert);
  if (v.bic && r.nummer) felder.push(['Verwendungszweck', `Rechnung ${r.nummer}`]);

  const spalte = CONTENT_W / Math.max(felder.length, 1);
  felder.forEach(([name, wert], index) => {
    const x = M.left + index * spalte;
    label(doc, name, x, cursor);
    doc.text(wert, x, cursor + 16, { size: 10.1, color: C.ink });
  });
  return cursor + 16;
}

/**
 * Baut die Rechnung. Standard: fertige PDF-Bytes (Uint8Array).
 * Mit { alsDokument: true } kommt das PdfDoc zurueck – fuer die Vorschau
 * auf dem Bildschirm, die dieselben Zeichenbefehle nutzt.
 */
export function baueRechnungPdf(input, { alsDokument = false } = {}) {
  const model = input.summen ? input : normalisiere(input);
  const doc = new PdfDoc({
    title: `Rechnung ${model.rechnung.nummer || ''}`.trim(),
    author: model.vermieter.name,
  });

  kopfzeile(doc, model);
  const kopfEnde = Math.max(
    empfaenger(doc, model, M.top + 82),
    eckdaten(doc, model, M.top + 82),
  );

  let y = tabellenkopf(doc, kopfEnde + 56);
  const maxY = A4.h - M.bottom - 40;

  for (const zeile of model.zeilen) {
    if (y + zeilenhoehe(zeile) > maxY) {
      doc.addPage();
      kopfzeile(doc, model);
      y = tabellenkopf(doc, M.top + 60);
    }
    y = zeichneZeile(doc, zeile, y);
  }

  const restHoehe = 210 + (model.rechnung.hinweis ? 30 : 0);
  if (y + restHoehe > maxY) {
    doc.addPage();
    kopfzeile(doc, model);
    y = M.top + 40;
  }

  y = summenblock(doc, model, y);
  y = zahlungsblock(doc, model, y);

  if (model.rechnung.hinweis) {
    doc.paragraph(model.rechnung.hinweis, M.left, y + 32, CONTENT_W, { size: 9.4, color: C.muted });
  }

  const seiten = doc.pageCount;
  doc.pages.forEach((_, index) => {
    doc.page = doc.pages[index];
    fusszeile(doc, model, index + 1, seiten);
  });

  return alsDokument ? doc : doc.build();
}
