"""DXF-Export des Zeichnungssatzes (Meter, layerweise getrennt).

Jede Zeichnung landet als eigener Block nebeneinander auf dem Modellbereich,
damit sich der komplette Satz in einem CAD-Programm oeffnen und weiter
bearbeiten laesst.
"""

from __future__ import annotations

import io
import math

import ezdxf

from .drawings import LAYERS, all_drawings
from .model import Building

ACI = {"schnitt": 7, "sicht": 8, "detail": 9, "hilfslinie": 252,
       "achse": 1, "bemassung": 5, "moebel": 3, "grenze": 1, "text": 7}


def export_dxf(b: Building) -> bytes:
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 6          # Meter
    msp = doc.modelspace()

    for name in LAYERS:
        if name not in doc.layers:
            doc.layers.add(name, color=ACI.get(name, 7))

    gap = 2.0
    cursor = 0.0
    for dr in all_drawings(b):
        x0, y0, x1, y1 = dr.bounds()
        ox, oy = cursor - x0 / 1000.0, -y0 / 1000.0

        def P(p):
            return (p[0] / 1000.0 + ox, p[1] / 1000.0 + oy)

        for e in dr.ents:
            attr = {"layer": e.layer}
            if e.kind in ("line", "poly"):
                pts = [P(p) for p in e.pts]
                if len(pts) < 2:
                    continue
                if e.closed:
                    pts.append(pts[0])
                msp.add_lwpolyline(pts, dxfattribs=attr)
            elif e.kind == "circle":
                msp.add_circle(P(e.pts[0]), e.pts[1][0] / 1000.0, dxfattribs=attr)
            elif e.kind == "hatch":
                a, c = P(e.pts[0]), P(e.pts[1])
                pts = [a, (c[0], a[1]), c, (a[0], c[1]), a]
                h = msp.add_hatch(color=254, dxfattribs={"layer": e.layer})
                h.set_pattern_fill("ANSI31", scale=0.02)
                h.paths.add_polyline_path(pts, is_closed=True)
            elif e.kind == "text":
                t = msp.add_text(e.text.replace("\n", " "), dxfattribs={
                    "layer": e.layer, "height": e.size / 1000.0 * dr.scale,
                    "rotation": e.angle})
                t.set_placement(P(e.pts[0]))
            elif e.kind == "dim":
                a, c = P(e.pts[0]), P(e.pts[1])
                msp.add_line(a, c, dxfattribs=attr)
                ang = math.degrees(math.atan2(c[1] - a[1], c[0] - a[0]))
                t = msp.add_text(e.text, dxfattribs={
                    "layer": e.layer, "height": 0.0025 * dr.scale,
                    "rotation": ang if -90 < ang <= 90 else ang + 180})
                t.set_placement(((a[0] + c[0]) / 2, (a[1] + c[1]) / 2))

        t = msp.add_text(dr.title, dxfattribs={"layer": "text",
                                               "height": 0.004 * dr.scale})
        t.set_placement((cursor, (y1 - y0) / 1000.0 + 0.4))
        cursor += (x1 - x0) / 1000.0 + gap

    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")
