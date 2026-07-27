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
