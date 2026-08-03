"""Statischer Nachweis des gesamten Bauwerks.

Verfolgt den Lastweg von der Dachhaut bis in den Baugrund und weist jedes
tragende Holz nach - Biegung, Schub, Durchbiegung, Knicken und die
Querdruckspannung an jeder Auflagerstelle.

Der Lastweg ist eine reine Auflagerkette:

    Dachhaut -> Traglatte -> Sparren -> Raehm -> Staender -> Fussriegel
             -> Bodenplatte -> Deckenbalken -> Schwelle -> Fundament -> Boden

Sparren, Staender und Deckenbalken stehen im selben Achsraster senkrecht
uebereinander. Dadurch laeuft die Dachlast gerade nach unten und die
waagerechten Hoelzer (Raehm, Schwelle) muessen sie nicht ueber Biegung
umlenken. Nachgewiesen werden sie trotzdem - fuer den Fall, dass ein
Sparren beim Bauen zwischen zwei Staendern landet.
"""

from __future__ import annotations

import math

from .model import Building
from .spec import DACHLATTE, DACH_UEBERSTAND_TRAUFE, SCHWELLE, WAND_STIEL
from .statics import (G_FLOOR, G_WALL, Q_FLOOR, Proof, bearing_proof,
                      beam_proof, column_proof, roof_dead_load, roof_snow,
                      soil_proof)


def _loads(b: Building) -> dict:
    """Charakteristische und Bemessungslasten des Bauwerks."""
    d, spec = b.dims, b.spec
    alpha = d["pitch_rad"]
    g_roof = roof_dead_load(spec.roofing) / max(math.cos(alpha), 0.1) + 0.10
    s_roof = roof_snow(spec.snow_zone, spec.altitude, spec.roof_pitch)
    return {
        "g_roof": g_roof,
        "s_roof": s_roof,
        "q_roof_k": g_roof + s_roof,
        "q_roof_d": 1.35 * g_roof + 1.5 * s_roof,
        "q_floor_k": G_FLOOR + Q_FLOOR,
        "q_floor_d": 1.35 * G_FLOOR + 1.5 * Q_FLOOR,
        "e": d["e_axis"] / 1000.0,
    }


def stud_load(b: Building, wall: str = "front") -> tuple[float, float]:
    """Normalkraft je Staender in kN (charakteristisch, Bemessungswert)."""
    d = b.dims
    L = _loads(b)
    e = L["e"]
    # Lasteinzugstiefe: halbe Sparrenspannweite, an der Traufe zusaetzlich
    # der Kragarm des Dachueberstands
    trib = d["frame_d"] / 2000.0
    if wall == "front":
        trib += DACH_UEBERSTAND_TRAUFE / 1000.0
    a_roof = e * trib
    h_wall = (d["z_plate_top_front"] if wall == "front"
              else d["z_plate_top_rear"]) / 1000.0
    n_k = L["q_roof_k"] * a_roof + G_WALL * e * h_wall
    n_d = L["q_roof_d"] * a_roof + 1.35 * G_WALL * e * h_wall
    return n_k, n_d


def sill_load(b: Building) -> tuple[float, float]:
    """Streckenlast auf der hoechstbelasteten Schwelle in kN/m."""
    d = b.dims
    L = _loads(b)
    n_k, n_d = stud_load(b, "front")
    # Wand- und Dachlast je Achse plus Auflagerkraft der Bodenlage
    floor_span = d["frame_d"] / 2000.0
    r_floor_k = L["q_floor_k"] * L["e"] * floor_span * 0.5
    r_floor_d = L["q_floor_d"] * L["e"] * floor_span * 0.5
    p_k = (n_k + r_floor_k) / L["e"]
    p_d = (n_d + r_floor_d) / L["e"]
    return p_k, p_d


def report(b: Building) -> list[Proof]:
    """Alle Nachweise in der Reihenfolge des Lastwegs."""
    d, spec = b.dims, b.spec
    L = _loads(b)
    e = L["e"]
    out: list[Proof] = []

    # 1 -- Traglattung: spannt zwischen den Sparren
    latt_e = d["roof_slope_len"] / max(1, d.get("n_latt", 4) - 1) / 1000.0
    out.append(beam_proof(
        "traglatte", "Traglattung", "Dachhaut",
        DACHLATTE[1], DACHLATTE[0], d["e_axis"],
        L["q_roof_k"] * latt_e, L["q_roof_d"] * latt_e, "kurz", 200,
        note=f"Spannt {d['e_axis']:.0f} mm zwischen zwei Sparren, "
             f"Lasteinzugsbreite {latt_e * 1000:.0f} mm. Liegt auf jedem "
             "Sparren auf und wird dort verschraubt."))

    # 2 -- Sparren
    sp = d["sparren_proof"]
    sp.member = "Dachtragwerk"
    sp.note += (" Liegt mit Kerve auf beiden Raehmen auf; jeder Sparren steht "
                "senkrecht ueber einem Staender.")
    out.append(sp)

    # 3 -- Auflager Sparren auf Raehm
    n_k, n_d = stud_load(b, "front")
    out.append(bearing_proof(
        "auflager_sparren", "Sparren auf dem Raehm", "Dachtragwerk",
        d["sparren"][0], WAND_STIEL[0], n_d, "kurz",
        note="Kerve nicht tiefer als ein Drittel der Sparrenhoehe "
             f"({d['sparren'][1] / 3:.0f} mm) einschneiden - sonst wird der "
             "Restquerschnitt am Auflager massgebend."))

    # 4 -- Raehm zwischen zwei Staendern
    out.append(beam_proof(
        "raehm", "Raehm zwischen zwei Staendern", "Staenderwerk",
        WAND_STIEL[0], WAND_STIEL[1], d["e_axis"],
        n_k / e, n_d / e, "kurz", 300,
        note="Planmaessig steht jeder Sparren ueber einem Staender, das Raehm "
             "traegt dann nur sich selbst. Nachgewiesen ist der ungünstige "
             "Fall, dass ein Sparren mittig zwischen zwei Staendern landet."))

    # 5 -- Sturz ueber der groessten Oeffnung
    if d["widest_opening"] > 0:
        li = d["lintel_proof"]
        li.member = "Staenderwerk"
        li.title = (f"Sturz ueber der {d['widest_opening']:.0f} mm breiten "
                    "Oeffnung")
        out.append(li)

    # 6 -- Staender
    h_stud = d["z_plate_top_front"] - WAND_STIEL[1] - d["z_floor"] - 60
    out.append(column_proof(
        "staender", "Staender der Traufwand", "Staenderwerk",
        WAND_STIEL[0], WAND_STIEL[1], h_stud, n_d, "kurz"))

    # 7 -- Auflager Staender auf Fussriegel
    out.append(bearing_proof(
        "auflager_staender", "Staender auf dem Fussriegel", "Staenderwerk",
        WAND_STIEL[0], WAND_STIEL[1], n_d, "kurz",
        note="Der Fussriegel liegt quer zur Faser - hier drueckt sich der "
             "Staender ein, wenn die Flaeche zu klein wird."))

    # 8 -- Deckenbalken
    jo = d["joist_proof"]
    jo.member = "Schwellenrost"
    out.append(jo)

    # 9 -- Auflager Deckenbalken auf Schwelle
    r_floor_d = L["q_floor_d"] * e * (d["frame_d"] / 2000.0) * 1.25
    out.append(bearing_proof(
        "auflager_balken", "Deckenbalken auf der Schwelle", "Schwellenrost",
        d["joist"][0], SCHWELLE[1], r_floor_d + n_d, "mittel",
        note="Mittleres Auflager: hier laufen die Reaktionen beider Felder "
             "zusammen. Auflagerlaenge ist die volle Schwellenbreite."))

    # 10 -- Schwelle zwischen den Fundamenten
    p_k, p_d = sill_load(b)
    span = d.get("support_spacing") or d["e_axis"]
    out.append(beam_proof(
        "schwelle", "Schwelle zwischen zwei Fundamenten", "Schwellenrost",
        SCHWELLE[1], SCHWELLE[0], span, p_k, p_d, "mittel", 300,
        note=f"Liegend eingebaut ({SCHWELLE[1]:.0f} mm breit, "
             f"{SCHWELLE[0]:.0f} mm hoch), Fundamentabstand {span:.0f} mm. "
             "Traegt Wand-, Dach- und Bodenlast in die Fundamente."))

    # 11 -- Baugrund
    if d.get("support_xy"):
        size = d["support_size"]
        n_sup_k = p_k * span / 1000.0
        out.append(soil_proof(
            "baugrund", "Bodenpressung unter einem Auflager", "Gruendung",
            size * size, n_sup_k,
            note="Angesetzt ist ein tragfaehiger, verdichteter Untergrund. "
                 "Bei weichem oder aufgefuelltem Boden die Platten "
                 "vergroessern oder auf Punktfundamente wechseln."))

    return out


def summary(proofs: list[Proof]) -> dict:
    fails = [p for p in proofs if not p.ok]
    worst = max(proofs, key=lambda p: p.util) if proofs else None
    return {
        "state": "fail" if fails else "ok",
        "count": len(proofs),
        "fails": [p.key for p in fails],
        "max_util": round(worst.util, 2) if worst else 0.0,
        "worst": worst.title if worst else "",
        "text": (f"{len(fails)} Nachweis(e) nicht erfuellt" if fails
                 else f"alle {len(proofs)} Nachweise erfuellt, hoechste "
                      f"Ausnutzung {worst.util:.2f}".replace(".", ",")
                      + f" ({worst.title})"),
    }
