"""Bauanleitung - aus dem konkreten Modell erzeugt, nicht generisch.

Alle Masse, Stueckzahlen und Hinweise stammen aus der aktuellen
Konfiguration, damit die Anleitung zu den Zeichnungen passt.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .bom import fasteners, materials, timber_list
from .model import Building
from .text import nz
from .spec import (DACHLATTE, DACH_UEBERSTAND_TRAUFE, KONTERLATTE, RASTER,
                   RHOMBUS, SCHWELLE, WAND_STIEL)


@dataclass
class Step:
    no: int
    title: str
    duration: str
    people: int
    body: list[str] = field(default_factory=list)
    checks: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"no": self.no, "title": self.title, "duration": self.duration,
                "people": self.people, "body": self.body, "checks": self.checks,
                "tools": self.tools}


def _n(members, name_part: str) -> int:
    return len([m for m in members if name_part in m.name])


def build_steps(b: Building) -> list[Step]:
    d, spec = b.dims, b.spec
    L, D = d["length_out"], d["depth_out"]
    fl, fd = d["frame_l"], d["frame_d"]
    sparren = [m for m in b.members if m.name in ("Sparren", "Aussensparren")]
    n_slabs = len([p for p in b.panels if p.group == "fundament"])
    doors = [o for o in b.openings if o.kind == "door"]
    steps: list[Step] = []

    steps.append(Step(
        1, "Standort abstecken und Grenze pruefen", "2 Stunden", 2,
        [
            f"Gebaeude aussen {nz(L / 1000, 2)} m lang und {nz(D / 1000, 2)} m tief - "
            f"die {nz(L / 1000, 2)}-m-Seite kommt an die Grundstuecksgrenze.",
            "Grenzverlauf anhand der amtlichen Grenzsteine pruefen. Sind keine "
            "Grenzsteine auffindbar, vor Baubeginn beim Katasteramt eine "
            "Grenzanzeige beauftragen - eine spaeter festgestellte "
            "Grenzueberbauung ist teuer.",
            "Rechteck mit Schnurgeruest abstecken. Diagonalen messen: beide "
            f"muessen gleich lang sein ({nz(math.hypot(L, D) / 1000, 3)} m).",
            "Die Aussenkante der Rueckwand exakt auf die Grenze legen - "
            "kein Bauteil, auch keine Fassadenleiste, darf darueber hinausragen. "
            "2-3 cm Sicherheitsabstand einplanen.",
            "Leitungen pruefen: Strom, Wasser, Abwasser, Telekom. Bei "
            "Unsicherheit Leitungsauskunft beim Versorger einholen.",
        ],
        ["Diagonalen gleich lang (Abweichung < 10 mm)",
         "Abstand Rueckwand zur Grenze gemessen und dokumentiert (Foto)",
         "Nachbarn informiert"],
        ["Schnurgeruest", "Bandmass 10 m", "Schlagschnur", "Spaten"]))

    if spec.foundation == "slabs":
        steps.append(Step(
            2, "Gruendung: Gehwegplatten auf Splittbett", "1 Tag", 2,
            [
                f"{n_slabs} Auflagerpunkte nach dem Gruendungsplan abstecken - "
                "drei Reihen (Grenze, Mitte, Traufe) mit je einem Punkt unter "
                "jeder Balkenachse.",
                "Je Punkt ca. 40 x 40 cm und 20 cm tief ausheben. Unkrautvlies "
                "einlegen, 15 cm Schotter 0/32 einfuellen und mit dem Handstampfer "
                "verdichten.",
                "5 cm Splitt 2/5 abziehen, Gehwegplatte 40 x 40 x 5 cm einlegen und "
                "mit dem Gummihammer einklopfen.",
                "Alle Platten mit Wasserwaage auf einem Richtscheit in EINE Ebene "
                f"bringen. Toleranz ueber die gesamte Laenge von {nz(L / 1000, 2)} m "
                "hoechstens 5 mm - jeder Fehler hier setzt sich bis ins Dach fort.",
                "Oberkante Platte mindestens 10 cm ueber dem umgebenden Gelaende "
                "halten, damit das Holz nicht im Spritzwasser steht.",
                "Hinweis: Plattenlager ist nicht frostsicher gegruendet. Bei "
                "bindigem, staunassem Boden kann sich das Haeuschen ueber die "
                "Jahre leicht setzen. Der Schwellenrost ist dafuer steif genug; "
                "einzelne Platten lassen sich spaeter nachjustieren.",
            ],
            ["Alle Platten in einer Ebene (Richtscheit + Wasserwaage)",
             "Plattenraster stimmt mit dem Gruendungsplan ueberein",
             "Oberkante >= 10 cm ueber Gelaende"],
            ["Richtscheit 2 m", "Wasserwaage", "Handstampfer", "Gummihammer", "Schubkarre"]))
    elif spec.foundation == "point":
        steps.append(Step(
            2, "Gruendung: Punktfundamente", "1,5 Tage (+ 2 Tage Aushaerten)", 2,
            [f"{n_slabs} Loecher 30 x 30 cm, 80 cm tief (frostfrei) ausheben.",
             "Schalrohr einsetzen, Beton einfuellen und verdichten.",
             "H-Pfostentraeger lot- und fluchtrecht einbetonieren, Oberkante "
             "aller Traeger auf einer Ebene.",
             "Mindestens 48 Stunden aushaerten lassen, bevor belastet wird."],
            ["Alle Pfostentraeger in einer Ebene", "Beton durchgehaertet"],
            ["Erdbohrer", "Betonmischer oder Moertelkuebel", "Wasserwaage"]))
    elif spec.foundation == "screw":
        steps.append(Step(
            2, "Gruendung: Schraubfundamente", "4 Stunden", 2,
            [f"{n_slabs} Erdschrauben nach Gruendungsplan senkrecht eindrehen.",
             "Mit Wasserwaage staendig auf Lot kontrollieren.",
             "Kopfplatten auf eine gemeinsame Hoehe ausrichten."],
            ["Alle Schrauben lotrecht", "Kopfplatten auf einer Ebene"],
            ["Eindrehwerkzeug/Rohrhebel", "Wasserwaage"]))
    else:
        steps.append(Step(
            2, "Bestandsflaeche vorbereiten", "2 Stunden", 1,
            ["Betonflaeche auf Gefaelle und Risse pruefen.",
             "Bitumen-Trennlage unter jedes Schwellenholz legen.",
             "Bohrloecher fuer die Bolzenanker anzeichnen (Raster max. 80 cm)."],
            ["Trennlage vollflaechig unter dem Holz"],
            ["Bohrhammer", "Wasserwaage"]))

    jb, jh = d["joist"]
    steps.append(Step(
        3, "Schwellen und Balkenlage aufbauen", "4 Stunden", 2,
        [
            f"Drei Schwellen {SCHWELLE[1]:.0f} x {SCHWELLE[0]:.0f} mm "
            f"kesseldruckimpraegniert auf {fl:.0f} mm zuschneiden - eine an der "
            "Grenze, eine in der Mitte, eine an der Traufe. Sie werden LIEGEND "
            "eingebaut, die breite Seite auf den Platten.",
            "Unter jede Schwelle einen Streifen Bitumenbahn legen. Das ist der "
            "wirksamste Schutz gegen aufsteigende Feuchte.",
            f"Deckenbalken {jb:.0f} x {jh:.0f} mm auf {fd:.0f} mm zuschneiden, "
            f"{_n(b.members, 'Deckenbalken')} Stueck. Sie werden hochkant QUER "
            "ueber die drei Schwellen gelegt - nicht dazwischen eingehaengt.",
            f"Achsabstand {d['e_axis']:.0f} mm. Unter jeder Balkenachse steht "
            "eine Fundamentplatte: so hat jeder Balken sein Auflager senkrecht "
            "unter sich. Genau dieses Raster wiederholt sich spaeter bei den "
            "Staendern und den Sparren.",
            "Jeden Balken mit zwei Schraegschrauben 6 x 140 mm in die Schwelle "
            "ziehen. Die Schrauben halten den Balken an Ort und Stelle - "
            "getragen wird er von der Auflagerflaeche, nicht von der Schraube.",
            "Randbalken an Grenz- und Traufseite auflegen und stirnseitig mit "
            "den Deckenbalken verschrauben.",
            "Rechtwinkligkeit ueber die Diagonalen kontrollieren und den Rost "
            "erst dann endgueltig fixieren.",
        ],
        [f"Diagonalen gleich ({math.hypot(fl, fd) / 1000:.3f} m)",
         "Rost waagerecht in beide Richtungen",
         "Jeder Deckenbalken liegt satt auf allen drei Schwellen auf",
         "Trennlage unter allen Schwellen"],
        ["Handkreissaege", "Akkuschrauber", "Holzbohrer 5 mm", "Winkel",
         "Richtscheit 2 m"]))

    if spec.with_floor:
        steps.append(Step(
            4, "Bodenplatten verlegen", "2 Stunden", 1,
            ["OSB/3 Verlegeplatten 22 mm mit Nut und Feder verlegen, Stoesse "
             "immer auf einem Querholz.",
             "Nut und Feder mit wasserfestem Holzleim (D3) verleimen.",
             "Alle 20 cm mit 4,5 x 60 mm Schrauben auf dem Rost befestigen.",
             "Rundum 5 mm Dehnfuge zur spaeteren Wand lassen.",
             "Platten mit den Aussenkanten des Rostes buendig zuschneiden."],
            ["Platten buendig und plan", "Stoesse liegen auf Hoelzern"],
            ["Stichsaege", "Akkuschrauber", "Holzleim D3"]))

    n = len(steps) + 1
    steps.append(Step(
        n, "Waende liegend vormontieren", "1 Tag", 2,
        [
            "Jede Wand nach dem Ständerwerksplan flach auf dem Boden aufbauen - "
            "das ist deutlich schneller und genauer als Aufrichten in der Luft.",
            f"Ständerraster {d['e_axis']:.0f} mm - dasselbe Achsmass wie die "
            "Deckenbalken darunter. Jeder Ständer steht senkrecht ueber einem "
            "Balken, jeder Sparren spaeter senkrecht ueber einem Ständer. "
            "Diese Achsen anzeichnen, bevor irgendetwas geschnitten wird.",
            f"Querschnitt "
            f"{WAND_STIEL[0]:.0f} x {WAND_STIEL[1]:.0f} mm, die 120-mm-Seite liegt "
            "in der Wandebene (Wanddicke 60 mm).",
            f"Rueckwand (Grenze): Ständerlaenge {d['z_plate_top_rear'] - d['z_floor'] - 60 - WAND_STIEL[1]:.0f} mm. "
            f"Vorderwand: {d['z_plate_top_front'] - d['z_floor'] - 60 - WAND_STIEL[1]:.0f} mm.",
            "Ständer stumpf zwischen Fussriegel und Raehm setzen und von aussen "
            "mit 2 x 6,0 x 140 mm durchschrauben (vorbohren!). Zusaetzlich "
            "innen je einen Winkelverbinder setzen.",
            "Oeffnungen: beidseitig Zargenständer, darueber den Sturz aus zwei "
            "Hoelzern 60 x 120 mm. Die Sturzhoelzer flach aufeinander legen und "
            "miteinander verschrauben.",
            "Wandflaechen mit einer Diagonalen aus Latte 30 x 50 provisorisch "
            "aussteifen, bis die Fassade sitzt.",
        ],
        ["Jede Wand rechtwinklig (Diagonalen)",
         "Ständerachsen stimmen mit dem Plan ueberein",
         "Oeffnungsmasse kontrolliert"],
        ["Handkreissaege mit Fuehrungsschiene", "Akkuschrauber", "Zwingen", "Anschlagwinkel"]))

    n += 1
    steps.append(Step(
        n, "Waende aufrichten und ausrichten", "4 Stunden", 2,
        [
            "Reihenfolge: Rueckwand (Grenze) zuerst, dann die beiden Seitenwaende, "
            "zuletzt die Vorderwand. Die Rueckwand von innen aufstellen - an der "
            "Grenze ist spaeter kein Arbeitsraum mehr.",
            "Jede Wand sofort mit einer Schraege abstuetzen, erst dann loslassen.",
            "Wand auf dem Boden ausrichten, mit 6 x 140 mm durch den Fussriegel "
            "in den Rost schrauben (Abstand max. 60 cm) und zusaetzlich "
            "Winkelverbinder setzen.",
            "Eckverbindungen: die Seitenwaende stossen innen an Rueck- und "
            "Vorderwand, mit 6 x 140 mm im Abstand von 40 cm verschrauben.",
            f"Lotrecht ausrichten - Kontrolle an jeder Ecke. Erst wenn alle vier "
            "Waende lotrecht und rechtwinklig stehen, endgueltig festziehen.",
            "Die Giebelständer der Seitenwaende oben schraeg auf die Dachneigung "
            f"von {spec.roof_pitch:.0f} Grad saegen.",
        ],
        ["Alle Ecken lotrecht", "Raehm-Oberkanten auf gleicher Hoehe",
         "Grundriss rechtwinklig"],
        ["Wasserwaage 2 m", "Stuetzstreben", "Akkuschrauber"]))

    n += 1
    steps.append(Step(
        n, "Sparrenlage und Dachtragwerk", "5 Stunden", 2,
        [
            f"{len(sparren)} Sparren {d['sparren'][0]:.0f} x {d['sparren'][1]:.0f} mm, "
            f"Laenge je {d['sparren_len']:.0f} mm, Achsabstand {d['e_axis']:.0f} mm "
            "- genau ueber den Ständern.",
            f"Kerven fuer die Auflager auf beiden Raehmen anreissen "
            f"(Neigung {spec.roof_pitch:.0f} Grad). Kerventiefe hoechstens "
            f"{d['sparren'][1] / 3:.0f} mm - ein Drittel der Sparrenhoehe.",
            "Ersten und letzten Sparren setzen, Schnur spannen, die uebrigen "
            "danach ausrichten.",
            "Jeden Sparren mit einem Sparren-Pfettenanker links und rechts am "
            "Raehm befestigen. Das ist die Sicherung gegen Windsog und "
            "keine Option - ein leeres Pultdach hebt bei Sturm ab.",
            "Am hinteren Ende (Grenze) enden die Sparren buendig mit der "
            "Wandaussenkante. Vorne stehen sie "
            f"{DACH_UEBERSTAND_TRAUFE:.0f} mm als Traufueberstand ueber.",
            f"Traufbohle und Ortgangbretter anbringen. Traglattung "
            f"{DACHLATTE[0]:.0f} x {DACHLATTE[1]:.0f} mm quer zum Gefaelle im "
            "Abstand von hoechstens 800 mm aufschrauben.",
        ],
        ["Sparrenoberkanten fluchten (Schnur)",
         "Alle Sparren beidseitig verankert",
         "Lattung rechtwinklig und in gleichem Abstand"],
        ["Handkreissaege", "Stechbeitel", "Schnur", "Winkelmesser", "Leitern"]))

    n += 1
    steps.append(Step(
        n, "Dachdeckung", "4 Stunden", 2,
        _roofing_body(b), _roofing_checks(b),
        ["Blechschere oder Nibbler", "Akkuschrauber mit Tiefenanschlag",
         "Handschuhe (Blechkanten!)", "Leiter"]))

    n += 1
    steps.append(Step(
        n, "Fassade: Bahn, Konterlattung, Rhombus", "1,5 Tage", 2,
        [
            "Diffusionsoffene Fassadenbahn waagerecht von unten nach oben "
            "anbringen, Ueberlappung 10 cm, Stoesse verkleben.",
            f"Konterlattung {KONTERLATTE[0]:.0f} x {KONTERLATTE[1]:.0f} mm senkrecht "
            "auf jeden Ständer schrauben - sie erzeugt die 30 mm Hinterlueftung, "
            "ohne die jede Holzfassade nach wenigen Jahren fault.",
            "Unten und oben je einen Lueftungsspalt von mindestens 20 mm frei "
            "lassen, unten ein Insektengitter einlegen.",
            f"Rhombusleisten {RHOMBUS[0]:.0f} x {RHOMBUS[1]:.0f} mm waagerecht von "
            "unten nach oben montieren, Fuge 12 mm (Fugenlehre benutzen).",
            "Je Kreuzungspunkt zwei Edelstahlschrauben A2 4,0 x 40 mm - "
            "verzinkte Schrauben zeichnen auf Laerche und Douglasie schwarze "
            "Laeufer.",
            "Alle Leisten VOR der Montage rundum streichen, besonders die "
            "Hirnholzenden. Nachtraeglich kommt man an die Rueckseite nicht mehr.",
            "An der Grenzwand: Fassade buendig mit der Wandaussenkante enden "
            "lassen. Diese Wand zuerst verkleiden, solange noch Platz zum "
            "Arbeiten ist.",
        ],
        ["Hinterlueftung oben und unten offen",
         "Fugenbild gleichmaessig",
         "Kein Bauteil ueber der Grenze"],
        ["Kappsaege", "Fugenlehre 12 mm", "Akkuschrauber", "Schlagschnur"]))

    n += 1
    door_txt = [
        f"{len(doors)} Tuer(en) aus Rahmen 40 x 60 mm bauen, Fuellung aus der "
        "gleichen Rhombusschalung wie die Fassade - so verschwindet die Tuer "
        "optisch in der Wand.",
        "Diagonalstrebe IMMER vom unteren Bandpunkt zur oberen freien Ecke "
        "einbauen (Druckstrebe). Falsch herum haengt der Fluegel nach einem "
        "Jahr durch.",
        "Rahmen auf einer ebenen Flaeche verleimen und verschrauben, "
        "Diagonalen kontrollieren.",
        "Luftspalt rundum 5 mm, unten 10 mm.",
        "Drei Aufschraubbaender je Fluegel.",
    ]
    if any("2-fluegelig" in o.name for o in doors):
        door_txt.append("Beim zweifluegeligen Tor den Standfluegel oben und unten "
                        "mit Kantenriegeln feststellen, der Gehfluegel schliesst "
                        "dagegen.")
    door_txt.append("Ueberwurfriegel mit Vorhaengeschloss montieren; die "
                    "Schrauben von innen sichern oder Einwegschrauben verwenden.")
    steps.append(Step(n, "Tueren bauen und einhaengen", "1 Tag", 2, door_txt,
                      ["Fluegel schliessen ueberall gleichmaessig",
                       "Diagonalstrebe richtig herum (unten am Band)",
                       "Schloss und Riegel gaengig"],
                      ["Kappsaege", "Stemmeisen", "Bohrmaschine", "Zwingen"]))

    n += 1
    body = ["Zweiten Anstrich auf allen Aussenflaechen auftragen.",
            "Alle Schnittkanten mit Hirnholzschutz nachbehandeln."]
    if spec.with_gutter:
        body += ["Rinnenhalter mit 3 mm/m Gefaelle zum Fallrohr auf der "
                 "Traufbohle befestigen (Abstand max. 60 cm).",
                 "Dachrinne einhaengen, Endstuecke setzen, Fallrohr montieren.",
                 "Ablauf in eine Regentonne oder einen Sickerschacht auf dem "
                 "EIGENEN Grundstueck fuehren - Wasser darf nicht zum Nachbarn "
                 "laufen."]
    body += ["Lueftungsgitter in beide Seitenwaende einsetzen (Querlueftung).",
             f"Fahrradhalter montieren: {spec.n_bikes} Plaetze, versetzt hoch/tief, "
             "Achsabstand 525 mm.",
             "Optional Erdung/Blitzschutz ist bei diesem Gebaeude nicht "
             "erforderlich."]
    if spec.has_tool_room:
        body.append(f"Im Geraeteraum {spec.tool_shelves} Regalboeden und "
                    "Wandhalter fuer Spaten, Rechen und Schlauch montieren.")
    steps.append(Step(n, "Abschluss: Oberflaeche, Entwaesserung, Einbauten",
                      "1 Tag", 1, body,
                      ["Alle Hoelzer zweifach gestrichen",
                       "Rinnengefaelle geprueft (Wasser giessen)",
                       "Fotos der fertigen Anlage fuer die eigenen Unterlagen"],
                      ["Pinsel und Rolle", "Akkuschrauber", "Wasserwaage"]))
    return steps


def _roofing_body(b: Building) -> list[str]:
    d, spec = b.dims, b.spec
    n = math.ceil(d["roof_w"] / 1000.0)
    if spec.roofing == "trapez":
        return [
            f"{n} Trapezbleche T-18/76, Nutzbreite 1,00 m, Laenge "
            f"{d['roof_slope_len'] + 100:.0f} mm auf Mass bestellen - dann muss "
            "auf dem Dach nichts geschnitten werden.",
            "Verlegung gegen die Hauptwindrichtung beginnen, damit die "
            "Ueberlappung im Windschatten liegt.",
            "Seitliche Ueberlappung: eine volle Rippe. Am Traufende 40 mm in "
            "die Rinne ueberstehen lassen.",
            "Kalottenschrauben 4,8 x 35 mm mit EPDM-Dichtscheibe IM WELLENTAL "
            "setzen, ca. 6-7 Schrauben je Quadratmeter. Nur so fest anziehen, "
            "dass die Dichtscheibe leicht hervorquillt - zu fest gedreht "
            "verliert sie ihre Dichtwirkung.",
            "Am oberen Abschluss zur Grenzwand ein Wandanschlussprofil setzen "
            "und mit Dichtband unterlegen. Diese Kante ist die einzige, an die "
            "man spaeter schwer herankommt - hier sorgfaeltig arbeiten.",
            "Ortgangprofile links und rechts montieren.",
            f"Bei {spec.roof_pitch:.0f} Grad Neigung ist Trapezblech sicher dicht "
            "(Mindestneigung 8 Grad mit Dichtband, 12 Grad ohne).",
            "Antikondensat-Vlies auf der Blechunterseite verhindert Tropfwasser "
            "im Sommer - beim Blech gleich mitbestellen.",
        ]
    if spec.roofing == "shingle":
        return ["OSB/3 15 mm als durchgehende Schalung verlegen, 3 mm Fuge.",
                "Bitumen-Unterspannbahn V13 waagerecht aufnageln, 10 cm Ueberlappung.",
                "Schindeln von der Traufe aufwaerts verlegen, je Schindel 4 Naegel.",
                "Erste Reihe umgedreht als Traufstreifen verlegen.",
                "Achtung: unter 15 Grad Neigung sind Schindeln nicht regensicher."]
    if spec.roofing == "epdm":
        return ["OSB/3 15 mm Schalung verlegen, Kanten brechen.",
                "EPDM-Bahn faltenfrei ausrollen und 30 Minuten entspannen lassen.",
                "Nur die Raender vollflaechig kleben, die Flaeche bleibt lose.",
                "Randprofile setzen und die Bahn darin klemmen."]
    return ["OSB/3 22 mm Schalung verlegen.",
            "Wurzelfeste EPDM-Bahn verlegen und Raender verkleben.",
            "Drainageplatte, Substrat 8 cm und Sedummatte aufbringen.",
            "Umlaufend 10 cm Kiesrandstreifen als Brandschutz und Windsicherung.",
            "Achtung: Gruendach wiegt gesaettigt ueber 100 kg/m2 - die "
            "Sparrendimension in dieser Planung ist darauf ausgelegt."]


def _roofing_checks(b: Building) -> list[str]:
    if b.spec.roofing == "trapez":
        return ["Alle Schrauben im Wellental, Dichtscheiben nicht verquetscht",
                "Wandanschluss an der Grenze dicht",
                "Blech steht 40 mm in die Rinne"]
    return ["Dachhaut vollflaechig geschlossen", "Raender dicht"]


def prepare_notes(b: Building) -> list[str]:
    """Wichtige Hinweise vor Baubeginn."""
    d = b.dims
    return [
        "Verfahrensfrei heisst nicht anforderungsfrei: Bebauungsplan, "
        "oertliche Gestaltungssatzung und Baulasten vor Baubeginn pruefen. "
        "Die Auskunft beim Bauamt ist kostenlos.",
        "Das Haeuschen darf keinen Aufenthaltsraum, keine Toilette und keine "
        "Feuerstaette enthalten - sonst entfallen Verfahrensfreiheit und "
        "Grenzprivileg sofort.",
        f"Brutto-Rauminhalt dieser Planung: {nz(d['bri'], 2)} m3 von zulaessigen "
        "30,00 m3. Jede spaetere Vergroesserung, auch ein Anbau, zaehlt mit.",
        "Nachbarn vorab informieren. Rechtlich ist keine Zustimmung noetig, "
        "praktisch erspart das Gespraech viel Aerger - vor allem, weil zum "
        "Streichen und Reparieren der Grenzwand spaeter niemand ohne Absprache "
        "auf das Nachbargrundstueck darf.",
        "Die Grenzwand zuerst fertigstellen (Fassade, Anstrich): danach ist "
        "dort kein Arbeitsraum mehr.",
        "Holz erst kurz vor dem Verbauen kaufen und liegend, belueftet und "
        "abgedeckt lagern - nicht auf dem Boden.",
        "Wetterfenster planen: Rost, Waende und Dach sollten innerhalb weniger "
        "Tage stehen. Offene Ständerwerke nicht ueber Wochen dem Regen aussetzen.",
    ]


def tool_list(b: Building) -> list[str]:
    return [
        "Handkreissaege mit Fuehrungsschiene (oder Kappsaege)",
        "Akkuschrauber, zwei Akkus, Bit-Satz TX",
        "Bohrmaschine mit Holzbohrern 3-8 mm",
        "Stichsaege",
        "Wasserwaage 2 m und 60 cm",
        "Richtscheit 2 m",
        "Bandmass 8 m, Zollstock, Schlagschnur",
        "Anschlagwinkel und Schmiege (Winkelmesser fuer die Dachneigung)",
        "Schraubzwingen (mindestens 6 Stueck)",
        "Stechbeitel 25 mm und Holzhammer",
        "Blechschere oder Nibbler-Aufsatz",
        "Handstampfer",
        "Leiter, besser zwei; Bockgeruest fuer die Dacharbeiten",
        "Arbeitshandschuhe, Schutzbrille, Gehoerschutz",
    ]


def maintenance(b: Building) -> list[str]:
    return [
        "Jaehrlich im Herbst: Dachrinne und Fallrohr reinigen.",
        "Jaehrlich: Lueftungsspalte der Fassade auf Verstopfung pruefen.",
        "Alle 2 Jahre: Sichtpruefung der Fassade, Anstrich an bewitterten "
        "Seiten auffrischen (Sued und West zuerst).",
        "Alle 2 Jahre: Kalottenschrauben des Blechs nachziehen - "
        "Temperaturwechsel arbeiten sie langsam locker.",
        "Alle 5 Jahre: Schwellenrost und Fusspunkte auf Feuchte und Faeulnis "
        "pruefen, Bewuchs am Sockel entfernen.",
        "Nach jedem Sturm: Blechkanten und Ortgangprofile kontrollieren.",
    ]
