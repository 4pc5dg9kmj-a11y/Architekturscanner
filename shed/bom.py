"""Holzliste, Zuschnittoptimierung, Schrauben- und Materialliste.

Der Zuschnitt arbeitet mit echten Handelslaengen (Standardhoelzer aus dem
Baustoffhandel) und optimiert je Querschnitt per First-Fit-Decreasing ueber
alle zulaessigen Stangenlaengen - gewaehlt wird die guenstigste Kombination.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .model import Building
from .spec import RHOMBUS, ShedSpec

SAEGEBLATT = 5.0     # mm Schnittfuge


# ---------------------------------------------------------------------------
# Handelssortiment
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Stock:
    profile: str                  # "60x120"
    material: str
    lengths: tuple[int, ...]      # verfuegbare Handelslaengen in mm
    price_per_m: float            # EUR/lfm (Preisstufe "mittel")


SORTIMENT: dict[str, Stock] = {
    "60x120|KVH Fichte": Stock("60x120", "KVH Fichte C24", (2500, 3000, 4000, 5000), 6.60),
    "60x120|Konstruktionsholz kesseldruckimpraegniert": Stock(
        "60x120", "Konstruktionsholz kdi (Nutzungsklasse 3)", (2500, 3000, 4000, 5000), 5.90),
    "60x160|KVH Fichte": Stock("60x160", "KVH Fichte C24", (3000, 4000, 5000), 9.20),
    "60x60|KVH Fichte": Stock("60x60", "KVH Fichte C24", (2000, 2500, 3000), 3.30),
    "40x60|KVH Fichte gehobelt": Stock("40x60", "KVH gehobelt (Tuerrahmen)", (2000, 2500, 3000), 3.10),
    "40x60|Latte 40x60": Stock("40x60", "Latte 40x60 sägerau", (2000, 3000, 4000), 2.10),
    "40x60|Dachlatte imprägniert": Stock("40x60", "Dachlatte 40x60 impraegniert", (3000, 4000, 5000), 1.70),
    "30x50|Latte 30x50 impraegniert": Stock("30x50", "Traglatte 30x50 impraegniert", (3000, 4000, 5000), 1.30),
    "20x120|Rauspund/Glattkantbrett 20 mm": Stock("20x120", "Glattkantbrett 20x120 Laerche", (3000, 4000), 3.10),
    "20x160|Glattkantbrett 20 mm": Stock("20x160", "Glattkantbrett 20x160 Laerche", (3000, 4000, 5000), 4.20),
}

# Fallback fuer Profile ohne eigenen Sortimentseintrag
DEFAULT_LENGTHS = (2500, 3000, 4000, 5000)
DEFAULT_PRICE = 5.0

PREIS_FAKTOR = {"guenstig": 0.82, "mittel": 1.0, "premium": 1.35}


@dataclass
class CutBar:
    """Eine gekaufte Stange mit ihrem Zuschnittplan."""

    length: int
    pieces: list[tuple[str, float]] = field(default_factory=list)

    @property
    def used(self) -> float:
        return sum(p[1] for p in self.pieces) + SAEGEBLATT * max(0, len(self.pieces) - 1)

    @property
    def rest(self) -> float:
        return self.length - self.used


@dataclass
class TimberLine:
    profile: str
    material: str
    bars: list[CutBar]
    pieces: list[tuple[str, float]]
    price_per_m: float

    @property
    def count_by_length(self) -> dict[int, int]:
        out: dict[int, int] = {}
        for bar in self.bars:
            out[bar.length] = out.get(bar.length, 0) + 1
        return dict(sorted(out.items()))

    @property
    def total_bought_m(self) -> float:
        return sum(b.length for b in self.bars) / 1000.0

    @property
    def needed_m(self) -> float:
        return sum(p[1] for p in self.pieces) / 1000.0

    @property
    def waste_pct(self) -> float:
        if not self.total_bought_m:
            return 0.0
        return (1 - self.needed_m / self.total_bought_m) * 100.0

    @property
    def cost(self) -> float:
        return self.total_bought_m * self.price_per_m


# ---------------------------------------------------------------------------
# Zuschnitt
# ---------------------------------------------------------------------------


def _ffd(pieces: list[float], stock_lengths: tuple[int, ...],
         allow_mixed: bool) -> list[CutBar] | None:
    """First-Fit-Decreasing. ``allow_mixed`` erlaubt verschiedene Stangenlaengen."""
    order = sorted(pieces, reverse=True)
    if order and order[0] > max(stock_lengths):
        return None
    bars: list[CutBar] = []
    for ln in order:
        placed = False
        for bar in bars:
            if bar.rest >= ln + (SAEGEBLATT if bar.pieces else 0.0):
                bar.pieces.append(("", ln))
                placed = True
                break
        if placed:
            continue
        if allow_mixed:
            fits = [s for s in stock_lengths if s >= ln]
            new_len = min(fits)
        else:
            new_len = stock_lengths[0]
            if new_len < ln:
                return None
        bars.append(CutBar(new_len, [("", ln)]))
    return bars


def optimize_cuts(pieces: list[tuple[str, float]],
                  stock_lengths: tuple[int, ...],
                  price_per_m: float) -> list[CutBar]:
    """Waehlt die guenstigste Stangenkombination fuer die Stuecke."""
    pieces = _presplit(pieces, max(stock_lengths))
    lengths = [p[1] for p in pieces]
    if not lengths:
        return []
    candidates: list[list[CutBar]] = []
    for s in stock_lengths:
        if s < max(lengths):
            continue
        res = _ffd(lengths, (s,), allow_mixed=False)
        if res:
            candidates.append(res)
    mixed = _ffd(lengths, tuple(sorted(stock_lengths)), allow_mixed=True)
    if mixed:
        candidates.append(mixed)
    if not candidates:
        return []
    best = min(candidates, key=lambda bars: sum(b.length for b in bars))
    _label_bars(best, pieces)
    return best


def _presplit(pieces: list[tuple[str, float]], max_stock: int) -> list[tuple[str, float]]:
    """Teilt uebermasslange Bauteile in gleich lange, stossbare Abschnitte."""
    out: list[tuple[str, float]] = []
    for name, ln in pieces:
        if ln <= max_stock:
            out.append((name, ln))
            continue
        n = math.ceil(ln / (max_stock - 100))
        part = round(ln / n, 1)
        for i in range(n):
            out.append((f"{name} (Stoss {i + 1}/{n})", part))
    return out


def _label_bars(bars: list[CutBar], pieces: list[tuple[str, float]]) -> None:
    """Ordnet den zugeschnittenen Laengen wieder ihre Bauteilnamen zu."""
    pool: dict[float, list[str]] = {}
    for name, ln in pieces:
        pool.setdefault(round(ln, 1), []).append(name)
    for bar in bars:
        new: list[tuple[str, float]] = []
        for _, ln in bar.pieces:
            key = round(ln, 1)
            name = pool.get(key, [""]).pop(0) if pool.get(key) else ""
            new.append((name, ln))
        bar.pieces = new


def timber_list(b: Building) -> list[TimberLine]:
    """Gruppiert alle Hoelzer nach Querschnitt+Material und schneidet zu."""
    groups: dict[tuple[str, str], list[tuple[str, float]]] = {}
    for m in b.members:
        if m.group in ("dachhaut",):
            continue
        key = (m.profile_label, m.material)
        groups.setdefault(key, []).append((m.name, round(m.length, 1)))

    lines: list[TimberLine] = []
    factor = PREIS_FAKTOR.get(b.spec.price_level, 1.0)
    for (profile, material), pieces in sorted(groups.items()):
        stock = SORTIMENT.get(f"{profile}|{material}")
        lengths = stock.lengths if stock else DEFAULT_LENGTHS
        price = (stock.price_per_m if stock else DEFAULT_PRICE) * factor
        label = stock.material if stock else material
        bars = optimize_cuts(pieces, lengths, price)
        lines.append(TimberLine(profile, label, bars, pieces, price))
    lines.sort(key=lambda l: -l.cost)
    return lines


# ---------------------------------------------------------------------------
# Verbindungsmittel
# ---------------------------------------------------------------------------


@dataclass
class Item:
    name: str
    qty: float
    unit: str
    note: str = ""
    unit_price: float = 0.0
    group: str = "Verbindungsmittel"

    @property
    def cost(self) -> float:
        return self.qty * self.unit_price


def _pack(qty: float, per_pack: int) -> int:
    return int(math.ceil(qty / per_pack))


def fasteners(b: Building) -> list[Item]:
    d, spec = b.dims, b.spec
    f = PREIS_FAKTOR.get(spec.price_level, 1.0)
    items: list[Item] = []

    n_studs = len([m for m in b.members if "Ständer" in m.name])
    n_sparren = len([m for m in b.members if m.name in ("Sparren", "Aussensparren")])
    n_rost = len(b.by_group("rost"))
    doors = [o for o in b.openings if o.kind == "door"]
    n_leaves = sum(2 if "2-fluegelig" in o.name else 1 for o in doors)
    roof_area = d["roof_area"]
    clad_area = d.get("cladding_area", 0.0)
    floor_area = d["frame_l"] * d["frame_d"] / 1e6

    items += [
        Item("Winkelverbinder 90x90x65 mm, feuerverzinkt", n_studs * 2 + n_rost * 2,
             "Stk", "je Ständerfuss und -kopf ein Winkel", 1.45 * f),
        Item("Sparren-Pfettenanker 170 mm, links/rechts", n_sparren * 2, "Stk",
             "jeder Sparren an Vorder- und Rueckwand-Raehm", 2.20 * f),
        Item("Ankernaegel/-schrauben 5,0 x 40 mm (fuer Verbinder)",
             _pack((n_studs * 2 + n_rost * 2) * 8 + n_sparren * 2 * 10, 250),
             "Pack a 250", "Verbinder vollnageln", 14.90 * f),
        Item("Konstruktionsschraube 6,0 x 140 mm TX", _pack(n_studs * 2 + n_sparren * 2, 100),
             "Pack a 100", "Raehm/Fussriegel, Sturztraeger", 26.50 * f),
        Item("Konstruktionsschraube 5,0 x 80 mm TX", _pack(n_studs * 4 + 80, 200),
             "Pack a 200", "Ständerwerk allgemein, Riegel", 21.90 * f),
        Item("Konstruktionsschraube 8,0 x 200 mm TX", _pack(n_rost * 2 + 20, 50),
             "Pack a 50", "Rostverbindungen und Eckausbildung", 32.00 * f),
    ]

    if spec.with_floor:
        items.append(Item("Spanplattenschraube 4,5 x 60 mm",
                          _pack(floor_area * 16, 200), "Pack a 200",
                          "OSB-Boden auf den Rost, Abstand ca. 20 cm", 12.50 * f))

    if spec.roofing == "trapez":
        items += [
            Item("Kalottenschraube 4,8 x 35 mm mit EPDM-Dichtscheibe",
                 _pack(roof_area * 7, 100), "Pack a 100",
                 "Trapezblech im Wellental verschrauben", 18.90 * f),
            Item("Firstabschlussprofil / Wandanschluss 2 m", math.ceil(d["roof_w"] / 2000),
                 "Stk", "obere Kante an der Grenzwand", 16.50 * f),
            Item("Ortgangprofil 2 m", 2 * math.ceil(d["roof_slope_len"] / 2000), "Stk",
                 "seitliche Abschluesse links und rechts", 15.50 * f),
        ]
    elif spec.roofing == "shingle":
        items += [
            Item("Dachpappnaegel 25 mm verzinkt", _pack(roof_area * 30, 500), "Pack a 500",
                 "4 Naegel je Schindel", 9.90 * f),
            Item("Unterspannbahn V13 Bitumen, Rolle 10 m2",
                 math.ceil(roof_area / 10), "Rolle", "unter den Schindeln", 24.00 * f),
        ]
    elif spec.roofing in ("epdm", "green"):
        items.append(Item("EPDM-Kontaktkleber 5 l", math.ceil(roof_area / 12), "Dose",
                          "Randverklebung der Bahn", 46.00 * f))

    # Fassade
    items.append(Item("Fassadenschraube Edelstahl A2 4,0 x 40 mm",
                      _pack(clad_area / ((RHOMBUS[1] + 12) / 1000.0) * 2.2, 250),
                      "Pack a 250", "2 Schrauben je Leiste und Konterlatte", 27.90 * f))
    items.append(Item("Fassadenbahn diffusionsoffen, Rolle 50 m2",
                      max(1, math.ceil(clad_area * 1.15 / 50)), "Rolle",
                      "hinter der Konterlattung", 59.00 * f, "Werkstoffe"))
    items.append(Item("Nagelband / Klebeband fuer Fassadenbahn", 1, "Rolle", "", 12.00 * f,
                      "Werkstoffe"))

    # Tueren
    items += [
        Item("Aufschraubband 160 mm, verzinkt (Paar)", n_leaves * 3, "Stk",
             "3 Baender je Fluegel", 4.20 * f),
        Item("Ueberwurfriegel mit Vorhaengeschloss", len(doors), "Stk",
             "abschliessbar", 14.90 * f),
        Item("Tuergriff Holz/Edelstahl", n_leaves, "Stk", "", 8.50 * f),
    ]
    if any("2-fluegelig" in o.name for o in doors):
        items.append(Item("Kantenriegel / Stangenschloss 300 mm", 2, "Stk",
                          "Standfluegel oben und unten feststellen", 11.50 * f))

    if spec.with_gutter:
        rl = d["roof_w"] / 1000.0
        items += [
            Item("Dachrinne NW 100, 2 m (Zink oder Kunststoff)", math.ceil(rl / 2), "Stk",
                 "an der Traufe (Vorderseite)", 12.90 * f, "Entwaesserung"),
            Item("Rinnenhalter", max(3, math.ceil(rl / 0.6)), "Stk", "Abstand <= 60 cm",
                 3.20 * f, "Entwaesserung"),
            Item("Rinnenwinkel + Endstuecke", 2, "Set", "", 9.80 * f, "Entwaesserung"),
            Item("Fallrohr 2 m + Bogen + Schellen", 1, "Set",
                 "Ablauf in Regentonne oder Sickerschacht - nicht zur Grenze!",
                 24.00 * f, "Entwaesserung"),
        ]

    items.append(Item("Lueftungsgitter 400 x 200 mm mit Insektenschutz", 2, "Stk",
                      "Querlueftung beider Seitenwaende", 7.90 * f, "Werkstoffe"))
    return items


def materials(b: Building) -> list[Item]:
    d, spec = b.dims, b.spec
    f = PREIS_FAKTOR.get(spec.price_level, 1.0)
    items: list[Item] = []
    fl, fd = d["frame_l"] / 1000.0, d["frame_d"] / 1000.0
    footprint = fl * fd

    # Gruendung
    if spec.foundation == "slabs":
        n = len([p for p in b.panels if p.group == "fundament"])
        items += [
            Item("Gehwegplatte 40 x 40 x 5 cm grau", n, "Stk",
                 "unter jedem Auflagerpunkt, waagerecht ausgerichtet", 2.40 * f, "Gruendung"),
            Item("Splitt 2/5 mm, Sack 25 kg", math.ceil(n * 1.6), "Sack",
                 "ca. 5 cm Bettung je Platte", 4.50 * f, "Gruendung"),
            Item("Schotter 0/32 mm, Sack 25 kg", math.ceil(n * 3.2), "Sack",
                 "ca. 10-15 cm Tragschicht", 4.20 * f, "Gruendung"),
            Item("Unkrautvlies 100 g/m2", math.ceil(footprint * 1.3), "m2",
                 "unter der gesamten Flaeche", 1.20 * f, "Gruendung"),
            Item("Bitumen-Dachbahn als Trennlage (Rolle 5 m2)",
                 max(1, math.ceil((fl + fd) * 2 * 0.2 / 5)), "Rolle",
                 "Streifen zwischen Platte und Schwellenholz", 11.90 * f, "Gruendung"),
        ]
    elif spec.foundation == "point":
        n = len([p for p in b.panels if p.group == "fundament"])
        items += [
            Item("Beton-Trockenmischung 40 kg", n * 4, "Sack", "je Fundament ca. 4 Sack",
                 4.90 * f, "Gruendung"),
            Item("H-Pfostentraeger 71 x 121 mm feuerverzinkt", n, "Stk",
                 "einbetonieren, Holz bleibt trocken", 9.50 * f, "Gruendung"),
            Item("Schalrohr DN 250, 1 m", n, "Stk", "Fundamentschalung", 6.90 * f, "Gruendung"),
        ]
    elif spec.foundation == "screw":
        n = len([p for p in b.panels if p.group == "fundament"])
        items += [
            Item("Erdschraubfundament 68 x 865 mm mit Kopfplatte", n, "Stk",
                 "eindrehen, frostfrei ab 80 cm", 27.00 * f, "Gruendung"),
        ]
    else:
        items.append(Item("Betonschraube / Bolzenanker 10 x 100 mm",
                          max(8, int((fl + fd) * 2 / 0.8)), "Stk",
                          "Schwellenrost auf Bestandsplatte duebeln", 1.60 * f, "Gruendung"))

    # Boden
    if spec.with_floor:
        n_osb = math.ceil(footprint / (2.5 * 1.25) * 1.12)
        items.append(Item("OSB/3 Verlegeplatte N+F 22 mm, 2500 x 1250 mm", n_osb, "Platte",
                          "feuchtebestaendig verleimt, Nut+Feder verleimen",
                          31.50 * f, "Werkstoffe"))

    # Dachhaut
    ra = d["roof_area"]
    if spec.roofing == "trapez":
        n_sheets = math.ceil(d["roof_w"] / 1000.0)   # 1,0 m Nutzbreite
        items.append(Item(
            f"Trapezblech T-18/76, 0,5 mm, RAL 7016, Laenge {d['roof_slope_len'] / 1000 + 0.1:.2f} m",
            n_sheets, "Tafel", "auf Mass bestellen - eine Tafel je 1,00 m Dachbreite",
            (d["roof_slope_len"] / 1000 + 0.1) * 21.00 * f, "Dachhaut"))
        items.append(Item("Antikondensat-Vlies auf der Blechunterseite", 1, "Option",
                          "empfohlen gegen Tauwasser (Aufpreis beim Blech)", 0.0, "Dachhaut"))
    elif spec.roofing == "shingle":
        items += [
            Item("OSB/3 15 mm Schalung, 2500 x 1250 mm",
                 math.ceil(ra / (2.5 * 1.25) * 1.1), "Platte", "durchgehende Schalung",
                 23.50 * f, "Dachhaut"),
            Item("Bitumen-Dachschindeln, Paket fuer 3 m2",
                 math.ceil(ra / 3 * 1.1), "Paket", "Rechteckschnitt", 21.00 * f, "Dachhaut"),
        ]
    elif spec.roofing == "epdm":
        items.append(Item("EPDM-Dachbahn 1,5 mm, einteilig auf Mass",
                          ra * 1.25, "m2", "Bahn allseitig 20 cm ueberstehend bestellen",
                          13.50 * f, "Dachhaut"))
        items.append(Item("OSB/3 15 mm Schalung, 2500 x 1250 mm",
                          math.ceil(ra / (2.5 * 1.25) * 1.1), "Platte", "",
                          23.50 * f, "Dachhaut"))
    elif spec.roofing == "green":
        items += [
            Item("OSB/3 22 mm Schalung", math.ceil(ra / (2.5 * 1.25) * 1.1), "Platte",
                 "hoehere Lastabtragung", 31.50 * f, "Dachhaut"),
            Item("EPDM-Dachbahn 1,5 mm (wurzelfest)", ra * 1.25, "m2", "", 15.50 * f, "Dachhaut"),
            Item("Drainage-/Speicherplatte 25 mm", ra, "m2", "", 9.80 * f, "Dachhaut"),
            Item("Substrat extensiv, Sack 50 l", math.ceil(ra * 80 / 50), "Sack",
                 "ca. 8 cm Aufbau", 8.90 * f, "Dachhaut"),
            Item("Sedum-Sprossen oder Vegetationsmatte", ra, "m2", "", 14.00 * f, "Dachhaut"),
            Item("Kiesrandstreifen 16/32, Sack 25 kg", math.ceil(ra * 0.15), "Sack",
                 "umlaufender Randstreifen", 5.50 * f, "Dachhaut"),
        ]

    # Fassadenschalung
    lfm = d.get("rhombus_lfm", 0.0)
    if lfm > 0:
        board_len = 4.0
        n_boards = math.ceil(lfm / board_len * 1.08)
        label = ("Rhombusleiste 20 x 65 mm, Laerche/Douglasie, 4,00 m"
                 if spec.cladding == "rhombus"
                 else "Profilbrett Nut+Feder 19 x 121 mm, Laerche, 4,00 m")
        items.append(Item(label, n_boards, "Stk",
                          f"Deckbreite mit Fuge {RHOMBUS[1] + 12:.0f} mm, "
                          f"Bedarf {lfm:.0f} lfm + 8 % Verschnitt",
                          board_len * 2.70 * f, "Fassade"))
        items.append(Item("Abstandhalter / Fugenlehre 12 mm", 2, "Stk",
                          "gleichmaessige Fugen beim Anschrauben", 3.50 * f, "Fassade"))

    # Oberflaeche
    paint_area = d.get("cladding_area", 0.0) * 2.1 + 12.0
    items += [
        Item("Holzschutz-Lasur aussen, 5 l (ca. 40 m2 je Anstrich)",
             max(1, math.ceil(paint_area / 40)), "Gebinde",
             "2 Anstriche, Leisten vor der Montage rundum streichen", 44.00 * f, "Oberflaeche"),
        Item("Hirnholzschutz / Wachs 0,75 l", 1, "Dose",
             "alle Schnittkanten nachbehandeln", 12.90 * f, "Oberflaeche"),
    ]
    return items


def cost_summary(b: Building) -> dict:
    lines = timber_list(b)
    fast = fasteners(b)
    mats = materials(b)
    timber_cost = sum(l.cost for l in lines)
    fast_cost = sum(i.cost for i in fast)
    mat_cost = sum(i.cost for i in mats)
    total = timber_cost + fast_cost + mat_cost
    return {
        "holz": round(timber_cost, 2),
        "verbindungsmittel": round(fast_cost, 2),
        "material": round(mat_cost, 2),
        "gesamt": round(total, 2),
        "pro_stellplatz": round(total / max(1, b.spec.n_bikes), 2),
        "holz_lfm": round(sum(l.total_bought_m for l in lines), 1),
        "verschnitt_pct": round(
            (1 - sum(l.needed_m for l in lines) / max(0.01, sum(l.total_bought_m for l in lines)))
            * 100, 1),
    }


def weight_estimate(b: Building) -> dict:
    """Eigenlast fuer die Plausibilitaet der Gruendung."""
    lines = timber_list(b)
    holz_m3 = 0.0
    for l in lines:
        try:
            bb, hh = (float(x) for x in l.profile.split("x"))
        except ValueError:
            continue
        holz_m3 += bb * hh * l.needed_m * 1000.0 / 1e9
    holz_kg = holz_m3 * 480.0
    d = b.dims
    roof_kg = {"trapez": 5.0, "shingle": 12.0, "epdm": 8.0, "green": 110.0}.get(
        b.spec.roofing, 6.0) * d["roof_area"]
    floor_kg = (d["frame_l"] * d["frame_d"] / 1e6) * 14.0 if b.spec.with_floor else 0.0
    clad_kg = d.get("cladding_area", 0.0) * 11.0
    total = holz_kg + roof_kg + floor_kg + clad_kg
    n_sup = max(1, len([p for p in b.panels if p.group == "fundament"]))
    snow_kg = d["footprint"] * 75.0     # Schneelastzone 2 Hessen, ~0,75 kN/m2
    return {
        "holz_kg": round(holz_kg), "dach_kg": round(roof_kg),
        "boden_kg": round(floor_kg), "fassade_kg": round(clad_kg),
        "eigenlast_kg": round(total),
        "schneelast_kg": round(snow_kg),
        "je_auflager_kg": round((total + snow_kg) / n_sup),
        "auflager": n_sup,
    }
