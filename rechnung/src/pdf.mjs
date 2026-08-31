/* Minimaler PDF-Generator (ohne Fremdbibliotheken).
 *
 * Erzeugt echte Vektor-PDFs mit den Standardschriften Helvetica /
 * Helvetica-Bold / Helvetica-Oblique (WinAnsi-Kodierung, inkl. Umlaute und
 * Euro-Zeichen). Das Koordinatensystem der API liegt oben links (wie im
 * Browser), intern wird auf das PDF-System (unten links) umgerechnet.
 */

export const A4 = { w: 595.28, h: 841.89 };

export const FONTS = { regular: 'F1', bold: 'F2', italic: 'F3' };

/* ---------------------------------------------------------------- Kodierung */

// Unicode -> WinAnsi-Byte fuer alles oberhalb von ASCII, was hier vorkommt.
const WIN_ANSI_SPECIAL = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
  '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Wandelt einen Unicode-String in eine WinAnsi-Bytefolge (als Latin1-String). */
export function toWinAnsi(input) {
  let out = '';
  for (const ch of String(input ?? '')) {
    const code = ch.codePointAt(0);
    if (code === 0x0a || code === 0x0d) { out += ' '; continue; }
    if (code >= 0x20 && code <= 0x7e) { out += ch; continue; }
    if (code >= 0xa0 && code <= 0xff) { out += ch; continue; }
    const special = WIN_ANSI_SPECIAL[ch];
    out += special !== undefined ? String.fromCharCode(special) : '?';
  }
  return out;
}

function escapePdfString(latin1) {
  return latin1.replace(/([\\()])/g, '\\$1');
}

/* --------------------------------------------------------------- Zeichenbreiten */

const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Akzentbuchstaben haben in Helvetica die Breite ihres Grundbuchstabens.
const ACCENT_BASE =
  'AAAAAAECEEEEIIIIDNOOOOOxOUUUUYPsaaaaaaeceeeeiiiidnooooo/ouuuuypy';

function buildWidthTable(ascii) {
  const widths = new Array(256).fill(ascii[0]);
  for (let i = 32; i <= 126; i += 1) widths[i] = ascii[i - 32];
  const w = (ch) => ascii[ch.charCodeAt(0) - 32];
  for (let i = 0xc0; i <= 0xff; i += 1) widths[i] = w(ACCENT_BASE[i - 0xc0]);
  widths[0xdf] = w('s');           // ss
  widths[0x80] = w('E');           // Euro
  widths[0x91] = widths[0x92] = w("'");
  widths[0x93] = widths[0x94] = w('"');
  widths[0x95] = w('o');           // bullet
  widths[0x96] = w('-') * 1.5;     // en dash
  widths[0x97] = w('-') * 2;       // em dash
  widths[0x85] = w('.') * 3;       // ellipsis
  widths[0xa0] = w(' ');
  widths[0xa9] = widths[0xae] = w('O');
  widths[0xb7] = w('.');           // middle dot
  return widths;
}

const WIDTHS = {
  F1: buildWidthTable(HELVETICA_ASCII),
  F2: buildWidthTable(HELVETICA_BOLD_ASCII),
  F3: buildWidthTable(HELVETICA_ASCII),
};

/** Textbreite in Punkt. */
export function measure(text, font = FONTS.regular, size = 10) {
  const table = WIDTHS[font] || WIDTHS.F1;
  const bytes = toWinAnsi(text);
  let total = 0;
  for (let i = 0; i < bytes.length; i += 1) total += table[bytes.charCodeAt(i)];
  return (total * size) / 1000;
}

/** Bricht Text auf maxWidth um; respektiert vorhandene Zeilenumbrueche. */
export function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/* ------------------------------------------------------------------ Dokument */

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();

export class PdfDoc {
  constructor({ width = A4.w, height = A4.h, title = 'Rechnung', author = '' } = {}) {
    this.width = width;
    this.height = height;
    this.title = title;
    this.author = author;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.pages.push([]);
    this.page = this.pages[this.pages.length - 1];
    return this.pages.length;
  }

  get pageCount() { return this.pages.length; }

  /** y von oben -> PDF-y von unten. */
  _y(y) { return this.height - y; }

  _color(rgb) {
    const [r, g, b] = rgb;
    return `${fmt(r / 255)} ${fmt(g / 255)} ${fmt(b / 255)}`;
  }

  rect(x, y, w, h, { fill, stroke, lineWidth = 0.6, radius = 0 } = {}) {
    this.page.push({ art: 'rect', x, y, w, h, fill, stroke, lineWidth, radius });
  }

  line(x1, y1, x2, y2, { color = [0, 0, 0], width = 0.6, dash = null } = {}) {
    this.page.push({ art: 'linie', x1, y1, x2, y2, color, width, dash });
  }

  /**
   * Setzt eine Textzeile. y ist die Grundlinie (Baseline) von oben gemessen.
   * align: 'left' | 'right' | 'center' – die Ausrichtung wird sofort in eine
   * linke x-Position umgerechnet, damit PDF und Bildschirm identisch sitzen.
   */
  text(content, x, y, {
    font = FONTS.regular, size = 10, color = [0, 0, 0], align = 'left',
    charSpacing = 0, opacity = 1,
  } = {}) {
    const raw = String(content ?? '');
    if (!raw) return;
    let breite = measure(raw, font, size);
    if (charSpacing) breite += charSpacing * (toWinAnsi(raw).length - 1);
    let tx = x;
    if (align === 'right') tx = x - breite;
    else if (align === 'center') tx = x - breite / 2;
    this.page.push({ art: 'text', text: raw, x: tx, y, font, size, color, charSpacing, opacity });
  }

  /** Mehrzeiliger Text; gibt die y-Position nach dem letzten Umbruch zurueck. */
  paragraph(content, x, y, maxWidth, {
    font = FONTS.regular, size = 10, color = [0, 0, 0], leading = null, align = 'left',
  } = {}) {
    const step = leading ?? size * 1.35;
    let cursor = y;
    for (const lineText of wrapText(content, font, size, maxWidth)) {
      if (lineText) this.text(lineText, x, cursor, { font, size, color, align });
      cursor += step;
    }
    return cursor;
  }

  /** Wandelt die gesammelten Befehle einer Seite in einen PDF-Inhaltsstrom. */
  _inhalt(ops) {
    const zeilen = [];
    for (const op of ops) {
      if (op.art === 'rect') zeilen.push(this._rechteck(op));
      else if (op.art === 'linie') zeilen.push(this._linie(op));
      else zeilen.push(this._text(op));
    }
    return zeilen.join('\n');
  }

  _rechteck({ x, y, w, h, fill, stroke, lineWidth, radius }) {
    const ops = [];
    if (fill) ops.push(`${this._color(fill)} rg`);
    if (stroke) ops.push(`${this._color(stroke)} RG`, `${fmt(lineWidth)} w`);
    const y0 = this._y(y + h);
    if (radius > 0) {
      const r = Math.min(radius, w / 2, h / 2);
      const k = r * 0.5523;
      const x1 = x + w;
      const y1 = y0 + h;
      ops.push(`${fmt(x + r)} ${fmt(y0)} m`);
      ops.push(`${fmt(x1 - r)} ${fmt(y0)} l`);
      ops.push(`${fmt(x1 - r + k)} ${fmt(y0)} ${fmt(x1)} ${fmt(y0 + r - k)} ${fmt(x1)} ${fmt(y0 + r)} c`);
      ops.push(`${fmt(x1)} ${fmt(y1 - r)} l`);
      ops.push(`${fmt(x1)} ${fmt(y1 - r + k)} ${fmt(x1 - r + k)} ${fmt(y1)} ${fmt(x1 - r)} ${fmt(y1)} c`);
      ops.push(`${fmt(x + r)} ${fmt(y1)} l`);
      ops.push(`${fmt(x + r - k)} ${fmt(y1)} ${fmt(x)} ${fmt(y1 - r + k)} ${fmt(x)} ${fmt(y1 - r)} c`);
      ops.push(`${fmt(x)} ${fmt(y0 + r)} l`);
      ops.push(`${fmt(x)} ${fmt(y0 + r - k)} ${fmt(x + r - k)} ${fmt(y0)} ${fmt(x + r)} ${fmt(y0)} c`);
      ops.push('h');
    } else {
      ops.push(`${fmt(x)} ${fmt(y0)} ${fmt(w)} ${fmt(h)} re`);
    }
    ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
    return `q ${ops.join(' ')} Q`;
  }

  _linie({ x1, y1, x2, y2, color, width, dash }) {
    const ops = [`${this._color(color)} RG`, `${fmt(width)} w`];
    if (dash) ops.push(`[${dash.map(fmt).join(' ')}] 0 d`);
    ops.push(`${fmt(x1)} ${fmt(this._y(y1))} m ${fmt(x2)} ${fmt(this._y(y2))} l S`);
    return `q ${ops.join(' ')} Q`;
  }

  _text({ text, x, y, font, size, color, charSpacing, opacity }) {
    const ops = ['BT', `/${font} ${fmt(size)} Tf`, `${this._color(color)} rg`];
    if (charSpacing) ops.push(`${fmt(charSpacing)} Tc`);
    ops.push(`${fmt(x)} ${fmt(this._y(y))} Td`);
    ops.push(`(${escapePdfString(toWinAnsi(text))}) Tj`);
    ops.push('ET');
    const alpha = opacity < 1 ? '/GS75 gs ' : '';
    return `q ${alpha}${ops.join(' ')} Q`;
  }

  build() {
    const objects = [];
    const push = (body) => { objects.push(body); return objects.length; };

    const pageIds = [];
    const contentIds = [];
    // Platzhalter fuer Katalog (1) und Seitenbaum (2)
    push('');
    push('');

    const fontIds = {
      F1: push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      F2: push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
      F3: push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'),
    };
    const gsId = push('<< /Type /ExtGState /ca 0.75 /CA 0.75 >>');

    this.pages.forEach((ops) => {
      const stream = this._inhalt(ops);
      contentIds.push(push(`<< /Length ${toWinAnsi(stream).length} >>\nstream\n${stream}\nendstream`));
    });

    this.pages.forEach((_, i) => {
      pageIds.push(push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(this.height)}] ` +
        `/Resources << /Font << /F1 ${fontIds.F1} 0 R /F2 ${fontIds.F2} 0 R /F3 ${fontIds.F3} 0 R >> ` +
        `/ExtGState << /GS75 ${gsId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
      ));
    });

    const infoId = push(
      `<< /Title (${escapePdfString(toWinAnsi(this.title))}) ` +
      `/Author (${escapePdfString(toWinAnsi(this.author))}) ` +
      `/Producer (Rechnungs-Generator) /Creator (Rechnungs-Generator) >>`,
    );

    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefPos = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n`;
    pdf += `startxref\n${xrefPos}\n%%EOF\n`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return bytes;
  }
}

/* ------------------------------------------------------------ Bildschirm */

const CANVAS_FONT = {
  F1: 'Helvetica, Arial, sans-serif',
  F2: 'Helvetica, Arial, sans-serif',
  F3: 'Helvetica, Arial, sans-serif',
};

function css(rgb) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

/**
 * Zeichnet eine Seite des Dokuments auf ein Canvas – dieselben Befehle wie im
 * PDF, damit Vorschau und Datei identisch aussehen. Funktioniert auch dort,
 * wo eingebettete PDFs nicht angezeigt werden (Handy, Vorschaufenster).
 */
export function zeichneSeite(doc, seitenIndex, leinwand, { skala = 1, dichte = 1 } = {}) {
  const ctx = leinwand.getContext('2d');
  const gesamt = skala * dichte;
  leinwand.width = Math.round(doc.width * gesamt);
  leinwand.height = Math.round(doc.height * gesamt);
  leinwand.style.width = `${doc.width * skala}px`;
  leinwand.style.height = `${doc.height * skala}px`;
  ctx.setTransform(gesamt, 0, 0, gesamt, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, doc.width, doc.height);

  for (const op of doc.pages[seitenIndex] || []) {
    if (op.art === 'rect') zeichneRechteck(ctx, op);
    else if (op.art === 'linie') zeichneLinie(ctx, op);
    else zeichneText(ctx, op);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function pfadRechteck(ctx, { x, y, w, h, radius }) {
  ctx.beginPath();
  if (radius > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
  else if (radius > 0) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  } else ctx.rect(x, y, w, h);
}

function zeichneRechteck(ctx, op) {
  pfadRechteck(ctx, op);
  if (op.fill) { ctx.fillStyle = css(op.fill); ctx.fill(); }
  if (op.stroke) { ctx.strokeStyle = css(op.stroke); ctx.lineWidth = op.lineWidth; ctx.stroke(); }
}

function zeichneLinie(ctx, { x1, y1, x2, y2, color, width, dash }) {
  ctx.save();
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function zeichneText(ctx, { text, x, y, font, size, color, charSpacing, opacity }) {
  ctx.save();
  ctx.globalAlpha = opacity ?? 1;
  ctx.fillStyle = css(color);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${font === FONTS.italic ? 'italic ' : ''}${font === FONTS.bold ? '700 ' : ''}${size}px ${CANVAS_FONT[font]}`;
  if (charSpacing) {
    // Buchstabenabstand von Hand setzen – exakt wie im PDF.
    let cursor = x;
    for (const zeichen of text) {
      ctx.fillText(zeichen, cursor, y);
      cursor += measure(zeichen, font, size) + charSpacing;
    }
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}
