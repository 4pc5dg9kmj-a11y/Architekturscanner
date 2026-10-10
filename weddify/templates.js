// Vorlagen für den automatisch erstellten Zeitstrahl.
// offset = Tage relativ zum Hochzeitsdatum (negativ = davor).
// product = passendes Produkt im Shop (optional).

export const COUPLE_TEMPLATE = [
  { offset: -365, title: 'Budget festlegen', note: 'Wer zahlt was? Plant etwa 10 % Puffer ein.' },
  { offset: -358, title: 'Gästeliste grob erstellen', note: 'Die Gästezahl bestimmt Location und Budget.' },
  { offset: -351, title: 'Location & Datum buchen', note: 'Beliebte Samstage im Sommer sind früh vergeben.' },
  { offset: -300, title: 'Fotograf:in buchen', note: 'Gute Fotograf:innen sind oft ein Jahr im Voraus ausgebucht.' },
  { offset: -293, title: 'Save-the-Date verschicken', note: 'Besonders wichtig für Gäste mit langer Anreise.', product: 'card' },
  { offset: -286, title: 'Trauzeug:innen fragen', note: 'Ladet sie danach mit ihrem Code in weddify ein.' },
  { offset: -240, title: 'Brautkleid & Anzug aussuchen', note: 'Änderungen brauchen 2–3 Monate.' },
  { offset: -233, title: 'Band oder DJ buchen', note: '' },
  { offset: -226, title: 'Gäste in weddify einladen', note: 'Mit dem Gäste-Code können alle zu- oder absagen.' },
  { offset: -182, title: 'Eheschließung beim Standesamt anmelden', note: 'Frühestens 6 Monate vorher möglich. Ausweise und Geburtsurkunden mitnehmen.' },
  { offset: -175, title: 'Einladungskarten bestellen', note: 'Mit QR-Code zur Online-Zusage.', product: 'invite' },
  { offset: -168, title: 'Catering & Torte probieren', note: '' },
  { offset: -120, title: 'Einladungen verschicken', note: 'Zusagefrist etwa 6 Wochen vor der Feier setzen.' },
  { offset: -113, title: 'Eheringe aussuchen', note: 'Gravur dauert 2–4 Wochen.' },
  { offset: -60, title: 'Tagesablauf mit der Location abstimmen', note: 'Den Ablauf in weddify pflegen, Gäste sehen ihn dann direkt.', product: 'time' },
  { offset: -53, title: 'Willkommensschild & Deko bestellen', note: '', product: 'sign' },
  { offset: -46, title: 'Menü festlegen', note: 'Menüwünsche und Allergien stehen in der Gästeübersicht.', product: 'menu' },
  { offset: -42, title: 'Fehlende Zusagen nachfragen', note: '' },
  { offset: -35, title: 'Sitzplan erstellen', note: '', product: 'seat' },
  { offset: -28, title: 'Tisch- & Namenskarten bestellen', note: '', product: 'place' },
  { offset: -14, title: 'Finale Gästezahl an das Catering melden', note: '' },
  { offset: -13, title: 'Zeitplan an alle Dienstleister schicken', note: 'Mit Telefonnummer einer Ansprechperson für den Tag.' },
  { offset: -10, title: 'Eheversprechen schreiben', note: '' },
  { offset: -5, title: 'Probefrisur & Make-up', note: '' },
  { offset: -4, title: 'Deko, Ringe und Papeterie packen', note: 'Eine Kiste pro Bereich, gut beschriftet.' },
  { offset: 0, title: 'Ja sagen und den Tag genießen', note: 'Ihr habt alles vorbereitet.' },
  { offset: 30, title: 'Danksagungskarten verschicken', note: 'Am schönsten mit einem Foto der Feier.', product: 'thanks' },
  { offset: 37, title: 'Namensänderung bei Ämtern & Banken', note: '' },
  { offset: 365, title: 'Ersten Hochzeitstag feiern', note: 'Papierhochzeit: traditionell schenkt man sich etwas aus Papier.', product: 'anni' },
];

export const WITNESS_TEMPLATE = [
  { offset: -240, title: 'Mit dem Paar über Wünsche & No-Gos sprechen', note: 'Was soll es auf keinen Fall geben? Spiele, Reden, Überraschungen?' },
  { offset: -210, title: 'Termin für den Junggesell:innenabschied festlegen', note: 'Gruppe mit den wichtigsten Freund:innen gründen.' },
  { offset: -180, title: 'Budget für JGA & Geschenk klären', note: '' },
  { offset: -150, title: 'JGA planen & buchen', note: '' },
  { offset: -120, title: 'Beiträge für die Hochzeitszeitung einsammeln', note: 'Gäste können ihre Texte direkt in weddify einreichen.', product: 'news' },
  { offset: -90, title: 'Junggesell:innenabschied feiern', note: '' },
  { offset: -75, title: 'Hochzeitszeitung gestalten & bestellen', note: 'Druck braucht etwa 1–2 Wochen.', product: 'news' },
  { offset: -60, title: 'Spiele & Überraschungen mit der Location abstimmen', note: 'Zeitfenster im Ablauf reservieren.', product: 'quiz' },
  { offset: -45, title: 'Gemeinschaftsgeschenk organisieren', note: '' },
  { offset: -30, title: 'Rede schreiben', note: 'Drei Minuten reichen. Eine Geschichte, ein Dank, ein Toast.' },
  { offset: -14, title: 'Ablauf mit Paar & Fotograf:in abgleichen', note: '' },
  { offset: -7, title: 'Notfalltasche für das Paar packen', note: 'Pflaster, Nadel & Faden, Taschentücher, Snacks, Ladekabel.' },
  { offset: -1, title: 'Ringe & Unterlagen einsammeln', note: '' },
  { offset: 0, title: 'Für das Paar da sein', note: 'Zeitplan im Blick behalten, Dienstleister koordinieren.' },
  { offset: 7, title: 'Fotos der Gäste sammeln', note: '' },
];

export const DEFAULT_SCHEDULE = [
  { time: '14:00', title: 'Freie Trauung', place: '' },
  { time: '15:00', title: 'Sektempfang & Gratulation', place: '' },
  { time: '16:30', title: 'Kaffee & Hochzeitstorte', place: '' },
  { time: '19:00', title: 'Abendessen', place: '' },
  { time: '21:00', title: 'Eröffnungstanz & Party', place: '' },
];
