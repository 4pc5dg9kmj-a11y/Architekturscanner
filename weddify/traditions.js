// Wissensbasis für die Hochzeitsplanung.
// Jede Tradition bringt Feiern (events), Aufgaben (tasks), Dienstleister-Kategorien (vendors),
// Budgetposten (budget) und Drucksachen (print) mit. Mehrere Traditionen lassen sich kombinieren
// (z. B. Standesamt + türkisch + islamisch), doppelte Feiern werden über ihren Schlüssel zusammengeführt.
//
// Feier-Schlüssel 'feier' ist immer die Hauptfeier am Hochzeitsdatum. Versatz (offset) in Tagen relativ zur Hauptfeier.
// Aufgaben: ev = Feier, auf die sich der Versatz o bezieht. v = Dienstleister-Kategorie: wird ein Dienstleister
// dieser Kategorie als „gebucht“ markiert, gilt die Aufgabe mit book: true als erledigt.
// cond = nur wenn Option zutrifft (noAlcohol, separated, international, kids, abroad).
// Hinweis: Inhalte sind Planungshilfen. Rechtliche und religiöse Details unterscheiden sich je nach Gemeinde,
// Rechtsschule, Standesamt und Familie und sollten vor Ort geklärt werden.

export const VENDOR_CATS = {
  location: 'Location / Saal', catering: 'Catering', getraenke: 'Getränke', fotograf: 'Fotografie', video: 'Video',
  dj: 'DJ', band: 'Band / Live-Musik', florist: 'Blumen', deko: 'Dekoration', torte: 'Hochzeitstorte',
  styling: 'Haare & Make-up', brautmode: 'Brautmode', herrenmode: 'Anzug / Herrenmode', ringe: 'Eheringe',
  papeterie: 'Papeterie & Druck', trauredner: 'Trauredner:in', kirche: 'Kirche & Pfarramt', imam: 'Imam / Hodscha',
  rabbiner: 'Rabbiner:in', priester: 'Priester:in', pandit: 'Pandit / Priester', granthi: 'Gurdwara / Granthi',
  henna: 'Henna-Künstlerin', davul: 'Davul & Zurna', zaffa: 'Zaffa-Band', dhol: 'Dhol-Spieler', moderation: 'Moderation / MC',
  transport: 'Transport & Hochzeitsauto', unterkunft: 'Unterkunft für Gäste', kinder: 'Kinderbetreuung', technik: 'Technik & Licht',
  mandap: 'Mandap / Bühne', gastgeschenke: 'Gastgeschenke', dolmetscher: 'Dolmetscher:in', mode_trad: 'Traditionelle Kleidung',
};

// Budget: Anteil am Gesamtbudget in Prozent. Traditionen ergänzen Posten, danach wird auf 100 % normiert.
export const BASE_BUDGET = [
  { cat: 'location', label: 'Location & Miete', share: 14 },
  { cat: 'catering', label: 'Essen & Catering', share: 28, perGuest: true },
  { cat: 'getraenke', label: 'Getränke', share: 8, perGuest: true },
  { cat: 'fotograf', label: 'Fotografie & Video', share: 10 },
  { cat: 'dj', label: 'Musik', share: 7 },
  { cat: 'florist', label: 'Blumen & Dekoration', share: 7 },
  { cat: 'brautmode', label: 'Kleidung & Styling', share: 9 },
  { cat: 'ringe', label: 'Eheringe', share: 5 },
  { cat: 'papeterie', label: 'Papeterie & Druck', share: 3, perGuest: true },
  { cat: 'torte', label: 'Hochzeitstorte & Süßes', share: 2 },
  { cat: 'transport', label: 'Transport', share: 1 },
  { cat: 'puffer', label: 'Puffer für Unvorhergesehenes', share: 6 },
];

// Standard-Ablauf je Feier
const SCHED = {
  standesamt: [['11:00', 'Standesamtliche Trauung'], ['11:30', 'Sekt & Gratulation vor dem Standesamt'], ['13:00', 'Mittagessen im kleinen Kreis']],
  feier: [['14:00', 'Trauung / Zeremonie'], ['15:00', 'Sektempfang & Gratulation'], ['16:00', 'Kaffee & Hochzeitstorte'], ['17:30', 'Gruppenfoto'], ['19:00', 'Abendessen'], ['21:00', 'Eröffnungstanz & Party'], ['00:00', 'Mitternachtssnack']],
  polterabend: [['19:00', 'Ankommen & Poltern'], ['20:00', 'Grillen & Getränke'], ['22:00', 'Scherben gemeinsam auffegen']],
  kirche: [['13:30', 'Einlass in die Kirche'], ['14:00', 'Kirchliche Trauung'], ['15:00', 'Auszug & Gratulation']],
  freie_trauung: [['14:00', 'Einzug'], ['14:10', 'Freie Trauung'], ['14:50', 'Ringtausch & Kuss'], ['15:00', 'Sektempfang']],
  nikah: [['15:00', 'Ankunft der Familien'], ['15:30', 'Nikah mit Imam und Zeugen'], ['16:15', 'Duʿāʾ & Glückwünsche'], ['17:00', 'Tee & Süßes']],
  henna: [['19:00', 'Ankunft der Gäste'], ['19:30', 'Einzug der Braut'], ['20:00', 'Henna-Ritual mit Liedern'], ['21:00', 'Essen, Musik & Tanz']],
  kina: [['19:00', 'Ankunft der Gäste'], ['19:30', 'Einzug der Braut im Bindallı'], ['20:30', 'Kına-Zeremonie mit Kerzen und Liedern'], ['21:00', 'Halay & Tanz']],
  walima: [['18:00', 'Empfang der Gäste'], ['18:30', 'Einzug des Brautpaares'], ['19:00', 'Festessen'], ['20:30', 'Reden & Duʿāʾ'], ['21:00', 'Beisammensein']],
  katb: [['16:00', 'Katb al-Kitab mit Imam'], ['16:45', 'Glückwünsche & Süßes']],
  aghd: [['15:00', 'Aghd am Sofreh'], ['16:00', 'Glückwünsche & Geschenke']],
  mehndi: [['18:00', 'Mehndi-Auftragen der Braut'], ['19:30', 'Musik & Tanz'], ['20:30', 'Abendessen']],
  sangeet: [['19:00', 'Begrüßung'], ['19:30', 'Tanzauftritte der Familien'], ['21:00', 'Abendessen & Party']],
  haldi: [['10:00', 'Haldi-Zeremonie'], ['11:30', 'Brunch']],
  pheras: [['09:30', 'Baraat (Ankunft des Bräutigams)'], ['10:30', 'Milni & Jaimala'], ['11:00', 'Zeremonie im Mandap (Pheras)'], ['13:00', 'Mittagessen']],
  reception: [['19:00', 'Empfang'], ['19:30', 'Einzug des Paares'], ['20:00', 'Dinner'], ['21:30', 'Party']],
  chuppa: [['16:00', 'Kabbalat Panim & Unterzeichnung der Ketubba'], ['16:45', 'Bedeken (Verschleierung)'], ['17:00', 'Chuppa'], ['17:45', 'Jichud'], ['18:30', 'Festessen'], ['20:00', 'Hora & Tanz']],
  orthodox: [['13:30', 'Ankunft in der Kirche'], ['14:00', 'Orthodoxe Trauung mit Krönung'], ['15:15', 'Glückwünsche & Koufeta']],
  anand: [['09:00', 'Milni'], ['10:00', 'Anand Karaj in der Gurdwara'], ['11:30', 'Langar']],
  tee: [['10:00', 'Türspiele beim Brautabholen'], ['11:00', 'Teezeremonie mit den Familien']],
  traditional: [['12:00', 'Ankunft & Begrüßung der Familien'], ['13:00', 'Traditionelle Zeremonie'], ['15:00', 'Essen & Tanz']],
  poprawiny: [['14:00', 'Zweiter Tag: Mittagessen'], ['16:00', 'Musik & Beisammensein']],
};

export const EVENT_DEFS = {
  feier: { title: 'Hochzeitsfeier', offset: 0, time: '14:00', scope: 'alle', kind: 'party' },
  standesamt: { title: 'Standesamtliche Trauung', offset: -1, time: '11:00', scope: 'familie', kind: 'legal' },
  polterabend: { title: 'Polterabend', offset: -7, time: '19:00', scope: 'alle', kind: 'pre' },
  kirche: { title: 'Kirchliche Trauung', offset: 0, time: '14:00', scope: 'alle', kind: 'religious' },
  freie_trauung: { title: 'Freie Trauung', offset: 0, time: '14:00', scope: 'alle', kind: 'ceremony' },
  nikah: { title: 'Nikah', offset: -1, time: '15:00', scope: 'familie', kind: 'religious' },
  henna: { title: 'Henna-Abend', offset: -2, time: '19:00', scope: 'frauen', kind: 'pre' },
  kina: { title: 'Kına-Abend', offset: -1, time: '19:00', scope: 'alle', kind: 'pre' },
  walima: { title: 'Walima', offset: 1, time: '18:00', scope: 'alle', kind: 'party' },
  katb: { title: 'Katb al-Kitab', offset: -7, time: '16:00', scope: 'familie', kind: 'religious' },
  aghd: { title: 'Aghd mit Sofreh', offset: 0, time: '15:00', scope: 'familie', kind: 'religious' },
  haldi: { title: 'Haldi', offset: -1, time: '10:00', scope: 'familie', kind: 'pre' },
  mehndi: { title: 'Mehndi', offset: -2, time: '18:00', scope: 'alle', kind: 'pre' },
  sangeet: { title: 'Sangeet', offset: -1, time: '19:00', scope: 'alle', kind: 'pre' },
  pheras: { title: 'Hinduistische Trauung (Pheras)', offset: 0, time: '09:30', scope: 'alle', kind: 'religious' },
  reception: { title: 'Reception', offset: 0, time: '19:00', scope: 'alle', kind: 'party' },
  chuppa: { title: 'Chuppa', offset: 0, time: '16:00', scope: 'alle', kind: 'religious' },
  orthodox: { title: 'Orthodoxe Trauung', offset: 0, time: '14:00', scope: 'alle', kind: 'religious' },
  anand: { title: 'Anand Karaj', offset: 0, time: '09:00', scope: 'alle', kind: 'religious' },
  tee: { title: 'Teezeremonie', offset: 0, time: '10:00', scope: 'familie', kind: 'religious' },
  traditional: { title: 'Traditional Wedding', offset: -7, time: '12:00', scope: 'alle', kind: 'religious' },
  poprawiny: { title: 'Poprawiny (zweiter Tag)', offset: 1, time: '14:00', scope: 'alle', kind: 'party' },
};
export const scheduleFor = key => SCHED[key] || [];

// Allgemeine Aufgaben, die jede Hochzeit braucht (unabhängig von der Tradition)
export const COMMON = {
  tasks: [
    { k: 'budget', o: -365, t: 'Budget festlegen', n: 'Wer trägt welche Kosten? Plant etwa 10 % Puffer ein. Das Budget in weddify ist bereits vorausgefüllt.' },
    { k: 'gaesteliste', o: -358, t: 'Gästeliste erstellen', n: 'Legt die Gäste in weddify an, mit Gruppe, Seite und Adresse. Daraus entstehen Einladungen, Zusagen, Sitzplan und Tischkarten.' },
    { k: 'location', o: -351, t: 'Location buchen', v: 'location', book: true, n: 'Beliebte Samstage im Sommer sind früh vergeben.' },
    { k: 'catering', o: -300, t: 'Catering auswählen und buchen', v: 'catering', book: true },
    { k: 'fotograf', o: -300, t: 'Fotograf:in buchen', v: 'fotograf', book: true, n: 'Gute Fotograf:innen sind oft ein Jahr im Voraus ausgebucht.' },
    { k: 'trauz', o: -286, t: 'Trauzeug:innen bzw. Vertraute fragen', n: 'Ladet sie danach mit ihrem Code in weddify ein.' },
    { k: 'std', o: -270, t: 'Save-the-Date verschicken', p: 'card', n: 'Wird in der Druckerei automatisch aus der Gästeliste erstellt.' },
    { k: 'musik', o: -240, t: 'Musik buchen (DJ oder Band)', v: 'dj', book: true },
    { k: 'mode', o: -240, t: 'Brautkleid & Anzug aussuchen', v: 'brautmode', book: true, n: 'Änderungen und Maßanfertigungen brauchen 2–4 Monate.' },
    { k: 'unterkunft', o: -200, t: 'Hotelkontingent für Gäste reservieren', v: 'unterkunft', n: 'Besonders wichtig bei vielen Gästen mit Anreise.' },
    { k: 'einladungen', o: -175, t: 'Einladungen gestalten und drucken', p: 'invite', n: 'Jede Einladung trägt den persönlichen QR-Code zur Zusage.' },
    { k: 'florist', o: -150, t: 'Blumen & Deko planen', v: 'florist', book: true },
    { k: 'styling', o: -150, t: 'Haare & Make-up buchen, Probetermin vereinbaren', v: 'styling', book: true },
    { k: 'einladungen_versand', o: -120, t: 'Einladungen verschicken', n: 'Zusagefrist etwa 6 Wochen vor der Feier.' },
    { k: 'ringe', o: -113, t: 'Eheringe aussuchen', v: 'ringe', book: true, n: 'Gravur dauert 2–4 Wochen.' },
    { k: 'torte', o: -90, t: 'Hochzeitstorte probieren und bestellen', v: 'torte', book: true },
    { k: 'transport', o: -75, t: 'Hochzeitsauto bzw. Shuttle für Gäste organisieren', v: 'transport', book: true },
    { k: 'ablauf', o: -60, t: 'Tagesablauf mit Location und Dienstleistern abstimmen', p: 'time' },
    { k: 'menu', o: -46, t: 'Menü und Getränke festlegen', p: 'menu', n: 'Menüwünsche und Allergien stehen in der Gästeübersicht.' },
    { k: 'rsvp_nach', o: -42, t: 'Fehlende Zusagen nachfragen', n: 'Die Gästeübersicht zeigt, wer noch nicht geantwortet hat.' },
    { k: 'sitzplan', o: -35, t: 'Sitzplan erstellen', p: 'seat' },
    { k: 'karten', o: -28, t: 'Tischkarten, Menükarten & Schilder drucken', p: 'place' },
    { k: 'finale_zahl', o: -14, t: 'Finale Gästezahl an Catering und Location melden' },
    { k: 'dienstleister_info', o: -13, t: 'Ablaufplan an alle Dienstleister schicken', n: 'Mit Telefonnummer einer Ansprechperson für den Tag.' },
    { k: 'zahlungen', o: -10, t: 'Restzahlungen vorbereiten', n: 'Offene Beträge stehen im Budget unter „Zahlungen“.' },
    { k: 'notfall', o: -4, t: 'Notfalltasche packen', n: 'Pflaster, Nadel & Faden, Taschentücher, Snacks, Ladekabel.' },
    { k: 'tag', o: 0, t: 'Ja sagen und den Tag genießen' },
    { k: 'geschenke', o: 7, t: 'Geschenke erfassen', n: 'In weddify unter „Geschenke“, daraus entstehen die Danksagungen.' },
    { k: 'danke', o: 30, t: 'Danksagungskarten verschicken', p: 'thanks' },
    { k: 'anni', o: 365, t: 'Ersten Hochzeitstag feiern', p: 'anni' },
    { k: 'kinder', o: -90, t: 'Kinderbetreuung und Kinderecke organisieren', v: 'kinder', book: true, cond: 'kids' },
  ],
  witness: [
    { k: 'w_wuensche', o: -240, t: 'Mit dem Paar über Wünsche & No-Gos sprechen' },
    { k: 'w_jga_termin', o: -210, t: 'Termin für den Junggesell:innenabschied festlegen' },
    { k: 'w_budget', o: -180, t: 'Budget für JGA & Geschenk klären' },
    { k: 'w_jga', o: -150, t: 'JGA planen & buchen' },
    { k: 'w_zeitung', o: -120, t: 'Beiträge für die Hochzeitszeitung einsammeln', p: 'news' },
    { k: 'w_zeitung_druck', o: -75, t: 'Hochzeitszeitung gestalten & bestellen', p: 'news' },
    { k: 'w_spiele', o: -60, t: 'Spiele & Überraschungen mit der Location abstimmen', p: 'quiz' },
    { k: 'w_geschenk', o: -45, t: 'Gemeinschaftsgeschenk organisieren' },
    { k: 'w_rede', o: -30, t: 'Rede schreiben' },
    { k: 'w_ablauf', o: -14, t: 'Ablauf mit Paar & Fotograf:in abgleichen' },
    { k: 'w_notfall', o: -7, t: 'Notfalltasche für das Paar packen' },
    { k: 'w_ringe', o: -1, t: 'Ringe & Unterlagen einsammeln' },
    { k: 'w_tag', o: 0, t: 'Für das Paar da sein, Zeitplan im Blick behalten' },
  ],
};

export const TRADITIONS = {
  standesamt: {
    label: 'Standesamt', group: 'Deutschland', desc: 'In Deutschland ist nur die standesamtliche Ehe rechtlich gültig.',
    events: ['standesamt'], vendors: [],
    tasks: [
      { k: 'sta_termin', ev: 'standesamt', o: -300, t: 'Wunschtermin beim Standesamt reservieren', n: 'Viele Standesämter nehmen Reservierungen bis zu einem Jahr im Voraus an.' },
      { k: 'sta_unterlagen', ev: 'standesamt', o: -200, t: 'Unterlagen für die Anmeldung besorgen', n: 'Meist: Ausweise, beglaubigter Ausdruck aus dem Geburtenregister, ggf. erweiterte Meldebescheinigung. Die genaue Liste nennt euer Standesamt.' },
      { k: 'sta_anmeldung', ev: 'standesamt', o: -180, t: 'Eheschließung beim Standesamt anmelden', n: 'Frühestens 6 Monate vor dem Termin möglich.' },
      { k: 'sta_name', ev: 'standesamt', o: -60, t: 'Ehenamen entscheiden', n: 'Gemeinsamer Name, Doppelname oder getrennte Namen.' },
      { k: 'sta_zeugen', ev: 'standesamt', o: -30, t: 'Trauzeug:innen fürs Standesamt (optional) Bescheid geben', n: 'In Deutschland seit 1998 keine Pflicht.' },
    ],
    budget: [{ cat: 'standesamt', label: 'Standesamt-Gebühren', share: 0.6 }],
  },
  frei: {
    label: 'Freie Trauung', group: 'Deutschland & Europa', desc: 'Persönliche Zeremonie mit Trauredner:in, oft im Freien.',
    events: ['freie_trauung'], vendors: ['trauredner'],
    tasks: [
      { k: 'fr_redner', ev: 'freie_trauung', o: -300, t: 'Trauredner:in buchen', v: 'trauredner', book: true },
      { k: 'fr_gespraech', ev: 'freie_trauung', o: -90, t: 'Kennenlerngespräch mit der Trauredner:in' },
      { k: 'fr_regen', ev: 'freie_trauung', o: -60, t: 'Schlechtwetter-Alternative klären', n: 'Zelt, Pavillon oder Plan B im Saal.' },
      { k: 'fr_musik', ev: 'freie_trauung', o: -45, t: 'Musik für Einzug, Ringtausch und Auszug auswählen' },
      { k: 'fr_versprechen', ev: 'freie_trauung', o: -21, t: 'Eheversprechen schreiben' },
    ],
    budget: [{ cat: 'trauredner', label: 'Trauredner:in', share: 4 }],
  },
  evangelisch: {
    label: 'Evangelisch', group: 'Christlich', desc: 'Kirchliche Trauung mit Traugespräch.',
    events: ['kirche'], vendors: ['kirche'],
    tasks: [
      { k: 'ev_kirche', ev: 'kirche', o: -365, t: 'Pfarramt kontaktieren und Kirche reservieren', v: 'kirche', book: true },
      { k: 'ev_nachweis', ev: 'kirche', o: -90, t: 'Nachweise für die Kirche besorgen', n: 'z. B. Taufbescheinigung, Mitgliedschaft, Nachweis der standesamtlichen Trauung. Das Pfarramt sagt, was nötig ist.' },
      { k: 'ev_gespraech', ev: 'kirche', o: -60, t: 'Traugespräch mit Pfarrer:in' },
      { k: 'ev_spruch', ev: 'kirche', o: -45, t: 'Trauspruch, Lieder und Lesungen auswählen' },
      { k: 'ev_organist', ev: 'kirche', o: -45, t: 'Organist:in bzw. Musik in der Kirche klären' },
      { k: 'ev_heft', ev: 'kirche', o: -21, t: 'Kirchenheft gestalten und drucken', p: 'program' },
    ],
    budget: [{ cat: 'kirche', label: 'Kirche, Musik & Kollekte', share: 1.5 }], print: ['program'],
  },
  katholisch: {
    label: 'Katholisch', group: 'Christlich', desc: 'Kirchliche Trauung mit Ehevorbereitung und zwei Trauzeugen.',
    events: ['kirche'], vendors: ['kirche'],
    tasks: [
      { k: 'ka_kirche', ev: 'kirche', o: -365, t: 'Pfarramt kontaktieren und Kirche reservieren', v: 'kirche', book: true },
      { k: 'ka_kurs', ev: 'kirche', o: -150, t: 'Ehevorbereitungskurs besuchen' },
      { k: 'ka_taufschein', ev: 'kirche', o: -100, t: 'Aktuelle Taufscheine anfordern', n: 'In der Regel nicht älter als 6 Monate, beim Taufpfarramt.' },
      { k: 'ka_dispens', ev: 'kirche', o: -120, t: 'Bei konfessionsverschiedener Ehe: Erlaubnis bzw. Dispens klären' },
      { k: 'ka_protokoll', ev: 'kirche', o: -90, t: 'Ehevorbereitungsprotokoll im Pfarramt' },
      { k: 'ka_zeugen', ev: 'kirche', o: -60, t: 'Zwei Trauzeug:innen benennen', n: 'Bei der katholischen Trauung vorgeschrieben.' },
      { k: 'ka_liturgie', ev: 'kirche', o: -45, t: 'Lesungen, Fürbitten und Lieder auswählen' },
      { k: 'ka_heft', ev: 'kirche', o: -21, t: 'Kirchenheft gestalten und drucken', p: 'program' },
    ],
    budget: [{ cat: 'kirche', label: 'Kirche, Musik & Kollekte', share: 1.5 }], print: ['program'],
  },
  polterabend: {
    label: 'Polterabend', group: 'Deutschland', desc: 'Geschirr zerschlagen bringt Glück, das Paar fegt gemeinsam.',
    events: ['polterabend'], vendors: [],
    tasks: [
      { k: 'po_ort', ev: 'polterabend', o: -120, t: 'Ort für den Polterabend festlegen', n: 'Garten, Hof oder Vereinsheim mit Platz für Scherben.' },
      { k: 'po_essen', ev: 'polterabend', o: -21, t: 'Essen & Getränke für den Polterabend planen', n: 'Oft Grillen, Fingerfood oder Mitbringbuffet.' },
      { k: 'po_scherben', ev: 'polterabend', o: -7, t: 'Container, Besen und Schaufeln bereitstellen', n: 'Kein Glas und keine Spiegel: Das bringt nach altem Brauch Unglück.' },
    ],
    budget: [{ cat: 'polterabend', label: 'Polterabend', share: 3 }],
  },
  islamisch: {
    label: 'Islamisch', group: 'Islamisch', desc: 'Nikah mit Imam, Brautgabe (Mahr) und Zeugen, oft mit Henna-Abend und Walima.',
    events: ['nikah', 'henna'], vendors: ['imam', 'henna'], options: ['separated', 'noAlcohol'], mainTitle: 'Walima (Hochzeitsfeier)', mainPrio: 1, mainTime: '18:00', mainSched: 'walima',
    tasks: [
      { k: 'is_standesamt', ev: 'nikah', o: -200, t: 'Standesamtliche Trauung vor der Nikah einplanen', n: 'In Deutschland ist nur die standesamtliche Ehe rechtlich gültig. Viele Imame trauen erst nach dem Standesamt.' },
      { k: 'is_imam', ev: 'nikah', o: -180, t: 'Imam bzw. Moschee für die Nikah anfragen', v: 'imam', book: true },
      { k: 'is_mahr', ev: 'nikah', o: -150, t: 'Mahr (Brautgabe) zwischen den Familien vereinbaren' },
      { k: 'is_wali', ev: 'nikah', o: -90, t: 'Wali (Vormund der Braut) und Familien einbeziehen', n: 'Je nach Rechtsschule und Familie unterschiedlich.' },
      { k: 'is_zeugen', ev: 'nikah', o: -60, t: 'Zwei Trauzeugen für die Nikah benennen', n: 'Muslimisch und volljährig, Details je nach Rechtsschule.' },
      { k: 'is_vertrag', ev: 'nikah', o: -30, t: 'Nikah-Urkunde bzw. Ehevertrag vorbereiten' },
      { k: 'is_halal', o: -150, t: 'Halal-Catering prüfen', v: 'catering', n: 'Zertifikat, getrennte Zubereitung, Herkunft des Fleisches erfragen.' },
      { k: 'is_gebet', o: -30, t: 'Gebetszeiten und Gebetsraum im Ablauf einplanen' },
      { k: 'is_getrennt', o: -60, t: 'Getrennte Bereiche für Damen und Herren planen', cond: 'separated', n: 'Im Sitzplan lassen sich Damen- und Herrenbereiche automatisch füllen.' },
      { k: 'is_henna_k', ev: 'henna', o: -90, t: 'Henna-Künstlerin buchen', v: 'henna', book: true },
      { k: 'is_henna_deko', ev: 'henna', o: -21, t: 'Henna-Abend vorbereiten: Henna, Tabletts, Kerzen, Musik' },
      { k: 'is_walima', o: -300, t: 'Saal für die Walima buchen', v: 'location', book: true },
    ],
    budget: [{ cat: 'henna', label: 'Henna-Abend', share: 4 }, { cat: 'imam', label: 'Imam / Nikah', share: 0.8 }],
    print: ['tags'],
  },
  tuerkisch: {
    label: 'Türkisch', group: 'Türkisch & Kurdisch', desc: 'Kına-Abend, großes Düğün mit Davul-Zurna, Takı-Zeremonie und Nikah şekeri.',
    events: ['kina'], vendors: ['davul', 'moderation', 'gastgeschenke', 'mode_trad'], mainTitle: 'Düğün', mainPrio: 2, mainTime: '18:00',
    tasks: [
      { k: 'tr_salon', o: -365, t: 'Düğün salonu (Festsaal) buchen', v: 'location', book: true, n: 'Türkische Hochzeiten haben oft 200 Gäste und mehr: Größe und Parkplätze prüfen.' },
      { k: 'tr_orkestra', o: -240, t: 'Orkestra bzw. Davul & Zurna buchen', v: 'davul', book: true },
      { k: 'tr_bindalli', ev: 'kina', o: -90, t: 'Bindallı (Kına-Kleid) besorgen', v: 'mode_trad' },
      { k: 'tr_kina', ev: 'kina', o: -30, t: 'Kına-Zeremonie vorbereiten', n: 'Henna, Kına-Tablett, Kerzen, roter Schleier, Lieder.' },
      { k: 'tr_taki', o: -30, t: 'Takı-Zeremonie vorbereiten', n: 'Ablauf mit Moderation, Band für Gold und Geldscheine, Helfer:innen zum Notieren der Geschenke.' },
      { k: 'tr_seker', o: -30, t: 'Nikah şekeri (Gastgeschenke) bestellen', v: 'gastgeschenke', p: 'tags' },
      { k: 'tr_gelinalma', o: -14, t: 'Gelin alma planen (Brautabholung)', n: 'Konvoi, Musik, roter Gürtel (kırmızı kuşak) durch Bruder oder Vater.' },
      { k: 'tr_moderation', o: -120, t: 'Moderation für Takı und Ablauf buchen', v: 'moderation', book: true },
    ],
    budget: [{ cat: 'davul', label: 'Davul, Zurna & Orkestra', share: 5 }, { cat: 'gastgeschenke', label: 'Nikah şekeri / Gastgeschenke', share: 2, perGuest: true }, { cat: 'kina', label: 'Kına-Abend', share: 4 }],
    print: ['tags'],
  },
  kurdisch: {
    label: 'Kurdisch', group: 'Türkisch & Kurdisch', desc: 'Şeva Hinê (Henna-Abend), Govend und Halay mit Davul & Zurna.',
    events: ['kina'], vendors: ['davul', 'mode_trad'], eventTitles: { kina: 'Şeva Hinê (Henna-Abend)' },
    tasks: [
      { k: 'ku_musik', o: -240, t: 'Musiker:innen mit Davul & Zurna für Govend und Halay buchen', v: 'davul', book: true },
      { k: 'ku_kleidung', o: -90, t: 'Traditionelle Kleidung (Kiras û Fistan) auswählen', v: 'mode_trad' },
      { k: 'ku_hine', ev: 'kina', o: -30, t: 'Şeva Hinê vorbereiten: Henna, Lieder, Tanz' },
      { k: 'ku_saal', o: -365, t: 'Saal mit großer Tanzfläche buchen', v: 'location', book: true, n: 'Govend wird in langen Reihen getanzt.' },
    ],
    budget: [{ cat: 'davul', label: 'Davul, Zurna & Musik', share: 5 }],
  },
  arabisch: {
    label: 'Arabisch', group: 'Islamisch', desc: 'Katb al-Kitab, Henna-Nacht und Zaffa beim Einzug des Paares.',
    events: ['katb', 'henna'], vendors: ['zaffa', 'imam'], mainTitle: 'Hochzeitsfeier mit Zaffa', mainPrio: 1, mainTime: '18:00',
    tasks: [
      { k: 'ar_katb', ev: 'katb', o: -120, t: 'Imam bzw. Maʾdhun für Katb al-Kitab anfragen', v: 'imam', book: true },
      { k: 'ar_zaffa', o: -180, t: 'Zaffa-Band bzw. Trommler buchen', v: 'zaffa', book: true },
      { k: 'ar_kosha', o: -60, t: 'Kosha (Bühne bzw. Thron für das Paar) dekorieren', v: 'deko' },
      { k: 'ar_suess', o: -30, t: 'Süßes & Gastgeschenke bestellen (z. B. Zuckermandeln)', v: 'gastgeschenke', p: 'tags' },
    ],
    budget: [{ cat: 'zaffa', label: 'Zaffa & Musik', share: 4 }],
    print: ['tags'],
  },
  persisch: {
    label: 'Persisch', group: 'Weitere Kulturen', desc: 'Aghd am Sofreh mit Spiegel, Kerzen und Zuckerkegeln, danach Aroosi (Feier).',
    events: ['aghd'], vendors: ['priester'],
    tasks: [
      { k: 'fa_aghd', ev: 'aghd', o: -120, t: 'Person für die Aghd-Zeremonie anfragen', v: 'priester', book: true },
      { k: 'fa_mehrieh', ev: 'aghd', o: -150, t: 'Mehrieh (Brautgabe) zwischen den Familien vereinbaren' },
      { k: 'fa_sofreh', ev: 'aghd', o: -45, t: 'Sofreh Aghd gestalten', n: 'Spiegel, Kerzenleuchter, Brot, Honig, Kandiszucker, Früchte, Kräuter.' },
      { k: 'fa_zucker', ev: 'aghd', o: -14, t: 'Personen für das Zuckerreiben auswählen', n: 'Glücklich verheiratete Frauen reiben Zuckerkegel über einem Tuch über dem Paar.' },
    ],
    budget: [{ cat: 'sofreh', label: 'Sofreh Aghd', share: 2 }],
  },
  indisch: {
    label: 'Indisch (Hindu)', group: 'Weitere Kulturen', desc: 'Mehrtägig: Mehndi, Sangeet, Haldi, Trauung im Mandap und Reception.',
    events: ['mehndi', 'sangeet', 'haldi', 'pheras'], vendors: ['pandit', 'mandap', 'henna', 'dhol', 'mode_trad'], mainTitle: 'Reception', mainPrio: 2, mainTime: '19:00', mainSched: 'reception',
    tasks: [
      { k: 'in_pandit', ev: 'pheras', o: -365, t: 'Pandit buchen und Muhurat (glückverheißende Zeit) bestimmen', v: 'pandit', book: true },
      { k: 'in_mandap', ev: 'pheras', o: -120, t: 'Mandap mieten oder bauen lassen', v: 'mandap', book: true },
      { k: 'in_outfit', o: -150, t: 'Lehenga, Sherwani & Outfits für alle Feiern bestellen', v: 'mode_trad', n: 'Maßanfertigung aus Indien braucht Vorlauf.' },
      { k: 'in_mehndi', ev: 'mehndi', o: -90, t: 'Mehndi-Künstlerin buchen', v: 'henna', book: true },
      { k: 'in_sangeet', ev: 'sangeet', o: -60, t: 'Tänze für den Sangeet einstudieren' },
      { k: 'in_baraat', ev: 'pheras', o: -60, t: 'Baraat organisieren (Pferd oder Auto, Dhol)', v: 'dhol', book: true },
      { k: 'in_haldi', ev: 'haldi', o: -7, t: 'Haldi-Paste, gelbe Deko & Kleidung vorbereiten' },
      { k: 'in_catering', o: -120, t: 'Catering mit vegetarischen Optionen auswählen', v: 'catering' },
    ],
    budget: [{ cat: 'mandap', label: 'Mandap & Zeremonie', share: 5 }, { cat: 'mode_trad', label: 'Outfits für alle Feiern', share: 6 }, { cat: 'henna', label: 'Mehndi', share: 2 }],
  },
  sikh: {
    label: 'Sikh', group: 'Weitere Kulturen', desc: 'Anand Karaj in der Gurdwara mit Langar.',
    events: ['anand'], vendors: ['granthi'],
    tasks: [
      { k: 'si_gurdwara', ev: 'anand', o: -300, t: 'Gurdwara und Granthi anfragen', v: 'granthi', book: true },
      { k: 'si_milni', ev: 'anand', o: -30, t: 'Milni (Begegnung der Familien) planen' },
      { k: 'si_langar', ev: 'anand', o: -60, t: 'Langar mit der Gurdwara abstimmen' },
      { k: 'si_kopf', ev: 'anand', o: -14, t: 'Kopfbedeckungen für Gäste bereitstellen', n: 'In der Gurdwara bedecken alle den Kopf.' },
    ],
    budget: [],
  },
  juedisch: {
    label: 'Jüdisch', group: 'Weitere Kulturen', desc: 'Ketubba, Chuppa und das Zertreten des Glases.',
    events: ['chuppa'], vendors: ['rabbiner'], dateRules: ['noShabbat'],
    tasks: [
      { k: 'ju_rabbi', ev: 'chuppa', o: -365, t: 'Rabbiner:in anfragen und Termin prüfen', v: 'rabbiner', book: true, n: 'Keine Trauungen am Schabbat und an bestimmten Feiertagen.' },
      { k: 'ju_ketubba', ev: 'chuppa', o: -90, t: 'Ketubba gestalten lassen und Zeugen bestimmen', n: 'Zwei Zeugen, in der Regel nicht mit dem Paar verwandt.' },
      { k: 'ju_chuppa', ev: 'chuppa', o: -90, t: 'Chuppa (Baldachin) organisieren' },
      { k: 'ju_koscher', o: -180, t: 'Koscheres Catering klären (je nach Observanz)', v: 'catering' },
      { k: 'ju_glas', ev: 'chuppa', o: -7, t: 'Glas zum Zertreten vorbereiten' },
    ],
    budget: [{ cat: 'rabbiner', label: 'Rabbiner:in & Ketubba', share: 2 }],
  },
  orthodox: {
    label: 'Orthodox', group: 'Christlich', desc: 'Griechisch, serbisch, russisch oder rumänisch: Krönung, Kerzen, Koumbaros bzw. Kum.',
    events: ['orthodox'], vendors: ['priester'], dateRules: ['orthodoxFast'],
    tasks: [
      { k: 'or_kirche', ev: 'orthodox', o: -365, t: 'Priester und Kirche anfragen, Fastenzeiten prüfen', v: 'priester', book: true, n: 'In Fastenzeiten (z. B. vor Ostern, 1.–15. August) finden meist keine Trauungen statt.' },
      { k: 'or_kum', ev: 'orthodox', o: -180, t: 'Koumbaros bzw. Kum bestimmen', n: 'Trauzeuge mit besonderer, oft lebenslanger Rolle.' },
      { k: 'or_kronen', ev: 'orthodox', o: -60, t: 'Stefana bzw. Kronen und Hochzeitskerzen besorgen' },
      { k: 'or_koufeta', ev: 'orthodox', o: -30, t: 'Koufeta (Zuckermandeln, ungerade Zahl) für Gäste vorbereiten', v: 'gastgeschenke', p: 'tags' },
    ],
    budget: [{ cat: 'priester', label: 'Kirche & Kronen', share: 1.5 }], print: ['tags'],
  },
  polnisch: {
    label: 'Polnisch', group: 'Europa', desc: 'Brot und Salz, Oczepiny um Mitternacht und Poprawiny am zweiten Tag.',
    events: ['poprawiny'], vendors: ['band'],
    tasks: [
      { k: 'pl_band', o: -240, t: 'Band für Oczepiny & Tanz buchen', v: 'band', book: true },
      { k: 'pl_oczepiny', o: -30, t: 'Oczepiny planen', n: 'Brauch um Mitternacht: Schleier wird abgenommen, Spiele mit den Gästen.' },
      { k: 'pl_brot', o: -7, t: 'Brot und Salz für die Begrüßung durch die Eltern bereitstellen' },
      { k: 'pl_poprawiny', ev: 'poprawiny', o: -60, t: 'Poprawiny am zweiten Tag organisieren' },
    ],
    budget: [{ cat: 'poprawiny', label: 'Poprawiny (zweiter Tag)', share: 6 }],
  },
  italienisch: {
    label: 'Italienisch', group: 'Europa', desc: 'Bomboniere mit Confetti, Aperitivo, viele Gänge und Tarantella.',
    events: [], vendors: ['gastgeschenke', 'band'],
    tasks: [
      { k: 'it_bomboniere', o: -45, t: 'Bomboniere mit fünf Confetti als Gastgeschenk vorbereiten', v: 'gastgeschenke', p: 'tags', n: 'Fünf Zuckermandeln für Gesundheit, Glück, Wohlstand, Fruchtbarkeit und langes Leben.' },
      { k: 'it_menu', o: -120, t: 'Aperitivo und mehrgängiges Menü planen', v: 'catering' },
      { k: 'it_tarantella', o: -60, t: 'Musik für Tarantella einplanen', v: 'band' },
      { k: 'it_busta', o: -14, t: 'Box für la busta (Geldumschläge) bereitstellen' },
    ],
    budget: [{ cat: 'gastgeschenke', label: 'Bomboniere', share: 2, perGuest: true }], print: ['tags'],
  },
  spanisch: {
    label: 'Spanisch', group: 'Europa', desc: 'Padrinos, Las Arras (13 Münzen) und lange Feiern bis in die Nacht.',
    events: [], vendors: [],
    tasks: [
      { k: 'es_padrinos', o: -180, t: 'Padrinos (Trauzeugen-Paar) bestimmen' },
      { k: 'es_arras', o: -30, t: 'Las Arras (13 Münzen) besorgen' },
      { k: 'es_recena', o: -30, t: 'Recena (Mitternachtsimbiss) planen', v: 'catering' },
    ],
    budget: [],
  },
  russisch: {
    label: 'Russisch', group: 'Europa', desc: 'Brautkauf (Vykup), Karavai mit Salz und ein Tamada als Moderator.',
    events: [], vendors: ['moderation'],
    tasks: [
      { k: 'ru_tamada', o: -180, t: 'Tamada (Moderator:in) buchen', v: 'moderation', book: true },
      { k: 'ru_vykup', o: -21, t: 'Vykup nevesty (Brautkauf) mit Brautjungfern planen' },
      { k: 'ru_karavai', o: -14, t: 'Karavai (Hochzeitsbrot) und Salz bestellen' },
    ],
    budget: [{ cat: 'moderation', label: 'Tamada / Moderation', share: 3 }],
  },
  westafrikanisch: {
    label: 'Westafrikanisch', group: 'Weitere Kulturen', desc: 'Traditional Wedding mit Familienzeremonie, Aso Ebi, MC und Spraying.',
    events: ['traditional'], vendors: ['moderation', 'mode_trad'],
    tasks: [
      { k: 'wa_liste', ev: 'traditional', o: -150, t: 'Liste der Familie für die traditionelle Zeremonie klären', n: 'z. B. Brautpreis bzw. Geschenke an die Familie der Braut.' },
      { k: 'wa_asoebi', o: -120, t: 'Aso Ebi (einheitliche Stoffe) auswählen und an Familie & Freunde verteilen', v: 'mode_trad' },
      { k: 'wa_mc', o: -180, t: 'MC buchen', v: 'moderation', book: true },
      { k: 'wa_outfits', o: -120, t: 'Traditionelle Outfits (z. B. Gele, Agbada, Kente) bestellen', v: 'mode_trad' },
      { k: 'wa_spraying', o: -7, t: 'Spraying vorbereiten: Bargeld in kleinen Scheinen, Helfer:innen zum Einsammeln' },
    ],
    budget: [{ cat: 'mode_trad', label: 'Traditionelle Outfits', share: 5 }, { cat: 'traditional', label: 'Traditional Wedding', share: 8 }],
  },
  chinesisch: {
    label: 'Chinesisch', group: 'Weitere Kulturen', desc: 'Glückstag, Türspiele, Teezeremonie und rote Umschläge (Hongbao).',
    events: ['tee'], vendors: ['mode_trad'],
    tasks: [
      { k: 'cn_datum', o: -365, t: 'Glückstag mit der Familie bestimmen', n: 'Viele Familien wählen das Datum nach dem chinesischen Kalender.' },
      { k: 'cn_tee', ev: 'tee', o: -30, t: 'Teeset und Teezeremonie für Eltern und Ältere vorbereiten' },
      { k: 'cn_tuer', ev: 'tee', o: -30, t: 'Türspiele beim Brautabholen planen' },
      { k: 'cn_qipao', o: -120, t: 'Qipao bzw. Kleid für den Kleiderwechsel bestellen', v: 'mode_trad' },
      { k: 'cn_deko', o: -30, t: 'Deko mit Doppelglück-Zeichen 囍 in Rot und Gold' },
    ],
    budget: [{ cat: 'mode_trad', label: 'Qipao & Kleiderwechsel', share: 3 }],
  },
};

// Optionen, die zusätzliche Aufgaben auslösen
export const OPTION_TASKS = [
  { k: 'op_alkoholfrei', o: -90, t: 'Alkoholfreies Getränkekonzept planen', cond: 'noAlcohol', v: 'getraenke', n: 'Mocktails, Limonaden, Tee- und Kaffeebar.' },
  { k: 'op_ehefaehig', o: -240, t: 'Ehefähigkeitszeugnis bzw. Befreiung beantragen', cond: 'international', n: 'Für Partner:innen ohne deutsche Staatsangehörigkeit. Bearbeitung kann Monate dauern.' },
  { k: 'op_apostille', o: -210, t: 'Ausländische Urkunden mit Apostille bzw. Legalisation und beglaubigter Übersetzung besorgen', cond: 'international' },
  { k: 'op_dolmetscher', o: -60, t: 'Dolmetscher:in fürs Standesamt buchen', cond: 'international', v: 'dolmetscher', book: true, n: 'Nötig, wenn jemand nicht ausreichend Deutsch spricht.' },
  { k: 'op_ausland', o: -300, t: 'Anerkennung der Ehe im Ausland bzw. in Deutschland klären', cond: 'abroad', n: 'Im Ausland geschlossene Ehen können beim deutschen Standesamt nachbeurkundet werden.' },
];

export const LANGS = { de: 'Deutsch', en: 'Englisch', tr: 'Türkisch', ar: 'Arabisch', pl: 'Polnisch', it: 'Italienisch', es: 'Spanisch', ru: 'Russisch', fa: 'Persisch' };

// Ramadan (ungefähre Daten, je nach Mondsichtung ±1 Tag)
const RAMADAN = [['2026-02-18', '2026-03-19'], ['2027-02-08', '2027-03-09'], ['2028-01-28', '2028-02-26'], ['2029-01-16', '2029-02-14'], ['2030-01-05', '2030-02-03'], ['2030-12-26', '2031-01-24']];

// Prüft das Datum gegen Regeln der gewählten Traditionen und gibt Hinweise zurück.
export function dateWarnings(date, traditions) {
  const out = []; const d = new Date(date + 'T12:00:00Z'); const dow = d.getUTCDay();
  const has = k => traditions.includes(k);
  if (has('juedisch') && dow === 6) out.push('Das Datum fällt auf einen Samstag (Schabbat). Jüdische Trauungen finden am Schabbat nicht statt.');
  if ((has('islamisch') || has('arabisch') || has('tuerkisch') || has('kurdisch')) && RAMADAN.some(([a, b]) => date >= a && date <= b)) out.push('Das Datum liegt voraussichtlich im Ramadan. Viele Familien feiern in dieser Zeit keine Hochzeit.');
  if (has('orthodox') && date.slice(5) >= '08-01' && date.slice(5) <= '08-15') out.push('Vom 1. bis 15. August ist orthodoxe Fastenzeit, in der meist keine Trauungen stattfinden.');
  return out;
}

// Für den Assistenten im Browser
export function catalog() {
  return {
    traditions: Object.fromEntries(Object.entries(TRADITIONS).map(([k, t]) => [k, { label: t.label, group: t.group, desc: t.desc, events: t.events.map(e => t.eventTitles?.[e] || EVENT_DEFS[e]?.title || e), options: t.options || [] }])),
    langs: LANGS, vendors: VENDOR_CATS,
  };
}
