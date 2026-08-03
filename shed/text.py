"""Deutsche Schreibweise fuer alle Ausgaben an einer Stelle.

Die Fachtexte in den Modulen sind bewusst in reinem ASCII geschrieben - hier
werden sie einmal zentral in korrektes Deutsch mit Umlauten und Eszett
uebersetzt. So sehen PDF, Zeichnungen und Weboberflaeche dieselben Texte.

Die Ersetzung arbeitet nur ueber diese Liste bekannter Wortstaemme, nicht
ueber Muster - Regeln wie "ss wird zu ss" wuerden sonst aus "Fassade" ein
falsches Wort machen.
"""

from __future__ import annotations

# Reihenfolge zaehlt: laengere Staemme muessen vor ihren Teilstuecken stehen.
REPLACEMENTS: tuple[tuple[str, str], ...] = (
    # Bauordnung und Verwaltung
    ("Bauaufsichtsbehoerde", "Bauaufsichtsbehörde"),
    ("Behoerde", "Behörde"), ("behoerde", "behörde"),
    ("Aufenthaltsraeume", "Aufenthaltsräume"),
    ("Aufenthaltsraum", "Aufenthaltsraum"),
    ("Feuerstaetten", "Feuerstätten"), ("Feuerstaette", "Feuerstätte"),
    ("Abstandsflaechen", "Abstandsflächen"), ("Abstandsflaeche", "Abstandsfläche"),
    ("Grundstuecksgrenze", "Grundstücksgrenze"),
    ("Grundstuecksflaeche", "Grundstücksfläche"),
    ("Nachbargrundstueck", "Nachbargrundstück"),
    ("Grundstueck", "Grundstück"), ("grundstueck", "grundstück"),
    ("Grenzueberbauung", "Grenzüberbauung"),
    ("Verfahrensfreiheit", "Verfahrensfreiheit"),
    ("zulaessig", "zulässig"), ("Zulaessig", "Zulässig"),
    ("unzulaessig", "unzulässig"),
    ("Zustaendig", "Zuständig"), ("zustaendig", "zuständig"),
    ("Grenzstaendig", "Grenzständig"), ("grenzstaendig", "grenzständig"),
    ("Staendig", "Ständig"), ("staendig", "ständig"),
    ("massgeblich", "maßgeblich"), ("Massgeblich", "Maßgeblich"),
    ("Massgeb", "Maßgeb"), ("massgeb", "maßgeb"),
    ("Gestaltungssatzung", "Gestaltungssatzung"),
    ("Erlaeuterung", "Erläuterung"), ("erlaeuter", "erläuter"),
    ("Haftungsausschluss", "Haftungsausschluss"),

    # Gebaeude und Bauteile
    ("Gebaeude", "Gebäude"), ("gebaeude", "gebäude"),
    ("Haeuschen", "Häuschen"), ("haeuschen", "häuschen"),
    ("Waende", "Wände"), ("waende", "wände"),
    ("Wandhoehe", "Wandhöhe"), ("wandhoehe", "wandhöhe"),
    ("Traufhoehe", "Traufhöhe"), ("Firsthoehe", "Firsthöhe"),
    ("Gebaeudehoehe", "Gebäudehöhe"),
    ("Hoehenlage", "Höhenlage"), ("Hoehe", "Höhe"), ("hoehe", "höhe"),
    ("Laengstraeger", "Längsträger"), ("Laengs", "Längs"),
    ("Laenge", "Länge"), ("laenge", "länge"), ("Laeng", "Läng"), ("laeng", "läng"),
    ("Traeger", "Träger"), ("traeger", "träger"),
    ("Staender", "Ständer"), ("staender", "ständer"),
    ("Raehm", "Rähm"), ("raehm", "rähm"),
    ("Tuerrahmen", "Türrahmen"), ("Tuerblatt", "Türblatt"),
    ("Tueren", "Türen"), ("Tuer", "Tür"), ("tuer", "tür"),
    ("Fluegel", "Flügel"), ("fluegel", "flügel"),
    ("Baender", "Bänder"), ("Aufschraubband", "Aufschraubband"),
    ("Oeffnung", "Öffnung"), ("oeffnung", "öffnung"),
    ("Hoelzer", "Hölzer"), ("hoelzer", "hölzer"),
    ("Hoelz", "Hölz"), ("hoelz", "hölz"),
    ("Querhoelzer", "Querhölzer"),
    ("Fussriegel", "Fußriegel"), ("Fusspunkt", "Fußpunkt"),
    ("Fussboden", "Fußboden"), ("Fuss", "Fuß"), ("fuss", "fuß"),
    ("Stoesse", "Stöße"), ("stoesse", "stöße"),
    ("Stoss", "Stoß"), ("stoss", "stoß"),
    ("Gestossen", "Gestoßen"), ("gestossen", "gestoßen"),
    ("Schraege", "Schräge"), ("schraege", "schräge"),
    ("schraeg", "schräg"), ("Schraeg", "Schräg"),
    ("Traeufel", "Träufel"),
    ("Lueftung", "Lüftung"), ("lueftung", "lüftung"),
    ("Lueft", "Lüft"), ("lueft", "lüft"),
    ("Hinterlueftung", "Hinterlüftung"),
    ("Gruendung", "Gründung"), ("gruendung", "gründung"),
    ("gegruendet", "gegründet"), ("Gruendach", "Gründach"),
    ("gruen", "grün"), ("Gruen", "Grün"),
    ("Anschluesse", "Anschlüsse"), ("Anschluss", "Anschluss"),
    ("Stuetzweite", "Stützweite"), ("Stuetz", "Stütz"), ("stuetz", "stütz"),
    ("Duebel", "Dübel"), ("duebel", "dübel"),
    ("Kuebel", "Kübel"), ("Moertel", "Mörtel"),
    ("Fuehrungs", "Führungs"), ("fuehr", "führ"), ("Fuehr", "Führ"),
    ("Gehoerschutz", "Gehörschutz"),
    ("Loecher", "Löcher"), ("loecher", "löcher"),
    ("Erdbohrer", "Erdbohrer"),
    ("Saege", "Säge"), ("saege", "säge"),
    ("Blechschere", "Blechschere"),
    ("Fassadenbahn", "Fassadenbahn"),

    # Masse und Zahlen
    ("Massstab", "Maßstab"), ("massstab", "maßstab"),
    ("Masskette", "Maßkette"), ("Massketten", "Maßketten"),
    ("Aussenkante", "Außenkante"), ("aussenkante", "außenkante"),
    ("Aussenmass", "Außenmaß"), ("Aussenflaechen", "Außenflächen"),
    ("Aussenbereich", "Außenbereich"), ("aussenbereich", "außenbereich"),
    ("Aussen", "Außen"), ("aussen", "außen"),
    ("Innenbereich", "Innenbereich"),
    ("Teilmasse", "Teilmaße"), ("Gesamtmasse", "Gesamtmaße"),
    ("Achsmasse", "Achsmaße"), ("Oeffnungsmasse", "Öffnungsmaße"),
    ("Zuschnittmasse", "Zuschnittmaße"), ("Hauptmasse", "Hauptmaße"),
    ("Konstruktionsmasse", "Konstruktionsmaße"),
    ("Plattenmass", "Plattenmaß"),
    ("Bandmass", "Bandmaß"),
    ("Massen", "Maßen"), ("Masse ", "Maße "), ("Masse.", "Maße."),
    ("Masse,", "Maße,"), ("masse ", "maße "),
    ("groesser", "größer"), ("Groesser", "Größer"),
    ("groesste", "größte"), ("Groesste", "Größte"),
    ("Groesse", "Größe"), ("groesse", "größe"),
    ("vergroessern", "vergrößern"), ("Vergroesserung", "Vergrößerung"),
    ("Flaeche", "Fläche"), ("flaeche", "fläche"),
    ("ungefaehr", "ungefähr"),

    # Verben und Allgemeines
    ("ueberlappung", "überlappung"), ("Ueberlappung", "Überlappung"),
    ("Ueberstand", "Überstand"), ("ueberstand", "überstand"),
    ("Ueberwurfriegel", "Überwurfriegel"),
    ("ueber", "über"), ("Ueber", "Über"),
    ("fuer", "für"), ("Fuer", "Für"),
    ("muessen", "müssen"), ("muss", "muss"),
    ("koennen", "können"), ("Koennen", "Können"), ("koennte", "könnte"),
    ("moeglich", "möglich"), ("Moeglich", "Möglich"),
    ("moechte", "möchte"),
    ("naechst", "nächst"), ("Naechst", "Nächst"),
    ("naeher", "näher"), ("naehere", "nähere"), ("Naehe", "Nähe"),
    ("spaeter", "später"), ("Spaeter", "Später"),
    ("haelt", "hält"), ("haengt", "hängt"), ("haeng", "häng"),
    ("Aerger", "Ärger"), ("aergerlich", "ärgerlich"),
    ("waehlen", "wählen"), ("gewaehlt", "gewählt"), ("Waehl", "Wähl"),
    ("waehrend", "während"),
    ("zurueck", "zurück"), ("Rueck", "Rück"), ("rueck", "rück"),
    ("Stueck", "Stück"), ("stueck", "stück"),
    ("Pruefung", "Prüfung"), ("pruefen", "prüfen"), ("Pruef", "Prüf"),
    ("pruef", "prüf"),
    ("beruecksicht", "berücksicht"), ("Beruecksicht", "Berücksicht"),
    ("Aushaerten", "Aushärten"), ("aushaerten", "aushärten"),
    ("haerten", "härten"), ("gehaertet", "gehärtet"),
    ("verstaerk", "verstärk"), ("Verstaerk", "Verstärk"),
    ("regelmaessig", "regelmäßig"), ("Regelmaessig", "Regelmäßig"),
    ("Gefaelle", "Gefälle"), ("gefaelle", "gefälle"),
    ("buendig", "bündig"), ("Buendig", "Bündig"),
    ("Daemm", "Dämm"), ("daemm", "dämm"),
    ("Waermeschutz", "Wärmeschutz"),
    ("Fahrraeder", "Fahrräder"), ("fahrraeder", "fahrräder"),
    ("Geraete", "Geräte"), ("geraete", "geräte"),
    ("Geraeteraum", "Geräteraum"), ("Geraetetuer", "Gerätetür"),
    ("Baeume", "Bäume"), ("Baumschutz", "Baumschutz"),
    ("Kaeufe", "Käufe"),
    ("Verschluesse", "Verschlüsse"), ("Schluessel", "Schlüssel"),
    ("Anhaeng", "Anhäng"), ("Zufuehr", "Zuführ"),
    ("Kuerz", "Kürz"), ("kuerz", "kürz"),
    ("Aenderung", "Änderung"), ("aenderung", "änderung"),
    ("geaendert", "geändert"), ("aendern", "ändern"),
    ("Traufwand", "Traufwand"),
    ("Aussteif", "Aussteif"),
    ("Sued", "Süd"), ("sued", "süd"),
    ("Ortgangsparren", "Ortgangsparren"),
    ("Kondensat", "Kondensat"),
    ("Wasserwaage", "Wasserwaage"),
    ("Schnurgeruest", "Schnurgerüst"), ("Bockgeruest", "Bockgerüst"),
    ("Geruest", "Gerüst"),
    ("Toleranz", "Toleranz"),
    ("Stellplaetze", "Stellplätze"), ("Stellplaetzen", "Stellplätzen"),
    ("oertlich", "örtlich"), ("Oertlich", "Örtlich"),
    ("kN/m2", "kN/m²"), ("N/mm2", "N/mm²"), ("g/m2", "g/m²"),
    ("kg/m2", "kg/m²"), ("EUR/m2", "EUR/m²"),
    (" m2", " m²"), (" m3", " m³"), (" mm3", " mm³"), (" mm4", " mm⁴"),
    ("kesseldruckimpraegniert", "kesseldruckimprägniert"),
    ("Kesseldruckimpraegniert", "Kesseldruckimprägniert"),
    ("impraegniert", "imprägniert"), ("Impraegn", "Imprägn"),
    ("guenstig", "günstig"), ("Guenstig", "Günstig"),
    ("Kalottenschraube", "Kalottenschraube"),
    ("Unterspannbahn", "Unterspannbahn"),
    ("Naegel", "Nägel"), ("naegel", "nägel"),
    ("Schaerfe", "Schärfe"),
    ("Traufwasser", "Traufwasser"),
    ("Sickerschacht", "Sickerschacht"),
    ("Wandanschluss", "Wandanschluss"),
    ("Ankernaegel", "Ankernägel"),
    ("Zargenstaender", "Zargenständer"),
    ("Giebelstaender", "Giebelständer"),
    ("Fuellstaender", "Füllständer"), ("Fuell", "Füll"),
    ("Brueckenriegel", "Brückenriegel"), ("Bruest", "Brüst"),
    ("Querlueftung", "Querlüftung"),
    ("Waermebruecke", "Wärmebrücke"),
    ("Verbindungsmittel", "Verbindungsmittel"),

    # Nachtrag aus der automatischen Textpruefung
    ("Entwaesserung", "Entwässerung"), ("entwaesser", "entwässer"),
    ("Laerche", "Lärche"),
    ("noetig", "nötig"), ("Noetig", "Nötig"),
    ("hoechstens", "höchstens"), ("Hoechst", "Höchst"), ("hoechst", "höchst"),
    ("Gelaendeoberflaeche", "Geländeoberfläche"), ("Gelaende", "Gelände"),
    ("endgueltig", "endgültig"), ("Endgueltig", "Endgültig"),
    ("gleichmaessig", "gleichmäßig"), ("Gleichmaessig", "Gleichmäßig"),
    ("Jaehrlich", "Jährlich"), ("jaehrlich", "jährlich"),
    ("faellig", "fällig"), ("faellt", "fällt"),
    ("zaehlen", "zählen"), ("zaehlt", "zählt"),
    ("einfuegen", "einfügen"), ("einfuell", "einfüll"), ("Einfuell", "Einfüll"),
    ("Gewaehlt", "Gewählt"),
    ("Abschluesse", "Abschlüsse"),
    ("Zusaetzlich", "Zusätzlich"), ("zusaetzlich", "zusätzlich"),
    ("uebrig", "übrig"), ("Uebrig", "Übrig"),
    ("sorgfaeltig", "sorgfältig"),
    ("Laeufer", "Läufer"),
    ("Nachtraeglich", "Nachträglich"), ("nachtraeglich", "nachträglich"),
    ("gaengig", "gängig"),
    ("Plaetze", "Plätze"), ("plaetze", "plätze"),
    ("Regalboeden", "Regalböden"), ("Boeden", "Böden"),
    ("Gespraech", "Gespräch"),
    ("Faeulnis", "Fäulnis"),
    ("ergaenz", "ergänz"), ("Ergaenz", "Ergänz"),
    ("Aufschraubbaender", "Aufschraubbänder"),
    ("planmaessig", "planmäßig"), ("Planmaessig", "Planmäßig"),
    ("erfuellt", "erfüllt"), ("Erfuellt", "Erfüllt"), ("erfuell", "erfüll"),
    ("unguenstig", "ungünstig"), ("Unguenstig", "Ungünstig"),
    ("Traegerlage", "Trägerlage"), ("Balkenschuh", "Balkenschuh"),
    ("Querdruck", "Querdruck"), ("Auflagerkette", "Auflagerkette"),
    ("Staenderwerk", "Ständerwerk"), ("Traufe", "Traufe"),
    ("Schraegschraube", "Schrägschraube"), ("schraeg", "schräg"),
    ("massgebend", "maßgebend"), ("Massgebend", "Maßgebend"),
    ("tragfaehig", "tragfähig"), ("Tragfaehig", "Tragfähig"),
    ("Standsicherheitsnachweis", "Standsicherheitsnachweis"),
    ("Aufstandsflaeche", "Aufstandsfläche"),
    ("Lasteinzugs", "Lasteinzugs"),
    ("Eindrueckung", "Eindrückung"),
    ("heisst", "heißt"), ("Heisst", "Heißt"),
    ("anreissen", "anreißen"), ("Anreissen", "Anreißen"), ("reissen", "reißen"),
    ("abschliessbar", "abschließbar"), ("abschliessen", "abschließen"),
    ("schliesst", "schließt"), ("schliessen", "schließen"),
    ("Schliess", "Schließ"), ("schliess", "schließ"),
    ("auf Mass", "auf Maß"), ("Mass ", "Maß "), ("Mass.", "Maß."),
    ("Mass,", "Maß,"), ("Massarbeit", "Maßarbeit"),
)


def _with_upper(pairs):
    """Ergaenzt jede Ersetzung um ihre Grossbuchstaben-Variante.

    Zeichnungen beschriften Grenzlinien in Versalien - ohne diese Variante
    bliebe dort "GRUNDSTUECKSGRENZE" stehen.
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for a, b in pairs:
        for pair in ((a, b), (a.upper(), b.upper())):
            if pair[0] not in seen:
                seen.add(pair[0])
                out.append(pair)
    return tuple(out)


_ALL = _with_upper(REPLACEMENTS)


def nz(value: float, dec: int = 2) -> str:
    """Zahl in deutscher Schreibweise: Komma als Dezimal-, Punkt als Tausendertrenner."""
    s = f"{value:,.{dec}f}"
    return s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def de(text: str) -> str:
    """Wandelt einen ASCII-Fachtext in korrektes Deutsch."""
    if not text:
        return text
    out = str(text)
    for a, b in _ALL:
        if a in out:
            out = out.replace(a, b)
    return out


def de_deep(value):
    """Wendet :func:`de` rekursiv auf alle Zeichenketten einer Struktur an."""
    if isinstance(value, str):
        return de(value)
    if isinstance(value, dict):
        return {k: de_deep(v) for k, v in value.items()}
    if isinstance(value, list):
        return [de_deep(v) for v in value]
    if isinstance(value, tuple):
        return tuple(de_deep(v) for v in value)
    return value
