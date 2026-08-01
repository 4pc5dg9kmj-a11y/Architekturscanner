# Verbesserungsvorschläge

Stand: August 2026. Priorisiert nach Nutzen im Alltag, mit grober Aufwands-
schätzung (S ≈ ½ Tag, M ≈ 1–2 Tage, L ≈ 3–5 Tage).

---

## Teil 1 — Belege automatisch beschriften und ablegen

Das ist der Hauptwunsch: Datei hereinlegen → Programm benennt sie korrekt →
Programm legt sie in der Cloud ab (pCloud bevorzugt, Google Drive als
Alternative).

### 1.1 Was heute fehlt

Aktuell landen Anhänge unter ihrem Originalnamen (`scan0012.pdf`) in der
IndexedDB des Browsers. Sie sind damit:

- **nicht auffindbar** außerhalb der App,
- **nicht typisiert** – eine Arztrechnung, ein Beihilfebescheid und eine
  PKV-Leistungsabrechnung sind für die App dasselbe „Anhang"-Objekt,
- **an genau einen Browser gebunden** – Profil gelöscht, Belege weg,
- **nicht gesichert** außer per manuellem JSON-Export.

Für Belege, die man im Zweifel Jahre später einem Widerspruch beilegen muss,
ist das zu wenig.

### 1.2 Dokumenttypen einführen (Voraussetzung für alles Weitere)

Statt „Anhang" bekommt jede Datei einen Typ. Der Typ steuert Benennung,
Zielordner und Auswertung:

| Typ | Kürzel | Gehört zu |
|---|---|---|
| Arztrechnung | `Rechnung` | Rechnung |
| Beihilfebescheid | `Beihilfebescheid` | Antrag (siehe 2.1) |
| PKV-Leistungsabrechnung | `PKV-Abrechnung` | Antrag |
| Rezept / Verordnung | `Rezept` | Rechnung |
| Mahnung | `Mahnung` | Rechnung |
| Sonstiges | `Sonstiges` | frei |

Beim Hereinlegen schlägt die App den Typ vor (Dateiname und PDF-Text enthalten
meist „Bescheid", „Leistungsabrechnung", „Rechnung"); bestätigen oder ändern
per Klick. **Aufwand: S**

### 1.3 Benennungsschema

Vorlage, frei konfigurierbar, Standard:

```
{datum}_{typ}_{person}_{erbringer}_{nummer}_{betrag}
```

Ergebnis:

```
2026-03-14_Rechnung_Andreas_Dr-Meier_RG-2026-0118_248-50EUR.pdf
2026-04-02_Beihilfebescheid_Andreas_Bezirksregierung_AZ-4711_173-95EUR.pdf
2026-04-09_PKV-Abrechnung_Andreas_Debeka_L-88213_74-55EUR.pdf
```

Regeln, die das robust machen:

- **ISO-Datum zuerst** → Ordner sortiert sich chronologisch von selbst.
- **ASCII-Slug**: Umlaute umgeschrieben (ä→ae), Leerzeichen→`-`, Sonderzeichen
  raus. Verhindert Ärger bei Sync zwischen Windows/macOS/Linux.
- **Komma→Bindestrich im Betrag** (`248-50EUR`), weil Punkt/Komma in
  Dateinamen je nach System stört.
- **Leere Felder fallen samt Trenner weg**, keine `__` -Lücken.
- **Längenbegrenzung** auf 120 Zeichen, Erbringer wird zuerst gekürzt.
- **Kollision**: existiert der Name schon, `_2`, `_3` anhängen — nie
  überschreiben.

**Aufwand: S**

### 1.4 Ordnerstruktur

Ebenfalls als Vorlage konfigurierbar, Standard:

```
/Krankenversicherung
  /2026
    /Andreas
      /01_Rechnungen
      /02_Beihilfebescheide
      /03_PKV-Abrechnungen
      /04_Sonstiges
    /Lisa
      ...
  /2025
    ...
```

Zusätzlich schreibt die App in jeden Jahresordner eine `_uebersicht.csv` mit
Datum, Person, Erbringer, Betrag, erstattet Beihilfe, erstattet PKV, Delta und
Dateiname. **Damit ist der Cloud-Ordner auch ohne die App verständlich** — das
ist der eigentliche Archivwert. **Aufwand: S**

### 1.5 Die drei technischen Varianten

#### Variante A — Ablage in den lokalen Sync-Ordner ✅ *empfohlen für den Start*

Der vorhandene Python-Server (`server.py`) bekommt einen Endpunkt, der die
fertig benannte Datei in einen konfigurierten lokalen Ordner schreibt, z. B.
`~/pCloud Drive/Krankenversicherung/2026/Andreas/01_Rechnungen/`. Den Upload
erledigt der pCloud-Drive- bzw. Google-Drive-Desktop-Client.

- **Kein OAuth, keine API-Schlüssel, kein CORS, keine Ablaufzeiten.**
- Funktioniert mit pCloud **und** Drive **und** jedem anderen Sync-Dienst —
  Anbieterwechsel ist eine Pfadänderung.
- Funktioniert in jedem Browser.
- **Kann in einen pCloud-Crypto-Ordner schreiben.** Das ist der einzige Weg zu
  echter Ende-zu-Ende-Verschlüsselung: Crypto-Ordner sind über die pCloud-API
  bewusst *nicht* erreichbar, über das lokal eingehängte Laufwerk aber schon.
  Für Gesundheitsdaten ein starkes Argument. (Vor dem Produktiveinsatz einmal
  testen.)
- Nachteil: PC muss laufen und der Desktop-Client installiert sein; kein
  Hochladen direkt vom Handy.

**Aufwand: S–M (ca. 4–6 h)**

#### Variante B — pCloud-API direkt ✅ *empfohlen als Ausbaustufe*

OAuth 2.0 gegen pCloud, Upload über `uploadfile`, Ordner über
`createfolderifnotexists`. Das Token liegt **im Backend** (Datei mit
0600-Rechten), nicht im localStorage.

- App-Registrierung bei pCloud ist schlank: App anlegen, `client_id` /
  `client_secret` erhalten. **Kein Prüfverfahren, keine Freigabe.**
- **Tokens laufen praktisch nicht ab** — pCloud vergibt standardmäßig keine
  Ablaufzeit (rclone speichert für pCloud `expiry: 0001-01-01`, also „nie").
  Einmal verbinden, dann läuft es. Das ist der größte Vorteil gegenüber Google.
- **EU-Rechenzentrum wählbar** (`eapi.pcloud.com`, Luxemburg) — für
  Gesundheitsdaten der angenehmere Rechtsrahmen.
- Stolperfalle: US- und EU-Konten haben **verschiedene API-Hosts**. Falscher
  Host → Login scheitert mit unklarer Meldung. Muss beim Verbinden automatisch
  erkannt werden.
- Offene Frage: ob die pCloud-API CORS-Header für den *direkten*
  Browser-Zugriff sendet, konnte ich hier nicht messen (die Domain ist in
  dieser Umgebung gesperrt). pCloud pflegt ein offizielles Browser-SDK mit
  Popup-Login und Browser-Upload, was stark dafür spricht. **Über das Backend
  ist die Frage ohnehin gegenstandslos** — ein weiterer Grund, den Upload
  serverseitig zu machen.

**Aufwand: M (ca. 8–12 h)**

#### Variante C — Google-Drive-API

- Scope **`drive.file`** verwenden: nicht-sensibel, die App sieht ausschließlich
  ihre eigenen Dateien. **Damit ist kein Google-Verifizierungsverfahren und
  kein Sicherheits-Audit nötig** — das ist der entscheidende Punkt, mit
  breiteren Drive-Scopes wäre es sonst ein monatelanger Prozess.
- Nachteil Einrichtung: Google-Cloud-Projekt anlegen, Drive-API aktivieren,
  OAuth-Client erstellen, Zustimmungsbildschirm konfigurieren. Deutlich mehr
  Klickarbeit als bei pCloud.
- Nachteil Token: Access-Token 1 Stunde, danach Refresh-Token nötig. Solange
  das Projekt im Status **„Testing"** steht, verfallen Refresh-Tokens nach
  **7 Tagen** — man müsste sich wöchentlich neu anmelden. Abhilfe: Status auf
  „In Produktion" setzen (bei nicht-sensiblen Scopes ohne Prüfung möglich).
  Muss man aber wissen, sonst nervt es dauerhaft.
- Kein Zero-Knowledge-Modus.

**Aufwand: M–L (ca. 10–14 h)**

### 1.6 Vergleich und Empfehlung

| Kriterium | pCloud | Google Drive |
|---|---|---|
| Einrichtungsaufwand | gering (App anlegen, fertig) | hoch (Cloud-Projekt, Consent Screen) |
| Freigabeverfahren | keins | keins bei `drive.file` |
| Token-Haltbarkeit | praktisch unbegrenzt | 1 h + Refresh; 7 Tage im Testing-Status |
| EU-Hosting | ja, wählbar | nein |
| Ende-zu-Ende-Verschlüsselung | ja (Crypto, nur über Variante A) | nein |
| API-Reife / Doku | brauchbar, dünner | sehr ausgereift |
| Ökosystem, Handy-Zugriff | gut | sehr gut |

**Empfehlung: pCloud** — und das deckt sich nicht nur mit deiner Präferenz,
sondern ist für diesen Anwendungsfall auch technisch die bessere Wahl:
einfachere Anmeldung, Tokens die nicht ablaufen, EU-Hosting und die Option auf
echte Verschlüsselung. Google Drive ist die stärkere Plattform, aber der
7-Tage-Refresh-Token im Testing-Status und die Projekt-Einrichtung sind für
eine private App unnötige Reibung.

**Konkreter Fahrplan:**

1. **Variante A zuerst** (Sync-Ordner). Sie liefert Benennung, Ordnerstruktur
   und Ablage vollständig, in einem Bruchteil der Zeit, ohne jede
   Fremdabhängigkeit — und ist der einzige Weg in einen Crypto-Ordner.
2. **Variante B danach**, falls Ablage ohne laufenden PC oder vom Handy
   gebraucht wird. Weil beide hinter derselben Schnittstelle liegen, ist das
   ein Austausch, kein Umbau:

```js
const ablage = {
  verbinden(),                              // Auth / Pfadprüfung
  ordnerSicherstellen(pfad),                // legt rekursiv an
  hochladen(pfad, dateiname, blob),         // → { id, url }
  status(),                                 // verbunden? freier Platz?
};
```

3. **Variante C** nur, wenn du später doch auf Drive willst — derselbe Adapter.

### 1.7 Was zusätzlich dazugehört

- **Sync-Status pro Datei** in der Oberfläche: lokal / hochgeladen / Fehler,
  mit Link zur Cloud-Datei. Ohne das weiß man nie, ob es geklappt hat.
- **Warteschlange**: schlägt der Upload fehl (Cloud offline, Token weg), bleibt
  die Datei lokal und wird beim nächsten Start erneut versucht.
- **Lokale Kopie behalten** (heutiges IndexedDB-Verhalten), Cloud ist Archiv,
  nicht alleiniger Speicher.
- **Umbenennen im Nachhinein**: ändert sich das Rechnungsdatum, kann die App
  die abgelegte Datei nachziehen.

---

## Teil 2 — Fachliche Verbesserungen

### 2.1 Anträge als eigenes Objekt ⭐ wichtigster Strukturpunkt

**Problem:** Die App unterstellt „eine Rechnung → eine Erstattung". In der
Realität bündelt man mehrere Rechnungen zu **einem** Beihilfeantrag und bekommt
**einen** Bescheid mit **einer** Summe. Aktuell muss man diese Summe von Hand
auf die Rechnungen aufteilen, sonst stimmt der Soll-Ist-Vergleich nicht.

**Vorschlag:** Objekt `Antrag` mit Empfänger (Beihilfe | PKV), Einreichdatum,
zugeordneten Rechnungen und Bescheid-Daten. Der Bescheidbetrag wird automatisch
positionsweise verteilt; der Beihilfebescheid als PDF hängt am Antrag, nicht an
einer willkürlich gewählten Rechnung. **Aufwand: M**

### 2.2 Kostendämpfungspauschale und Selbstbehalte ⭐ Korrektheitsproblem

**Problem:** Bei NRW, Rheinland-Pfalz, Saarland, Bremen und Hessen zieht die
Beihilfestelle eine jährliche Kostendämpfungspauschale (je nach
Besoldungsgruppe) vom ersten Bescheid des Jahres ab. Die App kennt das nicht
und meldet dann **fälschlich „Erstattung fehlt"** — genau die Fehlalarme, die
das Vertrauen in das Werkzeug zerstören.

**Vorschlag:**
- Pro Person und Jahr: Kostendämpfungspauschale (Betrag frei eintragbar,
  Vorschlag je Land/Besoldungsgruppe).
- Pro Person und Jahr: PKV-Selbstbehalt (Jahresselbstbeteiligung).
- Beide werden als Jahres-Topf geführt und beim ersten Bescheid verrechnet;
  die Erwartungsrechnung zieht sie ab und weist sie separat aus
  („davon Kostendämpfungspauschale 2026: 150,00 €, Rest 0,00 €").

**Aufwand: M**

### 2.3 Bagatellgrenze und Antragsfrist

- **Mindestgrenze:** Beihilfe wird vielerorts erst ab 200 € Aufwendungen
  gewährt. Die App sollte anzeigen: „Andreas: 143,20 € gesammelt — noch
  56,80 € bis zur Einreichgrenze" statt jede Einzelrechnung als „offen" zu
  mahnen.
- **Antragsfrist:** Beim Bund muss der Antrag innerhalb **eines Jahres** ab
  Rechnungsdatum gestellt werden (§ 54 BBhV); die Länder weichen ab. Eine
  verpasste Frist bedeutet Totalverlust — hier gehört eine deutliche Warnung
  hin („3 Rechnungen verfallen in 6 Wochen").
- **Widerspruchsfrist:** ein Monat ab Bescheid. Wenn ein Delta offen ist, läuft
  eine Uhr — die sollte sichtbar sein.

Alle Fristen und Grenzen als **einstellbare Werte** mit Landesvorschlag, nicht
fest verdrahtet. **Aufwand: S–M**

### 2.4 Erfassung beschleunigen

Das Abtippen der Positionen ist der größte Zeitfresser.

- **PDF-Text auslesen** (pdf.js, läuft rein im Browser): bei digitalen
  Rechnungen GOÄ-Ziffern, Beträge und Rechnungsnummer erkennen und als
  Positionen vorschlagen — mit Prüfsumme gegen den Rechnungsendbetrag.
  **Aufwand: M**
- **Einfügen aus der Zwischenablage**: mehrere Zeilen auf einmal in die
  Positionstabelle einfügen. **Aufwand: S**
- **Vorlagen** für wiederkehrende Erbringer/Leistungen (Physio 10× dieselbe
  Ziffer). **Aufwand: S**
- **Duplikatwarnung** bei gleicher Rechnungsnummer oder gleichem
  Betrag+Datum+Erbringer. **Aufwand: S**
- **OCR für Fotos** (tesseract.js) — technisch möglich, aber großes
  WASM-Paket und mäßige Trefferquote bei Arztrechnungen. Würde ich
  zurückstellen. **Aufwand: L**

### 2.5 „Lohnt sich das Einreichen?" (Beitragsrückerstattung)

Viele PKV-Tarife zahlen bei Leistungsfreiheit mehrere Monatsbeiträge zurück.
Bei kleinen Rechnungen ist Selbstzahlen oft günstiger.

**Vorschlag:** Pro Vertrag die mögliche Rückerstattung hinterlegen; die App
rechnet pro Jahr und Person: erwartete PKV-Erstattung gegen entgangene
Rückerstattung, und empfiehlt „einreichen" oder „selbst zahlen" — inklusive
Hinweis, dass die Beihilfe davon unberührt bleibt und immer eingereicht werden
sollte. **Aufwand: M**

### 2.6 Kürzungsgründe erfassen

Bei jeder gekürzten Position ein Grund aus einer Liste (Steigerungssatz nicht
anerkannt, nicht beihilfefähig, Höchstbetrag, Selbstbehalt, Bagatellgrenze,
unbekannt). Daraus entsteht automatisch eine Liste „Widerspruch prüfen" — und
über die Jahre erkennt man Muster. **Aufwand: S–M**

### 2.7 Auswertung und Nachweis

- **Jahresübersicht pro Person**: eingereicht, erstattet, Eigenanteil,
  Erstattungsquote.
- **Steuer-Export**: selbst getragene Krankheitskosten als CSV für die
  außergewöhnlichen Belastungen.
- **Volltextsuche** über Erbringer, Nummer, Notizen, Positionen.
- **Offene-Posten-Liste** zum Ausdrucken für die Nachfrage bei der Beihilfe.

**Aufwand: M**

### 2.8 Sicherheit und Datenschutz

Es geht um Gesundheitsdaten der ganzen Familie:

- **Warnung vor unverschlüsselter Cloud-Ablage**, mit dem Crypto-Weg aus 1.5 A
  als empfohlener Option.
- **Verschlüsselter Export**: JSON-Backup optional mit Passwort (AES-GCM über
  die Web-Crypto-API, kein Fremdcode nötig). **Aufwand: S**
- **Backup-Erinnerung**, wenn seit X Wochen kein Export erfolgt ist.
- **Automatische Sicherung** in denselben Cloud-Ordner, sobald 1.5 steht — dann
  ist auch die Datenbank selbst gesichert, nicht nur die Belege. **Aufwand: S**

### 2.9 Bedienung

- **Tastaturerfassung**: Tab durch die Positionszeile, Enter am Ende erzeugt
  die nächste Zeile. Beim Abtippen einer 12-Positionen-Rechnung entscheidend.
- **Rechnungsansicht ohne Reload**: aktuell rendert jede Eingabe die ganze
  Seite neu (`route()` bei jedem `change`). Bei vielen Positionen wird das
  träge und der Fokus springt. Punktuelles Aktualisieren wäre sauberer.
  **Aufwand: M**
- **Mehrfachauswahl** für Sammelaktionen („diese 5 als eingereicht markieren").
- **PWA/Handy**: installierbar, Rechnung direkt abfotografieren. **Aufwand: L**

---

## Vorgeschlagene Reihenfolge

| # | Thema | Abschnitt | Aufwand |
|---|---|---|---|
| 1 | Dokumenttypen + Benennung + Ablage (Variante A) | 1.2–1.5 | S–M |
| 2 | Kostendämpfungspauschale & Selbstbehalte | 2.2 | M |
| 3 | Anträge als eigenes Objekt | 2.1 | M |
| 4 | Fristen, Bagatellgrenze, Warnungen | 2.3 | S–M |
| 5 | Erfassungshilfen (Paste, Vorlagen, Duplikate) | 2.4 | S |
| 6 | Verschlüsseltes Backup + Auto-Sicherung | 2.8 | S |
| 7 | pCloud-API als Ausbaustufe (Variante B) | 1.5 B | M |
| 8 | PDF-Textauswertung | 2.4 | M |
| 9 | Auswertung & Steuer-Export | 2.7 | M |

Punkt 1 und 2 zusammen bringen den größten Sprung: die Belege sind sauber
archiviert, und die Erstattungsprüfung meldet keine Fehlalarme mehr.

---

*Alle genannten Beihilfe-Regeln (Sätze, Pauschalen, Fristen, Bagatellgrenzen)
sind als einstellbare Vorschlagswerte gedacht. Maßgeblich sind Bescheid und
die jeweils geltende Beihilfeverordnung.*
