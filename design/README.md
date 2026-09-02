# Entwürfe

Quellen der Design-Fläche zur minimalistischen Fassung der Rechnungs-App
(App am Rechner, App am Handy, Rechnung in zwei Varianten).

| Datei | Inhalt |
| --- | --- |
| `Main.dc.html` | App am Rechner: Eingaben links, Vorschau rechts |
| `Mobil.dc.html` | App am Handy (390 × 844) |
| `Rechnung.dc.html` | Rechnung, sachliche Fassung in Helvetica – so umsetzbar wie das jetzige PDF |
| `RechnungSerif.dc.html` | Rechnung, Objektname und Summe in einer Serifenschrift (Schrift müsste ins PDF eingebettet werden) |
| `canvas.json` | Anordnung der Entwürfe auf der Fläche |

Gestaltung: weiße Fläche, Haarlinien statt Karten, Eingabefelder nur mit
Unterlinie, Ziffern in gleicher Breite (`tabular-nums`), Farbe nur auf dem
PDF-Knopf und als Strich über der Summe.

Umgesetzt ist die sachliche Fassung (`Rechnung.dc.html`): App und PDF in
`rechnung/` folgen ihr. Die Variante mit Serifenschrift bleibt offen – dafür
müsste die Schrift ins PDF eingebettet werden.
