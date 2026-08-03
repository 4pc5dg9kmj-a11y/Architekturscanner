"""PDF-Ausgabe: Zeichnungssatz, Holzliste, Zuschnittplan und Bauanleitung.

Zeichnungsblaetter im Format A3 quer mit Schriftfeld und echtem Massstab,
Listen und Anleitung im Format A4 hoch.
"""

from __future__ import annotations

import datetime
import io
import math

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas as rl_canvas

from .bom import cost_summary, fasteners, materials, timber_list, weight_estimate
from .compliance import check_all, summary
from .drawings import LAYERS, Drawing, all_drawings
from .instructions import build_steps, maintenance, prepare_notes, tool_list
from .model import Building
from .spec import SCHWELLE, WAND_STIEL
from .statics import snow_load
from .structure import report as structural_report
from .structure import summary as structural_summary
from .text import de, nz

MM = 72.0 / 25.4
SHEET = landscape(A3)          # 420 x 297 mm
TEXT_PAGE = A4
MARGIN = 12 * MM
TITLE_W = 90 * MM
TITLE_H = 44 * MM
SCALES = [5, 10, 20, 25, 33, 50, 100, 200]

INK = HexColor("#111111")
MUTED = HexColor("#666666")
ACCENT = HexColor("#0b6ea8")
WARN = HexColor("#c0392b")
OK = HexColor("#1e7d4f")


# ---------------------------------------------------------------------------
# Hilfen
# ---------------------------------------------------------------------------


def _set_layer(c: rl_canvas.Canvas, layer: str) -> None:
    lw, color, style = LAYERS.get(layer, (0.25, "#333333", "solid"))
    c.setLineWidth(lw * MM)
    c.setStrokeColor(HexColor(color))
    c.setFillColor(HexColor(color))
    if style == "dash":
        c.setDash([3, 2], 0)
    elif style == "dashdot":
        c.setDash([6, 2, 1.5, 2], 0)
    else:
        c.setDash()


def _fit_scale(dr: Drawing, w: float, h: float) -> tuple[int, float, float]:
    """Waehlt den groessten Normmassstab, in dem die Zeichnung aufs Blatt passt."""
    x0, y0, x1, y1 = dr.bounds()
    dw = max(x1 - x0, 1.0)
    dh = max(y1 - y0, 1.0)
    for s in SCALES:
        if s < dr.scale:
            continue
        if dw / s * MM <= w and dh / s * MM <= h:
            return s, x0, y0
    return SCALES[-1], x0, y0


def _draw_drawing(c: rl_canvas.Canvas, dr: Drawing, ox: float, oy: float,
                  w: float, h: float) -> int:
    scale, bx0, by0 = _fit_scale(dr, w, h)
    x1, y1 = dr.bounds()[2], dr.bounds()[3]
    dw = (x1 - bx0) / scale * MM
    dh = (y1 - by0) / scale * MM
    px = ox + (w - dw) / 2
    py = oy + (h - dh) / 2

    def P(x, y):
        return (px + (x - bx0) / scale * MM, py + (y - by0) / scale * MM)

    for e in dr.ents:
        _set_layer(c, e.layer)
        if e.kind in ("line", "poly"):
            pts = [P(*p) for p in e.pts]
            if len(pts) < 2:
                continue
            path = c.beginPath()
            path.moveTo(*pts[0])
            for p in pts[1:]:
                path.lineTo(*p)
            if e.closed:
                path.close()
            c.drawPath(path)
        elif e.kind == "circle":
            cx, cy = P(*e.pts[0])
            c.circle(cx, cy, e.pts[1][0] / scale * MM, stroke=1, fill=0)
        elif e.kind == "hatch":
            _hatch(c, P(*e.pts[0]), P(*e.pts[1]))
        elif e.kind == "text":
            _text_ent(c, P(*e.pts[0]), e)
        elif e.kind == "dim":
            _dim_ent(c, P(*e.pts[0]), P(*e.pts[1]), e)
    c.setDash()
    return scale


def _hatch(c: rl_canvas.Canvas, p0, p1) -> None:
    x0, y0 = min(p0[0], p1[0]), min(p0[1], p1[1])
    x1, y1 = max(p0[0], p1[0]), max(p0[1], p1[1])
    if x1 - x0 < 1 or y1 - y0 < 1:
        return
    c.saveState()
    path = c.beginPath()
    path.rect(x0, y0, x1 - x0, y1 - y0)
    c.clipPath(path, stroke=0, fill=0)
    c.setLineWidth(0.12 * MM)
    step = 2.2 * MM
    n = int(((x1 - x0) + (y1 - y0)) / step) + 2
    for i in range(n):
        s = x0 - (y1 - y0) + i * step
        c.line(s, y0, s + (y1 - y0), y1)
    c.restoreState()


def _text_ent(c: rl_canvas.Canvas, p, e) -> None:
    size = max(e.size * MM * 0.85, 3.4)
    c.saveState()
    c.translate(p[0], p[1])
    if e.angle:
        c.rotate(e.angle)
    c.setFont("Helvetica", size)
    lines = de(e.text).split("\n")
    for i, ln in enumerate(lines):
        yy = -i * size * 1.15
        if e.align == "left":
            c.drawString(0, yy, ln)
        elif e.align == "right":
            c.drawRightString(0, yy, ln)
        else:
            c.drawCentredString(0, yy, ln)
    c.restoreState()


def _dim_ent(c: rl_canvas.Canvas, p0, p1, e) -> None:
    c.line(p0[0], p0[1], p1[0], p1[1])
    ang = math.degrees(math.atan2(p1[1] - p0[1], p1[0] - p0[0]))
    for p in (p0, p1):
        c.saveState()
        c.translate(*p)
        c.rotate(ang + 45)
        c.line(-1.4 * MM, 0, 1.4 * MM, 0)
        c.restoreState()
    mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    if ang > 90 or ang < -90:
        ang += 180
    c.saveState()
    c.translate(mx, my)
    c.rotate(ang)
    c.setFont("Helvetica-Bold", 6.2)
    c.drawCentredString(0, 1.1 * MM, de(e.text))
    c.restoreState()


def _title_block(c: rl_canvas.Canvas, b: Building, dr: Drawing, scale: int,
                 sheet: str, total: str) -> None:
    w, h = SHEET
    x = w - MARGIN - TITLE_W
    y = MARGIN
    c.setDash()
    c.setLineWidth(0.5 * MM)
    c.setStrokeColor(INK)
    c.rect(x, y, TITLE_W, TITLE_H, stroke=1, fill=0)
    c.setLineWidth(0.15 * MM)
    for yy in (10, 18, 26, 34):
        c.line(x, y + yy * MM, x + TITLE_W, y + yy * MM)

    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x + 3 * MM, y + 37.5 * MM, "FAHRRADHAEUSCHEN MIT GERAETERAUM")
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(x + 3 * MM, y + 34.8 * MM,
                 "Pultdach, Grenzbebauung nach § 6 Abs. 8 HBO (Hessen)")

    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 3 * MM, y + 29 * MM, de(dr.title))
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(x + 3 * MM, y + 26.8 * MM, de(dr.subtitle)[:62])

    d = b.dims
    c.setFillColor(INK)
    c.setFont("Helvetica", 6.8)
    rows = [
        ("Massstab", f"1 : {scale}"),
        ("Aussenmass", f"{nz(d['length_out'] / 1000, 2)} x {nz(d['depth_out'] / 1000, 2)} m"),
        ("Rauminhalt", f"{nz(d['bri'], 2)} m3  (zul. 30,00 m3)"),
    ]
    for i, (k, v) in enumerate(rows):
        yy = y + (22.5 - i * 2.6) * MM
        c.setFillColor(MUTED)
        c.drawString(x + 3 * MM, yy, k)
        c.setFillColor(INK)
        c.drawString(x + 25 * MM, yy, v)

    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(x + 3 * MM, y + 6.6 * MM,
                 f"Erstellt {datetime.date.today().strftime('%d.%m.%Y')}")
    c.drawString(x + 3 * MM, y + 4.0 * MM, "Alle Masse in mm, vor Ort pruefen")
    c.drawString(x + 3 * MM, y + 1.4 * MM, "Keine geprueften Bauvorlagen")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(x + TITLE_W - 3 * MM, y + 3.2 * MM, f"Blatt {sheet}/{total}")


def _sheet_frame(c: rl_canvas.Canvas) -> None:
    w, h = SHEET
    c.setDash()
    c.setLineWidth(0.5 * MM)
    c.setStrokeColor(INK)
    c.rect(MARGIN, MARGIN, w - 2 * MARGIN, h - 2 * MARGIN, stroke=1, fill=0)


def _scale_bar(c: rl_canvas.Canvas, x: float, y: float, scale: int) -> None:
    """Massstabsleiste - bleibt auch nach Verkleinern der Kopie aussagekraeftig."""
    unit_mm = 1000.0 / scale        # ein Meter auf dem Papier
    n = 5 if unit_mm * 5 < 90 else 2
    c.setDash()
    c.setLineWidth(0.2 * MM)
    c.setStrokeColor(INK)
    for i in range(n):
        c.setFillColor(INK if i % 2 == 0 else HexColor("#ffffff"))
        c.rect(x + i * unit_mm * MM, y, unit_mm * MM, 2 * MM, stroke=1, fill=1)
    c.setFillColor(INK)
    c.setFont("Helvetica", 6)
    for i in range(n + 1):
        c.drawCentredString(x + i * unit_mm * MM, y - 3.2 * MM, f"{i}")
    c.drawString(x + n * unit_mm * MM + 2 * MM, y - 3.2 * MM, "m")


# ---------------------------------------------------------------------------
# Textseiten (A4)
# ---------------------------------------------------------------------------


class TextPage:
    """Fortlaufender Textsatz auf A4 mit automatischem Seitenumbruch."""

    def __init__(self, c: rl_canvas.Canvas, b: Building, title: str):
        self.c = c
        self.b = b
        self.title = title
        self.w, self.h = TEXT_PAGE
        self.left = 20 * MM
        self.right = self.w - 18 * MM
        self.y = 0.0
        self.page = 0
        self._new_page()

    def _new_page(self) -> None:
        if self.page:
            self.c.showPage()
        self.c.setPageSize(TEXT_PAGE)
        self.page += 1
        c = self.c
        c.setDash()
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(self.left, self.h - 15 * MM, de(self.title))
        c.setFont("Helvetica", 7)
        c.setFillColor(MUTED)
        c.drawRightString(self.right, self.h - 15 * MM,
                          de("Fahrradhaeuschen mit Geraeteraum - Bauunterlagen"))
        c.setLineWidth(0.2 * MM)
        c.setStrokeColor(HexColor("#cccccc"))
        c.line(self.left, self.h - 17 * MM, self.right, self.h - 17 * MM)
        c.line(self.left, 14 * MM, self.right, 14 * MM)
        c.setFont("Helvetica", 7)
        c.drawCentredString(self.w / 2, 10 * MM, de(
            "Erstellt mit dem Fahrradhaeuschen-Planer - "
            "keine geprueften Bauvorlagen"))
        self.y = self.h - 24 * MM

    def space(self, mm_: float) -> None:
        self.y -= mm_ * MM
        if self.y < 20 * MM:
            self._new_page()

    def need(self, mm_: float) -> None:
        if self.y - mm_ * MM < 20 * MM:
            self._new_page()

    def h1(self, s: str) -> None:
        self.need(16)
        self.c.setFillColor(INK)
        self.c.setFont("Helvetica-Bold", 14)
        self.c.drawString(self.left, self.y, de(s))
        self.y -= 7 * MM

    def h2(self, s: str, color=None) -> None:
        self.need(12)
        self.c.setFillColor(color or ACCENT)
        self.c.setFont("Helvetica-Bold", 10.5)
        self.c.drawString(self.left, self.y, de(s))
        self.y -= 5.5 * MM

    def p(self, s: str, size: float = 8.6, indent: float = 0.0,
          color=None, bullet: str = "") -> None:
        c = self.c
        c.setFont("Helvetica", size)
        width = self.right - self.left - indent * MM
        lines = simpleSplit(de(s), "Helvetica", size, width)
        for i, ln in enumerate(lines):
            self.need(6)
            c.setFillColor(color or INK)
            if bullet and i == 0:
                c.setFont("Helvetica-Bold", size)
                c.drawString(self.left + indent * MM - 4 * MM, self.y, bullet)
                c.setFont("Helvetica", size)
            c.drawString(self.left + indent * MM, self.y, ln)
            self.y -= size * 1.34
        self.y -= 1.2 * MM

    def table(self, headers: list[str], rows: list[list[str]],
              widths: list[float], size: float = 7.6) -> None:
        headers = [de(h) for h in headers]
        rows = [[de(str(cell)) for cell in r] for r in rows]
        c = self.c
        total = self.right - self.left
        cols = [w / sum(widths) * total for w in widths]

        def header():
            self.need(10)
            c.setFillColor(HexColor("#eef3f7"))
            c.rect(self.left, self.y - 1.5 * MM, total, 5 * MM, stroke=0, fill=1)
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", size)
            x = self.left
            for hh, wdt in zip(headers, cols):
                c.drawString(x + 1 * MM, self.y, hh)
                x += wdt
            self.y -= 6 * MM

        header()
        c.setFont("Helvetica", size)
        for r in rows:
            hgt = 1
            for cell, wdt in zip(r, cols):
                hgt = max(hgt, len(simpleSplit(str(cell), "Helvetica", size,
                                               wdt - 2 * MM)))
            if self.y - hgt * size * 1.25 < 20 * MM:
                self._new_page()
                header()
                c.setFont("Helvetica", size)
            x = self.left
            y0 = self.y
            for cell, wdt in zip(r, cols):
                c.setFillColor(INK)
                lines = simpleSplit(str(cell), "Helvetica", size, wdt - 2 * MM)
                for i, ln in enumerate(lines):
                    c.drawString(x + 1 * MM, y0 - i * size * 1.25, ln)
                x += wdt
            self.y = y0 - hgt * size * 1.25 - 1.4 * MM
            c.setStrokeColor(HexColor("#e2e2e2"))
            c.setLineWidth(0.15 * MM)
            c.line(self.left, self.y + 1.6 * MM, self.right, self.y + 1.6 * MM)
        self.y -= 3 * MM

    def box(self, title: str, lines: list[str], color=ACCENT) -> None:
        self.need(16 + 5 * len(lines))
        c = self.c
        y_start = self.y + 4 * MM
        c.setFillColor(HexColor("#f7f9fb"))
        est = 8 + sum(len(simpleSplit(s, "Helvetica", 8, self.right - self.left - 10 * MM))
                      for s in lines) * 3.7
        c.rect(self.left, y_start - est * MM, self.right - self.left, est * MM,
               stroke=0, fill=1)
        c.setFillColor(color)
        c.rect(self.left, y_start - est * MM, 1.2 * MM, est * MM, stroke=0, fill=1)
        self.y -= 1 * MM
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(self.left + 4 * MM, self.y, de(title))
        self.y -= 5 * MM
        for s in lines:
            self.p(s, 8, indent=4)
        self.y -= 2 * MM


# ---------------------------------------------------------------------------
# Dokumentaufbau
# ---------------------------------------------------------------------------


def build_pdf(b: Building) -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=SHEET)
    c.setTitle("Fahrradhaeuschen mit Geraeteraum - Bauunterlagen")
    c.setAuthor("Fahrradhaeuschen-Planer")

    drawings = all_drawings(b)
    total = str(len(drawings))

    _cover(c, b, drawings)
    for i, dr in enumerate(drawings, start=1):
        c.setPageSize(SHEET)
        w, h = SHEET
        _sheet_frame(c)
        area_w = w - 2 * MARGIN - TITLE_W - 8 * MM
        area_h = h - 2 * MARGIN - 16 * MM
        scale = _draw_drawing(c, dr, MARGIN + 4 * MM, MARGIN + 8 * MM, area_w, area_h)
        dr.scale = scale
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(MARGIN + 4 * MM, h - MARGIN - 8 * MM, de(dr.title))
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        c.drawString(MARGIN + 4 * MM, h - MARGIN - 13 * MM, de(dr.subtitle))
        _scale_bar(c, MARGIN + 6 * MM, MARGIN + 6 * MM, scale)
        _title_block(c, b, dr, scale, str(i), total)
        c.showPage()

    _text_part(c, b)
    c.save()
    return buf.getvalue()


def _cover(c: rl_canvas.Canvas, b: Building, drawings: list[Drawing]) -> None:
    d, spec = b.dims, b.spec
    w, h = SHEET
    _sheet_frame(c)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 30)
    c.drawString(MARGIN + 10 * MM, h - 45 * MM, de("Fahrradhaeuschen mit Geraeteraum"))
    c.setFont("Helvetica", 13)
    c.setFillColor(MUTED)
    c.drawString(MARGIN + 10 * MM, h - 55 * MM, de(
        "Pultdach - Grenzbebauung in Hessen - Selbstbau aus Standardhoelzern"))

    checks = check_all(b)
    st = summary(checks)
    col = {"ok": OK, "warn": HexColor("#b8860b"), "fail": WARN}[st["state"]]
    c.setFillColor(col)
    c.rect(MARGIN + 10 * MM, h - 74 * MM, 150 * MM, 12 * MM, stroke=0, fill=1)
    c.setFillColor(HexColor("#ffffff"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN + 14 * MM, h - 70.5 * MM,
                 de(f"HBO-Pruefung: {st['text']}").upper())

    left_x = MARGIN + 10 * MM
    y = h - 90 * MM
    cost = cost_summary(b)
    wgt = weight_estimate(b)
    rows = [
        ("Aussenmass", f"{nz(d['length_out'] / 1000, 2)} m x {nz(d['depth_out'] / 1000, 2)} m"),
        ("Grundflaeche", f"{nz(d['footprint'], 2)} m2"),
        ("Brutto-Rauminhalt", f"{nz(d['bri'], 2)} m3   (zulaessig 30,00 m3)"),
        ("Hoehe an der Grenze", f"{nz(d['z_roof_rear'] / 1000, 2)} m   (zulaessig 3,00 m)"),
        ("Laenge an der Grenze", f"{nz(d['length_out'] / 1000, 2)} m   (zulaessig 15,00 m)"),
        ("Lichte Hoehe", f"{spec.eaves_height:.0f} mm vorne / "
                         f"{d['clear_height_rear']:.0f} mm hinten"),
        ("Dachneigung", f"{spec.roof_pitch:.0f} Grad Pultdach, Gefaelle von der Grenze weg"),
        ("Stellplaetze", f"{spec.n_bikes} Fahrraeder, versetzt"),
        ("Geraeteraum", f"{nz(d['tool_w'] / 1000, 2)} m x {nz(d['inner_d'] / 1000, 2)} m"
                        if spec.has_tool_room else "keiner"),
        ("Sparren", f"{d['sparren'][0]:.0f} x {d['sparren'][1]:.0f} mm, "
                    f"Achsabstand 625 mm, Ausnutzung "
                    f"{nz(d['sparren_check'].get('eta_max', 0), 2)}"),
        ("Gruendung", {"slabs": "Gehwegplatten auf Splittbett",
                       "point": "Punktfundamente",
                       "screw": "Schraubfundamente",
                       "concrete": "vorhandene Betonflaeche"}.get(spec.foundation, "-")),
        ("Dachhaut", {"trapez": "Trapezblech T-18/76 anthrazit",
                      "shingle": "Bitumenschindeln",
                      "epdm": "EPDM-Bahn", "green": "Extensives Gruendach"}
         .get(spec.roofing, "-")),
        ("Materialkosten", f"rund {cost['gesamt']:,.0f} EUR".replace(",", ".")),
        ("Eigenlast", f"{wgt['eigenlast_kg']} kg auf {wgt['auflager']} Auflagern"),
    ]
    for k, v in rows:
        c.setFont("Helvetica", 9)
        c.setFillColor(MUTED)
        c.drawString(left_x, y, de(k))
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(INK)
        c.drawString(left_x + 55 * MM, y, de(v))
        y -= 6.2 * MM

    # Inhaltsverzeichnis
    rx = w / 2 + 20 * MM
    y = h - 90 * MM
    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(INK)
    c.drawString(rx, y, "Inhalt")
    y -= 7 * MM
    c.setFont("Helvetica", 8.6)
    for i, dr in enumerate(drawings, start=1):
        c.setFillColor(MUTED)
        c.drawString(rx, y, f"Blatt {i}")
        c.setFillColor(INK)
        c.drawString(rx + 16 * MM, y, de(dr.title))
        y -= 5.2 * MM
    y -= 3 * MM
    for t in ("Materiallisten und Zuschnittplan", "Schrauben und Verbindungsmittel",
              "Bauanleitung Schritt fuer Schritt", "Pruefung nach Hessischer Bauordnung"):
        c.setFillColor(MUTED)
        c.drawString(rx, y, "Anhang")
        c.setFillColor(INK)
        c.drawString(rx + 16 * MM, y, de(t))
        y -= 5.2 * MM

    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN + 10 * MM, MARGIN + 14 * MM, de(
        "Diese Unterlagen sind eine Selbstbauplanung. Sie ersetzen keine "
        "Bauvorlagen, keine Statik und keine Rechtsberatung."))
    c.drawString(MARGIN + 10 * MM, MARGIN + 9 * MM, de(
        "Massgeblich sind die Hessische Bauordnung in der geltenden Fassung, der "
        "oertliche Bebauungsplan und die Auskunft der Bauaufsichtsbehoerde."))
    c.drawString(MARGIN + 10 * MM, MARGIN + 4 * MM,
                 f"Erstellt am {datetime.date.today().strftime('%d.%m.%Y')}")
    c.showPage()


def _text_part(c: rl_canvas.Canvas, b: Building) -> None:
    d, spec = b.dims, b.spec

    # --- Materiallisten ----------------------------------------------------
    tp = TextPage(c, b, "Materiallisten und Zuschnitt")
    tp.h1("Einkaufsliste Holz")
    tp.p("Alle Hoelzer sind Standardquerschnitte aus dem Baustoffhandel. "
         "Die Stangenlaengen sind so gewaehlt, dass der Verschnitt moeglichst "
         "klein bleibt - der Zuschnittplan weiter unten zeigt, welches Bauteil "
         "aus welcher Stange kommt.")

    lines = timber_list(b)
    rows = []
    for l in lines:
        laengen = ", ".join(f"{n} x {nz(ln / 1000, 2)} m" for ln, n in l.count_by_length.items())
        rows.append([f"{l.profile} mm", l.material, laengen,
                     f"{nz(l.total_bought_m, 1)}", f"{l.waste_pct:.0f} %",
                     f"{l.cost:.0f}"])
    tp.table(["Querschnitt", "Material", "Einkauf", "lfm", "Versch.", "EUR"],
             rows, [1.1, 2.6, 2.0, 0.6, 0.6, 0.6])

    cost = cost_summary(b)
    tp.box("Kostenrahmen (Baumarkt-Richtwerte, ohne Werkzeug)", [
        f"Holz: {cost['holz']:.0f} EUR   |   Verbindungsmittel: "
        f"{cost['verbindungsmittel']:.0f} EUR   |   uebriges Material: "
        f"{cost['material']:.0f} EUR",
        f"Summe rund {cost['gesamt']:.0f} EUR, das sind "
        f"{cost['pro_stellplatz']:.0f} EUR je Fahrradstellplatz.",
        f"Eingekauft werden {cost['holz_lfm']:.0f} lfm Holz bei "
        f"{cost['verschnitt_pct']:.0f} % Verschnitt.",
        "Preise schwanken stark. Vor dem Kauf zwei Angebote einholen - "
        "im Holzfachhandel ist KVH oft guenstiger als im Baumarkt, und "
        "Zuschnitt auf Mass ist dort meist inklusive.",
    ])

    tp.h1("Zuschnittplan")
    tp.p("Je Stange von links nach rechts abtragen. Zwischen zwei Stuecken sind "
         "5 mm Saegeblattbreite beruecksichtigt. Vor dem ersten Schnitt jede "
         "Stange auf Krummschaft pruefen und die Krone (Aufwoelbung) nach oben "
         "einbauen.")
    for l in lines:
        tp.h2(f"{l.profile} mm - {l.material}")
        rows = []
        for i, bar in enumerate(l.bars, start=1):
            cuts = "  +  ".join(f"{ln:.0f}" for _, ln in bar.pieces)
            parts = ", ".join(dict.fromkeys(
                (nm.split(":")[-1].strip() or "-") for nm, _ in bar.pieces))
            rows.append([f"{i}", f"{nz(bar.length / 1000, 2)} m", cuts,
                         f"{bar.rest:.0f}", parts[:70]])
        tp.table(["Nr", "Stange", "Zuschnitt in mm", "Rest", "Bauteile"],
                 rows, [0.35, 0.7, 2.1, 0.5, 3.0], size=7.0)

    # --- Verbindungsmittel -------------------------------------------------
    tp = TextPage(c, b, "Schrauben, Verbinder und Werkstoffe")
    tp.h1("Verbindungsmittel")
    tp.p("Alle Schrauben mit TX-Antrieb und Vollgewinde bzw. Teilgewinde je nach "
         "Anwendung. In Holz ab 6 mm Durchmesser immer vorbohren, besonders "
         "nahe an Hirnholzenden - sonst reisst das Holz.")
    fa = fasteners(b)
    tp.table(["Bezeichnung", "Menge", "Einheit", "Verwendung", "EUR"],
             [[i.name, f"{i.qty:.0f}", i.unit, i.note, f"{i.cost:.0f}"] for i in fa],
             [2.6, 0.5, 0.8, 2.6, 0.5])

    tp.h1("Werkstoffe und Baustoffe")
    ma = materials(b)
    groups: dict[str, list] = {}
    for i in ma:
        groups.setdefault(i.group, []).append(i)
    for g, items in groups.items():
        tp.h2(g)
        tp.table(["Bezeichnung", "Menge", "Einheit", "Hinweis", "EUR"],
                 [[i.name, f"{i.qty:.0f}", i.unit, i.note, f"{i.cost:.0f}"] for i in items],
                 [2.6, 0.5, 0.8, 2.6, 0.5])

    tp.h1("Werkzeug")
    for t in tool_list(b):
        tp.p(t, 8.4, indent=5, bullet="-")

    # --- Bauanleitung ------------------------------------------------------
    tp = TextPage(c, b, "Bauanleitung")
    tp.h1("Vor dem ersten Spatenstich")
    for s in prepare_notes(b):
        tp.p(s, 8.6, indent=5, bullet="-")

    steps = build_steps(b)
    tp.space(4)
    tp.h1("Ablauf")
    tp.p(f"Gesamtaufwand: rund {_total_days(steps)} Arbeitstage zu zweit. "
         "Die Reihenfolge ist bindend - besonders die Regel, die Grenzwand "
         "zuerst fertigzustellen.")
    for st in steps:
        tp.need(30)
        tp.h2(f"Schritt {st.no}: {st.title}")
        tp.p(f"Dauer {st.duration}  -  {st.people} Person(en)  -  "
             f"Werkzeug: {', '.join(st.tools)}", 7.6, color=MUTED)
        for para in st.body:
            tp.p(para, 8.6, indent=5, bullet="-")
        if st.checks:
            tp.p("Kontrolle vor dem naechsten Schritt:", 8.2, color=ACCENT)
            for ch in st.checks:
                tp.p(ch, 8.2, indent=5, bullet="[ ]")
        tp.space(2)

    tp.h1("Wartung")
    for s in maintenance(b):
        tp.p(s, 8.6, indent=5, bullet="-")

    # --- Rechtliches -------------------------------------------------------
    tp = TextPage(c, b, "Pruefung nach Hessischer Bauordnung")
    tp.h1("Ergebnis der Pruefung")
    checks = check_all(b)
    st = summary(checks)
    tp.box({"ok": "Zulaessig", "warn": "Zulaessig mit Hinweisen",
            "fail": "Nicht zulaessig"}[st["state"]],
           [st["text"].capitalize() + "."],
           {"ok": OK, "warn": HexColor("#b8860b"), "fail": WARN}[st["state"]])

    tp.table(["Kriterium", "Wert", "Grenzwert", "Status", "Rechtsgrundlage"],
             [[ch.title, ch.value, ch.limit,
               {"ok": "erfuellt", "warn": "Hinweis", "fail": "NICHT erfuellt",
                "info": "beachten"}[ch.status], ch.law] for ch in checks],
             [2.2, 1.1, 1.1, 0.9, 1.5])

    tp.h1("Erlaeuterungen")
    for ch in checks:
        tp.h2(ch.title, {"ok": OK, "warn": HexColor("#b8860b"),
                         "fail": WARN, "info": ACCENT}[ch.status])
        tp.p(f"{ch.law}: {ch.hint}", 8.4)

    tp.h1("Standsicherheit")
    proofs = structural_report(b)
    st = structural_summary(proofs)
    tp.box("Ergebnis", [
        de(st["text"])[0].upper() + de(st["text"])[1:] + ".",
        "Der Lastweg ist eine durchgehende Auflagerkette: Traglatte auf "
        "Sparren, Sparren auf Raehm, Raehm auf Staender, Staender auf "
        "Fussriegel und Bodenplatte, Bodenplatte auf Deckenbalken, "
        "Deckenbalken auf Schwelle, Schwelle auf Fundament. Kein Balken haengt "
        "in einer Verbindung - jedes Holz liegt auf dem darunterliegenden auf.",
        f"Sparren, Staender und Deckenbalken stehen im selben Achsraster von "
        f"{d['e_axis']:.0f} mm senkrecht uebereinander, unter jeder Achse "
        "steht ein Fundamentpunkt.",
    ], OK if st["state"] == "ok" else WARN)

    tp.table(["Nachweis", "Bauteil", "Querschnitt", "Stuetzweite", "Ausnutzung"],
             [[p.title, p.member, p.profile, p.span,
               nz(p.util, 2) + ("" if p.ok else "  NICHT ERFUELLT")]
              for p in proofs],
             [2.3, 1.2, 1.3, 1.2, 0.9])

    for p in proofs:
        tp.h2(p.title, OK if p.ok else WARN)
        tp.p(f"{p.member} - {p.profile} - {p.span} - Last {p.load}", 7.8, color=MUTED)
        for name, value, limit, util in p.results:
            if limit == "-":
                tp.p(f"{name}: {value}", 8.2, indent=5, bullet="-")
            else:
                tp.p(f"{name}: {value} gegen {limit} zulaessig "
                     f"(Ausnutzung {nz(util, 2)})", 8.2, indent=5, bullet="-")
        if p.note:
            tp.p(p.note, 8.0, indent=5, color=MUTED)

    tp.h1("Lastannahmen")
    tp.p(f"Schneelastzone {spec.snow_zone}, Gelaendehoehe {spec.altitude:.0f} m ueber NN, "
         f"charakteristische Schneelast sk = {nz(snow_load(spec.snow_zone, spec.altitude), 2)} kN/m2. "
         f"Formbeiwert 0,80 bei {spec.roof_pitch:.0f} Grad Dachneigung.")
    tp.p(f"Bauteile im Achsraster {d['e_axis']:.0f} mm: Sparren "
         f"{d['sparren'][0]:.0f} x {d['sparren'][1]:.0f} mm, Deckenbalken "
         f"{d['joist'][0]:.0f} x {d['joist'][1]:.0f} mm, Sturz "
         f"{d['lintel'][0]:.0f} x {d['lintel'][1]:.0f} mm, Staender und Raehm "
         f"{WAND_STIEL[0]:.0f} x {WAND_STIEL[1]:.0f} mm, Schwelle "
         f"{SCHWELLE[1]:.0f} x {SCHWELLE[0]:.0f} mm liegend - alle Nadelholz C24.")
    tp.p("Nutzlast der Bodenflaeche 2,50 kN/m2 (Abstellflaeche), Eigenlast "
         "der Balkenlage 0,30 kN/m2, Wandeigenlast 0,35 kN/m2.")
    tp.p("Nachweise nach DIN EN 1995-1-1 als Einfeldtraeger, Nutzungsklasse 2, "
         "gamma_M = 1,30, kmod = 0,90 fuer Schnee und 0,80 fuer die Nutzlast "
         "der Bodenflaeche. Der Knicknachweis der Staender ist konservativ "
         "ohne die aussteifende Wirkung von Konterlattung und Beplankung "
         "gefuehrt. Windsog ist ueber die durchgehende Verankerung jedes "
         "Sparrens mit Sparren-Pfettenankern und die Verschraubung des "
         "Fussriegels im Schwellenrost abgedeckt.")

    tp.box("Haftungsausschluss", [
        "Diese Unterlagen wurden automatisch aus den eingegebenen Parametern "
        "erzeugt. Sie sind eine Planungshilfe fuer den Selbstbau und keine "
        "geprueften Bauvorlagen im Sinne der HBO.",
        "Massgeblich sind ausschliesslich die geltende Hessische Bauordnung, "
        "der oertliche Bebauungsplan, oertliche Satzungen und die Auskunft "
        "der zustaendigen Bauaufsichtsbehoerde.",
        "Vor Baubeginn den Grenzverlauf durch die amtlichen Grenzsteine "
        "bestaetigen. Bei Unsicherheit eine kostenlose Bauberatung beim "
        "Bauamt in Anspruch nehmen.",
    ], WARN)
    c.showPage()


def _total_days(steps) -> str:
    total = 0.0
    for s in steps:
        t = s.duration.lower()
        num = "".join(ch for ch in t.split()[0] if ch.isdigit() or ch in ",.")
        try:
            v = float(num.replace(",", "."))
        except ValueError:
            v = 1.0
        total += v if "tag" in t else v / 8.0
    return f"{total:.0f}"
