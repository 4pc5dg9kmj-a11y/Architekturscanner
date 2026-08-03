"""Parametrisches Konstruktionsmodell des Fahrradhaeuschens.

Aus einer :class:`ShedSpec` entsteht hier das vollstaendige Bauwerk:
Schwellenrost, Ständerwerk aller Waende, Pultdach-Sparrenlage, Traglattung,
Tueren, Fassade und Boden - jedes Bauteil mit realer Lage im Raum und
realem Querschnitt. Aus dieser Liste leiten sich Holzliste, Zuschnitt,
Zeichnungen, 3D-Ansicht und Bauanleitung ab.

Bauweise: Plattformbauweise auf Schwellenrost.
Pultdach faellt von der Grenzwand (hinten, First) zur Traufe (vorne).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .spec import (
    DACHLATTE,
    DACH_UEBERSTAND_GRENZE,
    DACH_UEBERSTAND_ORT,
    DACH_UEBERSTAND_TRAUFE,
    FASSADE_LUFT,
    KONTERLATTE,
    RASTER,
    RHOMBUS,
    SCHWELLE,
    SPARREN,
    TUERRAHMEN,
    BODENPLATTE_D,
    WAND_STIEL,
    ShedSpec,
)
from .statics import (Q_FLOOR, select_joist, select_lintel_with_posts,
                      select_rafter, roof_dead_load, roof_snow)

Vec = tuple[float, float, float]


# ---------------------------------------------------------------------------
# Bauteile
# ---------------------------------------------------------------------------


@dataclass
class Member:
    """Ein Holzbauteil als Quader im Raum (auch geneigt)."""

    name: str
    group: str
    profile: tuple[float, float]   # Querschnitt b x h in mm
    length: float                  # Zuschnittlaenge in mm
    verts: list[Vec] = field(default_factory=list)
    material: str = "KVH Fichte"
    treated: bool = False
    note: str = ""

    @property
    def profile_label(self) -> str:
        b, h = self.profile
        return f"{b:.0f}x{h:.0f}"


@dataclass
class Panel:
    """Eine Plattenflaeche (Boden, Dachblech, Fassadenflaeche).

    ``kind`` = "box" -> 8 Eckpunkte in der Ordnung von :func:`_box`,
    ``kind`` = "poly" -> ebene Flaeche mit beliebig vielen Eckpunkten.
    """

    name: str
    group: str
    verts: list[Vec]
    thickness: float
    material: str
    area: float = 0.0
    kind: str = "box"


@dataclass
class Opening:
    """Wandoeffnung (Tuer/Lueftung) in lokalen Wandkoordinaten."""

    name: str
    wall: str
    x0: float
    width: float
    z0: float
    height: float
    kind: str = "door"


@dataclass
class Building:
    spec: ShedSpec
    dims: dict
    members: list[Member] = field(default_factory=list)
    panels: list[Panel] = field(default_factory=list)
    openings: list[Opening] = field(default_factory=list)

    def by_group(self, group: str) -> list[Member]:
        return [m for m in self.members if m.group == group]


# ---------------------------------------------------------------------------
# Geometrie-Helfer
# ---------------------------------------------------------------------------


def _norm(v: Vec) -> Vec:
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _prism(origin: Vec, axis: Vec, width_dir: Vec,
           length: float, width: float, height: float) -> list[Vec]:
    """Quader: origin = Mitte der Startflaeche (Unterkante-Mitte in width_dir).

    ``axis``       Laengsrichtung
    ``width_dir``  Richtung der Breite ``width``
    Hoehe steht senkrecht auf beiden.
    """
    a = _norm(axis)
    w = _norm(width_dir)
    h = _norm(_cross(a, w))
    ox, oy, oz = origin
    pts: list[Vec] = []
    for li in (0.0, length):
        for wi in (-width / 2.0, width / 2.0):
            for hi in (0.0, height):
                pts.append((ox + a[0] * li + w[0] * wi + h[0] * hi,
                            oy + a[1] * li + w[1] * wi + h[1] * hi,
                            oz + a[2] * li + w[2] * wi + h[2] * hi))
    # Reihenfolge: (l,w,h) -> Index l*4 + w*2 + h
    return pts


def _box(x0: float, y0: float, z0: float,
         x1: float, y1: float, z1: float) -> list[Vec]:
    """Achsparalleler Quader mit derselben Eckpunktordnung wie ``_prism``."""
    pts: list[Vec] = []
    for x in (x0, x1):
        for y in (y0, y1):
            for z in (z0, z1):
                pts.append((x, y, z))
    return pts


def raster_positions(total: float, spacing: float = RASTER,
                     member: float = WAND_STIEL[1]) -> list[float]:
    """Achsabstaende fuer Ständer/Sparren: aussen buendig, innen <= ``spacing``."""
    if total <= member:
        return [total / 2.0]
    inner = total - member          # Achsabstand erster<->letzter Ständer
    n = max(1, math.ceil(inner / spacing))
    step = inner / n
    start = member / 2.0
    return [start + i * step for i in range(n + 1)]


# ---------------------------------------------------------------------------
# Hauptaufbau
# ---------------------------------------------------------------------------


def compute_dims(spec: ShedSpec) -> dict:
    """Alle abgeleiteten Hauptmasse - ohne Bauteile zu erzeugen."""
    pitch = math.radians(spec.roof_pitch)

    frame_d = spec.depth - 2 * FASSADE_LUFT
    inner_d = frame_d - 2 * WAND_STIEL[0]

    bike_w = spec.bike_bay_width
    tool_w = spec.tool_width if spec.has_tool_room else 0.0
    partition = WAND_STIEL[0] if spec.has_tool_room else 0.0
    frame_l = WAND_STIEL[0] + bike_w + partition + tool_w + WAND_STIEL[0]
    length_out = frame_l + 2 * FASSADE_LUFT

    # EIN Achsraster fuer Deckenbalken, Staender und Sparren: so steht jeder
    # Sparren ueber einem Staender und jeder Staender ueber einem Deckenbalken.
    # Der Lastpfad laeuft damit gerade nach unten, ohne Umlenkung ueber
    # biegebeanspruchte Riegel.
    axes_x = raster_positions(frame_l, RASTER, WAND_STIEL[1])
    e_axis = (axes_x[1] - axes_x[0]) if len(axes_x) > 1 else RASTER

    # Sparren: Stuetzweite = Wandabstand, Kragarm = Traufueberstand
    sparren, sparren_proof = select_rafter(
        frame_d, e_axis, spec.roofing, spec.roof_pitch, spec.snow_zone,
        spec.altitude, cantilever_mm=DACH_UEBERSTAND_TRAUFE)

    # Deckenbalken: Schwellen unter beiden Enden und in der Mitte
    joist, joist_proof = select_joist(frame_d / 2.0, e_axis)

    # Hoehenlage: Schwelle liegend, Deckenbalken hochkant darauf
    z_sill_top = SCHWELLE[0]      # Schwelle liegt flach: 120 breit, 60 hoch
    z_rost_top = z_sill_top + joist[1]
    z_floor = z_rost_top + (BODENPLATTE_D if spec.with_floor else 0.0)
    z_plate_bottom_front = z_floor + spec.eaves_height
    z_plate_top_front = z_plate_bottom_front + WAND_STIEL[1]
    rise = frame_d * math.tan(pitch)
    z_plate_top_rear = z_plate_top_front + rise

    # Dachaufbau senkrecht gemessen
    roof_build = (sparren[1] + DACHLATTE[0]) / math.cos(pitch) + _roofing_thickness(spec)
    z_roof_front = z_plate_top_front + roof_build
    z_roof_rear = z_plate_top_rear + roof_build

    # Brutto-Rauminhalt nach Aussenmassen ab OK Gelaende
    bri = length_out * spec.depth * (z_roof_front + z_roof_rear) / 2.0 / 1e9

    roof_run = DACH_UEBERSTAND_GRENZE + frame_d + DACH_UEBERSTAND_TRAUFE
    sparren_len = roof_run / math.cos(pitch)
    roof_w = length_out + 2 * DACH_UEBERSTAND_ORT
    roof_slope_len = sparren_len

    # Sturz ueber der breitesten Oeffnung der Traufwand
    door_w = _widest_opening(spec, bike_w, tool_w)
    lintel, lintel_proof, lintel_posts = select_lintel_with_posts(
        door_w, 2 * WAND_STIEL[1], frame_d / 2.0 + DACH_UEBERSTAND_TRAUFE,
        spec.roofing, spec.roof_pitch, spec.snow_zone, spec.altitude)
    max_lintel_span = door_w / (lintel_posts + 1) if door_w else 0.0

    return {
        "pitch_rad": pitch,
        "axes_x": axes_x,
        "e_axis": e_axis,
        "sparren": sparren,
        "sparren_check": sparren_proof.to_dict(),
        "sparren_proof": sparren_proof,
        "joist": joist,
        "joist_proof": joist_proof,
        "lintel": lintel,
        "lintel_proof": lintel_proof,
        "lintel_posts": lintel_posts,
        "max_lintel_span": max_lintel_span,
        "widest_opening": door_w,
        "z_sill_top": z_sill_top,
        "frame_l": frame_l,
        "frame_d": frame_d,
        "length_out": length_out,
        "depth_out": spec.depth,
        "inner_d": inner_d,
        "bike_w": bike_w,
        "tool_w": tool_w,
        "partition_t": partition,
        "z_rost_top": z_rost_top,
        "z_floor": z_floor,
        "z_plate_bottom_front": z_plate_bottom_front,
        "z_plate_top_front": z_plate_top_front,
        "z_plate_top_rear": z_plate_top_rear,
        "rise": rise,
        "z_roof_front": z_roof_front,
        "z_roof_rear": z_roof_rear,
        "roof_build": roof_build,
        "sparren_len": sparren_len,
        "roof_w": roof_w,
        "roof_slope_len": roof_slope_len,
        "roof_run": roof_run,
        "roof_area": roof_w * roof_slope_len / 1e6,
        "bri": bri,
        "footprint": length_out * spec.depth / 1e6,
        # x-Grenzen der Nutzungsbereiche (innen, Ständerwerks-Koordinaten)
        "bike_x0": FASSADE_LUFT + WAND_STIEL[0],
        "bike_x1": FASSADE_LUFT + WAND_STIEL[0] + bike_w,
        "tool_x0": FASSADE_LUFT + WAND_STIEL[0] + bike_w + partition,
        "tool_x1": FASSADE_LUFT + WAND_STIEL[0] + bike_w + partition + tool_w,
        "clear_height_front": spec.eaves_height,
        "clear_height_rear": spec.eaves_height + rise,
    }


def _widest_opening(spec: ShedSpec, bike_w: float, tool_w: float) -> float:
    """Lichte Breite der groessten Wandoeffnung - massgebend fuer den Sturz."""
    widths = [0.0]
    if spec.closure == "closed_double":
        widths.append(min(bike_w - 120.0, 1800.0))
    elif spec.closure == "open_front":
        widths.append(bike_w)
    else:
        widths.append(1600.0)
    if spec.has_tool_room:
        widths.append(min(tool_w - 120.0, 900.0))
    return max(widths)


def _roofing_thickness(spec: ShedSpec) -> float:
    return {"trapez": 20.0, "shingle": 30.0, "green": 120.0, "epdm": 25.0}.get(
        spec.roofing, 20.0)


def build(spec: ShedSpec) -> Building:
    d = compute_dims(spec)
    b = Building(spec=spec, dims=d)

    _build_foundation(b)
    _build_rost(b)
    _build_floor(b)
    _build_walls(b)
    _build_roof(b)
    _build_doors(b)
    _build_cladding(b)
    _build_interior(b)
    return b


# --- Fundament -------------------------------------------------------------


def _build_foundation(b: Building) -> None:
    """Auflagerpunkte unter den Schwellen - nichts haengt, alles steht."""
    d, spec = b.dims, b.spec
    label = {"slabs": "Gehwegplatte 40x40x5 auf Splitt",
             "point": "Punktfundament C25/30 mit Pfostentraeger",
             "screw": "Schraubfundament mit Kopfplatte",
             "concrete": "vorhandene Betonflaeche"}.get(spec.foundation, "Auflager")
    if spec.foundation == "concrete":
        d["support_xy"] = []
        d["support_size"] = 0.0
        d["support_spacing"] = 0.0
        return

    size, thick = (400.0, 50.0) if spec.foundation == "slabs" else (300.0, 400.0)
    xs = _support_axes(d["axes_x"])
    ys = _sill_rows(d)

    pts = []
    for yi in ys:
        for xi in xs:
            # Auch unter Gelaende darf nichts die Grenze queren (§ 903 BGB)
            cy = min(max(yi, size / 2), spec.depth - size / 2)
            cx = FASSADE_LUFT + xi
            pts.append((cx, cy))
            b.panels.append(Panel(
                name=label, group="fundament",
                verts=_box(cx - size / 2, cy - size / 2, -thick,
                           cx + size / 2, cy + size / 2, 0.0),
                thickness=thick, material=label, area=size * size / 1e6))
    d["support_xy"] = pts
    d["support_size"] = size
    d["support_spacing"] = (xs[1] - xs[0]) if len(xs) > 1 else 0.0


def _support_axes(axes: list[float]) -> list[float]:
    """Unter jeder Balkenachse steht ein Auflager.

    Damit ist die Schwelle ein reines Auflagerholz und kein Biegetraeger:
    jeder Deckenbalken - und damit jeder Staender und jeder Sparren darueber -
    hat sein Fundament senkrecht unter sich. Das ist der Kern der
    Auflagerkette; ein paar Platten mehr sind billiger als ein Rost, der
    sich mit den Jahren durchbiegt.
    """
    return list(axes)


def _sill_rows(d: dict) -> list[float]:
    """Mittellinien der drei Schwellen in Bauwerkskoordinaten (y)."""
    oy, fd = FASSADE_LUFT, d["frame_d"]
    t = SCHWELLE[1]
    return [oy + t / 2, oy + fd / 2, oy + fd - t / 2]


def _build_rost(b: Building) -> None:
    """Schwellen auf den Fundamenten, Deckenbalken quer darueber.

    Die Deckenbalken liegen auf den Schwellen auf - keine Balkenschuhe und
    keine Verbindung im Hirnholz. Der Lastweg ist reine Auflagerung.
    """
    d = b.dims
    fl, fd = d["frame_l"], d["frame_d"]
    ox, oy = FASSADE_LUFT, FASSADE_LUFT
    sw, sh = SCHWELLE[1], SCHWELLE[0]        # liegend: 120 breit, 60 hoch
    jb, jh = d["joist"]

    for i, yc in enumerate(_sill_rows(d)):
        tag = ("hinten (Grenze)", "Mitte", "vorne")[i]
        m = Member(f"Schwelle {tag}", "rost", (sw, sh), fl,
                   material="Konstruktionsholz kesseldruckimpraegniert",
                   treated=True,
                   note="liegend auf den Fundamentplatten, Bitumen-Trennlage "
                        "dazwischen")
        m.verts = _box(ox, yc - sw / 2, 0, ox + fl, yc + sw / 2, sh)
        b.members.append(m)

    for xi in d["axes_x"]:
        m = Member("Deckenbalken", "rost", (jb, jh), fd,
                   note=f"liegt auf drei Schwellen auf, Stuetzweite je Feld "
                        f"{fd / 2:.0f} mm")
        m.verts = _box(ox + xi - jb / 2, oy, sh, ox + xi + jb / 2, oy + fd, sh + jh)
        b.members.append(m)

    for yc, tag in ((oy + jb / 2, "Grenzseite"), (oy + fd - jb / 2, "Traufseite")):
        m = Member(f"Randbalken {tag}", "rost", (jb, jh), fl,
                   note="liegt auf der Schwelle auf und fasst die Deckenbalken ein")
        m.verts = _box(ox, yc - jb / 2, sh, ox + fl, yc + jb / 2, sh + jh)
        b.members.append(m)


def _build_floor(b: Building) -> None:
    if not b.spec.with_floor:
        return
    d = b.dims
    ox, oy = FASSADE_LUFT, FASSADE_LUFT
    z = d["z_rost_top"]
    b.panels.append(Panel(
        name="Boden OSB/3 22 mm", group="boden",
        verts=_box(ox, oy, z, ox + d["frame_l"], oy + d["frame_d"], z + BODENPLATTE_D),
        thickness=BODENPLATTE_D, material="OSB/3 Verlegeplatte N+F 22 mm",
        area=d["frame_l"] * d["frame_d"] / 1e6))


# --- Waende ----------------------------------------------------------------


def _wall_axis(b: Building, wall: str):
    """Gibt (origin, axis, normal, laenge) der Wandmittelebene zurueck."""
    d = b.dims
    ox, oy = FASSADE_LUFT, FASSADE_LUFT
    t = WAND_STIEL[0]
    fl, fd = d["frame_l"], d["frame_d"]
    if wall == "rear":       # y = 0, Grenze
        return (ox, oy + t / 2, 0.0), (1.0, 0, 0), (0, -1.0, 0), fl
    if wall == "front":      # y = fd, Traufe
        return (ox, oy + fd - t / 2, 0.0), (1.0, 0, 0), (0, 1.0, 0), fl
    if wall == "left":
        return (ox + t / 2, oy + t, 0.0), (0, 1.0, 0), (-1.0, 0, 0), fd - 2 * t
    if wall == "right":
        return (ox + fl - t / 2, oy + t, 0.0), (0, 1.0, 0), (1.0, 0, 0), fd - 2 * t
    raise ValueError(wall)


def _place(b: Building, wall: str, name: str, group: str,
           u0: float, u1: float, z0: float, z1: float,
           profile: tuple[float, float], length: float,
           material: str = "KVH Fichte", note: str = "") -> Member:
    """Setzt ein Wandbauteil ueber lokale Koordinaten (u entlang der Wand)."""
    (px, py, _), axis, _, _ = _wall_axis(b, wall)
    t = WAND_STIEL[0]
    m = Member(name, group, profile, length, material=material, note=note)
    if axis[0]:
        m.verts = _box(px + u0, py - t / 2, z0, px + u1, py + t / 2, z1)
    else:
        m.verts = _box(px - t / 2, py + u0, z0, px + t / 2, py + u1, z1)
    b.members.append(m)
    return m


def _build_walls(b: Building) -> None:
    d, spec = b.dims, b.spec
    z_floor = d["z_floor"]
    z_top_front = d["z_plate_top_front"]
    z_top_rear = d["z_plate_top_rear"]
    sw, sh = WAND_STIEL              # 60 breit (Wanddicke), 120 in Wandebene

    _collect_openings(b)

    for wall in ("rear", "front", "left", "right"):
        _, axis, _, wl = _wall_axis(b, wall)
        if wall == "rear":
            z_plate_top = z_top_rear
        else:
            z_plate_top = z_top_front
        z_plate_bot = z_plate_top - sh
        label = {"rear": "Rueckwand (Grenze)", "front": "Vorderwand (Traufe)",
                 "left": "Seitenwand links", "right": "Seitenwand rechts"}[wall]
        grp = f"wand_{wall}"

        # Fussriegel
        _place(b, wall, f"{label}: Fussriegel", grp, 0, wl, z_floor, z_floor + 60,
               (sw, 60.0), wl, note="liegend auf Bodenplatte")
        # Rähm (traegt die Sparren)
        _place(b, wall, f"{label}: Raehm", grp, 0, wl, z_plate_bot, z_plate_top,
               (sw, sh), wl, note="Auflager der Sparren")

        ops = [o for o in b.openings if o.wall == wall]
        stud_h0 = z_floor + 60
        stud_h1 = z_plate_bot

        # Vorder- und Rueckwand teilen sich das Achsraster mit Deckenbalken
        # und Sparren; die Seitenwaende bekommen ihr eigenes Raster.
        axes = (d["axes_x"] if wall in ("front", "rear")
                else raster_positions(wl, RASTER, sh))
        for u in axes:
            u0, u1 = u - sh / 2, u + sh / 2
            if any(o.x0 - sh < u1 and u0 < o.x0 + o.width + sh for o in ops):
                continue
            _place(b, wall, f"{label}: Ständer", grp, u0, u1, stud_h0, stud_h1,
                   (sw, sh), stud_h1 - stud_h0)

        for o in ops:
            _frame_opening(b, wall, label, grp, o, stud_h0, stud_h1)

        # Giebelfeld der Seitenwaende unter dem geneigten Sparren
        if wall in ("left", "right"):
            _build_gable_infill(b, wall, label, grp, z_plate_top)


def _frame_opening(b: Building, wall: str, label: str, grp: str,
                   o: Opening, stud_h0: float, stud_h1: float) -> None:
    sw, sh = WAND_STIEL
    # Zargenständer beidseitig (doppelt: durchlaufend + Sturzträger)
    for u in (o.x0 - sh, o.x0 + o.width):
        _place(b, wall, f"{label}: Zargenständer {o.name}", grp,
               u, u + sh, stud_h0, stud_h1, (sw, sh), stud_h1 - stud_h0)
    z_head = o.z0 + o.height
    # Sturz: Querschnitt aus dem Nachweis, liegt beidseitig auf den
    # Zargenstaendern auf (keine Hirnholzverbindung)
    lb, lh = b.dims["lintel"]
    _place(b, wall, f"{label}: Sturz {o.name}", grp,
           o.x0 - sh, o.x0 + o.width + sh, z_head, z_head + lh,
           (lb, lh), o.width + 2 * sh,
           note="liegt beidseitig auf den Zargenstaendern auf")
    # Zwischenstuetzen teilen zu breite Oeffnungen auf
    max_span = b.dims.get("max_lintel_span") or o.width
    n_posts = max(0, math.ceil(o.width / max_span) - 1) if max_span else 0
    for k in range(1, n_posts + 1):
        u = o.x0 + o.width * k / (n_posts + 1) - sh / 2
        _place(b, wall, f"{label}: Zwischenstuetze {o.name}", grp,
               u, u + sh, stud_h0, z_head, (sw, sh), z_head - stud_h0,
               note="traegt den Sturz ab - die Oeffnung ist zu breit zum "
                    "freien Ueberspannen")

    # Fuellständer ueber dem Sturz uebertragen die Sparrenlast in den Sturz
    if stud_h1 - (z_head + lh) > 150:
        for u in raster_positions(o.width, RASTER, sh):
            _place(b, wall, f"{label}: Fuellständer", grp,
                   o.x0 + u - sh / 2, o.x0 + u + sh / 2, z_head + lh, stud_h1,
                   (sw, sh), stud_h1 - z_head - lh)
    # Brüstungsriegel bei Lueftungsoeffnungen
    if o.kind != "door" and o.z0 > stud_h0 + 50:
        _place(b, wall, f"{label}: Brueckenriegel", grp,
               o.x0 - sh, o.x0 + o.width + sh, o.z0 - sh, o.z0,
               (sw, sh), o.width + 2 * sh)


def _build_gable_infill(b: Building, wall: str, label: str, grp: str,
                        z_plate_top: float) -> None:
    """Dreieckiges Feld zwischen Seitenwand-Raehm und geneigtem Aussensparren."""
    d = b.dims
    sw, sh = WAND_STIEL
    _, axis, _, wl = _wall_axis(b, wall)
    pitch = d["pitch_rad"]
    # y-lokale Koordinate u laeuft von hinten (Grenze) nach vorn
    # Sparrenunterkante ueber dem Raehm: hinten hoch, vorne 0
    for u in raster_positions(wl, RASTER, sh):
        y_from_rear = u + WAND_STIEL[0]
        h = (d["frame_d"] - y_from_rear) * math.tan(pitch)
        if h < 80:
            continue
        _place(b, wall, f"{label}: Giebelständer", grp,
               u - sh / 2, u + sh / 2, z_plate_top, z_plate_top + h,
               (sw, sh), h, note="oben passend zur Dachneigung schraeg saegen")


def _collect_openings(b: Building) -> None:
    d, spec = b.dims, b.spec
    z_floor = d["z_floor"]
    lift = 0.0
    ox = FASSADE_LUFT

    bike_u0 = d["bike_x0"] - ox
    bike_u1 = d["bike_x1"] - ox
    tool_u0 = d["tool_x0"] - ox
    tool_u1 = d["tool_x1"] - ox

    door_h = min(spec.eaves_height - 120.0, 2000.0)

    if spec.closure == "open_front":
        b.openings.append(Opening("Fahrrad-Oeffnung", "front", bike_u0,
                                  bike_u1 - bike_u0, z_floor, door_h, "open"))
    elif spec.closure == "side_doors":
        wall = "left"
        w = min(d["frame_d"] - 2 * WAND_STIEL[0] - 200, 1600.0)
        b.openings.append(Opening("Fluegeltuer 2-fluegelig", wall, 100.0, w,
                                  z_floor, door_h, "door"))
    else:  # closed_double
        w = min(bike_u1 - bike_u0 - 120.0, 1800.0)
        u0 = bike_u0 + ((bike_u1 - bike_u0) - w) / 2.0
        b.openings.append(Opening("Fluegeltuer 2-fluegelig", "front", u0, w,
                                  z_floor, door_h, "door"))

    if spec.has_tool_room:
        w = min(tool_u1 - tool_u0 - 120.0, 900.0)
        u0 = tool_u0 + ((tool_u1 - tool_u0) - w) / 2.0
        b.openings.append(Opening("Geraetetuer", "front", u0, max(w, 600.0),
                                  z_floor, door_h, "door"))

    # Querlueftung oben in beiden Seitenwaenden
    _, _, _, wl_side = _wall_axis(b, "left")
    for wall in ("left", "right"):
        b.openings.append(Opening("Lueftungsgitter", wall, wl_side / 2 - 200.0,
                                  400.0, d["z_plate_top_front"] - 500.0, 200.0,
                                  "vent"))


# --- Dach ------------------------------------------------------------------


def _build_roof(b: Building) -> None:
    d, spec = b.dims, b.spec
    pitch = d["pitch_rad"]
    ox, oy = FASSADE_LUFT, FASSADE_LUFT
    fl, fd = d["frame_l"], d["frame_d"]
    sw, sh = d["sparren"]

    # Sparren laufen in Gefaellerichtung: hinten (y=0) hoch -> vorne (y=fd) tief
    z_rear = d["z_plate_top_rear"]
    axis = _norm((0.0, math.cos(pitch), -math.sin(pitch)))
    # Flaechennormale des Daches: senkrecht auf der Sparrenachse, nach oben
    perp = (0.0, math.sin(pitch), math.cos(pitch))
    # width_dir = -X, damit die Bauteilhoehe nach oben aufgetragen wird
    wdir = (-1.0, 0.0, 0.0)
    length = d["sparren_len"]
    y_start = oy - DACH_UEBERSTAND_GRENZE          # = 0: buendig mit der Fassade
    z_start = z_rear + DACH_UEBERSTAND_GRENZE * math.tan(pitch)

    def on_roof(x, s_along, t_perp):
        """Punkt auf der Dachebene: ``s_along`` in Gefaellerichtung, ``t_perp`` darueber."""
        return (x,
                y_start + axis[1] * s_along + perp[1] * t_perp,
                z_start + axis[2] * s_along + perp[2] * t_perp)

    sparren_x = d["axes_x"]
    for i, xi in enumerate(sparren_x):
        edge = i in (0, len(sparren_x) - 1)
        m = Member("Aussensparren" if edge else "Sparren", "dach", d["sparren"],
                   length,
                   note=("liegt mit Kerve auf beiden Raehmen auf, jeweils "
                         "senkrecht ueber einem Staender"
                         if not edge else
                         "Ortgangsparren, traegt zugleich das Giebelfeld"))
        m.verts = _prism((ox + xi, y_start, z_start), axis, wdir, length, sw, sh)
        b.members.append(m)

    # Traglattung quer zum Gefaelle (traegt das Trapezblech)
    x_left = -DACH_UEBERSTAND_ORT
    x_right = d["length_out"] + DACH_UEBERSTAND_ORT
    n_latt = max(3, int(d["roof_slope_len"] // 800) + 1)
    d["n_latt"] = n_latt
    latt_len = x_right - x_left
    # Achsen liegen um eine halbe Lattenbreite eingerueckt, damit die erste
    # Latte an der Grenze buendig abschliesst und nichts uebersteht
    s_first = DACHLATTE[1] / 2.0
    s_last = d["roof_slope_len"] - DACHLATTE[1] / 2.0
    for i in range(n_latt):
        s_along = s_first + i * (s_last - s_first) / (n_latt - 1)
        p = on_roof(x_left, s_along, sh)
        m = Member("Traglatte", "dach", DACHLATTE, latt_len,
                   material="Dachlatte imprägniert",
                   note="rechtwinklig zum Gefaelle, Achsabstand <= 800 mm")
        m.verts = _prism(p, (1.0, 0.0, 0.0), (0.0, -math.cos(pitch), math.sin(pitch)),
                         latt_len, DACHLATTE[1], DACHLATTE[0])
        b.members.append(m)

    # Dachhaut als Flaeche in der Dachebene
    thick = _roofing_thickness(spec)
    t0 = sh + DACHLATTE[0]
    verts = []
    for xx in (x_left, x_right):                     # Index = x*4 + s*2 + t
        for s_along in (0.0, d["roof_slope_len"]):
            for tt in (t0, t0 + thick):
                verts.append(on_roof(xx, s_along, tt))
    b.panels.append(Panel(name=_roofing_label(spec), group="dachhaut", verts=verts,
                          thickness=thick, material=_roofing_label(spec),
                          area=d["roof_area"]))

    # Ortgangbretter seitlich neben den Aussensparren
    for side, xx in (("links", x_left), ("rechts", x_right)):
        m = Member(f"Ortgangbrett {side}", "dach", (20.0, 120.0), d["roof_slope_len"],
                   material="Rauspund/Glattkantbrett 20 mm")
        m.verts = _prism((xx, y_start, z_start), axis, wdir,
                         d["roof_slope_len"], 20.0, 120.0)
        b.members.append(m)

    # Traufbohle als Auflager der Rinnenhalter
    m = Member("Traufbohle", "dach", (20.0, 160.0), latt_len,
               material="Glattkantbrett 20 mm", note="Auflager der Rinnenhalter")
    pe = on_roof(x_left, d["roof_slope_len"], 0.0)
    m.verts = _box(x_left, pe[1] - 20, pe[2] - 100, x_right, pe[1], pe[2] + 60)
    b.members.append(m)


def _roofing_label(spec: ShedSpec) -> str:
    return {"trapez": "Trapezblech T-18/76, 0,5 mm, anthrazit RAL 7016",
            "shingle": "Bitumenschindeln auf OSB/3 15 mm",
            "green": "Gruendach: EPDM + Drainage + Sedummatte",
            "epdm": "EPDM-Dachbahn 1,5 mm, einteilig"}.get(spec.roofing, "Dachhaut")


# --- Tueren ----------------------------------------------------------------


def _build_doors(b: Building) -> None:
    d = b.dims
    tw, th = TUERRAHMEN
    for o in b.openings:
        if o.kind != "door":
            continue
        leaves = 2 if "2-fluegelig" in o.name else 1
        leaf_w = (o.width - 10.0 * (leaves + 1)) / leaves
        for k in range(leaves):
            for part, ln in (("Rahmen senkrecht", o.height), ("Rahmen senkrecht", o.height),
                             ("Rahmen waagerecht", leaf_w - 2 * th),
                             ("Rahmen waagerecht", leaf_w - 2 * th),
                             ("Mittelriegel", leaf_w - 2 * th),
                             ("Diagonalstrebe", math.hypot(leaf_w, o.height) * 0.55)):
                b.members.append(Member(
                    f"{o.name}: {part}", "tuer", TUERRAHMEN, ln,
                    material="KVH Fichte gehobelt",
                    note=f"Fluegel {k + 1} von {leaves}, lichte Oeffnung "
                         f"{o.width:.0f}x{o.height:.0f} mm"))
        _door_geometry(b, o, leaves, leaf_w)


def _door_geometry(b: Building, o: Opening, leaves: int, leaf_w: float) -> None:
    """Tuerblatt in der Fassadenebene - buendig mit der Schalung ringsum."""
    d = b.dims
    (px, py, _), axis, _, _ = _wall_axis(b, o.wall)
    t = TUERRAHMEN[0]
    # Aussenflaeche der jeweiligen Wand
    face = {"front": d["depth_out"], "rear": 0.0,
            "left": 0.0, "right": d["length_out"]}[o.wall]
    sgn = 1.0 if o.wall in ("front", "right") else -1.0
    for k in range(leaves):
        u0 = o.x0 + 10.0 + k * (leaf_w + 10.0)
        u1 = u0 + leaf_w
        if axis[0]:
            y0, y1 = sorted((face, face - sgn * t))
            verts = _box(px + u0, y0, o.z0, px + u1, y1, o.z0 + o.height)
        else:
            x0, x1 = sorted((face, face - sgn * t))
            verts = _box(x0, py + u0, o.z0, x1, py + u1, o.z0 + o.height)
        b.panels.append(Panel(name=f"{o.name} Fluegel {k + 1}", group="tuerblatt",
                              verts=verts, thickness=t,
                              material="Rahmen + Schalung",
                              area=leaf_w * o.height / 1e6))


# --- Fassade ---------------------------------------------------------------


def _build_cladding(b: Building) -> None:
    d, spec = b.dims, b.spec
    ox, oy = FASSADE_LUFT, FASSADE_LUFT
    fl, fd = d["frame_l"], d["frame_d"]

    walls = [("rear", fl, d["z_plate_top_rear"]),
             ("front", fl, d["z_plate_top_front"]),
             ("left", fd, d["z_plate_top_rear"]),
             ("right", fd, d["z_plate_top_rear"])]
    if spec.closure == "open_front":
        walls = [w for w in walls if w[0] != "front"]

    total_area = 0.0
    for wall, wl, ztop in walls:
        h_mean = ztop - d["z_floor"]
        if wall in ("left", "right"):
            h_mean = (d["z_plate_top_front"] + d["z_plate_top_rear"]) / 2.0 - d["z_floor"]
        area = wl * h_mean / 1e6
        for o in b.openings:
            if o.wall == wall and o.kind != "vent":
                area -= o.width * o.height / 1e6
        total_area += max(area, 0.0)

        # senkrechte Konterlattung im Ständerraster
        for u in raster_positions(wl, RASTER, KONTERLATTE[1]):
            b.members.append(Member(
                "Konterlatte senkrecht", "fassade", KONTERLATTE, h_mean,
                material="Latte 30x50 impraegniert",
                note=f"{wall}: Hinterlueftung 30 mm"))

    _cladding_panels(b)
    b.dims["cladding_area"] = total_area
    # Rhombusleisten: Deckbreite mit 12 mm Fuge
    cover = RHOMBUS[1] + 12.0
    lfm = total_area * 1000.0 / cover * 1000.0 / 1000.0
    b.dims["rhombus_lfm"] = total_area / (cover / 1000.0) if cover else 0.0
    b.panels.append(Panel(name="Fassadenbahn diffusionsoffen", group="folie",
                          verts=[], thickness=0.5,
                          material="Fassadenbahn UV-stabil, 1,5 m breit",
                          area=total_area * 1.15))


def _cladding_panels(b: Building) -> None:
    """Sichtbare Fassadenflaechen (ohne Oeffnungen) fuer die 3D-Darstellung."""
    d, spec = b.dims, b.spec
    L, D = d["length_out"], d["depth_out"]
    z0 = d["z_floor"] - 40.0
    zf, zr = d["z_plate_top_front"], d["z_plate_top_rear"]
    mat = ("Rhombusschalung 20x65" if spec.cladding == "rhombus"
           else "Profilschalung 19 mm")

    def add(name, pts):
        b.panels.append(Panel(name, "fassade_flaeche", list(pts), RHOMBUS[0],
                              mat, kind="poly"))

    # Rueckwand an der Grenze - fensterlos
    add("Fassade Grenzwand",
        [(0, 0, z0), (L, 0, z0), (L, 0, zr), (0, 0, zr)])
    # Seitenwaende als Trapez
    add("Fassade West", [(0, 0, z0), (0, D, z0), (0, D, zf), (0, 0, zr)])
    add("Fassade Ost", [(L, 0, z0), (L, D, z0), (L, D, zf), (L, 0, zr)])

    # Vorderwand: Streifen zwischen und ueber den Oeffnungen
    if spec.closure == "open_front":
        return
    ops = sorted([o for o in b.openings if o.wall == "front" and o.kind != "vent"],
                 key=lambda o: o.x0)
    x = 0.0
    for o in ops:
        a = FASSADE_LUFT + o.x0
        if a - x > 1:
            add("Fassade Sued", [(x, D, z0), (a, D, z0), (a, D, zf), (x, D, zf)])
        zt = o.z0 + o.height
        if zf - zt > 1:
            add("Fassade Sued (Sturz)",
                [(a, D, zt), (a + o.width, D, zt), (a + o.width, D, zf), (a, D, zf)])
        x = a + o.width
    if L - x > 1:
        add("Fassade Sued", [(x, D, z0), (L, D, z0), (L, D, zf), (x, D, zf)])


# --- Innenausbau -----------------------------------------------------------


def _build_interior(b: Building) -> None:
    d, spec = b.dims, b.spec
    ox, oy = FASSADE_LUFT, FASSADE_LUFT
    sw, sh = WAND_STIEL

    if spec.has_tool_room:
        x = d["bike_x1"] + sw / 2
        wl = d["frame_d"] - 2 * sw
        z0, z1 = d["z_floor"], d["z_plate_top_front"]
        for name, zz0, zz1, prof in (
                ("Trennwand: Fussriegel", z0, z0 + 60, (sw, 60.0)),
                ("Trennwand: Raehm", z1 - sh, z1, (sw, sh))):
            m = Member(name, "trennwand", prof, wl)
            m.verts = _box(x - sw / 2, oy + sw, zz0, x + sw / 2, oy + sw + wl, zz1)
            b.members.append(m)
        for u in raster_positions(wl, RASTER, sh):
            m = Member("Trennwand: Ständer", "trennwand", (sw, sh), z1 - sh - z0 - 60)
            m.verts = _box(x - sw / 2, oy + sw + u - sh / 2, z0 + 60,
                           x + sw / 2, oy + sw + u + sh / 2, z1 - sh)
            b.members.append(m)

        for i in range(max(0, spec.tool_shelves)):
            z = d["z_floor"] + 600.0 + i * 500.0
            if z > d["z_plate_top_front"] - 300:
                break
            m = Member(f"Regalboden {i + 1}", "einbau", (18.0, 400.0),
                       d["tool_w"] - 20.0,
                       material="Leimholzplatte Fichte 18 mm",
                       note="auf Latten 30x50 an den Ständern")
            m.verts = _box(d["tool_x0"] + 10, oy + sw, z,
                           d["tool_x1"] - 10, oy + sw + 400, z + 18)
            b.members.append(m)

    # Fahrradhalter: Bodenschiene aus zwei Latten
    if spec.n_bikes > 0:
        for k in range(2):
            y = oy + sw + 300.0 + k * 500.0
            m = Member("Radhalter-Schiene", "einbau", (40.0, 60.0), d["bike_w"],
                       material="Latte 40x60",
                       note="Anschlag fuer versetzte Vorderradhalter")
            m.verts = _box(d["bike_x0"], y, d["z_floor"],
                           d["bike_x1"], y + 60, d["z_floor"] + 40)
            b.members.append(m)

    if spec.with_workbench and spec.has_tool_room:
        m = Member("Werkbankplatte", "einbau", (28.0, 600.0), d["tool_w"] - 20.0,
                   material="Multiplexplatte Buche 28 mm")
        z = d["z_floor"] + 850.0
        m.verts = _box(d["tool_x0"] + 10, oy + sw, z,
                       d["tool_x1"] - 10, oy + sw + 600, z + 28)
        b.members.append(m)
