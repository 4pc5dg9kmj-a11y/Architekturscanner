"""Werkzeichnungen: Grundriss, Ansichten, Schnitt, Details, Lageplan.

Alle Zeichnungen entstehen als Liste einfacher Entitaeten in
Millimeter-Weltkoordinaten. Dieselben Daten speisen den PDF-Satz, die
2D-Ansicht im Browser und den DXF-Export - damit koennen die Darstellungen
nicht auseinanderlaufen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .model import Building
from .spec import (
    DACHLATTE,
    DACH_UEBERSTAND_ORT,
    DACH_UEBERSTAND_TRAUFE,
    FAHRRAD_BREITE_HOCH,
    FAHRRAD_BREITE_TIEF,
    FAHRRAD_LAENGE,
    FASSADE_LUFT,
    KONTERLATTE,
    RHOMBUS,
    SCHWELLE,
    WAND_STIEL,
)

def nz(value: float, dec: int = 2) -> str:
    """Zahl in deutscher Schreibweise mit Komma."""
    return f"{value:.{dec}f}".replace(".", ",")


# Layer -> (Linienstaerke mm, Farbe, Strichart)
LAYERS = {
    "schnitt":    (0.70, "#111111", "solid"),
    "sicht":      (0.35, "#333333", "solid"),
    "detail":     (0.20, "#666666", "solid"),
    "hilfslinie": (0.15, "#999999", "dash"),
    "achse":      (0.15, "#c0392b", "dashdot"),
    "bemassung":  (0.18, "#0b6ea8", "solid"),
    "moebel":     (0.25, "#2e7d5b", "solid"),
    "grenze":     (0.50, "#c0392b", "dashdot"),
    "text":       (0.18, "#111111", "solid"),
}


@dataclass
class Ent:
    kind: str                       # line | poly | circle | text | dim | hatch
    pts: list[tuple[float, float]] = field(default_factory=list)
    layer: str = "sicht"
    text: str = ""
    size: float = 2.5               # Texthoehe in mm auf dem Papier
    angle: float = 0.0
    closed: bool = False
    align: str = "center"

    def to_dict(self) -> dict:
        return {"kind": self.kind, "pts": [[round(p[0], 2), round(p[1], 2)] for p in self.pts],
                "layer": self.layer, "text": self.text, "size": self.size,
                "angle": self.angle, "closed": self.closed, "align": self.align}


@dataclass
class Drawing:
    key: str
    title: str
    subtitle: str = ""
    scale: int = 25                 # Nenner: 1:25
    ents: list[Ent] = field(default_factory=list)

    # -- Zeichenprimitive ---------------------------------------------------
    def line(self, x0, y0, x1, y1, layer="sicht") -> None:
        self.ents.append(Ent("line", [(x0, y0), (x1, y1)], layer))

    def poly(self, pts, layer="sicht", closed=False) -> None:
        self.ents.append(Ent("poly", list(pts), layer, closed=closed))

    def rect(self, x0, y0, x1, y1, layer="sicht") -> None:
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], layer, closed=True)

    def hatch(self, x0, y0, x1, y1, layer="detail") -> None:
        self.ents.append(Ent("hatch", [(x0, y0), (x1, y1)], layer))

    def circle(self, cx, cy, r, layer="sicht") -> None:
        self.ents.append(Ent("circle", [(cx, cy), (r, 0)], layer))

    def text(self, x, y, s, size=2.5, layer="text", angle=0.0, align="center") -> None:
        self.ents.append(Ent("text", [(x, y)], layer, s, size, angle, align=align))

    def dim(self, x0, y0, x1, y1, offset, label=None, layer="bemassung") -> None:
        """Masskette zwischen zwei Punkten, ``offset`` senkrecht dazu."""
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy)
        if ln < 1e-6:
            return
        nx, ny = -dy / ln, dx / ln
        ax, ay = x0 + nx * offset, y0 + ny * offset
        bx, by = x1 + nx * offset, y1 + ny * offset
        ext = 0.12 * abs(offset) if offset else 0.0
        self.line(x0 + nx * ext, y0 + ny * ext, ax + nx * ext * 1.6, ay + ny * ext * 1.6, layer)
        self.line(x1 + nx * ext, y1 + ny * ext, bx + nx * ext * 1.6, by + ny * ext * 1.6, layer)
        self.ents.append(Ent("dim", [(ax, ay), (bx, by)], layer,
                             label or f"{ln:.0f}"))

    def dim_h(self, x0: float, x1: float, y: float, off: float,
              label=None) -> None:
        """Waagerechte Masskette. ``off`` > 0 legt sie oberhalb von ``y``."""
        self.dim(x0, y, x1, y, off, label)

    def dim_v(self, z0: float, z1: float, x: float, off: float,
              label=None) -> None:
        """Senkrechte Masskette. ``off`` > 0 legt sie rechts von ``x``."""
        self.dim(x, z0, x, z1, -off, label)

    def dim_chain(self, points, y, horizontal=True, layer="bemassung") -> None:
        """Fortlaufende Masskette entlang einer Achse."""
        pts = sorted(set(round(p, 1) for p in points))
        for a, b in zip(pts, pts[1:]):
            if horizontal:
                self.dim(a, y, b, y, 0, layer=layer)
            else:
                self.dim(y, a, y, b, 0, layer=layer)

    def bounds(self) -> tuple[float, float, float, float]:
        xs, ys = [], []
        for e in self.ents:
            for p in e.pts if e.kind != "circle" else [e.pts[0]]:
                xs.append(p[0])
                ys.append(p[1])
            if e.kind == "circle":
                r = e.pts[1][0]
                xs += [e.pts[0][0] - r, e.pts[0][0] + r]
                ys += [e.pts[0][1] - r, e.pts[0][1] + r]
        if not xs:
            return (0, 0, 1000, 1000)
        return (min(xs), min(ys), max(xs), max(ys))

    def to_dict(self) -> dict:
        x0, y0, x1, y1 = self.bounds()
        return {"key": self.key, "title": self.title, "subtitle": self.subtitle,
                "scale": self.scale, "bounds": [x0, y0, x1, y1],
                "ents": [e.to_dict() for e in self.ents]}


# ---------------------------------------------------------------------------
# Projektionen
# ---------------------------------------------------------------------------


def _members_in_plan(b: Building, z: float) -> list[tuple[float, float, float, float]]:
    """Alle Hoelzer, die eine waagerechte Schnittebene in ``z`` durchdringen."""
    out = []
    for m in b.members:
        if not m.verts:
            continue
        zs = [v[2] for v in m.verts]
        if min(zs) - 1 <= z <= max(zs) + 1:
            xs = [v[0] for v in m.verts]
            ys = [v[1] for v in m.verts]
            out.append((min(xs), min(ys), max(xs), max(ys)))
    return out


def plan(b: Building) -> Drawing:
    """Grundriss, waagerechter Schnitt 1,20 m ueber Fussboden."""
    d, spec = b.dims, b.spec
    dr = Drawing("grundriss", "Grundriss", "Schnittebene 1,20 m ueber OKFF", 25)
    z_cut = d["z_floor"] + 1200.0
    L, D = d["length_out"], d["depth_out"]

    # Dachumriss
    dr.rect(-DACH_UEBERSTAND_ORT, -0.0, L + DACH_UEBERSTAND_ORT,
            D + DACH_UEBERSTAND_TRAUFE, "hilfslinie")
    dr.text(-DACH_UEBERSTAND_ORT, D + DACH_UEBERSTAND_TRAUFE + 60,
            "Dachkante mit Ueberstand", 2.0, "text", align="left")

    # Grundstuecksgrenze
    dr.line(-500, -120, L + 500, -120, "grenze")
    dr.text(L / 2, -230, "GRUNDSTUECKSGRENZE - Wand buendig, kein Ueberstand", 2.6, "grenze")

    # Aussenkontur Beplankung
    dr.rect(0, 0, L, D, "schnitt")

    # geschnittene Hoelzer
    for x0, y0, x1, y1 in _members_in_plan(b, z_cut):
        dr.rect(x0, y0, x1, y1, "schnitt")
        dr.hatch(x0, y0, x1, y1)

    # Oeffnungen in der Vorderwand freistellen
    y_front0, y_front1 = D - FASSADE_LUFT - WAND_STIEL[0], D
    for o in b.openings:
        if o.wall != "front" or o.kind == "vent":
            continue
        x0 = FASSADE_LUFT + o.x0
        x1 = x0 + o.width
        dr.rect(x0, y_front0, x1, y_front1, "hilfslinie")
        _door_swing(dr, o, x0, x1, y_front0)

    # Nutzungsbereiche
    _plan_bikes(dr, b)
    if spec.has_tool_room:
        cx = (d["tool_x0"] + d["tool_x1"]) / 2
        cy = D / 2
        dr.text(cx, cy + 120, "GERAETERAUM", 3.0, "text")
        dr.text(cx, cy - 60, f"{nz(d['tool_w'] / 1000)} x {nz(d['inner_d'] / 1000)} m", 2.4, "text")
        dr.text(cx, cy - 220, f"{nz(d['tool_w'] * d['inner_d'] / 1e6)} m2", 2.2, "text")
        for i in range(spec.tool_shelves):
            yy = FASSADE_LUFT + WAND_STIEL[0] + 20
            dr.rect(d["tool_x0"] + 10, yy, d["tool_x1"] - 10, yy + 400, "moebel")
        if spec.tool_shelves:
            dr.text(cx, FASSADE_LUFT + WAND_STIEL[0] + 200, "Regal 40 cm", 2.0, "moebel")

    # Ständerachsen
    for m in b.members:
        if "Ständer" in m.name and m.verts:
            xs = [v[0] for v in m.verts]
            ys = [v[1] for v in m.verts]
            if max(xs) - min(xs) < 200 and min([v[2] for v in m.verts]) < z_cut:
                pass

    # Bemassung
    _plan_dims(dr, b)

    # Schnittlinie A-A
    xa = d["bike_x0"] + d["bike_w"] * 0.35
    dr.line(xa, -400, xa, D + 500, "achse")
    dr.text(xa, -460, "A", 3.5, "achse")
    dr.text(xa, D + 560, "A", 3.5, "achse")

    dr.text(L / 2, D + DACH_UEBERSTAND_TRAUFE + 1250,
            "TRAUFE / ZUGANGSSEITE - Dachrinne, Gefaelle von der Grenze weg",
            2.8, "text")
    return dr


def _door_swing(dr: Drawing, o, x0: float, x1: float, y_wall: float) -> None:
    leaves = 2 if "2-fluegelig" in o.name else 1
    w = (x1 - x0) / leaves
    for k in range(leaves):
        hx = x0 + k * w if k == 0 else x1
        sign = 1 if k == 0 else -1
        dr.line(hx, y_wall, hx + sign * w, y_wall + w * 0.02, "detail")
        # Oeffnungsviertelkreis
        pts = []
        for i in range(13):
            a = math.radians(90 * i / 12)
            pts.append((hx + sign * w * math.cos(a), y_wall + w * math.sin(a)))
        dr.poly(pts, "hilfslinie")
        dr.line(hx, y_wall, hx, y_wall + w, "detail")


def _plan_bikes(dr: Drawing, b: Building) -> None:
    d, spec = b.dims, b.spec
    if spec.n_bikes <= 0:
        return
    y0 = FASSADE_LUFT + WAND_STIEL[0] + 60
    pitch = (FAHRRAD_BREITE_HOCH + FAHRRAD_BREITE_TIEF) / 2.0
    x = d["bike_x0"] + 50 + pitch / 2
    for i in range(spec.n_bikes):
        offset = 0.0 if i % 2 == 0 else 180.0
        _bike(dr, x, y0 + offset)
        x += pitch
    cx = (d["bike_x0"] + d["bike_x1"]) / 2
    dr.text(cx, d["depth_out"] - 700, f"{spec.n_bikes} FAHRRAEDER", 3.0, "text")
    dr.text(cx, d["depth_out"] - 860,
            f"versetzt, Achsabstand {pitch:.0f} mm", 2.2, "text")


def _bike(dr: Drawing, cx: float, y0: float) -> None:
    r = 340.0
    wheel = r / 2
    dr.circle(cx, y0 + wheel, wheel, "moebel")
    dr.circle(cx, y0 + FAHRRAD_LAENGE - wheel, wheel, "moebel")
    dr.line(cx, y0 + wheel, cx, y0 + FAHRRAD_LAENGE - wheel, "moebel")
    dr.line(cx - 260, y0 + FAHRRAD_LAENGE - 120, cx + 260, y0 + FAHRRAD_LAENGE - 120, "moebel")
    dr.line(cx - 120, y0 + 620, cx + 120, y0 + 620, "moebel")


def _plan_dims(dr: Drawing, b: Building) -> None:
    d = b.dims
    L, D = d["length_out"], d["depth_out"]
    # Gesamtmasse
    dr.dim_h(0, L, D, 900, f"{L:.0f}")
    dr.dim_v(0, D, L, 900, f"{D:.0f}")
    # Teilmasse Laengsrichtung
    stations = [0.0, d["bike_x0"], d["bike_x1"]]
    if d["partition_t"]:
        stations += [d["tool_x0"], d["tool_x1"]]
    stations.append(L)
    for a, bx in zip(stations, stations[1:]):
        if bx - a > 1:
            dr.dim(a, D, bx, D, 520)
    # Oeffnungen
    ops = sorted([o for o in b.openings if o.wall == "front" and o.kind != "vent"],
                 key=lambda o: o.x0)
    for o in ops:
        x0 = FASSADE_LUFT + o.x0
        dr.dim(x0, D, x0 + o.width, D, 200, f"{o.width:.0f}")
    # lichte Tiefe links neben dem Gebaeude (Gesamttiefe steht rechts)
    yi0 = FASSADE_LUFT + WAND_STIEL[0]
    dr.dim_v(yi0, D - yi0, 0, -260, f"{d['inner_d']:.0f} lichte Tiefe")


def elevation(b: Building, side: str) -> Drawing:
    """Ansicht. ``side`` in front|rear|left|right."""
    d, spec = b.dims, b.spec
    L, D = d["length_out"], d["depth_out"]
    titles = {"front": ("Ansicht Sued - Traufseite (Zugang)", "Zugangsseite mit Tueren"),
              "rear": ("Ansicht Nord - Grenzwand (Firstseite)", "geschlossene Wand an der Grundstuecksgrenze"),
              "left": ("Ansicht West - links", "Pultdachneigung"),
              "right": ("Ansicht Ost - rechts", "Pultdachneigung")}
    dr = Drawing(f"ansicht_{side}", titles[side][0], titles[side][1], 25)

    z_f, z_r = d["z_roof_front"], d["z_roof_rear"]
    zt_f, zt_r = d["z_plate_top_front"], d["z_plate_top_rear"]

    if side in ("front", "rear"):
        w = L
        mirror = side == "rear"
        z_top = z_r if side == "rear" else z_f
        z_plate = zt_r if side == "rear" else zt_f

        def X(x):
            return (w - x) if mirror else x

        # Gelaende
        dr.line(-700, 0, w + 700, 0, "schnitt")
        for i in range(int((w + 1400) // 200)):
            xx = -700 + i * 200
            dr.line(xx, 0, xx - 90, -90, "detail")
        # Wandflaeche
        dr.rect(X(0), 0, X(w), z_plate, "sicht")
        # sichtbarer Dachrand: Sparrenkopf, Traufbohle und Blechkante
        a = X(-DACH_UEBERSTAND_ORT)
        c = X(w + DACH_UEBERSTAND_ORT)
        dr.rect(min(a, c), z_plate, max(a, c), z_top, "schnitt")
        dr.line(min(a, c), z_top - 30, max(a, c), z_top - 30, "detail")
        # Fassadenstruktur
        _cladding_lines(dr, X(0), X(w), 0, z_plate)
        # Oeffnungen
        for o in b.openings:
            if o.wall != side:
                continue
            x0, x1 = X(FASSADE_LUFT + o.x0), X(FASSADE_LUFT + o.x0 + o.width)
            x0, x1 = min(x0, x1), max(x0, x1)
            if o.kind == "vent":
                dr.rect(x0, o.z0, x1, o.z0 + o.height, "detail")
                continue
            dr.rect(x0, o.z0, x1, o.z0 + o.height, "schnitt")
            leaves = 2 if "2-fluegelig" in o.name else 1
            for k in range(1, leaves):
                xm = x0 + (x1 - x0) * k / leaves
                dr.line(xm, o.z0, xm, o.z0 + o.height, "sicht")
            for k in range(leaves):
                a = x0 + (x1 - x0) * k / leaves
                bx = x0 + (x1 - x0) * (k + 1) / leaves
                dr.line(a + 40, o.z0 + 40, bx - 40, o.z0 + o.height - 40, "detail")
            dr.text((x0 + x1) / 2, o.z0 + o.height + 90,
                    f"{o.name} {o.width:.0f}x{o.height:.0f}", 2.2, "text")
        if side == "front" and spec.with_gutter:
            dr.line(-DACH_UEBERSTAND_ORT, z_top - 130, w + DACH_UEBERSTAND_ORT,
                    z_top - 130, "detail")
            dr.text(w + 200, z_top - 260, "Rinne NW 100", 2.2, "text")
        if side == "rear":
            dr.line(-300, 0, -300, z_top + 300, "grenze")
            dr.text(-300, z_top + 420, "GRENZE", 2.6, "grenze")
        # Bemassung: Laenge unter dem Gebaeude, Hoehen rechts daneben
        x_l, x_r = min(X(0), X(w)), max(X(0), X(w))
        dr.dim_h(x_l, x_r, 0, -700, f"{w:.0f}")
        dr.dim_v(0, z_top, x_r, 900, f"{z_top:.0f}")
        dr.dim_v(0, z_plate, x_r, 450, f"{z_plate:.0f}")

    else:
        # Seitenansichten: sx = y (rechts) bzw. -y (links)
        sgn = 1.0 if side == "right" else -1.0

        def X(y):
            return sgn * y

        dr.line(X(-800), 0, X(D + 900), 0, "schnitt")
        # Wandflaeche trapezfoermig
        dr.poly([(X(0), 0), (X(D), 0), (X(D), zt_f), (X(0), zt_r)], "sicht", closed=True)
        _cladding_lines(dr, min(X(0), X(D)), max(X(0), X(D)), 0, zt_f)
        # Dachhaut mit Ueberstand
        dr.poly([(X(0), z_r), (X(D + DACH_UEBERSTAND_TRAUFE), z_f - DACH_UEBERSTAND_TRAUFE
                               * math.tan(d["pitch_rad"])),
                 (X(D + DACH_UEBERSTAND_TRAUFE), z_f - DACH_UEBERSTAND_TRAUFE
                  * math.tan(d["pitch_rad"]) - 70),
                 (X(0), z_r - 70)], "schnitt", closed=True)
        # Grenze
        dr.line(X(0) - sgn * 120, -200, X(0) - sgn * 120, z_r + 400, "grenze")
        dr.text(X(0) - sgn * 120, z_r + 520, "GRENZE", 2.6, "grenze")
        for o in b.openings:
            if o.wall != side:
                continue
            a = X(FASSADE_LUFT + WAND_STIEL[0] + o.x0)
            c = X(FASSADE_LUFT + WAND_STIEL[0] + o.x0 + o.width)
            dr.rect(min(a, c), o.z0, max(a, c), o.z0 + o.height,
                    "detail" if o.kind == "vent" else "schnitt")
        # Neigungspfeil
        xm = X(D / 2)
        dr.text(xm, (z_r + z_f) / 2 + 260, f"Pultdach {spec.roof_pitch:.0f} Grad",
                2.6, "text")
        x_l = min(X(0), X(D + DACH_UEBERSTAND_TRAUFE))
        x_r = max(X(0), X(D + DACH_UEBERSTAND_TRAUFE))
        dr.dim_h(x_l, x_r, 0, -700, f"{D:.0f}")
        dr.dim_v(0, z_f if sgn > 0 else z_r, x_r, 500,
                 f"{(z_f if sgn > 0 else z_r):.0f}")
        dr.dim_v(0, z_r if sgn > 0 else z_f, x_l, -500,
                 f"{(z_r if sgn > 0 else z_f):.0f}")
    return dr


def _cladding_lines(dr: Drawing, x0: float, x1: float, z0: float, z1: float) -> None:
    cover = RHOMBUS[1] + 12.0
    z = z0 + cover
    while z < z1 - 20:
        dr.line(x0, z, x1, z, "detail")
        z += cover


def section(b: Building) -> Drawing:
    """Schnitt A-A quer durch den Fahrradteil, Blick nach Osten."""
    d, spec = b.dims, b.spec
    dr = Drawing("schnitt_aa", "Schnitt A-A", "Aufbau vom Fundament bis zur Dachhaut", 20)
    D = d["depth_out"]
    fd = d["frame_d"]
    off = FASSADE_LUFT
    pitch = d["pitch_rad"]

    # Gelaende / Gruendung
    dr.line(-900, 0, D + 1100, 0, "schnitt")
    for p in b.panels:
        if p.group != "fundament":
            continue
        ys = [v[1] for v in p.verts]
        zs = [v[2] for v in p.verts]
        xs = [v[0] for v in p.verts]
        if not (min(xs) < d["bike_x0"] + 600 < max(xs)):
            continue
        dr.rect(min(ys), min(zs), max(ys), max(zs), "schnitt")
        dr.hatch(min(ys), min(zs), max(ys), max(zs))
    dr.rect(off - 150, -150, off + fd + 150, 0, "hilfslinie")
    # Lastweg-Achse: Sparren, Staender und Deckenbalken stehen uebereinander
    dr.line(off + WAND_STIEL[0] / 2, -300, off + WAND_STIEL[0] / 2,
            d["z_roof_rear"] + 200, "achse")
    dr.line(off + fd - WAND_STIEL[0] / 2, -300, off + fd - WAND_STIEL[0] / 2,
            d["z_roof_front"] + 200, "achse")
    dr.text((off + fd / 2), -230, "Schotter 0/32, ca. 15 cm - Splittbett 5 cm - Unkrautvlies",
            2.2, "text")

    # Schwellen (liegend, geschnitten) und Deckenbalken (laengs, in Ansicht)
    z_sill = d["z_sill_top"]
    for yc in (off + SCHWELLE[1] / 2, off + fd / 2, off + fd - SCHWELLE[1] / 2):
        dr.rect(yc - SCHWELLE[1] / 2, 0, yc + SCHWELLE[1] / 2, z_sill, "schnitt")
        dr.hatch(yc - SCHWELLE[1] / 2, 0, yc + SCHWELLE[1] / 2, z_sill)
    dr.text(off + fd + 220, z_sill / 2,
            f"Schwelle {SCHWELLE[1]:.0f}x{SCHWELLE[0]:.0f} kdi, liegend",
            2.2, "text", align="left")
    jb, jh = d["joist"]
    dr.rect(off, z_sill, off + fd, z_sill + jh, "sicht")
    dr.text(off + fd + 220, z_sill + jh / 2,
            f"Deckenbalken {jb:.0f}x{jh:.0f}, e = {d['e_axis']:.0f} mm",
            2.2, "text", align="left")

    # Boden
    if spec.with_floor:
        dr.rect(off, d["z_rost_top"], off + fd, d["z_floor"], "schnitt")
        dr.text(off + fd + 220, d["z_floor"], "OSB/3 22 mm N+F", 2.2, "text", align="left")

    # Waende geschnitten (vorne und hinten)
    for y0, ztop, tag in ((off, d["z_plate_top_rear"], "Grenzwand"),
                          (off + fd - WAND_STIEL[0], d["z_plate_top_front"], "Traufwand")):
        dr.rect(y0, d["z_floor"], y0 + WAND_STIEL[0], ztop, "schnitt")
        dr.hatch(y0, d["z_floor"], y0 + WAND_STIEL[0], ztop)
    # Fassadenaufbau
    for y0, sgn in ((off, -1.0), (off + fd, 1.0)):
        a = y0 + sgn * 0
        dr.rect(min(a, a + sgn * KONTERLATTE[0]), d["z_floor"],
                max(a, a + sgn * KONTERLATTE[0]), d["z_plate_top_front"], "detail")
        bxx = a + sgn * KONTERLATTE[0]
        dr.rect(min(bxx, bxx + sgn * RHOMBUS[0]), d["z_floor"],
                max(bxx, bxx + sgn * RHOMBUS[0]), d["z_plate_top_front"], "detail")

    # Sparren im Schnitt
    sh = d["sparren"][1]
    y_a, z_a = off, d["z_plate_top_rear"]
    y_b = off + fd + DACH_UEBERSTAND_TRAUFE
    z_b = z_a - (fd + DACH_UEBERSTAND_TRAUFE) * math.tan(pitch)
    nx, nz = math.sin(pitch), math.cos(pitch)
    dr.poly([(y_a, z_a), (y_b, z_b), (y_b + nx * sh, z_b + nz * sh),
             (y_a + nx * sh, z_a + nz * sh)], "schnitt", closed=True)
    # Lattung + Dachhaut
    t_l = DACHLATTE[0]
    t_h = 20.0
    for t0, t1, lay in ((sh, sh + t_l, "detail"), (sh + t_l, sh + t_l + t_h, "schnitt")):
        dr.poly([(y_a + nx * t0, z_a + nz * t0), (y_b + nx * t0, z_b + nz * t0),
                 (y_b + nx * t1, z_b + nz * t1), (y_a + nx * t1, z_a + nz * t1)],
                lay, closed=True)

    dr.text(off + fd * 0.45, z_a - fd * 0.45 * math.tan(pitch) + sh + 420,
            f"Trapezblech auf Traglattung 40x60, Sparren "
            f"{d['sparren'][0]:.0f}x{sh:.0f}, e = {d['e_axis']:.0f} mm",
            2.3, "text")

    # lichte Hoehen
    dr.dim(off + WAND_STIEL[0] + 40, d["z_floor"], off + WAND_STIEL[0] + 40,
           d["z_plate_bottom_front"] + d["rise"], 0, f"{d['clear_height_rear']:.0f} lichte H.")
    dr.dim(off + fd - WAND_STIEL[0] - 40, d["z_floor"], off + fd - WAND_STIEL[0] - 40,
           d["z_plate_bottom_front"], 0, f"{spec.eaves_height:.0f} lichte H.")
    # Gesamthoehen
    dr.dim(off + fd + 700, 0, off + fd + 700, d["z_roof_front"], 0, f"{d['z_roof_front']:.0f}")
    dr.dim(off - 700, 0, off - 700, d["z_roof_rear"], 0, f"{d['z_roof_rear']:.0f}")
    dr.dim(off, -900, off + fd, -900, 0, f"{fd:.0f}")

    # Grenze
    dr.line(-120, -300, -120, d["z_roof_rear"] + 500, "grenze")
    dr.text(-120, d["z_roof_rear"] + 620, "GRUNDSTUECKSGRENZE", 2.6, "grenze")
    dr.text(off + fd + 500, d["z_roof_front"] - 400,
            "Gefaelle von der Grenze weg", 2.3, "text", align="left")
    return dr


def framing(b: Building, wall: str) -> Drawing:
    """Ständerwerk-Aufriss einer Wand mit allen Zuschnittmassen."""
    d = b.dims
    names = {"front": "Traufwand (Sued, Zugang)", "rear": "Grenzwand (Nord)",
             "left": "Seitenwand West", "right": "Seitenwand Ost"}
    dr = Drawing(f"riegel_{wall}", f"Ständerwerk {names[wall]}",
                 "Zuschnitt und Achsmasse - Wand liegend vormontieren", 25)
    grp = f"wand_{wall}"
    horiz = wall in ("front", "rear")

    for m in b.members:
        if m.group != grp or not m.verts:
            continue
        xs = [v[0] for v in m.verts]
        ys = [v[1] for v in m.verts]
        zs = [v[2] for v in m.verts]
        a0 = min(xs) if horiz else min(ys)
        a1 = max(xs) if horiz else max(ys)
        dr.rect(a0, min(zs), a1, max(zs), "sicht")
        if max(zs) - min(zs) > 400:
            dr.text((a0 + a1) / 2, (min(zs) + max(zs)) / 2, f"{m.length:.0f}",
                    2.0, "text", angle=90)
        elif a1 - a0 > 500:
            dr.text((a0 + a1) / 2, (min(zs) + max(zs)) / 2 - 10, f"{m.length:.0f}",
                    2.0, "text")

    for o in b.openings:
        if o.wall != wall:
            continue
        a0 = FASSADE_LUFT + o.x0 if horiz else FASSADE_LUFT + WAND_STIEL[0] + o.x0
        dr.rect(a0, o.z0, a0 + o.width, o.z0 + o.height, "hilfslinie")
        dr.text(a0 + o.width / 2, o.z0 + o.height / 2, o.name, 2.4, "text")

    axes = []
    for m in b.members:
        if m.group == grp and "ständer" in m.name.lower() and m.verts:
            xs = [v[0] for v in m.verts] if horiz else [v[1] for v in m.verts]
            axes.append((min(xs) + max(xs)) / 2)
    zs_all = [v[2] for m in b.members if m.group == grp for v in m.verts]
    if axes and zs_all:
        z0 = min(zs_all)
        dr.dim_chain(axes, z0 - 500)
        dr.dim(min(axes) - WAND_STIEL[1] / 2, z0 - 900,
               max(axes) + WAND_STIEL[1] / 2, z0 - 900, 0)
    return dr


def roof_plan(b: Building) -> Drawing:
    d = b.dims
    dr = Drawing("dachplan", "Sparrenplan / Dachaufsicht",
                 "Sparrenlage, Traglattung und Blechteilung", 25)
    L = d["length_out"]
    fd = d["frame_d"]
    dr.rect(-DACH_UEBERSTAND_ORT, 0.0, L + DACH_UEBERSTAND_ORT,
            d["roof_run"], "schnitt")
    dr.rect(0, 0, L, d["depth_out"], "hilfslinie")

    sw, sh = d["sparren"]
    for m in b.members:
        if m.name not in ("Sparren", "Aussensparren") or not m.verts:
            continue
        xs = [v[0] for v in m.verts]
        ys = [v[1] for v in m.verts]
        dr.rect(min(xs), min(ys), max(xs), max(ys), "sicht")
    axes = sorted({round((min(v[0] for v in m.verts) + max(v[0] for v in m.verts)) / 2, 1)
                   for m in b.members if m.name in ("Sparren", "Aussensparren") and m.verts})
    dr.dim_chain(axes, -450)
    if axes:
        dr.dim(axes[0], -850, axes[-1], -850, 0)

    # Traglattung
    for m in b.members:
        if m.name != "Traglatte" or not m.verts:
            continue
        ys = [v[1] for v in m.verts]
        dr.line(-DACH_UEBERSTAND_ORT, min(ys), L + DACH_UEBERSTAND_ORT, min(ys), "detail")

    # Blechteilung
    n = math.ceil(d["roof_w"] / 1000.0)
    for i in range(1, n):
        x = -DACH_UEBERSTAND_ORT + i * 1000.0
        if x < L + DACH_UEBERSTAND_ORT:
            dr.line(x, 0, x, d["roof_run"], "achse")
    dr.text(L / 2, d["roof_run"] + 400,
            f"{n} Trapezbleche a 1,00 m Nutzbreite, Laenge "
            f"{d['roof_slope_len'] + 100:.0f} mm, 100 mm Ueberlappung an der Traufe",
            2.4, "text")
    dr.text(L / 2, -1200, "Grundstuecksgrenze - Dach buendig, kein Ueberstand", 2.6, "grenze")
    dr.line(-500, -1050, L + 500, -1050, "grenze")
    return dr


def foundation_plan(b: Building) -> Drawing:
    d = b.dims
    dr = Drawing("fundament", "Gruendungsplan", "Lage und Hoehe der Auflager", 25)
    L, D = d["length_out"], d["depth_out"]
    dr.rect(0, 0, L, D, "hilfslinie")
    xs_set, ys_set = set(), set()
    for p in b.panels:
        if p.group != "fundament":
            continue
        xs = [v[0] for v in p.verts]
        ys = [v[1] for v in p.verts]
        dr.rect(min(xs), min(ys), max(xs), max(ys), "schnitt")
        dr.hatch(min(xs), min(ys), max(xs), max(ys))
        xs_set.add(round((min(xs) + max(xs)) / 2, 1))
        ys_set.add(round((min(ys) + max(ys)) / 2, 1))
    # Rost darueber
    for m in b.by_group("rost"):
        xs = [v[0] for v in m.verts]
        ys = [v[1] for v in m.verts]
        dr.rect(min(xs), min(ys), max(xs), max(ys), "sicht")
    if xs_set:
        dr.dim_chain(sorted(xs_set), -450)
        dr.dim(0, -900, L, -900, 0, f"{L:.0f}")
    if ys_set:
        dr.dim_chain(sorted(ys_set), -450, horizontal=False)
    dr.line(-500, -120, L + 500, -120, "grenze")
    dr.text(L / 2, -230, "GRUNDSTUECKSGRENZE", 2.6, "grenze")
    dr.text(L / 2, D + 400,
            "Alle Platten in einer Ebene - Wasserwaage ueber Richtscheit pruefen "
            "(Toleranz max. 5 mm auf die Gesamtlaenge)", 2.3, "text")
    return dr


def site_plan(b: Building) -> Drawing:
    """Lageplan-Schema mit Grenzabstaenden - Beilage fuer die eigenen Unterlagen."""
    d = b.dims
    dr = Drawing("lageplan", "Lageplan (Schema)",
                 "Grenzstaendige Errichtung nach § 6 Abs. 8 HBO", 50)
    L, D = d["length_out"], d["depth_out"]

    dr.line(-1200, 0, L + 1200, 0, "grenze")
    dr.text(L / 2, -420, "GRUNDSTUECKSGRENZE ZUM NACHBARN", 2.6, "grenze")
    dr.text(L / 2, -800, "Nachbargrundstueck", 2.2, "text")

    dr.rect(0, 0, L, D, "schnitt")
    dr.hatch(0, 0, L, D)
    dr.text(L / 2, D / 2 + 150, "FAHRRADHAEUSCHEN", 2.8, "text")
    dr.text(L / 2, D / 2 - 120, f"{nz(L / 1000)} x {nz(D / 1000)} m", 2.2, "text")
    dr.text(L / 2, D / 2 - 350, f"{nz(d['bri'])} m3 Brutto-Rauminhalt", 2.0, "text")

    dr.dim_h(0, L, D, 900, f"{nz(L / 1000)} m an der Grenze")
    dr.dim_v(0, D, L, 700, f"{nz(D / 1000)} m")

    dr.text(L / 2, D + 1700, "eigenes Grundstueck / Garten", 2.4, "text")
    dr.text(L / 2, D + 1400,
            "Traufe mit Rinne - Ablauf ins eigene Grundstueck", 2.0, "text")
    dr.text(0, D + 2200,
            "Massstab und Nordpfeil im amtlichen Lageplan ergaenzen", 1.8,
            "text", align="left")
    return dr


def detail_drawings(b: Building) -> list[Drawing]:
    """Konstruktionsdetails im Massstab 1:5."""
    d = b.dims
    out: list[Drawing] = []

    # Detail 1: Fusspunkt - die Auflagerkette im Massstab 1:5
    jb, jh = d["joist"]
    dr = Drawing("detail_fuss", "Detail 1 - Fusspunkt: Auflagerkette",
                 "M 1:5 - jedes Holz liegt auf dem darunter auf", 5)
    dr.rect(-220, -50, 220, 0, "schnitt"); dr.hatch(-220, -50, 220, 0)
    dr.text(250, -25, "Gehwegplatte 40x40x5 auf Splitt -\nunter jeder Balkenachse",
            2.4, "text", align="left")
    dr.rect(-60, 0, 60, 4, "detail")
    dr.text(250, 8, "Bitumen-Trennlage", 2.4, "text", align="left")
    z = 4.0
    dr.rect(-60, z, 60, z + SCHWELLE[0], "schnitt")
    dr.hatch(-60, z, 60, z + SCHWELLE[0])
    dr.text(250, z + SCHWELLE[0] / 2,
            f"Schwelle {SCHWELLE[1]:.0f}x{SCHWELLE[0]:.0f} kdi, liegend",
            2.4, "text", align="left")
    z += SCHWELLE[0]
    dr.rect(-jb / 2, z, jb / 2, z + jh, "schnitt")
    dr.hatch(-jb / 2, z, jb / 2, z + jh)
    dr.text(250, z + jh / 2, f"Deckenbalken {jb:.0f}x{jh:.0f}\nliegt auf - nicht eingehaengt",
            2.4, "text", align="left")
    dr.line(-jb / 2 - 20, z, -140, z, "achse")
    dr.text(-150, z - 10, "Querdruck-Auflager,\nvolle Schwellenbreite",
            2.2, "text", align="right")
    z += jh
    dr.rect(-jb / 2 - 60, z, jb / 2 + 60, z + 22, "schnitt")
    dr.text(250, z + 11, "Bodenplatte OSB/3 22 mm", 2.4, "text", align="left")
    z += 22
    dr.rect(-30, z, 30, z + 60, "schnitt"); dr.hatch(-30, z, 30, z + 60)
    dr.text(250, z + 30, "Fussriegel 60x60", 2.4, "text", align="left")
    z += 60
    dr.rect(-30, z, 30, z + 380, "schnitt")
    dr.text(250, z + 200, "Staender 60x120 -\nsteht ueber dem Deckenbalken",
            2.4, "text", align="left")
    dr.line(-30, z + 40, -140, z + 40, "achse")
    dr.text(-150, z + 40, "Winkelverbinder 90x90\n+ Ankerschrauben 5x40",
            2.2, "text", align="right")
    dr.line(0, -120, 0, z + 420, "achse")
    dr.text(0, -200, "LASTACHSE", 2.6, "achse")
    dr.text(-260, -330, "Holz mindestens 100 mm ueber Gelaende halten - "
            "Spritzwasserschutz", 2.4, "text", align="left")
    out.append(dr)

    # Detail 2: Traufpunkt
    dr = Drawing("detail_traufe", "Detail 2 - Traufpunkt mit Rinne", "M 1:5", 5)
    pitch = d["pitch_rad"]
    sh = d["sparren"][1]
    dr.rect(-60, -400, 0, 0, "schnitt"); dr.hatch(-60, -400, 0, 0)
    dr.text(-70, -220, "Ständer 60x120", 2.4, "text", align="right")
    dr.rect(-60, 0, 0, 120, "schnitt"); dr.hatch(-60, 0, 0, 120)
    dr.text(-70, 60, "Raehm 60x120", 2.4, "text", align="right")
    nx, nz = math.sin(pitch), math.cos(pitch)
    ax, az = -60.0, 120.0
    bx = 320.0
    bz = az - (bx - ax) * math.tan(pitch)
    dr.poly([(ax, az), (bx, bz), (bx + nx * sh, bz + nz * sh), (ax + nx * sh, az + nz * sh)],
            "schnitt", closed=True)
    dr.text(120, az + sh + 210, f"Sparren {d['sparren'][0]:.0f}x{sh:.0f}", 2.4, "text")
    t = sh
    dr.poly([(ax + nx * t, az + nz * t), (bx + nx * t, bz + nz * t),
             (bx + nx * (t + 40), bz + nz * (t + 40)), (ax + nx * (t + 40), az + nz * (t + 40))],
            "detail", closed=True)
    t2 = t + 40
    dr.poly([(ax + nx * t2, az + nz * t2), (bx + 60 + nx * t2, bz + nz * t2 - 60 * math.tan(pitch)),
             (bx + 60 + nx * t2, bz + nz * t2 - 60 * math.tan(pitch) + 20),
             (ax + nx * t2, az + nz * t2 + 20)], "schnitt", closed=True)
    dr.text(430, bz + 120, "Trapezblech ueber Traufbohle\n40 mm ueberstehen lassen",
            2.4, "text", align="left")
    dr.circle(bx + 130, bz - 110, 90, "detail")
    dr.text(bx + 260, bz - 240, "Dachrinne NW 100\nHalter Abstand <= 600 mm",
            2.4, "text", align="left")
    dr.text(60, -520, "Kerve max. 1/3 der Sparrenhoehe - hier nicht tiefer als "
            f"{sh / 3:.0f} mm", 2.4, "text", align="left")
    out.append(dr)

    # Detail 3: Grenzwand oben
    dr = Drawing("detail_grenze", "Detail 3 - Anschluss an der Grenzwand", "M 1:5", 5)
    dr.rect(0, -400, 60, 120, "schnitt"); dr.hatch(0, -400, 60, 120)
    dr.text(80, -200, "Grenzwand: Ständer + Raehm 60x120", 2.4, "text", align="left")
    dr.rect(-50, -400, -20, 120, "detail")
    dr.rect(-70, -400, -50, 120, "detail")
    dr.text(-90, -260, "Konterlatte + Rhombus\nbuendig, kein Ueberstand",
            2.4, "text", align="right")
    ax, az = 0.0, 120.0
    dr.poly([(ax, az), (ax + 400, az - 400 * math.tan(pitch)),
             (ax + 400, az - 400 * math.tan(pitch) + sh / math.cos(pitch)),
             (ax, az + sh / math.cos(pitch))], "schnitt", closed=True)
    dr.poly([(-70, az + sh + 120), (-70, az + sh + 40), (200, az + sh + 20),
             (200, az + sh + 100)], "schnitt", closed=True)
    dr.text(230, az + sh + 160, "Wandanschluss-/Firstprofil,\noben dicht abschliessen",
            2.4, "text", align="left")
    dr.line(-90, -500, -90, az + sh + 400, "grenze")
    dr.text(-100, az + sh + 300, "GRENZE", 2.6, "grenze", align="right")
    dr.text(120, -560, "Alle Bauteile enden auf der Grenze - Montage nur vom "
            "eigenen Grundstueck aus planen (kein Hammerschlagsrecht ohne Absprache)",
            2.3, "text", align="left")
    out.append(dr)
    return out


def all_drawings(b: Building) -> list[Drawing]:
    out = [site_plan(b), foundation_plan(b), plan(b),
           elevation(b, "front"), elevation(b, "rear"),
           elevation(b, "left"), elevation(b, "right"),
           section(b), roof_plan(b),
           framing(b, "front"), framing(b, "rear"),
           framing(b, "left"), framing(b, "right")]
    out += detail_drawings(b)
    return out
