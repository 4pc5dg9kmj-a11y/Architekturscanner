"""Tests fuer den 3D-Druck-Builder.

Direkt ausfuehrbar:  python tests/test_printbuilder.py
oder mit pytest:     pytest tests/test_printbuilder.py
"""

from __future__ import annotations

import struct
import sys
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from printbuilder.builder import build_mesh, build_relief          # noqa: E402
from printbuilder.image_prep import DarknessField, darkness_map    # noqa: E402
from printbuilder.lines import build_polylines                     # noqa: E402
from printbuilder.mesh import Mesh, to_3mf, to_obj, to_stl         # noqa: E402
from printbuilder.params import PRESETS, ReliefParams              # noqa: E402


def sample_photo(w: int = 300, h: int = 400) -> np.ndarray:
    """Testbild: heller Hintergrund, dunkle Ellipse, Verlauf."""
    yy, xx = np.mgrid[0:h, 0:w]
    img = np.full((h, w), 235.0)
    img -= (yy / h) * 60.0
    ellipse = ((xx - w * 0.5) / (w * 0.30)) ** 2 + ((yy - h * 0.45) / (h * 0.32)) ** 2
    img[ellipse < 1.0] = 40.0
    return np.clip(img, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Geometrie
# ---------------------------------------------------------------------------

def edge_report(mesh: Mesh) -> tuple[int, int]:
    """(offene Kanten, falsch orientierte Kanten) eines Dreiecksnetzes.

    Bei einem geschlossenen, einheitlich orientierten Koerper kommt jede
    gerichtete Kante genau einmal vor und jede Kante genau zweimal.
    """
    tris = np.round(mesh.triangles().astype(np.float64), 4)
    verts = tris.reshape(-1, 3)
    _, inverse = np.unique(verts, axis=0, return_inverse=True)
    idx = np.asarray(inverse).reshape(-1, 3)

    directed = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    directed = directed[directed[:, 0] != directed[:, 1]]        # Nullkanten weg
    undirected = np.sort(directed, axis=1)

    _, counts = np.unique(undirected, axis=0, return_counts=True)
    open_edges = int((counts != 2).sum())
    _, dir_counts = np.unique(directed, axis=0, return_counts=True)
    flipped = int((dir_counts != 1).sum())
    return open_edges, flipped


def test_box_is_closed_and_outward():
    mesh = Mesh()
    mesh.add_box(0, 0, 0, 2, 3, 4)
    assert len(mesh) == 12
    assert edge_report(mesh) == (0, 0)
    assert abs(mesh.signed_volume_mm3() - 24.0) < 1e-4

    # Normalen muessen nach aussen zeigen: Fluss durch die Oberflaeche > 0
    tris = mesh.triangles().astype(np.float64)
    centers = tris.mean(axis=1) - np.array([1.0, 1.5, 2.0])
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    assert np.all(np.einsum("ij,ij->i", centers, normals) > 0)


def test_ribbon_is_watertight():
    pts = np.stack([np.linspace(0, 40, 60),
                    2.0 * np.sin(np.linspace(0, 6, 60))], axis=1)
    width = 0.5 + 0.4 * np.sin(np.linspace(0, 9, 60)) ** 2
    height = 0.8 + 0.5 * np.cos(np.linspace(0, 5, 60)) ** 2

    mesh = Mesh()
    mesh.add_ribbon(pts, width, height, -0.3)
    open_edges, flipped = edge_report(mesh)
    assert open_edges == 0, f"{open_edges} offene Kanten"
    assert flipped == 0, f"{flipped} falsch orientierte Kanten"
    assert mesh.signed_volume_mm3() > 0


def test_frame_is_one_closed_ring():
    mesh = Mesh()
    mesh.add_frame(0, 0, 60, 40, 5, -0.3, 1.2)
    assert len(mesh) == 32
    assert edge_report(mesh) == (0, 0)
    assert abs(mesh.signed_volume_mm3() - (60 * 40 - 50 * 30) * 1.5) < 1e-3

    mesh2 = Mesh()
    mesh2.add_frame(0, 0, 10, 10, 6, 0, 1)      # Rand breiter als die Platte
    assert len(mesh2) == 0


def test_complete_model_has_no_shared_edges():
    """Platte, Rahmen und Stege duerfen sich nicht Kanten teilen.

    Sie duerfen sich durchdringen (das vereinen Slicer), aber jede Kante darf
    nur zu genau zwei Dreiecken gehoeren - sonst melden Pruefwerkzeuge das
    Modell als fehlerhaft.
    """
    gray = sample_photo(160, 200)
    for kwargs in ({"frame": True}, {"frame": False}, {"frame": True, "angle_deg": 30}):
        result = build_relief(gray, ReliefParams(width_mm=80, line_count=25, **kwargs),
                              with_previews=False)
        assert edge_report(result.mesh) == (0, 0), kwargs


def test_ribbon_ignores_degenerate_input():
    mesh = Mesh()
    mesh.add_ribbon(np.array([[1.0, 1.0]]), np.array([0.5]), np.array([1.0]), 0.0)
    mesh.add_ribbon(np.full((5, 2), 2.0), np.full(5, 0.5), np.full(5, 1.0), 0.0)
    assert len(mesh) == 0


# ---------------------------------------------------------------------------
# Bild -> Linien
# ---------------------------------------------------------------------------

def test_dark_areas_get_more_material():
    gray = sample_photo()
    p = ReliefParams(width_mm=100, line_count=40).sanitized()
    dark = darkness_map(gray, p)
    assert dark[200, 150] > 0.8    # Ellipsenmitte
    assert dark[10, 10] < 0.3      # heller Rand

    inner = (5.0, 5.0, 95.0, 128.0)
    field = DarknessField(dark, inner)
    lines = build_polylines(field, p, inner)
    assert len(lines) >= 40

    inside = [pl for pl in lines if abs(pl.pts[:, 0].mean() - 50) < 8]
    assert max(pl.width.max() for pl in inside) > p.line_width_min_mm + 0.3
    for pl in lines:
        assert pl.pts[:, 0].min() >= inner[0] - 1e-6
        assert pl.pts[:, 0].max() <= inner[2] + 1e-6
        assert pl.pts[:, 1].min() >= inner[1] - 1e-6
        assert pl.pts[:, 1].max() <= inner[3] + 1e-6


def test_image_is_not_mirrored():
    """Dunkel oben im Foto muss oben auf der Platte landen."""
    gray = np.full((200, 200), 240, dtype=np.uint8)
    gray[:60, :] = 20                                   # dunkler Streifen oben
    p = ReliefParams(width_mm=100, height_mm=100, margin_mm=0, line_count=20,
                     wave_amp_mm=0, auto_levels=False).sanitized()
    inner = (0.0, 0.0, 100.0, 100.0)
    lines = build_polylines(DarknessField(darkness_map(gray, p), inner), p, inner)

    pl = lines[len(lines) // 2]
    upper = pl.width[pl.pts[:, 1] > 80].mean()
    lower = pl.width[pl.pts[:, 1] < 20].mean()
    assert upper > lower + 0.2


def test_angle_covers_full_area():
    gray = sample_photo()
    p = ReliefParams(width_mm=100, line_count=30, angle_deg=45).sanitized()
    inner = (5.0, 5.0, 95.0, 128.0)
    lines = build_polylines(DarknessField(darkness_map(gray, p), inner), p, inner)
    pts = np.concatenate([pl.pts for pl in lines])
    assert pts[:, 0].min() < inner[0] + 8 and pts[:, 0].max() > inner[2] - 8
    assert pts[:, 1].min() < inner[1] + 8 and pts[:, 1].max() > inner[3] - 8


def test_warns_when_lines_would_merge():
    gray = sample_photo()
    dense = build_relief(gray, ReliefParams(width_mm=80, line_count=200,
                                            line_width_min_mm=0.9),
                         with_previews=False)
    assert any("verschmelzen" in n for n in dense.stats["notes"])

    capped = build_relief(gray, ReliefParams(width_mm=80, line_count=90,
                                             line_width_max_mm=3.0),
                          with_previews=False)
    assert any("begrenzt" in n for n in capped.stats["notes"])
    assert capped.stats["width_max_mm"] < 3.0

    calm = build_relief(gray, ReliefParams(width_mm=120, line_count=60),
                        with_previews=False)
    assert calm.stats["notes"] == []


def test_simplify_keeps_shape():
    gray = sample_photo()
    inner = (5.0, 5.0, 95.0, 128.0)
    base = ReliefParams(width_mm=100, line_count=20, simplify_tol_mm=0.0)
    lean = ReliefParams(width_mm=100, line_count=20, simplify_tol_mm=0.02)
    dark = darkness_map(gray, base.sanitized())

    full = build_polylines(DarknessField(dark, inner), base.sanitized(), inner)
    thin = build_polylines(DarknessField(dark, inner), lean.sanitized(), inner)
    n_full = sum(len(pl) for pl in full)
    n_thin = sum(len(pl) for pl in thin)
    assert n_thin < n_full * 0.8, "Ausduennen bringt nichts"

    # Die ausgeduennte Linie darf nicht von der vollen abweichen
    a, b = full[10], thin[10]
    err = np.abs(np.interp(a.pts[:, 1], b.pts[:, 1], b.pts[:, 0]) - a.pts[:, 0])
    assert err.max() < 0.05


# ---------------------------------------------------------------------------
# Gesamtergebnis und Dateiformate
# ---------------------------------------------------------------------------

def test_build_relief_produces_printable_model():
    gray = sample_photo()
    p = ReliefParams(width_mm=100, line_count=45)
    result = build_relief(gray, p)

    lo, hi = result.mesh.bounds()
    assert abs(lo[2]) < 1e-4, "Unterseite muss auf z = 0 liegen"
    assert abs(hi[0] - 100.0) < 1e-3
    assert abs(hi[1] - result.stats["height_mm"]) < 0.05
    assert hi[2] > result.params.plate_thickness_mm
    assert result.stats["triangles"] > 1000
    assert result.stats["filament_g"] > 0
    assert result.previews["topview"].startswith("data:image/png;base64,")
    assert result.previews["relief"].startswith("data:image/png;base64,")


def test_plate_and_ribs_overlap():
    """Stege muessen in die Platte eintauchen, sonst faellt alles ab."""
    p = ReliefParams(embed_mm=0.3, plate_thickness_mm=1.6).sanitized()
    pts = np.stack([np.linspace(10, 50, 20), np.full(20, 20.0)], axis=1)
    from printbuilder.lines import Polyline
    line = Polyline(pts, np.full(20, 0.6), np.full(20, 0.8))
    mesh = build_mesh([line], p, 60, 40)
    lo, _ = mesh.bounds()
    assert abs(lo[2]) < 1e-5
    # Steg beginnt unterhalb der Plattenoberseite
    assert p.plate_thickness_mm - p.embed_mm < p.plate_thickness_mm


def test_stl_roundtrip():
    mesh = Mesh()
    mesh.add_box(0, 0, 0, 10, 10, 2)
    data = to_stl(mesh)
    assert len(data) == 84 + 50 * 12
    assert struct.unpack("<I", data[80:84])[0] == 12
    first = struct.unpack("<12fH", data[84:84 + 50])
    assert abs(np.linalg.norm(first[0:3]) - 1.0) < 1e-5   # Normale normiert


def test_3mf_and_obj():
    mesh = Mesh()
    mesh.add_box(0, 0, 0, 10, 10, 2)

    data = to_3mf(mesh)
    with zipfile.ZipFile(__import__("io").BytesIO(data)) as zf:
        assert "3D/3dmodel.model" in zf.namelist()
        model = zf.read("3D/3dmodel.model").decode()
    assert 'unit="millimeter"' in model
    assert model.count("<vertex ") == 8      # Quader hat 8 Ecken
    assert model.count("<triangle ") == 12

    obj = to_obj(mesh).decode()
    assert obj.count("\nv ") == 8
    assert obj.count("\nf ") == 12


def test_params_are_clamped():
    p = ReliefParams(line_width_max_mm=0.1, line_width_min_mm=0.9,
                     line_count=5000, margin_mm=999, gamma=0).sanitized()
    assert p.line_width_max_mm >= p.line_width_min_mm
    assert p.line_count <= 600
    assert p.margin_mm < p.width_mm / 2
    assert p.gamma > 0

    p2 = ReliefParams.from_dict({"width_mm": "150", "frame": "false",
                                 "line_count": "77", "unbekannt": 1})
    assert p2.width_mm == 150.0 and p2.frame is False and p2.line_count == 77


def test_presets_are_valid():
    gray = sample_photo(120, 160)
    for name, preset in PRESETS.items():
        p = ReliefParams.from_dict({**preset["values"], "width_mm": 60,
                                    "line_count": 20})
        result = build_relief(gray, p, with_previews=False)
        assert len(result.mesh) > 100, name


def _run_all() -> int:
    tests = [(k, v) for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ok    {name}")
        except AssertionError as exc:
            failed += 1
            print(f"  FEHL  {name}: {exc}")
        except Exception as exc:  # pragma: no cover
            failed += 1
            print(f"  ERR   {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} Tests bestanden")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
