"""Kommandozeile:  python -m printbuilder foto.jpg -o relief.stl --breite 120

Alle Regler der Weboberflaeche gibt es auch hier; nicht genannte Werte bleiben
auf den Vorgaben.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .builder import build_relief
from .image_prep import decode_image
from .mesh import EXPORTERS
from .params import PRESETS, ReliefParams


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="python -m printbuilder",
        description="Foto -> 3D-Druckdatei: Platte mit bildgebenden Linien.",
    )
    ap.add_argument("bild", type=Path, help="Foto (JPG/PNG/...) oder PDF")
    ap.add_argument("-o", "--ausgabe", type=Path, default=None,
                    help="Zieldatei (.stl, .3mf oder .obj; Vorgabe: <bild>.stl)")
    ap.add_argument("--preset", choices=sorted(PRESETS), default="welle")
    ap.add_argument("--vorschau", type=Path, default=None,
                    help="PNG der Draufsicht zusaetzlich speichern")

    plate = ap.add_argument_group("Platte")
    plate.add_argument("--breite", type=float, help="Plattenbreite in mm")
    plate.add_argument("--hoehe", type=float, help="Plattenhoehe in mm (0 = automatisch)")
    plate.add_argument("--dicke", type=float, help="Plattendicke in mm")
    plate.add_argument("--rand", type=float, help="Rand in mm")
    plate.add_argument("--ohne-rahmen", action="store_true")

    lines = ap.add_argument_group("Linien")
    lines.add_argument("--linien", type=int, help="Anzahl Linien")
    lines.add_argument("--winkel", type=float, help="0 = senkrecht, 90 = waagerecht")
    lines.add_argument("--amplitude", type=float, help="max. Auslenkung in mm")
    lines.add_argument("--wellenlaenge", type=float, help="Wellenlaenge in mm")
    lines.add_argument("--strich-min", type=float, help="Linienbreite hell (mm)")
    lines.add_argument("--strich-max", type=float, help="Linienbreite dunkel (mm)")
    lines.add_argument("--hoch-min", type=float, help="Linienhoehe hell (mm)")
    lines.add_argument("--hoch-max", type=float, help="Linienhoehe dunkel (mm)")

    image = ap.add_argument_group("Bild")
    image.add_argument("--negativ", action="store_true", help="hell/dunkel tauschen")
    image.add_argument("--gamma", type=float)
    image.add_argument("--kontrast", type=float)
    image.add_argument("--helligkeit", type=float)
    return ap


_MAP = {
    "breite": "width_mm", "hoehe": "height_mm", "dicke": "plate_thickness_mm",
    "rand": "margin_mm", "linien": "line_count", "winkel": "angle_deg",
    "amplitude": "wave_amp_mm", "wellenlaenge": "wave_len_mm",
    "strich_min": "line_width_min_mm", "strich_max": "line_width_max_mm",
    "hoch_min": "line_height_min_mm", "hoch_max": "line_height_max_mm",
    "gamma": "gamma", "kontrast": "contrast", "helligkeit": "brightness",
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    values = dict(PRESETS[args.preset]["values"])
    for cli_name, field_name in _MAP.items():
        value = getattr(args, cli_name, None)
        if value is not None:
            values[field_name] = value
    if args.negativ:
        values["invert"] = True
    if args.ohne_rahmen:
        values["frame"] = False
    params = ReliefParams.from_dict(values)

    out = args.ausgabe or args.bild.with_suffix(".stl")
    fmt = out.suffix.lower().lstrip(".")
    if fmt not in EXPORTERS:
        print(f"Unbekanntes Format '.{fmt}' - moeglich: "
              f"{', '.join(sorted(EXPORTERS))}", file=sys.stderr)
        return 2

    gray = decode_image(args.bild.read_bytes())
    # Die Vorschau wird immer gerastert: daraus stammt die Materialschaetzung.
    result = build_relief(gray, params, with_previews=True)
    out.write_bytes(EXPORTERS[fmt](result.mesh))

    s = result.stats
    print(f"{out}  ({out.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"  Platte      {s['width_mm']} x {s['height_mm']} x "
          f"{s['total_height_mm']} mm")
    print(f"  Linien      {s['line_count']} im Abstand {s['spacing_mm']} mm, "
          f"{s['line_length_m']} m Gesamtlaenge")
    print(f"  Dreiecke    {s['triangles']:,}".replace(",", "."))
    print(f"  Material    ca. {s['filament_g']} g / {s['filament_m']} m Filament")
    for note in s.get("notes", []):
        print(f"  Hinweis     {note}")

    if args.vorschau:
        import base64
        data = result.previews["topview"].split(",", 1)[1]
        args.vorschau.write_bytes(base64.b64decode(data))
        print(f"  Vorschau    {args.vorschau}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
