"""Zusammenbau: Foto -> Linien -> druckfertiges Mesh + Kennzahlen."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field as dc_field

import numpy as np

from . import preview as preview_mod
from .image_prep import DarknessField, darkness_map, fit_working_size
from .lines import Polyline, build_polylines, line_limits
from .mesh import Mesh
from .params import ReliefParams

PLA_DENSITY_G_CM3 = 1.24
FILAMENT_DIAMETER_MM = 1.75


@dataclass
class BuildResult:
    mesh: Mesh
    polylines: list[Polyline]
    params: ReliefParams
    stats: dict = dc_field(default_factory=dict)
    previews: dict = dc_field(default_factory=dict)


def plate_size(gray: np.ndarray, p: ReliefParams) -> tuple[float, float]:
    """Plattenmasse; ohne Vorgabe folgt die Hoehe dem Seitenverhaeltnis."""
    if p.height_mm > 0:
        return p.width_mm, p.height_mm
    img_h, img_w = gray.shape[:2]
    return p.width_mm, p.width_mm * (img_h / max(1, img_w))


def build_relief(gray: np.ndarray, params: ReliefParams,
                 with_previews: bool = True,
                 preview_px_per_mm: float = 10.0) -> BuildResult:
    """Kompletter Durchlauf von der Graustufenvorlage bis zum Mesh."""
    p = params.sanitized()
    gray = fit_working_size(gray)
    width_mm, height_mm = plate_size(gray, p)

    # Bildbereich innerhalb des Randes
    inner = (p.margin_mm, p.margin_mm, width_mm - p.margin_mm, height_mm - p.margin_mm)
    if inner[2] - inner[0] < 5 or inner[3] - inner[1] < 5:
        raise ValueError("Rand zu gross fuer die gewaehlte Plattengroesse")

    notes: list[str] = []
    dark = darkness_map(gray, p)
    field = DarknessField(dark, inner)
    polylines = build_polylines(field, p, inner, notes)

    mesh = build_mesh(polylines, p, width_mm, height_mm)

    result = BuildResult(mesh=mesh, polylines=polylines, params=p)
    result.stats = _stats(mesh, polylines, p, width_mm, height_mm, inner)
    result.stats["notes"] = notes

    if with_previews:
        frame = (p.margin_mm, p.frame_height_mm) if p.frame else None
        raster = preview_mod.rasterize(polylines, width_mm, height_mm,
                                       preview_px_per_mm, frame)
        result.previews = {
            "topview": _data_url(preview_mod.topview_png(raster)),
            "relief": _data_url(preview_mod.relief_png(
                raster, p.plate_thickness_mm, preview_px_per_mm)),
        }
        above_plate = preview_mod.material_mm3(raster, preview_px_per_mm)
        plate_mm3 = width_mm * height_mm * p.plate_thickness_mm
        result.stats.update(_material(above_plate + plate_mm3))
    return result


def build_mesh(polylines: list[Polyline], p: ReliefParams,
               width_mm: float, height_mm: float) -> Mesh:
    """Platte + optionaler Rahmen + alle Linienstege.

    Die Stege tauchen um ``embed_mm`` in die Platte ein. Slicer verschmelzen
    einander durchdringende Koerper automatisch - das ist deutlich robuster
    (und schneller) als eine echte boolesche Vereinigung, die bei tausenden
    Stegen numerisch heikel waere.
    """
    mesh = Mesh()
    mesh.add_box(0.0, 0.0, -p.plate_thickness_mm, width_mm, height_mm, 0.0)

    if p.frame and p.margin_mm > 0.3 and p.frame_height_mm > 0.05:
        # Wie die Stege taucht der Rahmen in die Platte ein, statt nur
        # buendig aufzusitzen - so gibt es keine gemeinsamen Eckpunkte.
        mesh.add_frame(0.0, 0.0, width_mm, height_mm, p.margin_mm,
                       -p.embed_mm, p.frame_height_mm)

    for pl in polylines:
        mesh.add_ribbon(pl.pts, pl.width, pl.height, -p.embed_mm)

    # Unterseite auf z = 0 legen - so liegt das Modell im Slicer sofort richtig
    mesh.translate(dz=p.plate_thickness_mm)
    return mesh


def _stats(mesh: Mesh, polylines: list[Polyline], p: ReliefParams,
           width_mm: float, height_mm: float,
           inner: tuple[float, float, float, float]) -> dict:
    lo, hi = mesh.bounds()
    total_len = sum(
        float(np.linalg.norm(np.diff(pl.pts, axis=0), axis=1).sum())
        for pl in polylines
    )
    spacing, width_cap, _ = line_limits(p, inner)
    return {
        "width_mm": round(width_mm, 2),
        "height_mm": round(height_mm, 2),
        "total_height_mm": round(float(hi[2] - lo[2]), 2),
        "line_count": p.line_count,
        "path_count": len(polylines),
        "spacing_mm": round(spacing, 2),
        "width_max_mm": round(min(p.line_width_max_mm, width_cap), 2),
        "triangles": len(mesh),
        "line_length_m": round(total_len / 1000.0, 2),
        "stl_mb": round(len(mesh) * 50 / 1024 / 1024, 2),
    }


def _material(volume_mm3: float) -> dict:
    grams = volume_mm3 / 1000.0 * PLA_DENSITY_G_CM3
    area = np.pi * (FILAMENT_DIAMETER_MM / 2.0) ** 2
    return {
        "volume_cm3": round(volume_mm3 / 1000.0, 1),
        "filament_g": round(grams, 1),
        "filament_m": round(volume_mm3 / area / 1000.0, 1),
    }


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")
