"""Parameter des Fahrradhaeuschens.

Alle Laengen in Millimetern, Winkel in Grad, Gewichte in kg.

Koordinatensystem (Millimeter):
    X  entlang der Gebaeudelaenge, 0 = linke Aussenkante
    Y  in die Tiefe, 0 = Rueckwand (Grundstuecksgrenze, hohe Seite)
    Z  nach oben, 0 = Oberkante Fundamentplatten (= Unterkante Schwellenrost)

Das Pultdach faellt von der Rueckwand (Grenze, First) zur Vorderseite
(Traufe mit Rinne). Damit laeuft kein Niederschlagswasser auf das
Nachbargrundstueck. An der Grenze endet das Dach buendig mit der
Fassadenaussenkante - kein Bauteil ragt ueber die Grenze.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict, field

# ---------------------------------------------------------------------------
# Feste Konstruktionsmasse (aendern sich nicht ueber die Slider)
# ---------------------------------------------------------------------------

RASTER = 625.0          # Ständer-/Sparrenraster in mm (Plattenmass 1250/2500)
WAND_STIEL = (60.0, 120.0)      # Ständerwerk b x h
SCHWELLE = (60.0, 120.0)        # Schwellenrost (druckimpraegniert)
SPARREN = (60.0, 160.0)         # Sparren
DACHLATTE = (40.0, 60.0)        # Traglattung unter dem Trapezblech
KONTERLATTE = (30.0, 50.0)      # senkrechte Konterlattung der Fassade
RHOMBUS = (20.0, 65.0)          # Rhombusleiste Fassade
TUERRAHMEN = (40.0, 60.0)       # Tuerblattrahmen
BODENPLATTE_D = 22.0            # OSB/3 Boden
FASSADE_LUFT = KONTERLATTE[0] + RHOMBUS[0]   # Aufbau vor dem Ständerwerk

DACH_UEBERSTAND_TRAUFE = 250.0  # vorne, mit Rinne
DACH_UEBERSTAND_ORT = 200.0     # seitlich links/rechts
# hinten an der Grenze: Dach endet buendig mit der Fassadenaussenkante,
# ragt also gerade so weit ueber das Staenderwerk wie der Fassadenaufbau dick ist
DACH_UEBERSTAND_GRENZE = FASSADE_LUFT

FAHRRAD_LAENGE = 1900.0         # Bemessungsrad inkl. Lenkerfreiheit
FAHRRAD_BREITE_HOCH = 600.0     # Lenkerbreite oben
FAHRRAD_BREITE_TIEF = 450.0     # versetzter Halter (hoch/tief im Wechsel)

# Bauordnung Hessen (HBO 2018)
HBO_MAX_BRI = 30.0              # m3, § 63 Abs. 1 Nr. 1 a: verfahrensfrei
HBO_MAX_WANDHOEHE = 3000.0      # mm, § 6 Abs. 8: mittlere Wandhoehe an der Grenze
HBO_MAX_GRENZLAENGE = 15000.0   # mm, § 6 Abs. 8: Gesamtlaenge je Grenze
HBO_BRI_RESERVE = 0.5           # m3 Sicherheitsabstand fuer den Optimierer


@dataclass
class ShedSpec:
    """Die vom Nutzer per Slider gesteuerten Groessen."""

    # --- Nutzung -----------------------------------------------------------
    # Die Vorgaben entsprechen dem Ergebnis des Optimierers: die groesste
    # Variante, die in Hessen noch verfahrensfrei an der Grenze stehen darf.
    n_bikes: int = 6                 # Fahrradstellplaetze
    tool_width: float = 1200.0       # lichte Breite des Geraeteteils (0 = keiner)

    # --- Geometrie ---------------------------------------------------------
    depth: float = 2270.0            # Aussentiefe (Y)
    eaves_height: float = 2100.0     # lichte Hoehe vorne an der Traufe
    roof_pitch: float = 7.0          # Dachneigung in Grad

    # --- Ausfuehrung -------------------------------------------------------
    closure: str = "closed_double"   # closed_double | open_front | side_doors
    roofing: str = "trapez"          # trapez | shingle | green | epdm
    foundation: str = "slabs"        # slabs | point | screw | concrete
    cladding: str = "rhombus"        # rhombus | profil
    boundary_side: str = "rear"      # Wand an der Grundstuecksgrenze

    # --- Standort / Lasten -------------------------------------------------
    snow_zone: str = "2"             # DIN EN 1991-1-3/NA: Hessen meist Zone 2
    altitude: float = 250.0          # Gelaendehoehe ueber NN in m
    site: str = "innenbereich"       # innenbereich | aussenbereich

    # --- Extras ------------------------------------------------------------
    with_gutter: bool = True
    with_floor: bool = True
    with_workbench: bool = False
    tool_shelves: int = 2

    # --- Preise (EUR, grobe Baumarkt-Richtwerte, editierbar) ----------------
    price_level: str = "mittel"      # guenstig | mittel | premium

    meta: dict = field(default_factory=dict)

    # -- abgeleitete Grundmasse --------------------------------------------
    @property
    def bike_bay_width(self) -> float:
        """Lichte Breite des Fahrradteils bei versetzter Aufstellung."""
        if self.n_bikes <= 0:
            return 0.0
        # abwechselnd hoch/tief eingehaengt -> Lenker greifen ineinander
        pitch = (FAHRRAD_BREITE_HOCH + FAHRRAD_BREITE_TIEF) / 2.0
        return self.n_bikes * pitch + 100.0   # 10 cm Bewegungszuschlag

    @property
    def has_tool_room(self) -> bool:
        return self.tool_width >= 600.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "ShedSpec":
        known = {f for f in cls.__dataclass_fields__}
        clean = {k: v for k, v in (data or {}).items() if k in known}
        for key in ("n_bikes", "tool_shelves"):
            if key in clean:
                clean[key] = int(clean[key])
        for key in ("tool_width", "depth", "eaves_height", "roof_pitch"):
            if key in clean:
                clean[key] = float(clean[key])
        for key in ("with_gutter", "with_floor", "with_workbench"):
            if key in clean:
                clean[key] = bool(clean[key])
        return cls(**clean)
