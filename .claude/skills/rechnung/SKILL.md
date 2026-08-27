---
name: rechnung
description: Erstellt aus Booking.com-/Airbnb-Screenshots (oder Angaben im Chat) eine fertige PDF-Rechnung für das Wohlfühlapartment Guxhagen. Nutzen, sobald Screenshots einer Buchung, einer Gast-Nachricht mit Rechnungsanschrift oder ein Auftrag wie "mach mir daraus eine Rechnung" kommt.
---

# Rechnung aus Buchungsdaten erstellen

Ziel: Der Nutzer schickt Screenshots (Booking-App, Airbnb, Nachricht des Gasts)
und bekommt eine fertige PDF-Rechnung zurück – ohne Rückfragen, wenn die Daten
vollständig sind.

## Ablauf

1. **Screenshots lesen** und die Felder unten sammeln.
2. **JSON schreiben** (Datei im Scratchpad, z. B. `rechnung.json`).
3. **PDF bauen:**
   ```bash
   node rechnung/cli.mjs <pfad>/rechnung.json <pfad>/Rechnung_<Nr>.pdf
   ```
4. **PDF an den Nutzer schicken** (`SendUserFile`, `status: "normal"`) und in
   zwei, drei Zeilen zusammenfassen: Empfänger, Zeitraum, Betrag, Rechnungsnummer.

## JSON-Schema

```json
{
  "gast":      { "firma": "", "name": "", "strasse": "", "plz": "", "ort": "", "land": "DE", "email": "" },
  "rechnung":  { "nummer": "2026-018", "datum": "JJJJ-MM-TT", "portal": "Booking.com",
                 "buchungsnummer": "", "anreise": "JJJJ-MM-TT", "abreise": "JJJJ-MM-TT",
                 "naechte": 1, "gaeste": 1, "zahlungsziel": 14, "bezahlt": false, "hinweis": "" },
  "intern":    { "gesamtpreis": 69, "kommission": 8.28 }
}
```

* Ohne `positionen` baut die CLI aus `intern.gesamtpreis`, Zeitraum und Nächten
  automatisch die Übernachtungsposition (Einzelpreis = Gesamtpreis ÷ Nächte).
* Eigene Zeilen (Endreinigung, Kurtaxe, Frühstück …) bei Bedarf ergänzen:
  ```json
  "positionen": [{ "titel": "Endreinigung", "details": [], "menge": 1, "einheit": "Pauschale", "einzelpreis": 35 }]
  ```
* Vermieterdaten, IBAN, Steuernummer und § 19 UStG stecken als Vorgabe in
  `rechnung/src/invoice.mjs` – nur überschreiben, wenn der Nutzer es sagt.

## Regeln beim Auslesen

* **Gesamtpreis** ist der Betrag, den der Gast zahlt ("Gesamtpreis der Buchung").
  Die **Kommission** des Portals wird **nicht** abgezogen und steht nicht auf der
  Rechnung – sie gehört nach `intern.kommission`.
* Nennt der Gast in einer Nachricht eine **abweichende Rechnungsanschrift**
  (typisch: "Bitte stellen Sie die Rechnung auf folgende Firma aus"), gilt diese –
  nicht der Name aus der Buchung.
* Die Bestätigungs-/Buchungsnummer aus der Nachricht hat Vorrang, wenn beide
  Screenshots eine Nummer zeigen; sie sollten übereinstimmen.
* Datumsangaben wie "Mo., 10. Aug. 2026" ins ISO-Format umrechnen. `naechte` =
  Abreise − Anreise.
* **Rechnungsnummer:** fortlaufend im Schema `JJJJ-NNN`. Wenn die letzte Nummer
  nicht bekannt ist, den Nutzer kurz fragen oder die vorgeschlagene Nummer klar
  benennen, damit er sie korrigieren kann.
* Fehlt etwas Wesentliches (Preis, Zeitraum, Empfänger), einmal gezielt nachfragen
  statt zu raten.

## Wenn der Nutzer selbst tippen will

`rechnung/index.html` ist die App dazu (Formular, Live-Vorschau, PDF-Download,
offline nutzbar). Übergabe per Link ist möglich:
`rechnung/index.html#daten=<base64 des JSON>` – dann sind alle Felder vorbelegt
und bleiben editierbar.
