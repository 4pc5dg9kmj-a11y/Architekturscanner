"""DXF-Export des Projekts (Linien, Massketten, Texte) mit getrennten Layern.

Koordinaten: Bild-Pixel (y nach unten) -> Meter (y nach oben) ueber den
kalibrierten Massstab. Die DXF-Datei ist in Metern ($INSUNITS = 6) und laesst
sich in AutoCAD, BricsCAD, LibreCAD usw. oeffnen; von dort ist "Speichern als
DWG" bzw. der ODA File Converter der Weg zu echtem DWG.
"""

from __future__ import annotations

import io

import ezdxf
from ezdxf.enums import TextEntityAlignment

# Zuordnung CSS-Hexfarbe -> naechster AutoCAD Color Index geschieht ueber ezdxf
from ezdxf import colors as ezcolors


def _hex_to_rgb(hexcolor: str) -> tuple[int, int, int]:
    h = hexcolor.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _safe_layer_name(name: str) -> str:
    """DXF verbietet u.a. <>/\\":;?*|=` in Tabellennamen."""
    cleaned = "".join("_" if c in '<>/\\":;?*|=`' else c for c in name).strip()
    return cleaned or "LAYER"


def export_dxf(project: dict) -> bytes:
    px_per_m = float(project.get("pxPerMeter") or 0)
    if px_per_m <= 0:
        # ohne Kalibrierung: 100 px = 1 m als neutrale Annahme
        px_per_m = 100.0
    img_h = float(project.get("imgH") or 0)
    dim_decimals = int(project.get("dimDecimals", 2))

    def tr(x: float, y: float) -> tuple[float, float]:
        return x / px_per_m, (img_h - y) / px_per_m

    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 6  # Meter
    doc.header["$MEASUREMENT"] = 1
    msp = doc.modelspace()

    dimstyle = doc.dimstyles.duplicate_entry("EZDXF", "SCAN")
    dimstyle.dxf.dimtxt = 0.12          # Texthoehe in m (lesbar bei 1:100)
    dimstyle.dxf.dimasz = 0.08
    dimstyle.dxf.dimexo = 0.05
    dimstyle.dxf.dimexe = 0.05
    dimstyle.dxf.dimdec = dim_decimals
    dimstyle.dxf.dimlfac = 1.0      # Messwert = Zeichnungseinheit (Meter)
    dimstyle.dxf.dimzin = 0         # Nachkommastellen nicht unterdruecken (2,00)
    dimstyle.dxf.dimdsep = ord(",")
    dimstyle.dxf.dimtsz = 0.08          # Architektur-Schraegstriche statt Pfeile
    dimstyle.dxf.dimgap = 0.03

    layer_names: dict = {}
    used_names: set[str] = set()
    for layer in project.get("layers", []):
        name = _safe_layer_name(layer["name"])
        while name.lower() in used_names or name == "0":
            name += "_"
        used_names.add(name.lower())
        layer_names[layer["id"]] = name
        dxf_layer = doc.layers.add(name)
        rgb = _hex_to_rgb(layer.get("color", "#ffffff"))
        dxf_layer.color = _nearest_aci(rgb)
        dxf_layer.rgb = rgb

    for ent in project.get("entities", []):
        lname = layer_names.get(ent.get("layer"), "0")
        attribs = {"layer": lname}
        etype = ent.get("type")
        if etype == "line":
            if ent.get("lt") == "dashed":
                attribs["linetype"] = "DASHED"
            msp.add_line(tr(ent["x1"], ent["y1"]), tr(ent["x2"], ent["y2"]),
                         dxfattribs=attribs)
        elif etype == "polyline":
            pts = [tr(px, py) for px, py in ent.get("points", [])]
            if len(pts) >= 2:
                msp.add_lwpolyline(pts, dxfattribs=attribs)
        elif etype == "fill":
            outer = [tr(px, py) for px, py in ent.get("outer", [])]
            if len(outer) >= 3:
                msp.add_lwpolyline(outer, close=True, dxfattribs=dict(attribs))
                hatch = msp.add_hatch(dxfattribs=dict(attribs))
                hatch.paths.add_polyline_path(outer, is_closed=True, flags=1)
                for hole in ent.get("holes", []):
                    hpts = [tr(px, py) for px, py in hole]
                    if len(hpts) >= 3:
                        msp.add_lwpolyline(hpts, close=True, dxfattribs=dict(attribs))
                        hatch.paths.add_polyline_path(hpts, is_closed=True, flags=0)
        elif etype == "text":
            x, y = tr(ent["x"], ent["y"])
            height = max(float(ent.get("size", 12)) / px_per_m, 0.05)
            text = msp.add_text(ent.get("text", ""),
                                dxfattribs={**attribs, "height": height,
                                            "rotation": float(ent.get("angle", 0))})
            text.set_placement((x, y), align=TextEntityAlignment.BOTTOM_LEFT)
        elif etype == "dim":
            _export_dim_chain(msp, ent, tr, attribs, px_per_m)

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


def _nearest_aci(rgb: tuple[int, int, int]) -> int:
    best, best_d = 7, 1e18
    for aci in range(1, 256):
        r, g, b = ezcolors.aci2rgb(aci)
        d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2
        if d < best_d:
            best, best_d = aci, d
    return best


def _export_dim_chain(msp, ent: dict, tr, attribs: dict, px_per_m: float) -> None:
    """Masskette: fuer jedes Teilstueck eine ALIGNED-Dimension auf gemeinsamer Linie."""
    pts = ent.get("points", [])
    if len(pts) < 2:
        return
    offset = float(ent.get("offset", 30)) / px_per_m
    overrides = ent.get("overrides") or {}
    for i in range(len(pts) - 1):
        p1 = tr(pts[i][0], pts[i][1])
        p2 = tr(pts[i + 1][0], pts[i + 1][1])
        text = overrides.get(str(i)) or "<>"
        dim = msp.add_aligned_dim(p1=p1, p2=p2, distance=offset, text=text,
                                  dimstyle="SCAN", dxfattribs=dict(attribs))
        dim.render()
