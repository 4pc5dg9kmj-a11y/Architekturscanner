"""Prueft die Kernzusagen des Fahrradhaeuschen-Planers.

Aufruf:  python -m pytest tests -q     oder     python tests/test_shed.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shed.api import plan_payload                                    # noqa: E402
from shed.bom import cost_summary, fasteners, materials, timber_list  # noqa: E402
from shed.compliance import (MIN_DEPTH, check_all, is_compliant,      # noqa: E402
                             optimize, summary)
from shed.drawings import all_drawings                                # noqa: E402
from shed.dxf import export_dxf                                       # noqa: E402
from shed.instructions import build_steps                             # noqa: E402
from shed.model import build, compute_dims                            # noqa: E402
from shed.pdf import build_pdf                                        # noqa: E402
from shed.spec import (BODENPLATTE_D, DACH_UEBERSTAND_GRENZE,          # noqa: E402
                       FASSADE_LUFT, HBO_MAX_BRI, HBO_MAX_WANDHOEHE,
                       ShedSpec)
from shed.statics import (beam_proof, bearing_proof, column_proof,     # noqa: E402
                          select_joist, select_lintel,
                          select_lintel_with_posts, select_rafter,
                          snow_load)
from shed.structure import report as structural_report              # noqa: E402
from shed.structure import summary as structural_summary
from shed.text import de, nz                                          # noqa: E402


# --------------------------------------------------------------------------
# Bauordnung
# --------------------------------------------------------------------------


def test_optimierte_variante_ist_verfahrensfrei():
    b = build(optimize())
    st = summary(check_all(b))
    assert st["state"] == "ok", st
    assert b.dims["bri"] <= HBO_MAX_BRI
    assert b.dims["z_roof_rear"] <= HBO_MAX_WANDHOEHE


def test_optimierer_reizt_die_huelle_wirklich_aus():
    """Ein Rad mehr muss die Verfahrensfreiheit kippen."""
    best = optimize()
    b = build(best)
    assert b.dims["bri"] > 27.5, "Optimierer laesst zu viel Luft"
    groesser = ShedSpec(**{**best.to_dict(), "n_bikes": best.n_bikes + 1})
    assert compute_dims(groesser)["bri"] > HBO_MAX_BRI - 0.5


def test_zu_grosses_haeuschen_faellt_durch():
    spec = ShedSpec(n_bikes=12, tool_width=2500, depth=3000, eaves_height=2400)
    b = build(spec)
    checks = {c.key: c for c in check_all(b)}
    assert checks["bri"].status == "fail"
    assert summary(check_all(b))["state"] == "fail"


def test_steile_neigung_verletzt_die_grenzwandhoehe():
    spec = ShedSpec(n_bikes=4, roof_pitch=25, eaves_height=2400, depth=2600)
    assert build(spec).dims["z_roof_rear"] > HBO_MAX_WANDHOEHE


def test_aussenbereich_ist_nicht_verfahrensfrei():
    b = build(ShedSpec(**{**optimize().to_dict(), "site": "aussenbereich"}))
    checks = {c.key: c for c in check_all(b)}
    assert checks["lage"].status == "fail"


def test_kein_bauteil_ragt_ueber_die_grenze():
    """Alles bei y <= 0 waere Ueberbau des Nachbargrundstuecks."""
    b = build(optimize())
    assert DACH_UEBERSTAND_GRENZE <= FASSADE_LUFT
    for m in b.members:
        for v in m.verts:
            assert v[1] >= -0.01, f"{m.name} ragt ueber die Grenze: y={v[1]}"
    for p in b.panels:
        for v in p.verts:
            assert v[1] >= -0.01, f"{p.name} ragt ueber die Grenze: y={v[1]}"


def test_dach_faellt_von_der_grenze_weg():
    d = build(optimize()).dims
    assert d["z_roof_rear"] > d["z_roof_front"], "Traufwasser liefe zum Nachbarn"


# --------------------------------------------------------------------------
# Geometrie
# --------------------------------------------------------------------------


def test_fahrrad_passt_in_die_tiefe():
    spec = optimize()
    assert spec.depth >= MIN_DEPTH
    assert build(spec).dims["inner_d"] >= 2000


def test_dachaufbau_liegt_ueber_dem_tragwerk():
    b = build(optimize())
    sparren = [m for m in b.members if m.name == "Sparren"][0]
    latte = [m for m in b.members if m.name == "Traglatte"][0]
    haut = [p for p in b.panels if p.group == "dachhaut"][0]
    assert max(v[2] for v in latte.verts) <= max(v[2] for v in sparren.verts) + 60
    assert max(v[2] for v in haut.verts) >= max(v[2] for v in latte.verts)


def test_lastpfad_ist_eine_auflagerkette():
    """Sparren, Staender und Deckenbalken stehen senkrecht uebereinander."""
    b = build(optimize())
    d = b.dims
    # Achsen liegen in Staenderwerkskoordinaten, Bauteile in Weltkoordinaten
    axes = [round(x + FASSADE_LUFT, 1) for x in d["axes_x"]]

    def x_axes(pred):
        return sorted({round((min(v[0] for v in m.verts)
                              + max(v[0] for v in m.verts)) / 2, 1)
                       for m in b.members if pred(m) and m.verts})

    assert x_axes(lambda m: m.name in ("Sparren", "Aussensparren")) == axes
    assert x_axes(lambda m: m.name == "Deckenbalken") == axes
    staender = x_axes(lambda m: m.group == "wand_front" and "Ständer" in m.name)
    assert set(staender) <= set(axes)

    # jede Achse hat ein Fundament senkrecht darunter
    sup_x = {round(x, 1) for x, _ in d["support_xy"]}
    assert set(axes) <= sup_x


def test_balken_liegen_auf_ihren_stuetzen():
    """Keine Lage haengt in der Luft: Unterkante = Oberkante der Lage darunter."""
    b = build(optimize())
    d = b.dims
    tol = 1.0

    def zmin(name):
        ms = [m for m in b.members if m.name.startswith(name) and m.verts]
        return min(min(v[2] for v in m.verts) for m in ms)

    def zmax(name):
        ms = [m for m in b.members if m.name.startswith(name) and m.verts]
        return max(max(v[2] for v in m.verts) for m in ms)

    assert abs(zmin("Schwelle") - 0.0) < tol                 # auf dem Fundament
    assert abs(zmin("Deckenbalken") - zmax("Schwelle")) < tol
    assert abs(d["z_floor"] - (zmax("Deckenbalken")
                               + (BODENPLATTE_D if b.spec.with_floor else 0))) < tol
    # Sparrenunterkante muss beide Raehme beruehren
    sp = [m for m in b.members if m.name == "Sparren"][0]
    p0, p1 = sp.verts[0], sp.verts[4]        # Unterkante Anfang und Ende

    def z_at(y):
        return p0[2] + (p1[2] - p0[2]) * (y - p0[1]) / (p1[1] - p0[1])

    oy, fd = FASSADE_LUFT, d["frame_d"]
    assert abs(z_at(oy) - d["z_plate_top_rear"]) < tol
    assert abs(z_at(oy + fd) - d["z_plate_top_front"]) < tol


def test_tuerblatt_liegt_in_der_fassadenebene():
    b = build(optimize())
    d = b.dims
    for p in b.panels:
        if p.group != "tuerblatt":
            continue
        assert max(v[1] for v in p.verts) == d["depth_out"]


def test_geraeteraum_verschwindet_bei_null():
    b = build(ShedSpec(n_bikes=4, tool_width=0))
    assert not b.spec.has_tool_room
    assert b.by_group("trennwand") == []
    assert not [o for o in b.openings if "Geraet" in o.name]


# --------------------------------------------------------------------------
# Statik
# --------------------------------------------------------------------------


def test_schneelast_hessen_zone2():
    assert 0.8 <= snow_load("2", 250) <= 1.0
    assert snow_load("2", 800) > snow_load("2", 250)


def test_sparren_wachsen_mit_spannweite_und_last():
    klein = select_rafter(2200, 625, "trapez", 8, "2", 250)[0]
    weit = select_rafter(4200, 625, "trapez", 8, "2", 250)[0]
    schwer = select_rafter(3000, 625, "green", 8, "2", 250)[0]
    leicht = select_rafter(3000, 625, "trapez", 8, "2", 250)[0]
    assert weit[1] > klein[1]
    assert schwer[1] > leicht[1]
    assert select_joist(2400, 625)[1].ok
    assert select_lintel(3000, 1400, "trapez", 8, "2", 250)[1].ok
    _, proof, posts = select_lintel_with_posts(
        5400, 240, 1900, "green", 5, "2", 250)
    assert posts >= 1 and proof.ok


def test_durchbiegung_wird_wirklich_gerechnet():
    """Der Nachweis darf nicht durch einen Einheitenfehler bei null landen."""
    p = beam_proof("t", "Test", "Test", 60, 120, 3000, 0.63, 0.90)
    durchbiegung = [r for r in p.results if "Durchbiegung" in r[0]][0]
    assert 0.1 < durchbiegung[3] <= 1.5


def test_alle_hoelzer_sind_nachgewiesen():
    """Jedes tragende Holz und jedes Auflager braucht seinen Nachweis."""
    b = build(optimize())
    proofs = structural_report(b)
    keys = {p.key for p in proofs}
    for k in ("traglatte", "sparren", "auflager_sparren", "raehm", "sturz",
              "staender", "auflager_staender", "deckenbalken",
              "auflager_balken", "schwelle", "baugrund"):
        assert k in keys, f"Nachweis fehlt: {k}"
    assert structural_summary(proofs)["state"] == "ok"
    for p in proofs:
        assert p.results, p.key
        assert p.util <= 1.0, f"{p.title} ueberlastet: {p.util}"


def test_querdruck_an_jedem_auflager():
    """Balken auf Stuetze heisst: die Auflagerpressung muss geprueft sein."""
    proofs = structural_report(build(optimize()))
    querdruck = [p for p in proofs if p.kind == "querdruck"]
    assert len(querdruck) >= 3
    for p in querdruck:
        assert "N/mm" in p.results[0][1]


def test_breite_oeffnung_bekommt_eine_zwischenstuetze():
    """Was sich nicht ueberspannen laesst, wird abgestuetzt - nie ueberlastet."""
    spec = ShedSpec(n_bikes=10, depth=3200, roofing="green", roof_pitch=3,
                    closure="open_front", tool_width=0)
    b = build(spec)
    assert b.dims["lintel_posts"] >= 1
    assert structural_summary(structural_report(b))["state"] == "ok"
    stuetzen = [m for m in b.members if "Zwischenstuetze" in m.name]
    assert stuetzen, "Zwischenstuetze fehlt im Modell"


def test_jede_konfiguration_ist_nachgewiesen():
    """Kein Reglerweg darf zu einem ueberlasteten Bauteil fuehren."""
    for bikes in (0, 5, 10):
        for depth in (2100, 2700, 3200):
            for roofing in ("trapez", "green"):
                for closure in ("closed_double", "open_front"):
                    b = build(ShedSpec(n_bikes=bikes, depth=depth,
                                       roofing=roofing, closure=closure,
                                       tool_width=1500))
                    st = structural_summary(structural_report(b))
                    assert st["state"] == "ok", (bikes, depth, roofing,
                                                 closure, st["fails"])


def test_querschnitte_wachsen_mit_der_belastung():
    klein = build(ShedSpec(n_bikes=4, depth=2300)).dims
    gross = build(ShedSpec(n_bikes=4, depth=3200, roofing="green")).dims
    assert gross["sparren"][1] >= klein["sparren"][1]
    assert gross["joist"][1] >= klein["joist"][1]
    weit = build(ShedSpec(n_bikes=8, tool_width=0, closure="open_front")).dims
    assert weit["lintel"][1] >= klein["lintel"][1]


# --------------------------------------------------------------------------
# Materiallisten
# --------------------------------------------------------------------------


def test_zuschnitt_deckt_jedes_bauteil_ab():
    b = build(optimize())
    for line in timber_list(b):
        gebraucht = sum(ln for _, ln in
                        [c for bar in line.bars for c in bar.pieces])
        assert gebraucht >= line.needed_m * 1000 - 1, line.profile
        for bar in line.bars:
            assert bar.used <= bar.length + 0.5, "Stange ueberbelegt"


def test_verschnitt_bleibt_vertretbar():
    b = build(optimize())
    assert cost_summary(b)["verschnitt_pct"] < 25


def test_listen_sind_vollstaendig():
    b = build(optimize())
    namen = " ".join(i.name for i in fasteners(b))
    assert "Winkelverbinder" in namen
    assert "Sparren-Pfettenanker" in namen or "Pfettenanker" in namen
    mat = " ".join(i.name for i in materials(b))
    assert "Trapezblech" in mat
    assert "Gehwegplatte" in mat


def test_gruendach_erzeugt_andere_werkstoffe():
    b = build(ShedSpec(**{**optimize().to_dict(), "roofing": "green"}))
    mat = " ".join(i.name for i in materials(b))
    assert "Sedum" in mat or "Substrat" in mat


# --------------------------------------------------------------------------
# Ausgaben
# --------------------------------------------------------------------------


def test_zeichnungssatz_ist_vollstaendig():
    keys = {d.key for d in all_drawings(build(optimize()))}
    for k in ("grundriss", "schnitt_aa", "ansicht_front", "ansicht_rear",
              "dachplan", "fundament", "lageplan", "riegel_front"):
        assert k in keys


def test_zeichnungen_haben_bemassung_und_ausdehnung():
    for d in all_drawings(build(optimize())):
        x0, y0, x1, y1 = d.bounds()
        assert x1 - x0 > 100 and y1 - y0 > 100, d.key
        if d.key.startswith(("grundriss", "ansicht", "schnitt")):
            assert any(e.kind == "dim" for e in d.ents), d.key


def test_pdf_und_dxf_entstehen():
    b = build(optimize())
    pdf = build_pdf(b)
    assert pdf.startswith(b"%PDF") and len(pdf) > 40_000
    dxf = export_dxf(b)
    assert b"SECTION" in dxf and len(dxf) > 20_000


def test_bauanleitung_nennt_die_kritischen_punkte():
    b = build(optimize())
    steps = build_steps(b)
    assert len(steps) >= 8
    text = " ".join(p for s in steps for p in s.body)
    assert "Grenze" in text
    assert "Diagonal" in text
    for s in steps:
        assert s.body, s.title


def test_nutzlast_ist_deutsch_und_serialisierbar():
    import json
    p = plan_payload(optimize())
    blob = json.dumps(p, ensure_ascii=False)
    assert "Grundstuecksgrenze" not in blob
    assert "Staenderwerk" not in blob
    assert "Grundstücksgrenze" in blob
    # die Eingabewerte muessen unveraendert zurueckkommen
    assert p["spec"]["price_level"] in ("guenstig", "mittel", "premium")
    assert p["spec"]["foundation"] in ("slabs", "point", "screw", "concrete")


def test_textwandlung():
    assert de("GRUNDSTUECKSGRENZE") == "GRUNDSTÜCKSGRENZE"
    assert de("Fassade") == "Fassade"          # kein falsches Eszett
    assert de("Wasser") == "Wasser"
    assert de("Aussenmass") == "Außenmaß"
    assert nz(1234.5, 2) == "1.234,50"


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  ok    {name}")
        except AssertionError as exc:
            fails += 1
            print(f"  FEHLER {name}: {exc}")
        except Exception as exc:                       # noqa: BLE001
            fails += 1
            print(f"  FEHLER {name}: {type(exc).__name__}: {exc}")
    print("\nAlle Tests bestanden." if not fails else f"\n{fails} Test(s) fehlgeschlagen.")
    raise SystemExit(1 if fails else 0)
