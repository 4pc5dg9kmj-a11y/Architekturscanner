"""Vorschaubilder: Draufsicht (wie gedruckt) und Streiflicht-Relief.

Beide Bilder entstehen aus derselben Rasterung der Linien; nebenbei faellt
daraus das Materialvolumen ab (Summe des Hoehenfelds), das im Gegensatz zum
Mesh-Volumen Ueberschneidungen nicht doppelt zaehlt.
"""

from __future__ import annotations

import cv2
import numpy as np

from .lines import Polyline

HEIGHT_BINS = 48
"""Hoehenstufen der Vorschau; die Druckdatei selbst bleibt stufenlos."""


def rasterize(polylines: list[Polyline], width_mm: float, height_mm: float,
              px_per_mm: float = 8.0,
              frame: tuple[float, float] | None = None) -> np.ndarray:
    """Hoehenfeld ueber der Platte in mm (float32), Bildzeile 0 = oben.

    ``frame`` ist optional (Randbreite, Rahmenhoehe) in mm.
    """
    w = max(1, int(round(width_mm * px_per_mm)))
    h = max(1, int(round(height_mm * px_per_mm)))
    field = np.zeros((h, w), dtype=np.float32)

    if frame and frame[0] > 0.3 and frame[1] > 0.05:
        border = int(round(frame[0] * px_per_mm))
        field[:] = frame[1]
        field[border:h - border, border:w - border] = 0.0

    if not polylines:
        return field

    segments, widths, heights = _segments(polylines, height_mm, px_per_mm)
    if segments.size == 0:
        return field

    # Segmente nach Strichstaerke und Hoehe buendeln: ein Zeichenaufruf je
    # Kombination statt einem je Segment.
    thickness_px = np.maximum(1, np.round(widths * px_per_mm).astype(np.int32))
    h_lo, h_hi = float(heights.min()), float(heights.max())
    h_step = max(1e-4, (h_hi - h_lo) / HEIGHT_BINS)
    h_level = np.round((heights - h_lo) / h_step).astype(np.int32)

    key = h_level.astype(np.int64) * 10_000 + thickness_px
    order = np.argsort(key, kind="stable")   # niedrige Hoehen zuerst zeichnen
    seg_sorted, key_sorted = segments[order], key[order]
    starts = np.flatnonzero(np.r_[True, key_sorted[1:] != key_sorted[:-1]])
    ends = np.r_[starts[1:], len(key_sorted)]

    for start, end in zip(starts, ends):
        level, thick = divmod(int(key_sorted[start]), 10_000)
        cv2.polylines(field, list(seg_sorted[start:end]), False,
                      float(h_lo + level * h_step),
                      thickness=int(thick), lineType=cv2.LINE_8)
    return field


def _segments(polylines: list[Polyline], height_mm: float, px_per_mm: float):
    """Alle Linien in Einzelsegmente (Pixelkoordinaten) zerlegen."""
    seg_list, w_list, h_list = [], [], []
    for pl in polylines:
        if len(pl) < 2:
            continue
        px = np.empty_like(pl.pts)
        px[:, 0] = pl.pts[:, 0] * px_per_mm
        px[:, 1] = (height_mm - pl.pts[:, 1]) * px_per_mm
        pairs = np.stack([px[:-1], px[1:]], axis=1)
        seg_list.append(np.round(pairs).astype(np.int32))
        w_list.append((pl.width[:-1] + pl.width[1:]) * 0.5)
        h_list.append((pl.height[:-1] + pl.height[1:]) * 0.5)
    if not seg_list:
        return np.zeros((0, 2, 2), np.int32), np.zeros(0), np.zeros(0)
    return (np.concatenate(seg_list), np.concatenate(w_list),
            np.concatenate(h_list))


def topview_png(field: np.ndarray) -> bytes:
    """Draufsicht wie auf Papier: Material schwarz, Platte weiss."""
    img = np.where(field > 1e-6, 0, 255).astype(np.uint8)
    img = cv2.GaussianBlur(img, (3, 3), 0.6)
    return _encode(img)


def relief_png(field: np.ndarray, plate_mm: float = 1.6,
               px_per_mm: float = 8.0) -> bytes:
    """Streiflicht-Ansicht: so wirkt der Druck unter schraeger Beleuchtung.

    Zwei Anteile ergeben zusammen den Eindruck, den das Auge vor dem
    fertigen Druck hat:

    * **Streiflicht** – Schattenkanten an den Flanken der Stege.
    * **Verdeckung** – wo Stege dicht und breit stehen, faellt weniger Licht
      bis auf die Platte. Das ist der Anteil, der aus Entfernung das Motiv
      traegt; ohne ihn saehe man nur ein gleichmaessiges Streifenmuster.
    """
    smooth = cv2.GaussianBlur(field, (0, 0), max(0.6, px_per_mm * 0.09))

    # Normalen aus dem Hoehenfeld, Licht von links oben
    gx = cv2.Sobel(smooth, cv2.CV_32F, 1, 0, ksize=3) * 6.0
    gy = cv2.Sobel(smooth, cv2.CV_32F, 0, 1, ksize=3) * 6.0
    inv = 1.0 / np.sqrt(gx * gx + gy * gy + 1.0)
    nx, ny, nz = -gx * inv, -gy * inv, inv

    light = np.array([-0.55, -0.55, 0.63], dtype=np.float32)
    light /= np.linalg.norm(light)
    diffuse = np.clip(nx * light[0] + ny * light[1] + nz * light[2], 0, 1)

    # Materialdichte ueber eine Blende von rund 3 mm - so gross ist der
    # Bereich, den das Auge auf Betrachtungsabstand zusammenfasst. Gemittelt
    # wird die Hoehe, nicht nur die Flaeche: dann traegt sowohl breiterer als
    # auch hoeherer Steg zum dunkleren Eindruck bei.
    density = cv2.GaussianBlur(field, (0, 0), max(1.5, px_per_mm * 1.5))
    reference = float(np.percentile(density, 97))
    occlusion = 1.0 - 0.75 * np.clip(density / max(reference, 1e-6), 0, 1) ** 1.2

    shade = np.clip((0.24 + 0.76 * diffuse ** 1.3) * (0.30 + 0.70 * occlusion), 0, 1)

    # Leichte Materialfarbe (heller Kunststoff)
    rgb = np.stack([shade * 236, shade * 234, shade * 226], axis=2)
    return _encode(np.clip(rgb, 0, 255).astype(np.uint8)[:, :, ::-1])


def material_mm3(field: np.ndarray, px_per_mm: float) -> float:
    """Materialvolumen der Linien aus dem Hoehenfeld (ohne Platte)."""
    return float(field.sum()) / (px_per_mm * px_per_mm)


def _encode(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:  # pragma: no cover
        raise RuntimeError("PNG-Kodierung fehlgeschlagen")
    return buf.tobytes()
