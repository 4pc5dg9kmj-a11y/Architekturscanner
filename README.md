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

Dann <http://localhost:8000> öffnen.

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

---

## 🧾 Zusätzlich im Repo: Rechnungs-App (`rechnung/`)

Aus Booking.com-/Airbnb-Screenshots wird eine fertige PDF-Rechnung für das
Wohlfühlapartment Guxhagen – im Browser (`rechnung/index.html`, offline und als
Handy-App installierbar), auf der Kommandozeile (`node rechnung/cli.mjs`) oder
direkt über Claude (Skill `.claude/skills/rechnung/`).

Details: [`rechnung/README.md`](rechnung/README.md)
