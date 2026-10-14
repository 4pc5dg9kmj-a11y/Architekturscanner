// Spiele-Rubrik für Trauzeug:innen: druckbare Hochzeitsspiele, automatisch mit Namen, Datum, Ort,
// Tischen und Gästezahl befüllt. Jeder Inhalt lässt sich anpassen. Das Paar sieht diese Seite nicht.
import { DESIGNS, qrSvg } from './print.js';

/* ---------- Hilfen ---------- */
// Reproduzierbarer Zufall: gleiche Karten bei jedem Druck, trotzdem jede Karte anders
export function rng(seed) {
  let a = 0; for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0);
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(arr, r) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const lines = t => String(t || '').split('\n').map(s => s.trim()).filter(Boolean);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
// Rätselbuchstaben: Umlaute wie in deutschen Kreuzworträtseln
export const puzzleWord = w => String(w).toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ẞ|ß/g, 'SS').replace(/[^A-Z]/g, '');

/* ---------- Quiz-Format: "Frage | Antwort | *richtige Antwort | Antwort" ---------- */
export function parseQuiz(text) {
  return lines(text).map(l => {
    const [q, ...opts] = l.split('|').map(s => s.trim());
    const answers = opts.filter(Boolean).map(o => ({ t: o.replace(/^\*/, '').trim(), ok: o.startsWith('*') }));
    return { q, answers };
  }).filter(x => x.q);
}

/* ---------- Wortsuchrätsel ---------- */
export function wordSearch(words, size, seed, dirs = 8) {
  const r = rng(seed);
  const D = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]].slice(0, dirs);
  const grid = Array.from({ length: size }, () => Array(size).fill(''));
  const placed = [], skipped = [];
  const list = [...new Set(words.map(puzzleWord).filter(w => w.length >= 3 && w.length <= size))].sort((a, b) => b.length - a.length);
  for (const w of [...new Set(words.map(puzzleWord))].filter(w => w.length > size || w.length < 3)) skipped.push(w);
  for (const w of list) {
    let ok = false;
    for (let tries = 0; tries < 400 && !ok; tries++) {
      const [dr, dc] = D[Math.floor(r() * D.length)];
      const r0 = Math.floor(r() * size), c0 = Math.floor(r() * size);
      const er = r0 + dr * (w.length - 1), ec = c0 + dc * (w.length - 1);
      if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
      let fits = true;
      for (let i = 0; i < w.length; i++) { const ch = grid[r0 + dr * i][c0 + dc * i]; if (ch && ch !== w[i]) { fits = false; break; } }
      if (!fits) continue;
      const cells = [];
      for (let i = 0; i < w.length; i++) { grid[r0 + dr * i][c0 + dc * i] = w[i]; cells.push([r0 + dr * i, c0 + dc * i]); }
      placed.push({ w, cells }); ok = true;
    }
    if (!ok) skipped.push(w);
  }
  const ABC = 'AEEINRSTLHOUDGMBKCFWZPV';
  const solution = grid.map(row => row.map(Boolean));
  for (const row of grid) for (let c = 0; c < size; c++) if (!row[c]) row[c] = ABC[Math.floor(r() * ABC.length)];
  return { grid, placed, skipped, solution };
}

/* ---------- Kreuzworträtsel ---------- */
export function crossword(pairs) {
  const items = pairs.map(p => ({ clue: p.clue, w: puzzleWord(p.answer) })).filter(p => p.w.length >= 2).sort((a, b) => b.w.length - a.w.length);
  const cells = new Map(); const key = (r, c) => r + ',' + c;
  const placed = [], skipped = [];
  const canPlace = (w, r, c, dir) => {
    const [dr, dc] = dir === 'h' ? [0, 1] : [1, 0];
    if (cells.has(key(r - dr, c - dc)) || cells.has(key(r + dr * w.length, c + dc * w.length))) return -1;
    let cross = 0;
    for (let i = 0; i < w.length; i++) {
      const rr = r + dr * i, cc = c + dc * i; const ex = cells.get(key(rr, cc));
      if (ex) { if (ex.ch !== w[i] || ex[dir]) return -1; cross++; continue; }
      // Nachbarn quer zur Laufrichtung müssen frei sein
      if (cells.has(key(rr + dc, cc + dr)) || cells.has(key(rr - dc, cc - dr))) return -1;
    }
    return cross;
  };
  const put = (it, r, c, dir) => {
    const [dr, dc] = dir === 'h' ? [0, 1] : [1, 0];
    for (let i = 0; i < it.w.length; i++) { const k = key(r + dr * i, c + dc * i); const ex = cells.get(k) || { ch: it.w[i] }; ex[dir] = true; cells.set(k, ex); }
    placed.push({ ...it, r, c, dir });
  };
  if (!items.length) return { placed, skipped, rows: 0, cols: 0 };
  put(items[0], 0, 0, 'h');
  for (const it of items.slice(1)) {
    let best = null;
    for (const p of placed) for (let i = 0; i < p.w.length; i++) for (let j = 0; j < it.w.length; j++) {
      if (p.w[i] !== it.w[j]) continue;
      const dir = p.dir === 'h' ? 'v' : 'h';
      const r = p.dir === 'h' ? p.r - j : p.r + i, c = p.dir === 'h' ? p.c + i : p.c - j;
      const cross = canPlace(it.w, r, c, dir); if (cross < 1) continue;
      // kompakt halten: kleinste Ausdehnung gewinnt
      const all = [...cells.keys()].map(k => k.split(',').map(Number));
      const end = dir === 'h' ? [r, c + it.w.length - 1] : [r + it.w.length - 1, c];
      const rs = all.map(a => a[0]).concat(r, end[0]), cs = all.map(a => a[1]).concat(c, end[1]);
      const area = (Math.max(...rs) - Math.min(...rs) + 1) * (Math.max(...cs) - Math.min(...cs) + 1);
      const score = cross * 1000 - area;
      if (!best || score > best.score) best = { r, c, dir, score };
    }
    if (best) put(it, best.r, best.c, best.dir); else skipped.push(it);
  }
  const rs = [...cells.keys()].map(k => +k.split(',')[0]), cs = [...cells.keys()].map(k => +k.split(',')[1]);
  const r0 = Math.min(...rs), c0 = Math.min(...cs);
  for (const p of placed) { p.r -= r0; p.c -= c0; }
  // Nummerieren in Leserichtung
  const starts = new Map();
  for (const p of [...placed].sort((a, b) => a.r - b.r || a.c - b.c)) { const k = key(p.r, p.c); if (!starts.has(k)) starts.set(k, starts.size + 1); p.no = starts.get(k); }
  const grid = Array.from({ length: Math.max(...rs) - r0 + 1 }, () => Array(Math.max(...cs) - c0 + 1).fill(null));
  for (const p of placed) for (let i = 0; i < p.w.length; i++) { const rr = p.r + (p.dir === 'v' ? i : 0), cc = p.c + (p.dir === 'h' ? i : 0); grid[rr][cc] = { ch: p.w[i], no: grid[rr][cc]?.no || (i === 0 ? p.no : 0) }; }
  return { placed, skipped, grid, rows: grid.length, cols: grid[0].length };
}

/* ---------- Katalog ---------- */
// fields: [key, label, type ('lines'|'quiz'|'pairs'|'text'|'input'), hint]
export const CATS = ['Am Tisch', 'Rätsel', 'Zum Mitmachen', 'Erinnerungen', 'Kinder', 'Moderation', 'Traditionen'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const GAMES = [
  { k: 'quiz', t: 'Hochzeitsquiz', cat: 'Am Tisch', per: 'gast', fmt: 'Langkarte 99 × 210 mm, 2 pro A4', dur: 15, mat: 'Stifte auf jedem Tisch, Lösungsblatt, kleiner Preis',
    how: 'Wie gut kennen die Gäste das Paar? Die Karten liegen beim Essen auf den Plätzen. Vor dem Dessert sammelt ihr ein, wertet aus und ehrt die Siegerin oder den Sieger. Die richtige Antwort markiert ihr mit einem * davor.',
    fields: [['questions', 'Fragen', 'quiz', 'Eine Frage pro Zeile: Frage | Antwort | *richtige Antwort | Antwort'], ['prize', 'Preis für die Siegerin oder den Sieger', 'input']],
    def: E => ({ questions: [
      `Wer hat zuerst „Ich liebe dich“ gesagt? | ${E.a} | ${E.b} | Beide gleichzeitig`,
      `Wer hat den Heiratsantrag gemacht? | ${E.a} | ${E.b} | Es war eine gemeinsame Entscheidung`,
      `Wo haben sich die beiden kennengelernt? | Über Freunde | Online | Bei der Arbeit oder im Studium`,
      `Wie lange sind die beiden schon ein Paar? | Unter 3 Jahre | 3 bis 6 Jahre | Mehr als 6 Jahre`,
      `Wer braucht morgens länger im Bad? | ${E.a} | ${E.b} | Beide gleich lang`,
      `Wer kocht zu Hause öfter? | ${E.a} | ${E.b} | Der Lieferdienst`,
      `Wer verliert öfter den Schlüssel? | ${E.a} | ${E.b} | Beide`,
      `Wohin ging der erste gemeinsame Urlaub? | Ans Meer | In die Berge | In eine Stadt`,
      `Wer schläft beim Filmabend zuerst ein? | ${E.a} | ${E.b} | Keiner, Filmabend heißt Serienmarathon`,
      `Was war das erste gemeinsame Date? | Essen gehen | Kino | Etwas ganz anderes`,
    ].join('\n'), prize: 'Die erste Flasche vom Sektempfang' }) },
  { k: 'bingo', t: 'Hochzeits-Bingo', cat: 'Am Tisch', per: 'gast', fmt: 'A6, 4 pro A4, jede Karte anders', dur: 0, mat: 'Stifte, Preis für das erste Bingo',
    how: 'Läuft den ganzen Abend nebenbei. Wer einen Moment erlebt, kreuzt ihn an. Wer zuerst eine volle Reihe, Spalte oder Diagonale hat, ruft „Bingo!“ und holt sich den Preis bei den Trauzeug:innen. Jede Karte ist anders gemischt, das Mittelfeld ist frei.',
    fields: [['fields', 'Bingo-Felder (mindestens 24)', 'lines', 'Ein Moment pro Zeile']],
    def: E => ({ fields: [
      'Jemand weint bei der Trauung', 'Ein Kind tanzt allein auf der Tanzfläche', `${E.a} lacht laut los`, `${E.b} wischt sich eine Träne weg`, 'Ein Handy klingelt während einer Rede',
      'Jemand verschüttet ein Getränk', 'Jemand ruft „Küssen!“', 'Das Paar küsst sich auf Zuruf', 'Ein Gast trägt Hut', 'Jemand zieht die Schuhe aus',
      'Die Rede dauert länger als 10 Minuten', 'Jemand tanzt mit geschlossenen Augen', 'Der DJ spielt einen Schlager', 'Jemand fotografiert mit einem Tablet', 'Ein Gast verpasst den Einzug',
      'Jemand fragt nach dem WLAN', 'Die Torte wird angeschnitten', 'Jemand singt laut mit', 'Ein Gast schläft kurz ein', 'Ein Paar tanzt Walzer',
      'Jemand erzählt eine peinliche Geschichte', 'Jemand holt sich eine zweite Portion Dessert', 'Ein Gast verliert etwas', 'Jemand macht ein Selfie mit dem Paar', 'Jemand trägt Turnschuhe zum Anzug',
      'Der Brautstrauß wird gefangen', 'Jemand tanzt auf einem Stuhl', 'Ein Gast spricht mit der Band oder dem DJ', 'Es fällt das Wort „Schwiegermutter“', 'Jemand bringt einen Toast aus',
    ].join('\n') }) },
  { k: 'menschenbingo', t: 'Gäste-Bingo „Finde jemanden, der …“', cat: 'Zum Mitmachen', per: 'gast', fmt: 'A6, 4 pro A4, jede Karte anders', dur: 30, mat: 'Stifte',
    how: 'Das Kennenlern-Spiel für Sektempfang oder Kaffee. Wer jemanden findet, auf den ein Feld passt, lässt ihn oder sie dort unterschreiben. Jede Person darf nur einmal pro Karte unterschreiben. Perfekt, wenn sich die Familien noch nicht kennen.',
    fields: [['fields', 'Felder (mindestens 16)', 'lines', 'Ein Satz pro Zeile, beginnt mit „… der/die“']],
    def: E => ({ fields: [
      `… ${E.a} schon aus der Schulzeit kennt`, `… ${E.b} länger als 10 Jahre kennt`, '… im selben Monat Geburtstag hat wie du', '… mehr als 300 km angereist ist', '… schon einmal im Ausland gelebt hat',
      '… drei oder mehr Sprachen spricht', '… selbst verheiratet ist, länger als 25 Jahre', '… ein Instrument spielt', '… beim Antrag dabei war', '… dieselbe Lieblingsband hat wie du',
      '… heute zum ersten Mal auf einer Hochzeit ist', '… einen Hund hat', '… schon einmal Trauzeug:in war', '… morgen früh als Erste:r wieder wach ist', '… das Paar am ersten gemeinsamen Abend gesehen hat',
      '… Tango, Salsa oder Walzer tanzen kann', '… in einem anderen Land geboren ist', '… dieselbe Schuhgröße hat wie du', '… schon einmal einen Brautstrauß gefangen hat', '… ein Tattoo hat',
    ].join('\n') }) },
  { k: 'fotochallenge', t: 'Foto-Challenge', cat: 'Am Tisch', per: 'tisch', fmt: 'A6 pro Tisch, 4 pro A4', dur: 0, mat: 'Einwegkamera oder Handy pro Tisch, optional Upload-Link',
    how: 'Jeder Tisch bekommt eine Karte mit eigenen Foto-Aufgaben. Die Fotos landen in der geteilten Galerie. So bekommt das Paar Bilder, die der Fotograf nie macht. Mit Upload-Link wird ein QR-Code aufgedruckt.',
    fields: [['tasks', 'Foto-Aufgaben', 'lines', 'Eine Aufgabe pro Zeile, je Tisch werden 8 gemischt'], ['url', 'Upload-Link (z. B. geteiltes Album)', 'input']],
    def: E => ({ url: '', tasks: [
      'Ein Selfie mit dem Brautpaar', 'Euer ganzer Tisch schneidet eine Grimasse', 'Die schönsten Schuhe des Abends', 'Drei Generationen auf einem Bild', 'Jemand, der gerade herzlich lacht',
      'Ein Foto mit dem DJ oder der Band', 'Die Hände des Brautpaars', 'Jemand, der mit geschlossenen Augen tanzt', 'Ein Gruppenfoto mit einem Tisch, den ihr nicht kennt', 'Die Torte, bevor sie angeschnitten wird',
      'Euer Tisch stellt den Heiratsantrag nach', 'Das lustigste Accessoire', `Ein Foto, auf dem ${E.a} nicht hinsieht`, `${E.b} beim Tanzen`, 'Der Sonnenuntergang', 'Jemand, der heimlich nascht',
      'Ein Kuss, aber nicht vom Brautpaar', 'Die Trauzeug:innen in Aktion', 'Ein Herz aus Händen', 'Das älteste und das jüngste Paar zusammen',
    ].join('\n') }) },
  { k: 'tischquiz', t: 'Tisch-Duell', cat: 'Am Tisch', per: 'tisch', fmt: 'A6 pro Tisch, 4 pro A4', dur: 20, mat: 'Ein Stift pro Tisch, Moderationskarte',
    how: 'Die Tische spielen als Team gegeneinander. Ihr lest die Fragen nacheinander vor, jeder Tisch schreibt seine Antwort auf. Am Ende gewinnt der Tisch mit den meisten Punkten und darf als erster zum Buffet oder zum Dessert.',
    fields: [['questions', 'Fragen zum Vorlesen', 'quiz', 'Frage | *richtige Antwort'], ['prize', 'Preis für den Siegertisch', 'input']],
    def: E => ({ questions: [
      `In welcher Stadt wurde ${E.a} geboren? | *`, `Was ist das Lieblingsessen von ${E.b}? | *`, 'Wie viele Gäste sind heute eingeladen? | *' + E.guests,
      `An welchem Wochentag findet die Hochzeit statt? | *${E.weekday}`, 'Wie viele Stufen hat die Hochzeitstorte? | *', `Welchen Song wünscht sich ${E.a} für den ersten Tanz? | *`,
      'Wie heißt das Haustier der beiden (oder das Wunsch-Haustier)? | *', 'Wohin geht die Hochzeitsreise? | *',
    ].join('\n'), prize: 'Dürfen als Erste zum Dessert' }) },
  { k: 'ersie', t: `Schuhspiel „Wer von beiden …?“`, cat: 'Moderation', per: 'stk', fmt: 'Fragenliste A4 + 2 Namensschilder A4', dur: 15, mat: 'Zwei Stühle Rücken an Rücken, je ein Schuh von beiden oder die Schilder',
    how: 'Das Paar sitzt Rücken an Rücken und hält je einen Schuh von sich und einen vom Gegenüber (oder die Namensschilder). Ihr lest die Fragen vor, beide heben gleichzeitig hoch, wer gemeint ist. Die Gäste jubeln bei Übereinstimmung.',
    fields: [['questions', 'Fragen', 'lines', 'Eine Frage pro Zeile, Antwort ist eine der beiden Personen']],
    def: () => ({ questions: [
      'Wer hat den ersten Schritt gemacht?', 'Wer ist ordentlicher?', 'Wer hat das letzte Wort beim Streit?', 'Wer kann besser kochen?', 'Wer ist morgens schlechter gelaunt?',
      'Wer gibt mehr Geld aus?', 'Wer ist der bessere Autofahrer?', 'Wer entschuldigt sich zuerst?', 'Wer hat mehr Schuhe?', 'Wer ist romantischer?',
      'Wer schnarcht lauter?', 'Wer hat zuerst „Ich liebe dich“ gesagt?', 'Wer plant den Urlaub?', 'Wer hat beim Antrag geweint?', 'Wer wird nachts öfter zum Kühlschrank schleichen?',
    ].join('\n') }) },
  { k: 'wortsuche', t: 'Wortsuchrätsel', cat: 'Rätsel', per: 'gast', fmt: 'A6, 4 pro A4, plus Lösung', dur: 10, mat: 'Stifte',
    how: 'Ein Buchstabengitter mit Wörtern rund um das Paar, waagerecht, senkrecht und diagonal versteckt, auch rückwärts. Ideal für Wartezeiten, z. B. zwischen Trauung und Essen. Umlaute werden als AE, OE, UE geschrieben.',
    fields: [['words', 'Wörter', 'lines', 'Ein Wort pro Zeile, 3 bis 12 Buchstaben']],
    def: E => ({ words: [E.a, E.b, E.place, 'Liebe', 'Ringe', 'Jawort', 'Torte', 'Kuss', 'Tanzen', 'Trauung', 'Treue', 'Hochzeit', 'Strauss', 'Feiern'].filter(Boolean).join('\n') }) },
  { k: 'kreuzwort', t: 'Kreuzworträtsel', cat: 'Rätsel', per: 'gast', fmt: 'A4, plus Lösung', dur: 15, mat: 'Stifte',
    how: 'Ein Kreuzworträtsel über das Paar und den Tag. Die Wörter werden automatisch verschränkt. Passt gut auch in die Hochzeitszeitung.',
    fields: [['pairs', 'Hinweise und Lösungen', 'pairs', 'Eine Zeile pro Wort: Hinweis = LÖSUNG']],
    def: E => ({ pairs: [
      `Vorname der einen Hälfte des Brautpaars, beginnt mit ${E.a[0] || '?'} = ${E.a}`, `Vorname der anderen Hälfte, beginnt mit ${E.b[0] || '?'} = ${E.b}`,
      E.place && `Hier wird heute gefeiert = ${E.place}`, `Monat der Hochzeit = ${E.month}`, 'Wird bei der Trauung getauscht = Ringe', 'Süßes Highlight mit mehreren Etagen = Torte',
      'Wird von der Braut über die Schulter geworfen = Brautstrauss', 'Reise nach der Hochzeit = Flitterwochen', 'Das wichtigste Wort des Tages = Jawort',
      'Zeugen der Trauung = Trauzeugen', 'Das Gegenteil von Streit = Versoehnung', 'Ein Leben lang = Ewig',
    ].filter(Boolean).join('\n') }) },
  { k: 'lueckentext', t: 'Lückentext-Geschichte', cat: 'Zum Mitmachen', per: 'gast', fmt: 'Wortsammel-Karten A6 + Geschichte A4', dur: 15, mat: 'Stifte, Mikrofon',
    how: 'Die Gäste füllen die nummerierten Wörter aus, ohne die Geschichte zu kennen. Ihr sammelt die Karten ein, setzt die schönsten Wörter in die Geschichte und lest sie vor. Garantierte Lacher. In der Geschichte stehen Lücken als [Wortart].',
    fields: [['story', 'Geschichte', 'text', 'Lücken in eckigen Klammern, z. B. [Adjektiv]']],
    def: E => ({ story: `Es war einmal ein [Adjektiv] Tag in [Ort], als ${E.a} zum ersten Mal ${E.b} sah. ${E.b} trug gerade [Kleidungsstück] und aß [Essen]. ${E.a} dachte sofort: „Was für ein [Adjektiv] Mensch!“ und sagte ganz [Adjektiv]: „[Ausruf]!“\n\nSchon beim ersten Date gingen die beiden [Tätigkeit mit -en] und landeten am Ende in [Ort]. Seitdem streiten sie sich nur über [Gegenstand, Mehrzahl] und wer [Tätigkeit mit -en] muss.\n\nAls ${E.a} die Frage aller Fragen stellte, kniete ${E.a} auf [Gegenstand] nieder, und ${E.b} rief: „[Ausruf]!“ Heute, am ${E.date}, feiern wir mit [Zahl] [Tier, Mehrzahl] und sehr viel [Getränk]. Wir wünschen euch eine [Adjektiv] Ehe und für jeden Tag ein bisschen [Gefühl]!` }) },
  { k: 'prognosen', t: 'Wetten & Prognosen', cat: 'Zum Mitmachen', per: 'gast', fmt: 'A6, 4 pro A4', dur: 0, mat: 'Stifte, Sammelbox, Uhr',
    how: 'Die Gäste geben Tipps ab, ihr sammelt die Karten in einer Box. Am Ende des Abends wird aufgelöst: Wer am nächsten dran ist, gewinnt. Wenn ihr ein Schätzglas aufstellt, fragt ihr hier gleich mit.',
    fields: [['questions', 'Fragen', 'lines', 'Eine Frage pro Zeile']],
    def: E => ({ questions: [
      'Wie viele Minuten dauert die längste Rede?', 'Um wie viel Uhr wird die Torte angeschnitten?', 'Wie viele Gäste tanzen beim ersten Lied nach dem Eröffnungstanz?',
      `Um wie viel Uhr verlassen ${E.a} und ${E.b} die Feier?`, 'Wie viele Paar Schuhe stehen um Mitternacht unter den Tischen?', 'Wie viele Herzen sind im Schätzglas?', 'Welches Lied wird am häufigsten gewünscht?',
    ].join('\n') }) },
  { k: 'ratschlaege', t: 'Ratschläge fürs Eheleben', cat: 'Erinnerungen', per: 'gast', fmt: 'A6, 4 pro A4', dur: 0, mat: 'Stifte, Box oder Album',
    how: 'Die Karten liegen auf den Plätzen oder an einem eigenen Tisch. Die Gäste schreiben ihre besten Tipps. Das Paar liest sie nach der Hochzeit, ein schönes Andenken neben dem Gästebuch.',
    fields: [['prompts', 'Fragen auf der Karte', 'lines', 'Eine Zeile pro Frage, 3 bis 5 passen gut']],
    def: () => ({ prompts: ['Mein bester Tipp für eine glückliche Ehe', 'Das solltet ihr unbedingt gemeinsam erleben', 'Wenn ihr euch mal streitet …', 'In zehn Jahren wünsche ich euch …'].join('\n') }) },
  { k: 'dateideen', t: 'Date-Ideen-Glas', cat: 'Erinnerungen', per: 'gast', fmt: 'Kärtchen 49 × 70 mm, 16 pro A4', dur: 0, mat: 'Ein großes Glas mit Etikett, Stifte',
    how: 'Jeder Gast schreibt eine Date-Idee auf ein Kärtchen und wirft es ins Glas. Das Paar zieht im ersten Ehejahr regelmäßig eine Karte. Das Etikett für das Glas wird mitgedruckt.',
    fields: [['label', 'Etikett auf dem Glas', 'input']],
    def: () => ({ label: 'Ein Jahr voller Dates' }) },
  { k: 'briefe', t: 'Briefe für später', cat: 'Erinnerungen', per: 'stk', fmt: 'Umschlag-Etiketten A6, 4 pro A4', dur: 0, mat: 'Umschläge C6, Briefpapier, Box',
    how: 'Gäste schreiben Briefe für besondere Momente der Ehe. Auf jedem Umschlag klebt ein Etikett, wann er geöffnet werden darf. Die Daten der Hochzeitstage werden automatisch berechnet.',
    fields: [['occasions', 'Anlässe', 'lines', 'Ein Anlass pro Zeile. {1} wird zum Datum des 1. Hochzeitstags, {5} zum 5. usw.']],
    def: () => ({ occasions: ['am ersten Hochzeitstag, {1}', 'nach eurem ersten Streit', 'an einem verregneten Sonntag', 'wenn ihr in ein neues Zuhause zieht', 'am fünften Hochzeitstag, {5}', 'nach einem richtig stressigen Tag', 'wenn ihr Grund zum Feiern habt', 'am zehnten Hochzeitstag, {10}'].join('\n') }) },
  { k: 'wunschkarten', t: 'Wunschkarten', cat: 'Erinnerungen', per: 'gast', fmt: 'Kärtchen 99 × 70 mm, 8 pro A4', dur: 0, mat: 'Stifte, Wunschbaum (Zweige in Vase) mit Band, oder Laternen bzw. Ballons',
    how: 'Jeder Gast schreibt einen Wunsch für das Paar. Variante Wunschbaum: Karten mit Band an Zweige hängen. Variante Ballon: Rückantwort-Text mit Adresse (nur Naturlatex und Papierschnur, viele Gemeinden verbieten Ballonstarts, bitte vorher klären).',
    fields: [['variant', 'Variante', 'select:baum=Wunschbaum|ballon=Ballonflug'], ['address', 'Rücksende-Adresse (nur Ballonflug)', 'text']],
    def: () => ({ variant: 'baum', address: '' }) },
  { k: 'kinder', t: 'Kinder-Rätselbogen', cat: 'Kinder', per: 'kind', fmt: 'A4 pro Kind', dur: 0, mat: 'Buntstifte, kleine Preise',
    how: 'Ein Bogen mit Malfeld, Suchliste für die Feier und einem leichten Wortsuchrätsel. Hält Kinder beim Essen und während der Reden beschäftigt.',
    fields: [['find', 'Finde auf der Feier', 'lines', 'Eine Sache pro Zeile'], ['words', 'Leichte Wörter für das Rätsel', 'lines']],
    def: E => ({ find: ['die Hochzeitstorte', 'die Ringe', 'jemanden mit Hut', 'eine Blume im Knopfloch', 'den Brautstrauß', 'jemanden, der tanzt', 'eine Kerze', 'den Fotografen'].join('\n'), words: ['Torte', 'Ring', 'Kuss', 'Tanz', 'Herz', E.a.length <= 8 ? E.a : 'Liebe', 'Blume', 'Fest'].join('\n') }) },
  { k: 'moderation', t: 'Moderationskarten für Spiele ohne Papier', cat: 'Moderation', per: 'stk', fmt: 'A6, 4 pro A4', dur: 0, mat: 'Je nach Spiel',
    how: 'Spickzettel für die Klassiker, die ihr ansagt: Ablauf, Material und Text zum Vorlesen. Wählt aus, welche ihr spielt. Passend zu euren Traditionen sind kulturelle Spiele markiert.',
    fields: [['pick', 'Ausgewählte Spiele', 'pick']], def: () => ({ pick: 'baumstamm,schleiertanz,strauss' }) },
  { k: 'ausloesung', t: 'Brautauslösung & Türspiele', cat: 'Traditionen', per: 'stk', fmt: 'Stationenliste A4 + Aufgabenkarten A6', dur: 30, mat: 'Je nach Station, Kasse für das „Lösegeld“',
    trad: ['russisch', 'polnisch', 'chinesisch', 'orthodox', 'tuerkisch', 'kurdisch', 'indisch', 'sikh'],
    how: 'Vor der Abholung muss sich die Partnerin oder der Partner den Weg „freikaufen“, mit Aufgaben, Rätseln und kleinen Geldscheinen. Russisch: Wykup, chinesisch: Türspiele (堵门), polnisch, türkisch und kurdisch: Kapı parası, indisch: Joota Chupai. Die Stationen werden passend zu euren Traditionen vorgeschlagen.',
    fields: [['stations', 'Stationen', 'lines', 'Station: Aufgabe']],
    def: E => ({ stations: ausloesungDefaults(E).join('\n') }) },
];

export const MODERATION = {
  baumstamm: { t: 'Baumstamm sägen', trad: [], text: 'Nach der Trauung sägt das Paar gemeinsam mit einer Zugsäge einen Baumstamm durch. Es zeigt, dass beide Hindernisse zusammen meistern. Material: Sägebock, Stamm (Ø 15–20 cm), Zugsäge, Handschuhe. Spruch: „Wer gemeinsam zieht, kommt schneller durch.“' },
  schleiertanz: { t: 'Schleiertanz', trad: [], text: 'Um Mitternacht tanzen die Gäste mit der Braut und reißen dabei ein Stück vom Schleier (oder einem extra gekauften Tüll) ab. Wer ein Stück erwischt, soll Glück haben. Moderation: „Wer möchte ein Stück vom Glück?“ Bitte vorher mit der Braut klären.' },
  strauss: { t: 'Brautstraußwurf', trad: [], text: 'Alle unverheirateten Gäste versammeln sich. Mit dem Rücken zur Gruppe wirft die Person mit dem Strauß ihn über die Schulter. Gut ist ein zweiter, günstigerer Wurfstrauß. Zählt laut gemeinsam von drei herunter.' },
  herz: { t: 'Herz ausschneiden', trad: [], text: 'Ein Bettlaken mit aufgemaltem Herz wird gespannt. Das Paar schneidet mit Nagelscheren das Herz aus, ohne die Linie zu verlassen, und der Bräutigam trägt die Braut durch das Loch (oder beide steigen gemeinsam hindurch). Material: Laken, zwei Nagelscheren, zwei Helfer zum Halten.' },
  klopapier: { t: 'Brautkleid aus Klopapier', trad: [], text: 'Teams von 3–4 Gästen gestalten in 10 Minuten ein Kleid oder einen Anzug aus Toilettenpapier an einem „Model“. Das Paar kürt den Sieger. Material: 4 Rollen pro Team, Tesafilm, Stoppuhr.' },
  zeitungstanz: { t: 'Zeitungstanz', trad: [], text: 'Paare tanzen auf einer ausgebreiteten Zeitung. Bei jedem Musikstopp wird die Zeitung halbiert. Wer den Boden berührt, scheidet aus. Material: Zeitungen, Musik mit Pausen (DJ vorher briefen).' },
  ballontanz: { t: 'Luftballontanz', trad: [], text: 'Jeder Gast bindet sich einen Ballon ans Fußgelenk. Beim Tanzen versucht jeder, die Ballons der anderen zu zertreten und den eigenen zu schützen. Der letzte Ballon gewinnt. Vorsicht bei Kindern und High Heels.' },
  stuhltanz: { t: 'Reise nach Jerusalem, Paarversion', trad: [], text: 'Je ein Stuhl weniger als Paare. Die Paare tanzen, bei Musikstopp setzt sich eine Person auf den Stuhl, die andere auf ihren Schoß. Wer keinen Platz hat, scheidet aus.' },
  oczepiny: { t: 'Oczepiny', trad: ['polnisch'], text: 'Polnischer Brauch um Mitternacht: Die Braut gibt ihren Schleier ab und bekommt die Haube. Danach folgen Spiele, z. B. Schleier- und Krawattenwurf, Paar-Quiz oder „Wer ist wer“ mit verbundenen Augen. Mit der Kapelle die Musik absprechen.' },
  ayakkabi: { t: 'Namen auf der Schuhsohle', trad: ['tuerkisch', 'kurdisch'], text: 'Türkischer und kurdischer Brauch: Unverheiratete Freundinnen schreiben ihre Namen unter den Brautschuh. Wessen Name am Ende des Abends abgelaufen ist, heiratet als Nächste. Material: wasserfester Stift.' },
  joota: { t: 'Joota Chupai (Schuhe verstecken)', trad: ['indisch', 'sikh'], text: 'Während der Zeremonie verstecken die Schwestern und Cousinen der Braut die Schuhe des Bräutigams. Er bekommt sie erst gegen ein „Lösegeld“ zurück, über das lebhaft verhandelt wird.' },
  ringmilch: { t: 'Ring im Milchbad', trad: ['indisch', 'sikh', 'persisch'], text: 'Ein Ring wird in einer Schale mit Milch, Rosenblättern und Münzen versteckt. Das Paar sucht gleichzeitig. Wer den Ring zuerst findet, hat (scherzhaft) das Sagen im Haus. Meist dreimal gespielt.' },
  krawatte: { t: 'Krawatte versteigern', trad: ['spanisch', 'italienisch'], text: 'Spanischer und italienischer Brauch: Die Krawatte des Bräutigams wird in kleine Stücke geschnitten und an die Gäste verkauft. Der Erlös geht an das Paar. Material: Schere, Tablett, Sammelkörbchen.' },
  tuerspiele: { t: 'Türspiele (Chuangmen)', trad: ['chinesisch'], text: 'Am Morgen müssen der Bräutigam und seine Freunde an den Brautjungfern vorbei: saure, scharfe und bittere Speisen probieren, Fragen beantworten, Liebeserklärungen aufsagen und Hongbao (rote Umschläge) verteilen.' },
  wykup: { t: 'Wykup (Brautauslösung)', trad: ['russisch', 'orthodox'], text: 'Der Bräutigam löst seine Braut im Treppenhaus aus: auf jeder Stufe eine Aufgabe, für jede falsche Antwort ein Geldschein. Die Stationsliste und Aufgabenkarten findet ihr unter „Brautauslösung & Türspiele“.' },
};

function ausloesungDefaults(E) {
  const t = new Set(E.traditions);
  const out = [
    `Liebeserklärung: Sag zehn Komplimente für ${E.b}, ohne eines zu wiederholen.`,
    `Fotoraten: Erkenne ${E.b} auf drei Babyfotos.`,
    `Quiz: Wann und wo habt ihr euch kennengelernt? Lieblingsfarbe, Lieblingsessen, Schuhgröße von ${E.b}?`,
    'Ständchen: Sing das Lied eures ersten Tanzes oder ein Liebeslied mit den Trauzeugen.',
    'Lippenabdruck: Finde den Kussmund deiner Liebsten oder deines Liebsten unter fünf Abdrücken auf Papier.',
    'Schuh-Station: Der Schuh ist versteckt. Lösegeld oder die Aufgabe der Brautjungfern erfüllen.',
  ];
  if (t.has('chinesisch')) out.push('Fünf Geschmäcker: Probiere sauer, süß, bitter, scharf und salzig, wie das Leben, ohne das Gesicht zu verziehen.', 'Hongbao: Jede Brautjungfer bekommt einen roten Umschlag (Glücksbeträge mit 8, keine 4).');
  if (t.has('russisch') || t.has('orthodox')) out.push('Treppen-Wykup: Auf jeder Stufe ein Kosewort für die Braut, sonst ein Schein.', 'Schwiegermutter-Pfannkuchen: Erkenne den von ihr gebackenen Blin.');
  if (t.has('polnisch')) out.push('Brama (Tor): Die Nachbarn sperren den Weg. Gegen eine Flasche Wodka geht es weiter.');
  if (t.has('tuerkisch') || t.has('kurdisch')) out.push('Kapı parası: Ein Kind oder ein Geschwister sitzt auf der Mitgifttruhe bzw. vor der Tür und gibt den Weg nur gegen Geld frei.');
  if (t.has('indisch') || t.has('sikh')) out.push('Joota Chupai: Die Schuhe sind schon weg. Verhandle den Preis mit den Schwestern der Braut.');
  return out;
}

/* ---------- Seite ---------- */
export async function vGames(ctx) {
  const { api, S, esc, toast, view } = ctx;
  const wid = S.w.id;
  const [store, guestsRes, seat] = await Promise.all([api(`/api/w/${wid}/games`), api(`/api/w/${wid}/guests`), api(`/api/w/${wid}/seating`).catch(() => ({ data: null }))]);
  const D = store.data || {}; D.games ||= {}; D.plan ||= {};
  const P = seat.data || { items: [], names: {} }; P.items ||= []; P.names ||= {};
  const prof = S.w.profile || {};
  const live = guestsRes.guests.filter(g => g.status !== 'absage');
  const persons = live.reduce((s, g) => s + (g.status === 'zusage' ? g.persons : g.adults + g.kids), 0) || prof.guests || 60;
  const kids = live.reduce((s, g) => s + (g.kids || 0), 0);
  const tables = P.items.filter(i => i.kind === 'table').map(t => t.name).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
  const main = guestsRes.events.find(e => e.key === 'feier') || { date: S.w.date, location: S.w.location };
  const wd = new Date(S.w.date + 'T12:00:00');
  const E = { a: S.w.name1, b: S.w.name2, date: wd.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }), weekday: wd.toLocaleDateString('de-DE', { weekday: 'long' }), month: MONTHS[wd.getMonth()],
    place: (main.location || S.w.location || '').split(/[,·–-]/)[0].trim().split(/\s+/).find(w => w.length >= 4 && w.length <= 12) || '', guests: persons, traditions: prof.traditions || [] };
  const couple = `${E.a} & ${E.b}`;
  const opt = Object.assign({ game: null, design: D.design || prof.print?.design || 'klassisch', solution: true }, S.gameOpt || {});
  S.gameOpt = opt;
  const content = k => { const g = GAMES.find(x => x.k === k); return { ...g.def(E), ...(D.games[k] || {}) }; };
  const countFor = g => D.plan[g.k]?.count || (g.per === 'tisch' ? Math.max(1, tables.length || Math.ceil(persons / 8)) : g.per === 'kind' ? Math.max(1, kids) : g.per === 'stk' ? 1 : persons);
  const fitTrad = g => (g.trad || []).some(t => E.traditions.includes(t));
  let timer = null;
  const save = () => { clearTimeout(timer); timer = setTimeout(async () => { try { D.design = opt.design; await api(`/api/w/${wid}/games`, { method: 'PUT', body: { data: D } }); } catch (e) { toast(e.message); } }, 500); };

  /* ----- Druck-Renderer ----- */
  const head = (title, sub = '') => `<div class="k-eyebrow">${esc(title)}</div><div class="gm-names">${esc(couple)}</div>${sub ? `<div class="k-small">${esc(sub)}</div>` : ''}`;
  const nameLine = (lbl = 'Name') => `<div class="gm-name">${esc(lbl)}<span></span></div>`;
  const a6 = cards => chunk(cards, 4).map(c => `<div class="sheet sheet-a6">${c.map(x => `<div class="pc6 gm">${x}</div>`).join('')}</div>`).join('');
  const a4 = html => `<div class="sheet sheet-a4"><div class="a4 gm gm-a4">${html}</div></div>`;
  const nums = n => Array.from({ length: n }, (_, i) => i);
  const R = {
    quiz: c => {
      const qs = parseQuiz(c.questions); const n = countFor(GAMES[0]);
      const card = `${head('Hochzeitsquiz', 'Wie gut kennt ihr das Paar? Kreist die richtige Antwort ein.')}<ol class="gm-quiz">${qs.map(q => `<li><b>${esc(q.q)}</b>${q.answers.length ? `<span>${q.answers.map((a, i) => `<i>${'abcde'[i]}) ${esc(a.t)}</i>`).join('')}</span>` : '<span class="gm-line"></span>'}</li>`).join('')}</ol>${nameLine('Name & Tisch')}${c.prize ? `<div class="k-small">Zu gewinnen: ${esc(c.prize)}</div>` : ''}`;
      const sheets = chunk(nums(n), 2).map(c2 => `<div class="sheet sheet-dl">${c2.map(() => `<div class="dl gm gm-dl">${card}</div>`).join('')}</div>`).join('');
      return sheets + (opt.solution ? a4(`<div class="k-eyebrow">Lösungsblatt, nur für Trauzeug:innen</div><h2 class="gm-h">Hochzeitsquiz</h2><ol class="gm-sol">${qs.map(q => `<li>${esc(q.q)} <b>${esc(q.answers.filter(a => a.ok).map(a => a.t).join(' / ') || 'noch offen, bitte mit * markieren')}</b></li>`).join('')}</ol>`) : '');
    },
    bingo: c => bingoCards(lines(c.fields), 'Hochzeits-Bingo', 'Kreuzt an, was ihr heute erlebt. Volle Reihe? Ruft „Bingo!“', 'bingo', 5),
    menschenbingo: c => bingoCards(lines(c.fields), 'Finde jemanden, der …', 'Lass dir jedes Feld von einer anderen Person unterschreiben.', 'mb', 4),
    fotochallenge: c => {
      const tasks = lines(c.tasks); const names = tables.length ? tables : nums(countFor(GAMES.find(g => g.k === 'fotochallenge'))).map(i => `Tisch ${i + 1}`);
      const qr = c.url ? qrSvg(c.url) : '';
      return a6(names.map((t, i) => `${head('Foto-Challenge', t)}<ul class="gm-check">${shuffle(tasks, rng(wid + 'f' + i)).slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${qr ? `<div class="k-rsvp">${qr}<span>Fotos hochladen</span></div>` : '<div class="k-small">Zeigt die Fotos dem Paar oder ladet sie ins gemeinsame Album.</div>'}`));
    },
    tischquiz: c => {
      const qs = parseQuiz(c.questions); const names = tables.length ? tables : nums(countFor(GAMES.find(g => g.k === 'tischquiz'))).map(i => `Tisch ${i + 1}`);
      return a6(names.map(t => `${head('Tisch-Duell', t)}<ol class="gm-blank">${qs.map(() => '<li><span class="gm-line"></span></li>').join('')}</ol><div class="gm-name">Punkte<span></span></div>${c.prize ? `<div class="k-small">Siegertisch: ${esc(c.prize)}</div>` : ''}`))
        + a4(`<div class="k-eyebrow">Moderationskarte</div><h2 class="gm-h">Tisch-Duell</h2><ol class="gm-sol">${qs.map(q => `<li>${esc(q.q)} <b>${esc(q.answers.map(a => a.t).filter(Boolean).join(' / ') || '…')}</b></li>`).join('')}</ol>`);
    },
    ersie: c => a4(`<div class="k-eyebrow">Moderation</div><h2 class="gm-h">Wer von beiden …?</h2><p class="k-small">${esc(E.a)} und ${esc(E.b)} sitzen Rücken an Rücken und heben das Schild oder den Schuh der Person, die gemeint ist.</p><ol class="gm-sol">${lines(c.questions).map(q => `<li>${esc(q)}</li>`).join('')}</ol>`)
      + [E.a, E.b].map(n => a4(`<div class="gm-paddle">${esc(n)}</div>`)).join(''),
    wortsuche: c => {
      const ws = wordSearch(lines(c.words), 12, wid + 'ws', 8);
      const card = (sol) => `${head('Wortsuchrätsel', 'Findet alle Wörter: waagerecht, senkrecht, diagonal, auch rückwärts.')}${wsGrid(ws, sol)}<div class="gm-words">${ws.placed.map(p => `<span>${esc(p.w)}</span>`).join('')}</div>`;
      return a6(nums(countFor(GAMES.find(g => g.k === 'wortsuche'))).map(() => card(false))) + (opt.solution ? `<div class="sheet sheet-a6"><div class="pc6 gm">${card(true)}</div></div>` : '');
    },
    kreuzwort: c => {
      const cw = crossword(lines(c.pairs).map(l => { const i = l.lastIndexOf('='); return { clue: l.slice(0, i).trim(), answer: l.slice(i + 1).trim() }; }).filter(p => p.answer));
      const sheet = sol => a4(`${head('Kreuzworträtsel', sol ? 'Lösung' : `Rund um ${couple}. Umlaute als AE, OE, UE.`)}${cwGrid(cw, sol)}<div class="gm-clues"><div><b>Waagerecht</b><ol>${cw.placed.filter(p => p.dir === 'h').sort((a, b) => a.no - b.no).map(p => `<li value="${p.no}">${esc(p.clue)} <i>(${p.w.length})</i></li>`).join('')}</ol></div><div><b>Senkrecht</b><ol>${cw.placed.filter(p => p.dir === 'v').sort((a, b) => a.no - b.no).map(p => `<li value="${p.no}">${esc(p.clue)} <i>(${p.w.length})</i></li>`).join('')}</ol></div></div>${sol ? '' : nameLine()}`);
      return nums(countFor(GAMES.find(g => g.k === 'kreuzwort'))).map(() => sheet(false)).join('') + (opt.solution ? sheet(true) : '');
    },
    lueckentext: c => {
      const gaps = [...String(c.story).matchAll(/\[([^\]]{1,40})\]/g)].map(m => m[1]);
      let i = 0; const story = esc(c.story).replace(/\[([^\]]{1,40})\]/g, (_, w) => `<span class="gm-gap"><sup>${++i}</sup>${w}</span>`);
      return a6(nums(countFor(GAMES.find(g => g.k === 'lueckentext'))).map(() => `${head('Wörter gesucht', 'Schreibt spontan ein Wort pro Zeile. Die Geschichte gibt es später.')}<ol class="gm-blank gm-blank-l">${gaps.map(g => `<li><span class="gm-line"></span><small>${esc(g)}</small></li>`).join('')}</ol>`))
        + a4(`<div class="k-eyebrow">Zum Vorlesen</div><h2 class="gm-h">Unsere Geschichte</h2><div class="gm-story">${story.replace(/\n\n/g, '</p><p>').replace(/^/, '<p>')}</p></div>`);
    },
    prognosen: c => a6(nums(countFor(GAMES.find(g => g.k === 'prognosen'))).map(() => `${head('Wetten & Prognosen', 'Wer am nächsten dran ist, gewinnt.')}<ol class="gm-blank gm-q">${lines(c.questions).map(q => `<li>${esc(q)}<span class="gm-line"></span></li>`).join('')}</ol>${nameLine('Name & Tisch')}`)),
    ratschlaege: c => a6(nums(countFor(GAMES.find(g => g.k === 'ratschlaege'))).map(() => `${head('Für euer Eheleben', E.date)}<div class="gm-prompts">${lines(c.prompts).map(p => `<div><b>${esc(p)}</b><span class="gm-line"></span><span class="gm-line"></span></div>`).join('')}</div>${nameLine('Von')}`)),
    dateideen: c => chunk(nums(Math.ceil(countFor(GAMES.find(g => g.k === 'dateideen')) / 16) * 16), 16).map(pg => `<div class="sheet sheet-date">${pg.map(() => `<div class="gm-date"><div class="k-eyebrow">Eine Date-Idee für ${esc(couple)}</div><span class="gm-line"></span><span class="gm-line"></span><div class="gm-cost">☐ € &nbsp; ☐ €€ &nbsp; ☐ €€€ <span>von ______________</span></div></div>`).join('')}</div>`).join('')
      + a4(`<div class="gm-jar"><div class="k-eyebrow">${esc(E.date)}</div><div class="gm-names big">${esc(c.label)}</div><div class="k-sal">${esc(couple)}</div><p class="k-small">Schreibt eine Date-Idee auf ein Kärtchen und werft es ins Glas. Das Paar zieht im ersten Ehejahr regelmäßig eine Karte.</p></div>`),
    briefe: c => {
      const ann = n => { const d = new Date(S.w.date + 'T12:00:00'); d.setFullYear(d.getFullYear() + n); return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }); };
      return a6(lines(c.occasions).map(o => `${head('Ein Brief für euch')}<div class="gm-open">Öffnen</div><div class="gm-occ">${esc(o.replace(/\{(\d{1,2})\}/g, (_, n) => ann(+n)))}</div><div class="gm-name">Von<span></span></div>`));
    },
    wunschkarten: c => chunk(nums(Math.ceil(countFor(GAMES.find(g => g.k === 'wunschkarten')) / 8) * 8), 8).map(pg => `<div class="sheet sheet-a7">${pg.map(() => c.variant === 'ballon'
      ? `<div class="gm-a7"><div class="k-eyebrow">Hochzeitsballon</div><div class="gm-names sm">${esc(couple)}</div><div class="k-small">Dieser Ballon ist am ${esc(E.date)} auf unserer Hochzeit gestartet. Bitte schickt die Karte mit Fundort und Datum zurück an:</div><div class="gm-addr">${esc(c.address || '')}</div><div class="gm-name">Fundort<span></span></div><div class="gm-name">Wunsch von<span></span></div></div>`
      : `<div class="gm-a7"><span class="gm-hole"></span><div class="k-eyebrow">Mein Wunsch für</div><div class="gm-names sm">${esc(couple)}</div><span class="gm-line"></span><span class="gm-line"></span><span class="gm-line"></span><div class="gm-name">Von<span></span></div></div>`).join('')}</div>`).join(''),
    kinder: c => {
      const ws = wordSearch(lines(c.words), 8, wid + 'kid', 2);
      return nums(countFor(GAMES.find(g => g.k === 'kinder'))).map(() => a4(`<div class="k-eyebrow">Kinderspaß</div><div class="gm-names">Hochzeit von ${esc(couple)}</div><div class="gm-kid">${nameLine('Ich heiße')}${nameLine('Ich bin … Jahre alt')}</div><div class="gm-kidgrid"><div class="gm-draw"><b>Male das Brautpaar!</b></div><div><b>Finde auf der Feier und hake ab:</b><ul class="gm-check">${lines(c.find).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div><div class="gm-kidws"><b>Finde die Wörter:</b> ${ws.placed.map(p => esc(p.w)).join(' · ')}${wsGrid(ws, false)}</div>`)).join('');
    },
    moderation: c => { const pick = String(c.pick || '').split(',').filter(k => MODERATION[k]); return pick.length ? a6(pick.map(k => `<div class="k-eyebrow">Moderationskarte</div><h3 class="gm-h">${esc(MODERATION[k].t)}</h3><p class="gm-text">${esc(MODERATION[k].text)}</p><div class="k-foot">${esc(couple)}</div>`)) : '<p class="empty">Wählt oben mindestens ein Spiel aus.</p>'; },
    ausloesung: c => { const st = lines(c.stations);
      return a4(`<div class="k-eyebrow">Stationen</div><h2 class="gm-h">Brautauslösung für ${esc(couple)}</h2><ol class="gm-sol gm-stations">${st.map(s => `<li>${esc(s)}<span class="gm-tick">☐ geschafft &nbsp; ☐ Lösegeld: ______</span></li>`).join('')}</ol>`)
        + a6(st.map((s, i) => { const [h, ...rest] = s.split(':'); return `<div class="k-eyebrow">Station ${i + 1}</div><h3 class="gm-h">${esc(rest.length ? h : 'Aufgabe')}</h3><p class="gm-text">${esc(rest.length ? rest.join(':').trim() : s)}</p><div class="gm-name">Lösegeld bei Versagen<span></span></div>`; })); },
  };
  function bingoCards(fields, title, sub, seedKey, n) {
    const need = n * n - (n % 2 ? 1 : 0);
    if (fields.length < need) return `<p class="empty">Bitte mindestens ${need} Felder eintragen (aktuell ${fields.length}).</p>`;
    const g = GAMES.find(x => x.k === (seedKey === 'bingo' ? 'bingo' : 'menschenbingo'));
    return a6(nums(countFor(g)).map(i => { const f = shuffle(fields, rng(wid + seedKey + i)).slice(0, need); if (n % 2) f.splice((need) / 2, 0, null);
      return `${head(title, sub)}<div class="gm-bingo n${n}">${f.map(x => x === null ? `<div class="free">♥<small>${esc(E.a[0] || '')} & ${esc(E.b[0] || '')}</small></div>` : `<div>${esc(x)}</div>`).join('')}</div>${seedKey === 'mb' ? nameLine() : `<div class="k-small">Karte ${i + 1}</div>`}`; }));
  }
  function wsGrid(ws, sol) {
    const hit = new Set(ws.placed.flatMap(p => p.cells.map(c => c.join(','))));
    return `<div class="gm-ws" style="--n:${ws.grid.length}">${ws.grid.map((row, r) => row.map((ch, c) => `<span class="${sol && hit.has(r + ',' + c) ? 'hit' : ''}">${ch}</span>`).join('')).join('')}</div>`;
  }
  function cwGrid(cw, sol) {
    if (!cw.rows) return '<p class="empty">Noch keine Wörter.</p>';
    return `<div class="gm-cw" style="--c:${cw.cols};--r:${cw.rows}">${cw.grid.map(row => row.map(x => x ? `<span class="on">${x.no ? `<sup>${x.no}</sup>` : ''}${sol ? x.ch : ''}</span>` : '<span></span>').join('')).join('')}</div>`;
  }

  /* ----- Ansicht ----- */
  function render() {
    const g = GAMES.find(x => x.k === opt.game);
    if (!g) return renderList();
    const c = content(g.k); const pl = D.plan[g.k] || {};
    let extra = '';
    if (g.k === 'kreuzwort') { const cw = crossword(lines(c.pairs).map(l => { const i = l.lastIndexOf('='); return { clue: l.slice(0, i), answer: l.slice(i + 1) }; }).filter(p => p.answer)); if (cw.skipped.length) extra = `<p class="small warn-text">Nicht unterzubringen (kein gemeinsamer Buchstabe): ${cw.skipped.map(s => esc(s.w)).join(', ')}. Ergänzt ein Wort, das sich kreuzt, oder ändert die Schreibweise.</p>`; }
    if (g.k === 'wortsuche') { const ws = wordSearch(lines(c.words), 12, wid + 'ws', 8); if (ws.skipped.length) extra = `<p class="small warn-text">Nicht im Gitter (zu lang, zu kurz oder kein Platz): ${ws.skipped.map(esc).join(', ')}</p>`; }
    view.innerHTML = `<div class="no-print"><a class="mini" href="#/w/${wid}/spiele" data-back>← Alle Spiele</a><span class="eyebrow">${esc(g.cat)}</span><h1>${esc(g.t)}</h1><p class="muted">${esc(g.how)}</p></div>
    <div class="grid2 no-print gm-edit"><section class="card"><h3>Inhalt anpassen</h3>
      ${g.fields.map(([k, lbl, type, hint]) => fieldHtml(g, k, lbl, type, hint, c)).join('')}
      ${extra}<button class="btn ghost small" id="gReset">Vorschlag wiederherstellen</button></section>
      <section class="card"><h3>Einplanen & Drucken</h3>
        <dl class="gm-facts"><dt>Format</dt><dd>${esc(g.fmt)}</dd><dt>Material</dt><dd>${esc(g.mat)}</dd>${g.dur ? `<dt>Dauer</dt><dd>ca. ${g.dur} Min.</dd>` : '<dt>Dauer</dt><dd>läuft nebenbei</dd>'}</dl>
        <label class="row"><input type="checkbox" id="gOn" ${pl.on ? 'checked' : ''}> Im Spieleplan</label>
        <div class="row"><div class="field"><label for="gTime">Uhrzeit</label><input id="gTime" type="time" value="${esc(pl.time || '')}"></div>
        ${g.per !== 'stk' ? `<div class="field"><label for="gCount">Anzahl ${g.per === 'tisch' ? 'Tische' : g.per === 'kind' ? 'Kinder' : 'Karten'}</label><input id="gCount" type="number" min="1" max="500" value="${countFor(g)}"><small class="muted">${g.per === 'tisch' ? (tables.length ? `${tables.length} Tische aus dem Sitzplan` : 'Noch kein Sitzplan, geschätzt') : g.per === 'kind' ? `${kids} Kinder auf der Gästeliste` : `${persons} erwartete Gäste`}</small></div>` : ''}</div>
        <div class="field"><label>Design</label><div class="designs">${Object.entries(DESIGNS).map(([k, d]) => `<button type="button" class="design-pick d-${k}" data-de="${k}" aria-pressed="${opt.design === k}"><span class="swatch"><span>Aa</span></span><b>${d.label}</b></button>`).join('')}</div></div>
        ${['quiz', 'wortsuche', 'kreuzwort'].includes(g.k) ? `<label class="row small"><input type="checkbox" id="gSol" ${opt.solution ? 'checked' : ''}> Lösungsblatt mitdrucken</label>` : ''}
        <div class="row"><button class="btn" id="gPrint">Drucken / PDF</button></div>
        <p class="small muted">Das Paar sieht die Spiele-Rubrik nicht. Klärt Spiele mit Programmpunkt, Mikrofon oder Musik vorher mit Location und DJ ab.</p></section></div>
    <div id="cardSheets" class="sheets design-${esc(opt.design)}">${R[g.k](c)}</div>`;
    view.querySelector('[data-back]').onclick = e => { e.preventDefault(); opt.game = null; history.replaceState(null, '', `#/w/${wid}/spiele`); render(); };
    const upd = () => { D.games[g.k] = { ...(D.games[g.k] || {}) }; return D.games[g.k]; };
    view.querySelectorAll('[data-f]').forEach(el => el.onchange = () => { upd()[el.dataset.f] = el.value; save(); render(); });
    view.querySelectorAll('[data-pick]').forEach(el => el.onchange = () => { upd().pick = [...view.querySelectorAll('[data-pick]:checked')].map(x => x.dataset.pick).join(','); save(); render(); });
    view.querySelector('#gReset').onclick = () => { if (confirm('Eure Änderungen an diesem Spiel verwerfen und den Vorschlag wiederherstellen?')) { delete D.games[g.k]; save(); render(); } };
    const plan = () => (D.plan[g.k] ||= {});
    view.querySelector('#gOn').onchange = e => { plan().on = e.target.checked; save(); };
    view.querySelector('#gTime').onchange = e => { plan().time = e.target.value; plan().on = true; save(); render(); };
    const cnt = view.querySelector('#gCount'); if (cnt) cnt.onchange = () => { plan().count = Math.max(1, Math.min(500, +cnt.value || 1)); save(); render(); };
    const sol = view.querySelector('#gSol'); if (sol) sol.onchange = () => { opt.solution = sol.checked; render(); };
    view.querySelectorAll('[data-de]').forEach(b => b.onclick = () => { opt.design = b.dataset.de; save(); render(); });
    view.querySelector('#gPrint').onclick = () => window.print();
  }
  function fieldHtml(g, k, lbl, type, hint, c) {
    const id = 'gf_' + k;
    if (type === 'input') return `<div class="field"><label for="${id}">${esc(lbl)}</label><input id="${id}" data-f="${k}" maxlength="300" value="${esc(c[k] || '')}"></div>`;
    if (type.startsWith('select:')) return `<div class="field"><label for="${id}">${esc(lbl)}</label><select id="${id}" data-f="${k}">${type.slice(7).split('|').map(o => { const [v, l] = o.split('='); return `<option value="${v}" ${c[k] === v ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></div>`;
    if (type === 'pick') { const on = new Set(String(c.pick || '').split(','));
      return `<div class="field"><label>${esc(lbl)}</label><div class="gm-picks">${Object.entries(MODERATION).map(([mk, m]) => `<label class="row small"><input type="checkbox" data-pick="${mk}" ${on.has(mk) ? 'checked' : ''}> ${esc(m.t)}${m.trad.some(t => E.traditions.includes(t)) ? ' <span class="pill ok">passt zu euch</span>' : m.trad.length ? ' <span class="small muted">kulturell</span>' : ''}</label>`).join('')}</div></div>`; }
    const rows = Math.min(16, Math.max(4, lines(c[k]).length + 1));
    return `<div class="field"><label for="${id}">${esc(lbl)}</label><textarea id="${id}" data-f="${k}" rows="${type === 'text' ? 8 : rows}" maxlength="8000">${esc(c[k] || '')}</textarea>${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</div>`;
  }
  function renderList() {
    const planned = GAMES.filter(g => D.plan[g.k]?.on).sort((a, b) => (D.plan[a.k].time || '99').localeCompare(D.plan[b.k].time || '99'));
    view.innerHTML = `<div class="no-print"><span class="eyebrow">Nur für Trauzeug:innen</span><h1>Spiele</h1>
      <p class="muted">${GAMES.length} druckfertige Hochzeitsspiele, schon mit ${esc(couple)}, dem ${esc(E.date)}, ${tables.length ? `${tables.length} Tischen aus dem Sitzplan` : 'der Tischzahl'} und ${persons} Gästen befüllt. Antippen, anpassen, drucken. Das Paar sieht diese Seite nicht.</p></div>
    <section class="card no-print"><div class="row between"><h3>Spieleplan</h3>${planned.length ? '<button class="btn sec small" id="gRegie">Regieplan drucken</button>' : ''}</div>
      ${planned.length ? `<ul class="gm-plan">${planned.map(g => `<li><span class="mono">${esc(D.plan[g.k].time || '–:–')}</span><a href="#/w/${wid}/spiele?spiel=${g.k}" data-g="${g.k}">${esc(g.t)}</a><span class="small muted">${g.dur ? `${g.dur} Min.` : 'nebenbei'}</span></li>`).join('')}</ul>` : '<p class="small muted">Noch nichts eingeplant. Öffnet ein Spiel und setzt den Haken „Im Spieleplan“.</p>'}</section>
    ${CATS.map(cat => { const list = GAMES.filter(g => g.cat === cat); return list.length ? `<section class="no-print"><h3 class="gm-cat">${esc(cat)}</h3><div class="gm-tiles">${list.map(g => `<a class="gm-tile ${fitTrad(g) ? 'fit' : ''}" href="#/w/${wid}/spiele?spiel=${g.k}" data-g="${g.k}"><b>${esc(g.t)}</b><span>${esc(g.fmt)}</span>${D.plan[g.k]?.on ? '<i class="pill ok">eingeplant</i>' : fitTrad(g) ? '<i class="pill">passt zu euren Traditionen</i>' : ''}</a>`).join('')}</div></section>` : ''; }).join('')}
    <div id="cardSheets" class="sheets design-${esc(opt.design)}">${planned.length ? regie(planned) : ''}</div>`;
    view.querySelectorAll('[data-g]').forEach(a => a.onclick = e => { e.preventDefault(); opt.game = a.dataset.g; history.replaceState(null, '', `#/w/${wid}/spiele?spiel=${opt.game}`); render(); window.scrollTo(0, 0); });
    const rg = view.querySelector('#gRegie'); if (rg) rg.onclick = () => window.print();
    view.querySelector('#cardSheets').classList.add('only-print');
  }
  function regie(planned) {
    return a4(`<div class="k-eyebrow">Regieplan der Trauzeug:innen</div><h2 class="gm-h">Spiele für ${esc(couple)}</h2><div class="k-small">${esc(E.date)}</div><table class="gm-regie"><thead><tr><th>Zeit</th><th>Spiel</th><th>Material</th><th>Ablauf</th></tr></thead><tbody>${planned.map(g => `<tr><td>${esc(D.plan[g.k].time || '')}</td><td><b>${esc(g.t)}</b><br><small>${g.dur ? g.dur + ' Min.' : 'nebenbei'}</small></td><td>${esc(g.mat)}</td><td>${esc(g.how)}</td></tr>`).join('')}</tbody></table>`);
  }
  const q = new URLSearchParams(location.hash.split('?')[1] || ''); opt.game = GAMES.some(g => g.k === q.get('spiel')) ? q.get('spiel') : null;
  render();
}
