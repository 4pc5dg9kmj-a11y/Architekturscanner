# 👣 Familien-Füße Generator

Erzeugt aus **Namen + Alter** ein Familienbild aus Füßen im minimalistischen
Ein-Linien-Stil (wie die Vorlage „WE ARE GOOD TOGETHER") – **große Füße für
Erwachsene, kleinere für Kinder, maßstäblich zum Alter**. Perfekt zum Ausdrucken.

## Benutzen

Einfach `index.html` im Browser öffnen (Doppelklick genügt). Es braucht **keinen
Server und keine Installation** – alles läuft lokal, nichts wird hochgeladen.

## Funktionen

- **Personen mit Name und Alter** beliebig hinzufügen/entfernen.
- **Fußgröße maßstäblich zum Alter**: realistische Kurve von ~7,5 cm (Baby) bis
  ~26 cm (Erwachsener). Jedes Paar wird proportional gezeichnet.
- **5 Fußform-Varianten** je Person (Rund, Schmal, Breit, Zierlich, Kräftig).
  „Automatisch" gibt jeder Person eine andere Form, damit die Paare sich
  natürlich unterscheiden.
- **5 Posen** je Person:
  - **Aufrecht** – Zehen nach oben (Standard).
  - **Oben auseinander** – die Zehen spreizen sich, Fersen bleiben zusammen (V).
  - **Unten auseinander** – die Fersen spreizen sich, Zehen bleiben zusammen (A).
  - **Parallel schräg** – beide Füße parallel, leicht geneigt nebeneinander.
  - **Liegend 90°** – das Paar liegt waagerecht (Zehen zur Seite), wie das
    mittlere Paar auf der Vorlage.

  Jedes Paar wird exakt über seine Bounding-Box zentriert, damit auch
  gespreizte, gedrehte oder liegende Paare sauber in einer Reihe sitzen.
- **Anordnung**: „Große Füße außen" (Eltern außen, Kinder in die Mitte – wie die
  Vorlage), Eingabereihenfolge oder klein → groß.
- **Beschriftung**: eigener Untertitel (Standard „WE ARE GOOD TOGETHER"),
  optional Namen und Alter unter jedem Fußpaar.
- **Stil**: Neigung der Füße, Linienstärke, Linienfarbe, weißer oder
  transparenter Hintergrund.
- **Export**:
  - **SVG** – verlustfreier Vektor, ideal fürs Druckhaus (beliebig skalierbar).
  - **PNG** – hochauflösend (~2400–4000 px) für den Heimdruck.
  - **Drucken** – direkt aus dem Browser (nur das Motiv wird gedruckt).

## Technik

Eine einzige, eigenständige HTML-Datei. Die Füße sind eine parametrische
SVG-Linienzeichnung (geglättete Catmull-Rom-Kurve durch die Umriss-Punkte),
die je Person nach Alter skaliert wird. Kein Build-Schritt, keine
Abhängigkeiten.
