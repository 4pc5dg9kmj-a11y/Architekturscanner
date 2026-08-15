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

## 🖨 3D-Druck-Builder: Foto → Linien-Relief

Zweiter Arbeitsbereich unter <http://localhost:8000/relief> (Knopf
„🖨 3D-Druck-Builder“ oben rechts). Aus einem Foto entsteht eine
**druckfertige Datei**: eine Grundplatte, auf der eine Schar Linien steht.
Aus der Nähe sieht man nur Striche – aus ein paar Schritten Abstand setzt
sich daraus wieder das Motiv zusammen.

Drei Modulationen tragen das Bild, jede einzeln regelbar:

| Modulation | Wirkung | Regler |
|---|---|---|
| **Auslenkung** | Die Linien schwingen seitlich aus und drängen sich in dunklen Zonen zusammen – der Effekt klassischer Linienporträts. | Auslenkung, Wellenlänge, Versatz je Linie |
| **Strichstärke** | Dunkle Stellen bekommen breitere Stege, helle schmale. Trägt den Tonwert am zuverlässigsten. | Strich hell / Strich dunkel |
| **Höhe** | Dunkle Stellen werden höher – wirkt im Streiflicht plastisch. | Höhe hell / Höhe dunkel |

Fertige Ausgangspunkte gibt es als Voreinstellungen: *Welle* (wie das
Vorbild), *Strichstärke*, *Relief (Höhe)*, *Kombiniert*, *Fein & dicht*.

**Zwei Vorschauen**, beide aus derselben Rasterung des Modells:

- **Streiflicht** – simuliert den fertigen Druck unter schräger Beleuchtung
  (Schattenkanten der Stege plus Verdeckung dicht stehender Linien).
- **Draufsicht** – Material schwarz auf weißer Platte; zeigt den Tonwertaufbau
  am schärfsten.

Die Statuszeile nennt laufend Plattenmaß, Linienabstand, Stegzahl,
Dreiecksanzahl, Dateigröße und den geschätzten Materialbedarf (PLA).

**Export**: `STL` (überall lesbar, Voreinstellung), `3MF` (bringt die Einheit
Millimeter selbst mit, deutlich kleiner) oder `OBJ`. Das Modell liegt mit der
Unterseite auf z = 0 und ist in Millimetern – im Slicer also sofort richtig
platziert.

### Druckhinweise

- Voreinstellungen passen zu **0,4-mm-Düse / 0,2-mm-Schichten**: schmalste
  Linie 0,4 mm (eine saubere Extrusionsbahn), Linienhöhe ein Vielfaches von
  0,2 mm. Schmaler als die Düse sollte „Strich hell“ nicht werden.
- **Ohne Stützen** druckbar: alle Flanken stehen senkrecht auf der Platte.
- Die Stege tauchen um „Eintauchtiefe“ (0,3 mm) in die Platte ein und
  durchdringen sie damit. Slicer (PrusaSlicer, Orca, Cura, Bambu Studio)
  vereinen sich durchdringende Körper automatisch – das ist bewusst so
  gelöst, eine echte boolesche Vereinigung wäre bei tausenden Stegen
  numerisch heikel und langsam.
- Wird „Strich dunkel“ größer als 80 % des Linienabstands, begrenzt das
  Programm den Wert und sagt es in der Statuszeile: sonst laufen die dunklen
  Partien zu einer schwarzen Fläche zusammen und das Motiv verschwindet.
- Für kräftigen Kontrast eignen sich Motive mit klarer Silhouette. Über
  Gamma/Kontrast/Helligkeit lässt sich der Tonwertumfang nachziehen,
  „Negativ“ dreht ihn um.

### Ohne Weboberfläche (Kommandozeile)

```bash
python -m printbuilder foto.jpg -o relief.stl --breite 120 --linien 60
python -m printbuilder foto.jpg -o relief.3mf --preset relief --winkel 90
python -m printbuilder foto.jpg --vorschau vorschau.png   # nur ansehen
```

`python -m printbuilder --help` listet alle Regler. Programmatisch:

```python
from printbuilder import ReliefParams, build_relief
from printbuilder.image_prep import decode_image
from printbuilder.mesh import to_stl

gray = decode_image(open("foto.jpg", "rb").read())
result = build_relief(gray, ReliefParams(width_mm=150, line_count=70))
open("relief.stl", "wb").write(to_stl(result.mesh))
```

## Installation & Start

```bash
pip install -r requirements.txt
# optional für OCR:  apt-get install tesseract-ocr tesseract-ocr-deu
python server.py
```

Dann <http://localhost:8000> öffnen (Planscanner) bzw.
<http://localhost:8000/relief> (3D-Druck-Builder).

Tests: `python tests/test_printbuilder.py`

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
- **3D-Druck-Builder** (`printbuilder/`): Bildaufbereitung → Linienschar mit
  bilinearer Abtastung der Tonwerte → Douglas-Peucker-Ausdünnung der
  Stützpunkte → Vernähen zu geschlossenen Stegkörpern (Mantel + Deckel,
  Normalen nach außen) → STL/3MF/OBJ. Ohne weitere Abhängigkeiten, nur
  NumPy und OpenCV.
- **Frontend**: Vanilla-JS-Canvas-Editor ohne Build-Schritt.
- Vektorisierungs-Parameter (Mindestlänge, Lückenschluss, Winkeltoleranz)
  sind in der Seitenleiste einstellbar; „Neu vektorisieren“ wendet sie an,
  ohne eigene Zeichnungen/Maßketten zu verlieren.
