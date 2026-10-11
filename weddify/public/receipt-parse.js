// Liest aus dem erkannten Text eines Kassenzettels oder einer Rechnung: Gesamtbetrag, Datum, Händler und eine Kategorie.
// Reine Funktion ohne Browser-Abhängigkeiten, damit sie auch im Test läuft.

const AMOUNT = /(?<![\d.,])(\d{1,3}(?:[.\s]\d{3})+|\d+)\s?[,.]\s?(\d{2})(?![\d])/g;
const STRONG = /(zu\s*zahlen|gesamtbetrag|gesamtsumme|endbetrag|rechnungsbetrag|zahlbetrag|summe|gesamt|total|brutto|betrag)/i;
const WEAK = /\b(bar|ec[\s-]?karte|girocard|kartenzahlung|visa|mastercard|eur)\b/i;
const EXCLUDE = /(zwischensumme|zw\.?-?summe|mwst|ust|netto|steuer|rückgeld|rueckgeld|zurück|gegeben|rabatt|pfand|nr\.|tel|fax|iban|steuernr)/i;

export const CAT_HINTS = [
  ['florist', /blume|florist|blüten|bluten|fleurop|gärtnerei|gartnerei/i],
  ['deko', /deko|depot|ikea|tedi|action|nanu|butlers|kerze|ballon|bastel/i],
  ['torte', /bäckerei|backerei|konditorei|backhaus|torte|kuchen|patisserie/i],
  ['getraenke', /getränke|getranke|metro|selgros|trinkgut|weinhandel|\bwein|bier|spirituosen/i],
  ['catering', /catering|partyservice|restaurant|metzgerei|fleischerei|imbiss|gastronomie/i],
  ['papeterie', /druck|copy|kopie|papeterie|vistaprint|flyeralarm|papier|schreibwaren|briefmarke|deutsche post/i],
  ['styling', /friseur|frisör|salon|kosmetik|douglas|make-?up|nagel|beauty/i],
  ['brautmode', /braut|brautmode|brautkleid/i],
  ['herrenmode', /anzug|herrenmode|herrenausstatter|krawatte/i],
  ['ringe', /juwelier|schmuck|goldschmied|trauring|ring/i],
  ['transport', /tankstelle|aral|shell|esso|\bjet\b|taxi|deutsche bahn|\bdb\b|autovermietung|sixt|europcar|parkhaus/i],
  ['gastgeschenke', /gastgeschenk|confiserie|mandel|süßwaren|suswaren|şeker|seker/i],
  ['henna', /henna/i],
  ['location', /saal|location|vermietung|festhalle|eventhalle/i],
  ['fotograf', /foto|photo/i],
  ['dj', /\bdj\b|musik|tonstudio|band/i],
];

const HAS_AMOUNT = /\d+\s?[,.]\s?\d{2}(?!\d)/;
const toNum = (a, b) => Number(a.replace(/[.\s]/g, '') + '.' + b);

export function parseReceipt(text, cats = null) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Betrag: Zeile mit starkem Stichwort, sonst schwachem, sonst größter Betrag
  let best = null;
  lines.forEach((line, i) => {
    if (EXCLUDE.test(line)) return;
    const prio = STRONG.test(line) ? 2 : WEAK.test(line) ? 1 : 0;
    if (!prio) return;
    let m; const found = []; AMOUNT.lastIndex = 0;
    while ((m = AMOUNT.exec(line))) found.push(toNum(m[1], m[2]));
    // Betrag steht manchmal in der nächsten Zeile
    if (!found.length && lines[i + 1]) { AMOUNT.lastIndex = 0; while ((m = AMOUNT.exec(lines[i + 1]))) found.push(toNum(m[1], m[2])); }
    const v = found.length ? found[found.length - 1] : null;
    if (v != null && v > 0 && (!best || prio > best.prio || (prio === best.prio && v > best.v))) best = { v, prio };
  });
  if (!best) {
    let max = 0;
    for (const line of lines) { if (EXCLUDE.test(line)) continue; let m; AMOUNT.lastIndex = 0; while ((m = AMOUNT.exec(line))) max = Math.max(max, toNum(m[1], m[2])); }
    if (max > 0) best = { v: max, prio: 0 };
  }
  // Datum: erstes gültiges Datum, nicht weiter als ein Jahr in der Zukunft
  let date = '';
  const now = new Date();
  for (const line of lines) {
    const m = /(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?!\d)/.exec(line);
    if (!m) continue;
    let [, d, mo, y] = m; y = y.length === 2 ? '20' + y : y;
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const t = new Date(iso + 'T12:00:00');
    if (!isNaN(t) && t.getMonth() + 1 === +mo && t - now < 366 * 864e5 && t.getFullYear() > 2015) { date = iso; break; }
  }
  // Händler: erste Zeile mit Buchstaben, ohne Beträge/Datum/Adressen-Nummern
  const merchant = (lines.find(l => /[A-Za-zÄÖÜäöüß]{3,}/.test(l) && !HAS_AMOUNT.test(l) && !/\d{1,2}[.\/]\d{1,2}[.\/]\d{2}/.test(l) && !/^(kassenbon|beleg|rechnung|quittung|bon)\b/i.test(l)) || '')
    .replace(/[^\p{L}\p{N}&+.,' -]/gu, '').replace(/\s{2,}/g, ' ').trim().slice(0, 60);
  // Kategorie aus Stichworten, nur wenn sie im Budget existiert
  let cat = '';
  for (const [c, re] of CAT_HINTS) if (re.test(text) && (!cats || cats.includes(c))) { cat = c; break; }
  return { amount: best ? Math.round(best.v * 100) / 100 : null, date, merchant, cat, sure: !!best && best.prio === 2 };
}
