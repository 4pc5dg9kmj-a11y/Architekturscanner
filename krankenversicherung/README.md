# 🏥 Beihilfe- & PKV-Rechnungsprüfer

Web-App für Beamtenfamilien: Arztrechnungen erfassen und nachvollziehen, ob
**Beihilfe** und **private Krankenversicherung (PKV)** alles ausgezahlt haben,
was nach Beihilfesatz und Vertragsbausteinen zu erwarten wäre – inklusive
Delta-Anzeige, Markierung fehlender Auszahlungen und Beleg-Archiv.

## Start

Keine Installation nötig – die App läuft komplett im Browser:

```bash
cd krankenversicherung
python -m http.server 8080     # oder index.html direkt im Browser öffnen
```

Dann <http://localhost:8080> öffnen. Wer den Architekturscanner-Server nutzt
(`python server.py` im Hauptverzeichnis), erreicht die App unter
<http://localhost:8000/krankenversicherung/>.

Alle Daten bleiben **lokal in deinem Browser** (localStorage; Rechnungs-Anhänge
in IndexedDB). Nichts wird an einen Server geschickt. Für Backups und
Gerätewechsel gibt es unter „Einstellungen“ einen JSON-Export/-Import
(wahlweise inklusive Anhängen).

## Funktionen

- **Bis zu 10 Personen** (Familie) mit eigener Rolle (Beamter/in, Ehepartner,
  Kind, Versorgungsempfänger), individuellem **Beihilfesatz** und eigenem
  PKV-Vertrag.
- **Beihilfe-Einstellung nach Bundesland/Dienstherr** (Bund + 16 Länder) mit
  Hinweisen zu Regelsätzen und Besonderheiten (z. B. Kostendämpfungspauschale,
  Baden-Württemberg-Neufälle). Der Satz je Person bleibt frei einstellbar –
  maßgeblich ist immer der Bescheid.
- **Verträge mit Bausteinen**: je Baustein Leistungsbereiche (ambulant,
  stationär, Zahn, Heilmittel, Sehhilfen, Heilpraktiker …), Erstattungssatz
  und optionale Jahres-Höchstgrenze. Bausteine sind **global im Vertrag und
  zusätzlich pro Person aktivierbar/deaktivierbar**. Eine Vorlage legt typische
  Restkosten-Bausteine an.
- **Rechnungen erfassen**: Positionen mit Datum, GOÄ-/GOZ-Ziffer, Beschreibung,
  Kategorie und Betrag; Original-Beleg (PDF/Foto) als Anhang hereinladen.
- **Soll-Ist-Vergleich**: erwartete Beihilfe (Betrag × Beihilfesatz) und
  erwartete PKV-Erstattung (Betrag × Baustein-Satz, gedeckelt auf 100 % und
  auf Jahres-Höchstgrenzen) gegen die tatsächlich erfassten Auszahlungen.
  Deltas werden je Quelle und – bei Bedarf – **je Position** ausgewiesen.
- **Warnungen**: Deckungslücken (keine Baustein-Abdeckung einer Kategorie),
  erreichte Jahres-Höchstgrenzen, Überzahlungen, nicht eingereichte Rechnungen.
- **Status selbst pflegen**: „an Arzt bezahlt“, „bei Beihilfe eingereicht“,
  „bei PKV eingereicht“ – jeweils mit Datum. Einzelne Positionen lassen sich
  **markieren** (🔖) und mit Notizen versehen; markierte Positionen erscheinen
  gesammelt auf der Übersicht.
- **Übersicht**: fehlende Beihilfe-/PKV-Beträge gesamt, offene Zahlungen an
  Ärzte, Rechnungen mit Handlungsbedarf, Zusammenfassung pro Person.

## Empfohlener Ablauf

1. **Einstellungen** → Bundesland wählen.
2. **Verträge** → PKV-Vertrag anlegen, Bausteine mit Sätzen erfassen
   (üblich: 100 % minus Beihilfesatz, z. B. „Ambulant 50 %“).
3. **Personen** → Familienmitglieder mit Beihilfesatz, Vertrag und aktiven
   Bausteinen anlegen.
4. **Rechnungen** → Rechnung erfassen (Positionen abtippen, Beleg anhängen),
   „an Arzt bezahlt“ und „eingereicht“ pflegen.
5. Nach Bescheid/Leistungsabrechnung die **Erstattungen** eintragen – der
   Soll-Ist-Vergleich zeigt sofort, ob und wo etwas fehlt.

## Wichtiger Hinweis

Die Erwartungswerte sind eine **Plausibilitätsrechnung** (Satz × Betrag).
Beihilfestellen und Versicherer können nach Gebührenordnung (GOÄ/GOZ),
beihilfefähigen Höchstbeträgen oder Eigenbehalten abweichend kürzen. Die App
ersetzt keine Rechts- oder Tarifberatung; maßgeblich sind Bescheid,
Leistungsabrechnung und Vertragsunterlagen.
