# weddify

Hochzeitsshop mit Planer für drei Rollen: **Brautpaar**, **Trauzeug:innen** und **Gäste**.
Läuft auf einem eigenen Server und braucht nur Node.js 22. Es gibt keine externen Pakete, die Datenbank ist SQLite.

## Was die App kann

**Aus wenigen Angaben ein kompletter, verknüpfter Plan.** Der Assistent fragt nur nach Namen, Datum, Ort, Traditionen, ungefährer Gästezahl, ein paar Optionen und den Sprachen. Daraus entstehen:

| Bereich | Inhalt |
|---|---|
| **Feiern** | Alle Feiern der gewählten Traditionen mit Datum, Uhrzeit, Gästekreis und Programm, z. B. Standesamt, Henna- bzw. Kına-Abend, Nikah, Kirche, Mehndi, Chuppa, Hauptfeier |
| **Zeitplan** | Aufgaben je Tradition, bezogen auf die passende Feier, für das Paar und getrennt für die Trauzeug:innen |
| **Budget** | Gesamtbudget (angegeben oder aus der Gästezahl geschätzt), verteilt auf Posten inklusive traditioneller Kosten |
| **Dienstleister** | Checkliste passend zu den Traditionen, z. B. Imam, Davul-Zurna, Henna-Künstlerin, Pandit, Rabbiner:in |
| **Gästeliste** | Einladungen je Feier nach Gästekreis (alle, Familie, nur Frauen) und persönliche Zusage-Links ohne Konto |
| **Sitzplan** | Grundriss, automatische Tischplanung, Namen pro Stuhl, auf Wunsch getrennte Damen- und Herrenbereiche |
| **Druckerei** | Save-the-Date, persönliche Einladungen mit QR-Code, Programm bzw. Kirchenheft, Menükarten, Platzkarten, Tischnummern, Sitzplan-Aushang, Willkommensschild, Gastgeschenk-Anhänger, Adressetiketten, Danksagungen. Bis zu 3 Sprachen, auch Arabisch und Persisch von rechts nach links, optional mit Bismillah. 4 Designs. |
| **Kostenrechner** | Kosten je Posten aus Gästezahl (geplant, eingeladen oder zugesagt), Ausstattung (einfach, mittel, gehoben), Region und Traditionen. Jeder Preis ist überschreibbar, mit Puffer, per Klick ins Budget übernehmbar. |
| **Belege & Ausgaben** | Kassenzettel fotografieren oder Foto bzw. PDF hochladen. Die Texterkennung liest Gesamtbetrag, Datum, Händler und Kategorie, ihr prüft nur noch. Ausgaben fließen ins Budget, eine Zahlung an einen gebuchten Dienstleister wird nicht doppelt gezählt. Dazu eine Übersicht „Wer hat was bezahlt“. |
| **Geschenke** | Wer hat was geschenkt (auch Gold/Takı und Geld), daraus entstehen die Danksagungskarten |

### Traditionen (Wissensbasis in `traditions.js`)
- **Deutschland:** Standesamt, freie Trauung, Polterabend
- **Christlich:** evangelisch, katholisch, orthodox
- **Islamisch:** islamisch, arabisch
- **Türkisch & kurdisch:** türkisch, kurdisch
- **Europa:** polnisch, italienisch, spanisch, russisch
- **Weitere Kulturen:** persisch, indisch (Hindu), Sikh, jüdisch, westafrikanisch, chinesisch

Kombinationen sind ausdrücklich vorgesehen (z. B. Standesamt + türkisch + islamisch). Doppelte Aufgaben wie „Location buchen“ werden zusammengeführt.

**Datumswarnungen:**
- Schabbat bei jüdischen Trauungen
- Ramadan bei islamischen, türkischen und arabischen Hochzeiten (ungefähre Daten bis 2031)
- Orthodoxe Fastenzeit im August
- Fehlendes Standesamt: In Deutschland ist nur die standesamtliche Ehe rechtlich gültig.

Die Inhalte sind Planungshilfen. Religiöse und rechtliche Details unterscheiden sich je nach Gemeinde, Rechtsschule, Standesamt und Familie.

### Wie alles verknüpft ist
- **Datum der Hauptfeier ändern:** Alle Feiern und Aufgaben wandern mit. Von Hand gesetzte Termine bleiben stehen.
- **Später Planungsstart:** Aufgaben, deren idealer Termin schon vorbei ist, werden auf die nächsten Wochen verteilt.
- **Dienstleister auf „gebucht“ setzen:**
  - Die passende „Buchen“-Aufgabe ist erledigt.
  - Der Preis fließt ins Budget.
  - Anzahlung und Restzahlung erscheinen im Zeitplan und im Kalender-Abo.
  - „Bezahlt“ zählt automatisch im Budget.
- **Gäste:**
  - Zusagen je Feier fließen in die Gästeübersicht (Personen, Menüwünsche, Allergien).
  - Zusagen zur Hauptfeier landen im Sitzplan, von dort auf Platzkarten und Aushang.
  - Adressen ergeben die Etiketten.
  - Der persönliche Link wird auf der Einladung zum QR-Code.
  - Gäste sehen ihren Tisch auf der Zusage-Seite.
- **Geschenke** ergeben die Danksagungskarten. Abgehakte Danksagungen werden nicht erneut gedruckt.
- **Traditionen nachträglich ändern:** Fehlende Feiern, Aufgaben, Posten und Dienstleister werden ergänzt, Eingetragenes bleibt erhalten.

### Texterkennung (Belege)
- Läuft im Browser mit Tesseract.js (`public/vendor/ocr`, Apache-2.0), mit deutschen und englischen Sprachdaten (MIT). Belegfotos werden dafür an keinen fremden Dienst geschickt.
- Der Beleg selbst wird auf eurem Server gespeichert (`DATA_DIR/receipts`).
- Erkannt wird der Gesamtbetrag über Stichworte wie „Summe“, „Gesamt“, „zu zahlen“ oder „Rechnungsbetrag“. Zwischensumme, MwSt, Rabatt und Rückgeld werden ignoriert.
- Bei PDF-Rechnungen wird die Datei gespeichert, den Betrag tragt ihr selbst ein.
- Die Kostenrichtwerte stehen in `traditions.js` (`COST_BASE`, `COST_TRAD`) und lassen sich dort anpassen.

### Rollen
| Rolle | Sieht |
|---|---|
| **Brautpaar** | alles |
| **Trauzeug:innen** | eigenen Zeitplan (das Paar sieht ihn nicht), Gäste, Sitzplan, Feiern, Beiträge für die Hochzeitszeitung |
| **Gäste** | eigene Einladungen und Zusage je Feier, Programm, eigenen Tisch, Beitrag zur Hochzeitszeitung. Zusagen gehen auch ohne Konto über den persönlichen Link `/app#/r/<token>`. |

### Einladen
- `G-…` Gäste (mit Konto; Gäste aus der Gästeliste brauchen keins, der persönliche Link reicht)
- `T-…` Trauzeug:innen
- `P-…` zweite Hälfte des Paares

Wer mit dem Gäste-Code beitritt und dieselbe E-Mail wie ein Eintrag in der Gästeliste hat, wird automatisch mit diesem Eintrag verknüpft.

### Gästeliste schnell füllen
„Liste einfügen“ nimmt eine Zeile pro Gast oder Haushalt: `Name; Personen; Gruppe; E-Mail; Adresse`. Ihr könnt direkt aus Excel oder Google Tabellen kopieren, mehrzeilige Adresszellen werden erkannt.

## Lokal starten

```bash
node --version      # mindestens v22.13
npm start           # http://localhost:3000  (Shop) und /app (Planer)
npm test            # spielt alle Rollen und Rechte automatisch durch
```

## Auf dem eigenen Server

### Mit Docker
```bash
cp docker-compose.yml docker-compose.override.yml   # PUBLIC_URL anpassen
docker compose up -d --build
```
Die Datenbank liegt in `./data/weddify.db`.

### Ohne Docker
```bash
PORT=3000 DATA_DIR=/var/lib/weddify COOKIE_SECURE=1 TRUST_PROXY=1 PUBLIC_URL=https://eure-domain.de npm start
```
Den Prozess mit systemd oder pm2 dauerhaft laufen lassen.

### HTTPS mit Caddy (empfohlen)
```
eure-domain.de {
    reverse_proxy 127.0.0.1:3000
}
```
Caddy besorgt das Zertifikat automatisch. Hinter HTTPS `COOKIE_SECURE=1` setzen.

### Konfiguration

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `DATA_DIR` | `./data` | Ordner für die SQLite-Datenbank |
| `COOKIE_SECURE` | `0` | `1`, sobald die Seite über HTTPS läuft |
| `PUBLIC_URL` | `http://localhost:PORT` | Öffentliche Adresse für Einladungs- und Kalenderlinks |
| `TRUST_PROXY` | `0` | `1` hinter einem Reverse Proxy, damit die echte Besucher-IP für die Anmeldebegrenzung zählt |

### Backup
```bash
sqlite3 data/weddify.db ".backup 'backup-$(date +%F).db'"
```

## Sicherheit
- Passwörter werden mit scrypt und eigenem Salt gespeichert.
- Sitzungen laufen über HttpOnly-Cookies mit SameSite=Lax. In der Datenbank steht nur ein Hash des Tokens.
- Schreibende Anfragen werden nur als JSON angenommen. Das schützt vor CSRF.
- Pro IP und 15 Minuten sind höchstens 20 Fehlversuche bei Anmeldung und Code-Eingabe erlaubt. Gezählt werden nur Fehlversuche, damit viele Gäste im selben WLAN beitreten können. Registrierungen sind auf 60 pro IP und 15 Minuten begrenzt.
- Jede Anfrage prüft die Rolle:
  - Gäste sehen keine Zeitpläne und keine Gästeliste.
  - Das Paar sieht weder die Zeitung-Beiträge noch den Zeitplan der Trauzeug:innen.
  - Fremde sehen gar nichts.
- Content-Security-Policy, nosniff und `frame-ancestors 'none'` sind gesetzt.

## Vor dem Livegang noch offen
- **Rechtliches:** Impressum, Datenschutzerklärung, AGB und Widerrufsbelehrung. Im Shop stehen bisher nur Platzhalter.
- **Google Fonts selbst hosten:** Wenn die Schriften von Google geladen werden, gilt das nach deutscher Rechtsprechung als DSGVO-Risiko. Die Schriftdateien gehören nach `public/fonts`, und die `<link>`-Tags sind durch `@font-face` zu ersetzen.
- **Passwort vergessen und E-Mail-Bestätigung** brauchen einen Mailversand (SMTP).
- **Erinnerungen per E-Mail oder Push** gibt es bisher nicht, nur über das Kalender-Abo.
- **Shop-Kasse:** Warenkorb und Preise sind ein Prototyp. Für echte Bestellungen braucht es Zahlungsanbieter, Druckdienstleister und Bestellverwaltung, zum Beispiel über Shopify.
- **Datenbank:** `node:sqlite` ist in Node 22 noch als experimentell markiert. Für den Start reicht das. Bei Bedarf lässt es sich auf `better-sqlite3` oder PostgreSQL umstellen.

## Aufbau
```
server.js       HTTP-Server, API, Kalender-Feed, statische Dateien
db.js           SQLite-Schema
traditions.js   Wissensbasis: Traditionen, Feiern, Aufgaben, Budget, Dienstleister, Datumsregeln
generator.js    erzeugt aus dem Profil den verknüpften Plan
public/
  index.html    Shop mit Marktanalyse (Startseite)
  app.html/.js/.css   Planer-App (Single-Page-App, mobil zuerst, als App installierbar)
  planner.js    Assistent, Cockpit, Feiern, Gästeliste, Budget, Dienstleister, Geschenke, Zusagen
  seating.js    Sitzplan-Generator
  print.js      Druckerei (alle Drucksachen, mehrsprachig, QR-Codes)
  vendor/qrcode.js  QR-Code-Bibliothek (MIT, Kazuhiko Arase)
  vendor/ocr/   Tesseract.js für die Belegerkennung (Apache-2.0) mit Sprachdaten deu/eng
  ocr.js, receipt-parse.js  Belegscan und Auswertung
test/smoke.mjs  Ende-zu-Ende-Test aller Rollen
```

### API (Auszug)
| Methode | Pfad | Wer |
|---|---|---|
| POST | `/api/register`, `/api/login`, `/api/logout` | alle |
| GET | `/api/me` | angemeldet |
| POST | `/api/weddings` | legt Hochzeit an, Rolle Paar |
| POST | `/api/join` `{code}` | Beitritt per Code |
| GET/PATCH | `/api/w/:id` | Mitglieder / Paar |
| GET/POST | `/api/w/:id/tasks` | Paar, Trauzeug:innen (jeweils eigener Zeitplan) |
| PATCH/DELETE | `/api/tasks/:id` | Besitzer des Zeitplans |
| POST | `/api/w/:id/tasks/regenerate` | Paar, Trauzeug:innen |
| GET/PUT | `/api/w/:id/rsvp` | Gäste |
| GET | `/api/w/:id/guests` | Paar, Trauzeug:innen |
| GET/POST | `/api/w/:id/schedule` | alle lesen, Paar schreibt |
| GET/POST | `/api/w/:id/contributions` | Trauzeug:innen (alle), Gäste (eigene) |
| GET | `/cal/:token.ics` | Kalender-Abo |
