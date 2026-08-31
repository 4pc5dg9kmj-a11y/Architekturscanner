/* Rechnungsmodell + PDF-Layout.
 *
 * Reine Logik ohne DOM: wird sowohl von der Web-App als auch von der
 * Kommandozeile (cli.mjs) benutzt, damit Vorschau und Download identisch sind.
 */

import { A4, FONTS, PdfDoc, measure, wrapText } from './pdf.mjs';

/* -------------------------------------------------------------- Farben/Raster */

const C = {
  ink: [26, 29, 27],
  soft: [107, 118, 113],
  faint: [147, 156, 151],
  accent: [27, 107, 75],
  accentDark: [17, 71, 50],
  accentSoft: [234, 243, 238],
  hair: [219, 227, 221],
  zebra: [247, 249, 248],
  white: [255, 255, 255],
};

const M = { left: 48, right: 48, bottom: 74, header: 108 };
const CONTENT_W = A4.w - M.left - M.right;

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

/* ------------------------------------------------------------------ Layout */

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

function kopf(doc, model) {
  const v = model.vermieter;
  doc.rect(0, 0, A4.w, M.header, { fill: C.accentDark });
  doc.rect(0, M.header, A4.w, 4, { fill: C.accent });

  doc.text(v.objekt || 'Ferienwohnung', M.left, 44, {
    font: FONTS.bold, size: 18, color: C.white,
  });
  doc.text(v.name, M.left, 63, { size: 9.5, color: C.white, opacity: 0.75 });
  const adresse = [v.strasse, [v.plz, v.ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  doc.text(adresse, M.left, 77, { size: 9.5, color: C.white, opacity: 0.75 });
  const kontakt = [v.telefon, v.email].filter(Boolean).join(' · ');
  doc.text(kontakt, M.left, 91, { size: 9.5, color: C.white, opacity: 0.75 });

  const rechts = A4.w - M.right;
  doc.text('RECHNUNG', rechts, 46, {
    font: FONTS.bold, size: 20, color: C.white, align: 'right', charSpacing: 1.6,
  });
  const nummer = model.rechnung.nummer ? `Nr. ${model.rechnung.nummer}` : '';
  if (nummer) doc.text(nummer, rechts, 66, { size: 10, color: C.white, align: 'right', opacity: 0.75 });
  doc.text(formatDatum(model.rechnung.datum), rechts, 82, {
    size: 10, color: C.white, align: 'right', opacity: 0.75,
  });
}

function fuss(doc, model, seite, seiten) {
  const v = model.vermieter;
  const y = A4.h - M.bottom + 18;
  doc.line(M.left, y - 22, A4.w - M.right, y - 22, { color: C.hair, width: 0.8 });
  if (v.grussformel) {
    doc.text(v.grussformel, A4.w / 2, y, {
      font: FONTS.italic, size: 13, color: C.accent, align: 'center',
    });
  }
  const zeile = [
    v.telefon,
    v.email,
    v.steuernummer ? `Steuernr. ${v.steuernummer}` : '',
    v.ustId ? `USt-IdNr. ${v.ustId}` : '',
  ].filter(Boolean).join('  ·  ');
  doc.text(zeile, M.left, y + 20, { size: 8, color: C.faint });
  doc.text(`Seite ${seite} von ${seiten}`, A4.w - M.right, y + 20, {
    size: 8, color: C.faint, align: 'right',
  });
}

function infoBox(doc, model, x, y, width) {
  const r = model.rechnung;
  const eintraege = [
    ['Rechnungsnr.', r.nummer],
    ['Rechnungsdatum', formatDatum(r.datum)],
    ['Buchungsnr.', r.buchungsnummer],
    ['Buchungsportal', r.portal],
    ['Anreise', formatDatum(r.anreise)],
    ['Abreise', formatDatum(r.abreise)],
    ['Nächte', r.naechte ? String(r.naechte) : ''],
    ['Gäste', r.gaeste ? String(r.gaeste) : ''],
  ].filter(([, wert]) => wert);

  const zeilenhoehe = 15;
  const hoehe = 30 + eintraege.length * zeilenhoehe;
  doc.rect(x, y, width, hoehe, { fill: C.accentSoft, radius: 8 });
  doc.text('Buchungsdetails', x + 14, y + 20, {
    font: FONTS.bold, size: 8.5, color: C.accent, charSpacing: 0.8,
  });
  let cursor = y + 40;
  for (const [label, wert] of eintraege) {
    doc.text(label, x + 14, cursor, { size: 9, color: C.soft });
    doc.text(wert, x + width - 14, cursor, { size: 9, font: FONTS.bold, color: C.ink, align: 'right' });
    cursor += zeilenhoehe;
  }
  return y + hoehe;
}

function empfaenger(doc, model, x, y, width) {
  const v = model.vermieter;
  const absender = [v.name, v.strasse, [v.plz, v.ort].filter(Boolean).join(' ')]
    .filter(Boolean).join(' · ');
  doc.text(absender, x, y, { size: 7.5, color: C.faint });
  doc.line(x, y + 4, x + Math.min(width, measure(absender, FONTS.regular, 7.5)), y + 4,
    { color: C.hair, width: 0.5 });

  doc.text('RECHNUNGSEMPFÄNGER', x, y + 26, {
    font: FONTS.bold, size: 8, color: C.accent, charSpacing: 0.8,
  });

  let cursor = y + 46;
  const zeilen = anschrift(model.gast);
  zeilen.forEach((zeile, index) => {
    doc.text(zeile, x, cursor, {
      font: index === 0 ? FONTS.bold : FONTS.regular,
      size: index === 0 ? 11.5 : 10.5,
      color: C.ink,
    });
    cursor += index === 0 ? 17 : 15;
  });
  if (model.gast.email) {
    doc.text(model.gast.email, x, cursor + 3, { size: 9, color: C.soft });
    cursor += 18;
  }
  return cursor;
}

const SPALTEN = {
  pos: M.left + 4,
  titel: M.left + 34,
  menge: M.left + 336,
  preis: M.left + 410,
  summe: A4.w - M.right - 6,
};

function tabellenkopf(doc, y) {
  doc.rect(M.left, y, CONTENT_W, 26, { fill: C.accent, radius: 5 });
  const basis = y + 17;
  doc.text('POS', SPALTEN.pos, basis, { font: FONTS.bold, size: 8, color: C.white, charSpacing: 0.6 });
  doc.text('BESCHREIBUNG', SPALTEN.titel, basis, { font: FONTS.bold, size: 8, color: C.white, charSpacing: 0.6 });
  doc.text('MENGE', SPALTEN.menge, basis, { font: FONTS.bold, size: 8, color: C.white, align: 'right', charSpacing: 0.6 });
  doc.text('EINZELPREIS', SPALTEN.preis, basis, { font: FONTS.bold, size: 8, color: C.white, align: 'right', charSpacing: 0.6 });
  doc.text('BETRAG', SPALTEN.summe, basis, { font: FONTS.bold, size: 8, color: C.white, align: 'right', charSpacing: 0.6 });
  return y + 26;
}

function zeilenhoehe(zeile) {
  const breite = SPALTEN.menge - SPALTEN.titel - 24;
  const titelZeilen = wrapText(zeile.titel || '', FONTS.bold, 10.5, breite).length || 1;
  const detailZeilen = zeile.details.reduce(
    (sum, d) => sum + wrapText(d, FONTS.regular, 8.8, breite).length, 0,
  );
  return 14 + titelZeilen * 14 + detailZeilen * 11.5;
}

function zeichneZeile(doc, zeile, index, y) {
  const hoehe = zeilenhoehe(zeile);
  if (index % 2 === 1) doc.rect(M.left, y, CONTENT_W, hoehe, { fill: C.zebra });
  doc.line(M.left, y + hoehe, A4.w - M.right, y + hoehe, { color: C.hair, width: 0.5 });

  const breite = SPALTEN.menge - SPALTEN.titel - 24;
  let cursor = y + 18;
  doc.text(String(index + 1), SPALTEN.pos, cursor, { size: 9, color: C.faint });
  doc.text(formatMenge(zeile.menge) + (zeile.einheit ? ` ${zeile.einheit}` : ''),
    SPALTEN.menge, cursor, { size: 10, color: C.ink, align: 'right' });
  doc.text(formatEuro(zeile.einzelpreis), SPALTEN.preis, cursor, { size: 10, color: C.ink, align: 'right' });
  doc.text(formatEuro(zeile.summe), SPALTEN.summe, cursor, { font: FONTS.bold, size: 10.5, color: C.ink, align: 'right' });

  for (const t of wrapText(zeile.titel || '', FONTS.bold, 10.5, breite)) {
    doc.text(t, SPALTEN.titel, cursor, { font: FONTS.bold, size: 10.5, color: C.ink });
    cursor += 14;
  }
  for (const detail of zeile.details) {
    for (const t of wrapText(detail, FONTS.regular, 8.8, breite)) {
      doc.text(t, SPALTEN.titel, cursor, { size: 8.8, color: C.soft });
      cursor += 11.5;
    }
  }
  return y + hoehe;
}

function summenblock(doc, model, y) {
  const breite = 250;
  const x = A4.w - M.right - breite;
  const rechts = A4.w - M.right - 6;
  const s = model.summen;
  let cursor = y + 20;

  const zeile = (label, wert, opts = {}) => {
    doc.text(label, x + 6, cursor, { size: 9.5, color: opts.stark ? C.ink : C.soft });
    doc.text(wert, rechts, cursor, {
      size: 9.5, color: C.ink, font: opts.stark ? FONTS.bold : FONTS.regular, align: 'right',
    });
    cursor += 16;
  };

  const inklusive = model.vermieter.preiseInklUst !== false;
  if (s.satz > 0) {
    zeile('Nettobetrag', formatEuro(s.netto));
    zeile(`${inklusive ? 'enthaltene' : 'zzgl.'} ${formatMenge(s.satz)} % USt.`, formatEuro(s.steuer));
  } else if (model.zeilen.length > 1) {
    zeile('Zwischensumme', formatEuro(s.zwischensumme));
  }

  const boxY = cursor - 4;
  doc.rect(x, boxY, breite, 38, { fill: C.accent, radius: 8 });
  doc.text('Gesamt zu zahlen', x + 14, boxY + 24, { font: FONTS.bold, size: 11, color: C.white });
  doc.text(formatEuro(s.gesamt), rechts - 8, boxY + 25, {
    font: FONTS.bold, size: 14, color: C.white, align: 'right',
  });
  cursor = boxY + 38 + 16;

  const hinweis = model.vermieter.kleinunternehmer
    ? 'Im ausgewiesenen Rechnungsbetrag ist gemäß § 19 UStG keine Umsatzsteuer enthalten.'
    : `Umsatzsteuer ${formatMenge(s.satz)} % auf die Beherbergungsleistung${inklusive ? ' im Rechnungsbetrag enthalten' : ' zusätzlich berechnet'}.`;
  cursor = doc.paragraph(hinweis, M.left, cursor, CONTENT_W, { size: 8.5, color: C.soft });
  return cursor + 6;
}

function zahlungsblock(doc, model, y) {
  const v = model.vermieter;
  const r = model.rechnung;
  const hoehe = 92;
  doc.rect(M.left, y, CONTENT_W, hoehe, { fill: C.white, stroke: C.hair, radius: 8, lineWidth: 0.8 });
  doc.text('ZAHLUNG', M.left + 16, y + 22, {
    font: FONTS.bold, size: 8.5, color: C.accent, charSpacing: 0.8,
  });

  if (r.bezahlt) {
    doc.text('Bereits bezahlt – dieser Beleg dient nur zu Ihrer Unterlage.',
      M.left + 16, y + 46, { size: 10.5, color: C.ink });
    if (r.portal) {
      doc.text(`Zahlung über ${r.portal}.`, M.left + 16, y + 64, { size: 9.5, color: C.soft });
    }
    return y + hoehe;
  }

  const faellig = model.faelligkeit
    ? `Bitte bis zum ${formatDatum(model.faelligkeit)} überweisen.`
    : 'Bitte zeitnah überweisen.';
  doc.text(faellig, M.left + 16, y + 44, { size: 10, color: C.ink });

  const felder = [
    ['Empfänger', v.name],
    ['IBAN', v.iban],
    ['Verwendungszweck', r.nummer ? `Rechnung ${r.nummer}` : ''],
  ].filter(([, wert]) => wert);
  if (v.bic) felder.splice(2, 0, ['BIC', v.bic]);

  let x = M.left + 16;
  const spalte = (CONTENT_W - 32) / felder.length;
  for (const [label, wert] of felder) {
    doc.text(label, x, y + 66, { size: 8, color: C.faint });
    doc.text(wert, x, y + 80, { font: FONTS.bold, size: 9.5, color: C.ink });
    x += spalte;
  }
  return y + hoehe;
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

  kopf(doc, model);
  const linkeSpalte = A4.w - M.right - 232;
  const endeEmpfaenger = empfaenger(doc, model, M.left, M.header + 36, linkeSpalte - M.left - 24);
  const endeInfo = infoBox(doc, model, linkeSpalte, M.header + 30, 232);

  let y = Math.max(endeEmpfaenger, endeInfo) + 30;
  y = tabellenkopf(doc, y);

  const maxY = A4.h - M.bottom - 30;
  model.zeilen.forEach((zeile, index) => {
    if (y + zeilenhoehe(zeile) > maxY) {
      doc.addPage();
      kopf(doc, model);
      y = tabellenkopf(doc, M.header + 40);
    }
    y = zeichneZeile(doc, zeile, index, y);
  });

  const restHoehe = 210 + (model.rechnung.hinweis ? 40 : 0);
  if (y + restHoehe > maxY) {
    doc.addPage();
    kopf(doc, model);
    y = M.header + 40;
  }

  y = summenblock(doc, model, y);
  y = zahlungsblock(doc, model, y + 12);

  if (model.rechnung.hinweis) {
    doc.paragraph(model.rechnung.hinweis, M.left, y + 26, CONTENT_W, { size: 9, color: C.soft });
  }

  const seiten = doc.pageCount;
  // Fusszeilen mit korrekter Seitenzahl auf allen Seiten nachziehen.
  doc.pages.forEach((_, index) => {
    doc.page = doc.pages[index];
    fuss(doc, model, index + 1, seiten);
  });

  return alsDokument ? doc : doc.build();
}
