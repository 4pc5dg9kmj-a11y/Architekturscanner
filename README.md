# 🚲 Fahrradhäuschen-Planer + 📐 Architekturscanner

Dieses Repository enthält zwei Werkzeuge:

| Seite | Werkzeug |
|---|---|
| `/` bzw. `/planer` | **Fahrradhäuschen-Planer** – parametrischer Selbstbau-Planer mit 3D, Werkzeichnungen, Holzliste und PDF |
| `/scanner` | **Architekturscanner** – Altpläne vektorisieren und als DXF exportieren |

```bash
pip install -r requirements.txt
python server.py          # http://localhost:8000
```

---

# 🚲 Fahrradhäuschen-Planer

Plant ein **Fahrradhäuschen mit Geräteraum und Pultdach**, das in **Hessen
verfahrensfrei direkt an der Grundstücksgrenze** stehen darf – und liefert
alles, was zum Bauen nötig ist: 3D-Modell, maßstäbliche Werkzeichnungen,
Zuschnittplan, Schraubenliste und eine Schritt-für-Schritt-Bauanleitung als PDF.

Jeder Slider verändert das komplette Paket sofort: Geometrie, Statik,
Materiallisten, Zeichnungen und die Prüfung nach Hessischer Bauordnung.

## Warum genau diese Konstruktion

- **Pultdach, das von der Grenze wegfällt.** Der First liegt an der
  Grenzwand, die Traufe mit Rinne auf der Gartenseite. So läuft kein
  Niederschlagswasser zum Nachbarn, und an der Grenze ist der Dachüberstand
  null – das Dach endet bündig mit der Fassadenaußenkante.
- **Grenzwand zuerst fertigstellen.** Die Bauanleitung erzwingt diese
  Reihenfolge, weil dort später kein Arbeitsraum mehr ist und niemand ohne
  Absprache das Nachbargrundstück betreten darf.
- **Plattformbauweise auf Schwellenrost**, Ständerraster 625 mm – passt zum
  Plattenmaß 1250/2500 mm und hält den Verschnitt klein.

## Prüfung nach Hessischer Bauordnung

Der Planer rechnet die drei entscheidenden Grenzwerte live mit und zeigt sie
als Ampel:

| Kriterium | Grenzwert | Rechtsgrundlage |
|---|---|---|
| Brutto-Rauminhalt | 30 m³ → verfahrensfrei | § 63 Abs. 1 Nr. 1 a HBO |
| Mittlere Wandhöhe an der Grenze | 3,00 m | § 6 Abs. 8 HBO |
| Bebauungslänge je Grenze | 15,00 m | § 6 Abs. 8 HBO |
| Brandwand an der Grenze | erst ab 50 m³ nötig | § 30 HBO |
| Lage im Innen-/Außenbereich | Außenbereich nie verfahrensfrei | § 34/35 BauGB |

Dazu geprüft: Dachüberstand zur Grenze (muss 0 sein), Ableitung des
Niederschlagswassers und die Nutzung ohne Aufenthaltsraum oder Feuerstätte.

**Wichtig:** verfahrensfrei heißt nicht anforderungsfrei (§ 63 Abs. 4 HBO).
Bebauungsplan, örtliche Satzungen und Baulasten müssen zusätzlich geprüft
werden. Diese Unterlagen sind eine Selbstbauplanung, keine geprüften
Bauvorlagen und keine Rechtsberatung.

## „Maximal ausreizen“

Ein Knopf sucht die größte Variante, die noch verfahrensfrei **und**
grenzständig zulässig ist: möglichst viele Fahrradstellplätze, danach ein
möglichst breiter Geräteteil, danach möglichst großzügige lichte Höhe.
Typisches Ergebnis: rund **5,03 m × 2,27 m, 29,4 m³** – sechs Räder plus
1,50 m Geräteraum, Grenzwand 2,71 m.

## Statik

Die Sparren werden **automatisch dimensioniert**, nicht geraten. Nachgewiesen
werden Biegespannung, Durchbiegung und Schub nach DIN EN 1995-1-1
(Nutzungsklasse 2, k_mod = 0,90, γ_M = 1,30) für Schneelastzone und
Geländehöhe des Standorts. Wer auf Gründach umstellt, sieht sofort einen
stärkeren Querschnitt – 110 kg/m² gesättigtes Substrat sind kein Detail.

## Standardhölzer und Zuschnitt

Alle Querschnitte sind Handelsware (KVH 60×120, 60×60, Dachlatte 40×60,
Latte 30×50, Rhombusleiste 20×65 …). Für jeden Querschnitt sucht ein
First-Fit-Decreasing-Zuschnitt über alle lieferbaren Stangenlängen die
günstigste Kombination – inklusive 5 mm Sägeblattbreite. Der Zuschnittplan
zeigt jede einzelne Stange mit Belegung und Rest; der Verschnitt liegt
typisch unter 20 %.

## Ausgaben

**PDF-Bauunterlagen** (ein Dokument, 25 Seiten):

- Deckblatt mit allen Kennwerten und dem Prüfergebnis
- 16 Zeichnungsblätter A3 quer mit Schriftfeld, echtem Maßstab und
  Maßstabsleiste: Lageplan, Gründungsplan, Grundriss, vier Ansichten,
  Schnitt A-A, Sparrenplan, vier Ständerwerkspläne, drei Details 1:5
- Holzliste, Zuschnittplan, Schrauben- und Werkstoffliste, Werkzeugliste
- Bauanleitung in 11 Schritten mit Dauer, Personenzahl und Kontrollpunkten
- Prüfung nach HBO mit Einzelnachweisen und Lastannahmen

**DXF-Export** des kompletten Zeichnungssatzes, layerweise getrennt, in Metern.

## Bedienung

| Bereich | Inhalt |
|---|---|
| Seitenleiste | Slider für Stellplätze, Geräteteil, Tiefe, lichte Höhe, Dachneigung; Ausführung, Standort, Preisniveau; Ampel und Kostenrahmen |
| 3D-Ansicht | Ziehen = drehen, Mausrad = zoomen, Shift+Ziehen = verschieben; Bauteilgruppen einzeln ausblenden, Bauteil unter dem Zeiger wird benannt |
| Zeichnungen | alle Blätter, Ziehen = verschieben, Mausrad = zoomen |
| Holz & Zuschnitt | Einkaufsliste und Zuschnittplan je Stange |
| Schrauben & Material | Verbindungsmittel, Werkstoffe, Werkzeug |
| Bauanleitung | Schritte mit Kontrollpunkten zum Abhaken |
| Hessen-Prüfung | Kennwerte, Einzelnachweise, Lastannahmen |

## Technik

- **Backend**: Python, FastAPI, reportlab (PDF), ezdxf (DXF). Keine Datenbank.
- **Frontend**: Vanilla JS ohne Build-Schritt und ohne Fremdbibliotheken –
  3D-Ansicht und Zeichnungen werden auf Canvas gerendert.
- **Eine Geometriequelle**: aus `shed/model.py` entstehen 3D-Ansicht,
  2D-Zeichnungen, PDF und DXF. Die Darstellungen können nicht auseinanderlaufen.
- **Deutsche Schreibweise** zentral in `shed/text.py`, damit PDF und
  Weboberfläche identische Texte zeigen.

```
shed/spec.py          Eingabeparameter und feste Konstruktionsmaße
shed/statics.py       Lasten und Sparrennachweis nach EC5
shed/model.py         parametrisches Bauwerk, jedes Holz mit Lage
shed/compliance.py    HBO-Prüfung und Optimierer
shed/bom.py           Holzliste, Zuschnitt, Schrauben, Werkstoffe
shed/drawings.py      2D-Zeichnungssatz
shed/instructions.py  Bauanleitung
shed/pdf.py           PDF-Satz
shed/dxf.py           DXF-Export
```

Tests: `python tests/test_shed.py` (oder `python -m pytest tests -q`).

---

# 📐 Architekturscanner

Digitalisiert abfotografierte oder gescannte Altpläne (Foto/PDF) zu **exakten,
geraden, maßstäblichen CAD-Zeichnungen** – mit editierbaren Maßketten,
Layern und DXF-Export (AutoCAD/DWG-kompatibel).

![Ablauf](docs/screenshot.png)

## Was das Programm kann

- **Automatische Vektorisierung**: Beleuchtungsausgleich, Entzerrung der
  Verdrehung (Deskew), Skelettierung und Linienerkennung machen aus krummen,
  fotografierten Linien gerade, exakt horizontale/vertikale Segmente.
  Schräge Linien (z. B. Dachneigungen) bleiben erhalten.
- **Lange, logische Linien statt Fragmente**: kollineare Stücke werden
  spurweise zu durchgehenden Linien verschmolzen, Lücken unter entfernter
  Beschriftung überbrückt, Ecken exakt geschlossen. Gefüllte Flächen
  (Wände, Decken) werden als saubere Konturzüge übernommen.
- **Text bleibt Text**: erkannte Beschriftungen werden vor der
  Linienerkennung maskiert und als editierbare Textobjekte übernommen –
  Buchstaben werden nicht zu Linien vektorisiert. Papierkanten und
  Faltenschatten werden ausgefiltert.
- **Perspektiv-Entzerrung**: 4 Ecken des Plans klicken → das Foto wird
  rechtwinklig entzerrt (Knopf „◇ Entzerren“).
- **Maßstab kalibrieren**: Zwei Punkte einer bekannten Strecke klicken
  (z. B. Maßstabsleiste oder ein vorhandenes Maß) und die reale Länge in
  Metern eingeben. Danach sind alle Maße und der Export **maßstäblich**.
- **Maßketten**: Beliebig viele Messpunkte klicken → Maßkette mit
  automatisch berechneten, maßstäblichen Werten. Punkte sind nachträglich
  verschiebbar (Werte aktualisieren sich), die Maßlinie ist frei
  positionierbar, einzelne Maßtexte per Doppelklick überschreibbar.
  Damit sind **nachträgliche Messungen** direkt im Plan möglich.
- **Neue Linien zeichnen**: Klick-Klick mit Endpunkt-Fang und
  Orthogonal-Modus (Shift).
- **Getrennte Layer** (frei erweiterbar, Farbe/Sichtbarkeit je Layer):
  - Bestand (alte Zeichnung) – Ergebnis der Vektorisierung
  - Neu (neue Zeichnung)
  - Bemaßung Bestand / Bemaßung Neu
  - Text / Beschriftung
- **Texterkennung (OCR)**: Beschriftungen des Zeichners (Schriftfeld,
  Anmerkungen) werden optional per Tesseract erkannt und als editierbare
  Textobjekte übernommen.
- **DXF-Export**: Linien, echte DIMENSION-Entities und Texte auf ihren
  Layern, Koordinaten in Metern. Die Datei öffnet in AutoCAD, BricsCAD,
  LibreCAD u. a. – von dort „Speichern als DWG“ (DWG ist ein proprietäres
  Format; DXF ist das offizielle Austauschformat und verlustfrei
  konvertierbar, z. B. auch mit dem kostenlosen ODA File Converter).
- **Projekt speichern/laden** als JSON (inkl. Foto, Layern, Maßketten).
- Undo/Redo (Strg+Z / Strg+Y), Mehrfachauswahl per Rahmen, Löschen mit Entf.

## Installation & Start

```bash
pip install -r requirements.txt
# optional für OCR:  apt-get install tesseract-ocr tesseract-ocr-deu
python server.py
```

Dann <http://localhost:8000/scanner> öffnen.

## Empfohlener Arbeitsablauf

1. **Plan laden** (Foto oder PDF).
2. Bei schrägem Foto: **◇ Entzerren** und die 4 Plan-Ecken klicken.
3. **⚖ Kalibrieren**: bekannte Strecke klicken, reale Länge in m eingeben.
4. Erkannte Linien prüfen: Störlinien mit Rahmenauswahl + Entf löschen,
   fehlende Linien mit dem Linienwerkzeug nachziehen.
5. **⟷ Maßketten** anlegen (alte Maße nachbilden oder neue Messungen).
6. **⬇ DXF-Export** → in CAD öffnen, bei Bedarf als DWG speichern.

## Tastenkürzel

| Taste | Funktion |
|---|---|
| `V` / `L` / `M` / `T` / `K` / `H` | Auswahl / Linie / Maßkette / Text / Kalibrieren / Hand |
| `Shift` | orthogonal zeichnen |
| `Enter` / Doppelklick | Maßkette abschließen |
| `Entf` | Auswahl löschen |
| `Strg+Z` / `Strg+Y` | Rückgängig / Wiederholen |
| Mausrad / mittlere Taste | Zoom / Ansicht verschieben |

## Technik

- **Backend**: Python, FastAPI, OpenCV (adaptive Binarisierung,
  Zhang-Suen-Skelettierung, Hough-Segmente, Winkel-Snapping, kollineares
  Zusammenführen, Eckpunkt-Clustering), ezdxf, PyMuPDF, Tesseract (optional).
- **Frontend**: Vanilla-JS-Canvas-Editor ohne Build-Schritt.
- Vektorisierungs-Parameter (Mindestlänge, Lückenschluss, Winkeltoleranz)
  sind in der Seitenleiste einstellbar; „Neu vektorisieren“ wendet sie an,
  ohne eigene Zeichnungen/Maßketten zu verlieren.
