"""Serialisierung des Planungsergebnisses fuer die Weboberflaeche."""

from __future__ import annotations

from .bom import cost_summary, fasteners, materials, timber_list, weight_estimate
from .compliance import check_all, max_bikes_for, summary
from .drawings import LAYERS, all_drawings
from .instructions import build_steps, maintenance, prepare_notes, tool_list
from .model import Building, build
from .text import de_deep
from .spec import (
    HBO_MAX_BRI,
    HBO_MAX_GRENZLAENGE,
    HBO_MAX_WANDHOEHE,
    ShedSpec,
)

# Farben der 3D-Ansicht je Bauteilgruppe
COLORS = {
    "fundament": "#9aa0a6",
    "rost": "#8a6a44",
    "boden": "#c9a06a",
    "wand_rear": "#d8b98a", "wand_front": "#d8b98a",
    "wand_left": "#d8b98a", "wand_right": "#d8b98a",
    "trennwand": "#cfae7f",
    "dach": "#a4753f",
    "dachhaut": "#4a4f55",
    "fassade": "#c49a63",
    "fassade_flaeche": "#b98a52",
    "tuer": "#8f6234",
    "tuerblatt": "#a97640",
    "einbau": "#7f9f7a",
    "folie": "#d5d5d5",
}

GROUP_LABEL = {
    "fundament": "Gruendung", "rost": "Schwellenrost", "boden": "Boden",
    "wand_rear": "Ständerwerk", "wand_front": "Ständerwerk",
    "wand_left": "Ständerwerk", "wand_right": "Ständerwerk",
    "trennwand": "Trennwand", "dach": "Dachtragwerk", "dachhaut": "Dachhaut",
    "fassade": "Konterlattung", "fassade_flaeche": "Fassade",
    "tuer": "Tueren", "tuerblatt": "Tueren", "einbau": "Einbauten",
    "folie": "Folien",
}

# Reihenfolge der Ein-/Ausblendbaren Ebenen in der 3D-Ansicht
LAYER_ORDER = ["Gruendung", "Schwellenrost", "Boden", "Ständerwerk", "Trennwand",
               "Dachtragwerk", "Dachhaut", "Konterlattung", "Fassade",
               "Tueren", "Einbauten"]


def model3d(b: Building) -> dict:
    """Bauteile als Quader/Flaechen fuer den Canvas-Renderer."""
    solids = []
    for m in b.members:
        if not m.verts:
            continue
        solids.append({
            "kind": "box",
            "v": [[round(c, 1) for c in p] for p in m.verts],
            "c": COLORS.get(m.group, "#c0a070"),
            "g": GROUP_LABEL.get(m.group, m.group),
            "n": m.name,
            "p": m.profile_label,
            "l": round(m.length),
        })
    for p in b.panels:
        if not p.verts or p.group == "folie":
            continue
        solids.append({
            "kind": p.kind,
            "v": [[round(c, 1) for c in q] for q in p.verts],
            "c": COLORS.get(p.group, "#bbbbbb"),
            "g": GROUP_LABEL.get(p.group, p.group),
            "n": p.name,
            "p": f"{p.thickness:.0f} mm",
            "l": 0,
        })
    d = b.dims
    return {
        "solids": solids,
        "layers": LAYER_ORDER,
        "center": [d["length_out"] / 2, d["depth_out"] / 2, d["z_roof_rear"] / 2],
        "size": max(d["length_out"], d["depth_out"], d["z_roof_rear"]),
    }


def plan_payload(spec: ShedSpec) -> dict:
    """Vollstaendige Nutzlast in korrektem Deutsch.

    ``spec`` bleibt bewusst unuebersetzt: die Werte sind Schluessel, die der
    Client unveraendert zurueckschickt.
    """
    payload = _payload(spec)
    raw_spec = payload.pop("spec")
    out = de_deep(payload)
    out["spec"] = raw_spec
    return out


def _payload(spec: ShedSpec) -> dict:
    b = build(spec)
    d = b.dims
    checks = check_all(b)
    lines = timber_list(b)

    return {
        "spec": spec.to_dict(),
        "dims": {k: (list(v) if isinstance(v, tuple) else v)
                 for k, v in d.items() if k != "sparren_check"},
        "sparren_check": d["sparren_check"],
        "kpi": {
            "laenge": round(d["length_out"]),
            "tiefe": round(d["depth_out"]),
            "grundflaeche": round(d["footprint"], 2),
            "bri": round(d["bri"], 2),
            "bri_max": HBO_MAX_BRI,
            "bri_pct": round(d["bri"] / HBO_MAX_BRI * 100),
            "grenzhoehe": round(d["z_roof_rear"]),
            "grenzhoehe_max": HBO_MAX_WANDHOEHE,
            "grenzhoehe_pct": round(d["z_roof_rear"] / HBO_MAX_WANDHOEHE * 100),
            "grenzlaenge": round(d["length_out"]),
            "grenzlaenge_max": HBO_MAX_GRENZLAENGE,
            "grenzlaenge_pct": round(d["length_out"] / HBO_MAX_GRENZLAENGE * 100),
            "lichte_vorn": round(d["clear_height_front"]),
            "lichte_hinten": round(d["clear_height_rear"]),
            "sparren": f"{d['sparren'][0]:.0f} x {d['sparren'][1]:.0f}",
            "sparren_eta": d["sparren_check"].get("eta_max", 0),
            "dachflaeche": round(d["roof_area"], 2),
            "geraetflaeche": round(d["tool_w"] * d["inner_d"] / 1e6, 2),
            "max_bikes": max_bikes_for(spec),
        },
        "checks": [c.to_dict() for c in checks],
        "summary": summary(checks),
        "cost": cost_summary(b),
        "weight": weight_estimate(b),
        "timber": [{
            "profile": l.profile, "material": l.material,
            "buy": [{"len": k, "n": v} for k, v in l.count_by_length.items()],
            "needed_m": round(l.needed_m, 1), "bought_m": round(l.total_bought_m, 1),
            "waste": round(l.waste_pct, 1), "cost": round(l.cost, 2),
            "bars": [{"len": bar.length, "rest": round(bar.rest),
                      "cuts": [{"n": nm, "l": round(ln)} for nm, ln in bar.pieces]}
                     for bar in l.bars],
        } for l in lines],
        "fasteners": [{"name": i.name, "qty": round(i.qty, 1), "unit": i.unit,
                       "note": i.note, "cost": round(i.cost, 2), "group": i.group}
                      for i in fasteners(b)],
        "materials": [{"name": i.name, "qty": round(i.qty, 1), "unit": i.unit,
                       "note": i.note, "cost": round(i.cost, 2), "group": i.group}
                      for i in materials(b)],
        "steps": [s.to_dict() for s in build_steps(b)],
        "notes": prepare_notes(b),
        "tools": tool_list(b),
        "maintenance": maintenance(b),
        "drawings": [dr.to_dict() for dr in all_drawings(b)],
        "layers": {k: {"width": v[0], "color": v[1], "style": v[2]}
                   for k, v in LAYERS.items()},
        "model3d": model3d(b),
    }
