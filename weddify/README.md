# weddify

Hochzeitsshop mit Planer für drei Rollen: **Brautpaar**, **Trauzeug:innen** und **Gäste**.
Läuft auf einem eigenen Server und braucht nur Node.js 22. Es gibt keine externen Pakete, die Datenbank ist SQLite.

## Was die App kann

| Bereich | Funktionen |
|---|---|
| **Brautpaar** | Countdown · Zeitstrahl, der aus dem Hochzeitsdatum automatisch erstellt wird, mit jedem Schritt anpassbar · eigene Schritte hinzufügen · Gästeübersicht mit Zusagen, Menüwünschen, Allergien und Musikwünschen · Tagesablauf pflegen · **Sitzplan-Generator** · Einladungscodes · Kalender-Abo |
| **Trauzeug:innen** | Eigener Zeitstrahl für JGA, Hochzeitszeitung und Rede, den das Paar nicht sieht · Gästeübersicht · Beiträge der Gäste für die Hochzeitszeitung · Sitzplan ansehen · Ablauf · Kalender-Abo |
| **Gäste** | Countdown · eigener Tisch und Platz · Zu- oder Absage mit Personenzahl, Menü, Allergien und Musikwunsch · Anfahrt, Dresscode und Hinweise · Tagesablauf · Beitrag zur Hochzeitszeitung · Hochzeitstermin im Kalender |

### Der Zeitstrahl
- Beim Anlegen einer Hochzeit entstehen automatisch 29 Schritte für das Paar und 15 für die Trauzeug:innen (Vorlagen in `templates.js`).
- Jeder Schritt lässt sich bearbeiten (Titel, Datum, Notiz), abhaken, löschen oder durch eigene Schritte ergänzen.
- Wenn das Hochzeitsdatum geändert wird, wandern alle automatischen Schritte mit. Von Hand verschobene Termine bleiben stehen und lassen sich mit „Automatisches Datum“ zurücksetzen.
- „Zeitplan neu erstellen“ setzt den Zeitplan auf die Vorlage zurück.

### Einladen
Beim Anlegen einer Hochzeit entstehen drei Codes, jeweils auch als Link (`/app#/join/CODE`):
- `G-…` für Gäste
- `T-…` für Trauzeug:innen
- `P-…` für die zweite Hälfte des Paares

### Sitzplan-Generator
1. **Grundriss einfügen:** Bild einfügen (Strg+V / ⌘+V), hineinziehen oder auswählen (PNG, JPG, WebP). Die Raumkontur wird automatisch erkannt. Dicke Wandlinien zählen, dünne Maß- und Hilfslinien nicht. Ohne Grundriss reicht die Eingabe von Breite und Länge.
2. **Maßstab setzen:** Zwei Punkte mit bekanntem Abstand antippen, zum Beispiel eine Wand, und die echte Länge eintragen. Ab dann ist alles in echter Größe.
3. **Raum anpassen:** Ecken verschieben. Wer einen Wand-Mittelpunkt zieht, legt eine neue Ecke an, so lassen sich auch L-förmige Säle abbilden.
4. **Tische legen:** Zur Wahl stehen runde Tische (Ø 150/180), Rechtecktische, Tafeln, quadratische Tische und der Brauttisch (nur einseitig besetzt). Dazu kommen Tanzfläche, DJ/Band, Buffet, Bar, Tortentisch und Säulen. Alles lässt sich verschieben, drehen und in der Größe ändern. Die Zahl der Plätze ist frei wählbar, die Stühle werden automatisch angeordnet.
5. **Prüfung:** Tische außerhalb des Raums oder mit unter 1 m Abstand werden rot markiert, Abstände unter 1,5 m gelb.
6. **Bestuhlung:** Alle Zusagen erscheinen mit Begleitung, dazu das Paar und die Trauzeug:innen. Gäste ohne App lassen sich ergänzen. Plätze werden einzeln vergeben oder automatisch verteilt, dabei sitzen Begleitungen zusammen und das Paar am Brauttisch. Jeder Gast sieht in der App den eigenen Tisch und Platz.
7. **Übersicht „Wer sitzt wo“:** zum Drucken oder als Vorlage für das Sitzplan-Poster.

### Erinnerungen
Jede Person hat einen eigenen Kalender-Abo-Link (`/cal/<token>.ics`). Apple Kalender, Google Kalender und Outlook laden ihn regelmäßig neu. Änderungen im Zeitplan erscheinen deshalb automatisch, mit einer Erinnerung am Vortag. Einzelne Schritte lassen sich zusätzlich direkt zu Google Kalender hinzufügen.

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
templates.js    Vorlagen für die Zeitstrahlen und den Tagesablauf
public/
  index.html    Shop mit Marktanalyse (Startseite)
  app.html/.js/.css   Planer-App (Single-Page-App, mobil zuerst, als App installierbar)
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
