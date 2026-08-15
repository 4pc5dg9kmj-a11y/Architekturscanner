"""Erzeugung der Linienschar aus der Dunkelheitskarte.

Eine Linie ist ein Polygonzug mit je Stuetzpunkt einer Breite und einer Hoehe.
Drei Modulationen wirken zusammen (jede einzeln abschaltbar):

* **Auslenkung**  – die Linie schwingt quer zur Laufrichtung, die Amplitude
  waechst mit der Dunkelheit. Dadurch draengen sich Linien in dunklen Zonen
  zusammen: der Effekt der Vorlage.
* **Strichstaerke** – die Linie wird in dunklen Zonen breiter.
* **Hoehe** – die Linie wird in dunklen Zonen hoeher (Streiflicht-Relief).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .image_prep import DarknessField
from .params import ReliefParams


@dataclass
class Polyline:
    """Ein Linienzug in mm: Punkte (N,2), Breiten (N,), Hoehen (N,)."""

    pts: np.ndarray
    width: np.ndarray
    height: np.ndarray

    def __len__(self) -> int:
        return int(self.pts.shape[0])


MAX_WIDTH_OF_SPACING = 0.80
"""Breiteste Linie im Verhaeltnis zum Linienabstand.

Darueber beruehren sich benachbarte Linien schon bei mittleren Tonwerten, die
dunklen Partien laufen zu einer schwarzen Flaeche zusammen und das Motiv
verschwindet.
"""

MAX_AMP_OF_SPACING = 4.0
"""Auslenkung im Verhaeltnis zum Linienabstand - darueber wird es unruhig."""


def _mm(value: float) -> str:
    """Millimeterwert mit deutschem Dezimalkomma."""
    return f"{value:.2f}".replace(".", ",")


def line_limits(p: ReliefParams, rect: tuple[float, float, float, float]
                ) -> tuple[float, float, float]:
    """(Linienabstand, zulaessige Maximalbreite, zulaessige Amplitude) in mm."""
    x0, y0, x1, y1 = rect
    a = math.radians(p.angle_deg)
    extent = abs((x1 - x0) * math.cos(a)) + abs((y1 - y0) * math.sin(a))
    spacing = extent / max(1, p.line_count)
    return (spacing,
            max(p.line_width_min_mm, spacing * MAX_WIDTH_OF_SPACING),
            spacing * MAX_AMP_OF_SPACING)


def build_polylines(field: DarknessField, p: ReliefParams,
                    rect: tuple[float, float, float, float],
                    notes: list[str] | None = None) -> list[Polyline]:
    """Linienschar fuer das Bildrechteck ``rect`` (x0, y0, x1, y1) in mm.

    Breite und Auslenkung werden auf das begrenzt, was der Linienabstand
    hergibt; jede Begrenzung wird in ``notes`` vermerkt.
    """
    x0, y0, x1, y1 = rect
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0

    a = math.radians(p.angle_deg)
    d = np.array([math.sin(a), math.cos(a)], dtype=np.float64)   # Laufrichtung
    n = np.array([math.cos(a), -math.sin(a)], dtype=np.float64)  # quer dazu

    # Ausdehnung des Rechtecks im gedrehten System
    corners = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) - np.array([cx, cy])
    along = corners @ d
    across = corners @ n
    u_min, u_max = float(along.min()), float(along.max())
    v_min, v_max = float(across.min()), float(across.max())

    spacing = (v_max - v_min) / p.line_count
    _, width_cap, amp_cap = line_limits(p, rect)
    width_max = min(p.line_width_max_mm, width_cap)
    wave_amp = min(p.wave_amp_mm, amp_cap)
    if notes is not None:
        if p.line_width_min_mm > spacing * MAX_WIDTH_OF_SPACING:
            notes.append(
                f"Schon der schmalste Strich ({_mm(p.line_width_min_mm)} mm) füllt "
                f"den Linienabstand von {_mm(spacing)} mm – die Linien "
                f"verschmelzen zu einer Fläche. Weniger Linien wählen oder "
                f"„Strich hell“ verkleinern.")
        elif width_max < p.line_width_max_mm - 1e-3:
            notes.append(
                f"Strichstärke auf {_mm(width_max)} mm begrenzt – bei "
                f"{p.line_count} Linien laufen breitere Striche zusammen.")
        if wave_amp < p.wave_amp_mm - 1e-3:
            notes.append(f"Auslenkung auf {_mm(wave_amp)} mm begrenzt.")
        if spacing < 0.8:
            notes.append(
                f"Linienabstand {_mm(spacing)} mm – mit einer 0,4-mm-Düse lassen "
                f"sich so enge Linien nicht mehr getrennt drucken.")

    step = 1.0 / p.samples_per_mm
    n_samples = max(2, int(math.ceil((u_max - u_min) / step)) + 1)
    u = np.linspace(u_min, u_max, n_samples)

    # Ueberstand, damit auch bei Auslenkung/Drehung der Rand voll bedeckt ist
    reserve = wave_amp + spacing
    dw = width_max - p.line_width_min_mm
    dh = p.line_height_max_mm - p.line_height_min_mm
    phase_step = math.radians(p.wave_phase_deg)
    k = 2.0 * math.pi / p.wave_len_mm

    out: list[Polyline] = []
    for i in range(p.line_count):
        v = v_min + (i + 0.5) * spacing
        base_x = cx + d[0] * u + n[0] * v
        base_y = cy + d[1] * u + n[1] * v

        # Linien, die komplett neben dem Bild liegen, ueberspringen
        if (base_x.max() < x0 - reserve or base_x.min() > x1 + reserve
                or base_y.max() < y0 - reserve or base_y.min() > y1 + reserve):
            continue

        dark = field.sample(base_x, base_y).astype(np.float64)

        if wave_amp > 1e-4:
            offset = wave_amp * dark * np.sin(k * u + i * phase_step)
            px = base_x + n[0] * offset
            py = base_y + n[1] * offset
        else:
            px, py = base_x, base_y

        width = p.line_width_min_mm + dw * dark
        height = p.line_height_min_mm + dh * dark

        pts = np.stack([px, py], axis=1)
        attrs = np.stack([width, height], axis=1)
        for seg_pts, seg_attrs in _clip_to_rect(pts, attrs, rect):
            if seg_pts.shape[0] < 2:
                continue
            seg_pts, seg_attrs = _simplify(seg_pts, seg_attrs, p.simplify_tol_mm)
            out.append(Polyline(seg_pts, seg_attrs[:, 0], seg_attrs[:, 1]))
    return out


# ---------------------------------------------------------------------------
# Zuschnitt auf das Bildrechteck
# ---------------------------------------------------------------------------

def _clip_to_rect(pts: np.ndarray, attrs: np.ndarray,
                  rect: tuple[float, float, float, float]
                  ) -> list[tuple[np.ndarray, np.ndarray]]:
    """Polygonzug am Rechteck abschneiden; liefert die Teilstuecke innen.

    An Ein-/Austritten wird der Schnittpunkt interpoliert, damit die Linien
    exakt an der Rahmenkante enden statt im Abtastraster zu stufen.
    """
    x0, y0, x1, y1 = rect
    inside = ((pts[:, 0] >= x0) & (pts[:, 0] <= x1)
              & (pts[:, 1] >= y0) & (pts[:, 1] <= y1))
    if inside.all():
        return [(pts, attrs)]
    if not inside.any():
        return []

    runs: list[tuple[np.ndarray, np.ndarray]] = []
    cur_pts: list[np.ndarray] = []
    cur_attrs: list[np.ndarray] = []

    def flush() -> None:
        if len(cur_pts) >= 2:
            runs.append((np.array(cur_pts), np.array(cur_attrs)))
        cur_pts.clear()
        cur_attrs.clear()

    for i in range(pts.shape[0]):
        if inside[i]:
            if not cur_pts and i > 0:
                t = _entry_fraction(pts[i], pts[i - 1], rect)
                cur_pts.append(_lerp(pts[i], pts[i - 1], t))
                cur_attrs.append(_lerp(attrs[i], attrs[i - 1], t))
            cur_pts.append(pts[i])
            cur_attrs.append(attrs[i])
        else:
            if cur_pts:
                t = _entry_fraction(pts[i - 1], pts[i], rect)
                cur_pts.append(_lerp(pts[i - 1], pts[i], t))
                cur_attrs.append(_lerp(attrs[i - 1], attrs[i], t))
                flush()
    flush()
    return runs


def _lerp(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    return a + (b - a) * t


def _entry_fraction(inside_pt: np.ndarray, outside_pt: np.ndarray,
                    rect: tuple[float, float, float, float]) -> float:
    """Anteil auf inside->outside, an dem die Rechteckkante geschnitten wird."""
    x0, y0, x1, y1 = rect
    delta = outside_pt - inside_pt
    t = 1.0
    for value, d, lo, hi in ((inside_pt[0], delta[0], x0, x1),
                             (inside_pt[1], delta[1], y0, y1)):
        if d > 1e-12:
            t = min(t, (hi - value) / d)
        elif d < -1e-12:
            t = min(t, (lo - value) / d)
    return float(max(0.0, min(1.0, t)))


# ---------------------------------------------------------------------------
# Ausduennen: gerade Abschnitte brauchen keine Zwischenpunkte
# ---------------------------------------------------------------------------

def _simplify(pts: np.ndarray, attrs: np.ndarray,
              tol: float) -> tuple[np.ndarray, np.ndarray]:
    """Stuetzpunkte entfernen, solange die Abweichung unter ``tol`` bleibt.

    Douglas-Peucker im 4D-Raum (x, y, Breite, Hoehe) - alle vier Groessen sind
    in mm, ``tol`` gilt also gleichermassen fuer Lage und Querschnitt: eine
    Stelle, an der nur die Strichstaerke umschlaegt, bleibt erhalten.
    """
    n = pts.shape[0]
    if tol <= 0 or n <= 2:
        return pts, attrs

    data = np.concatenate([pts, attrs], axis=1)  # (N, 4)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[n - 1] = True

    stack = [(0, n - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 - i0 < 2:
            continue
        seg = data[i0 + 1:i1]
        axis = data[i1] - data[i0]
        length = float(np.linalg.norm(axis))
        rel = seg - data[i0]
        if length < 1e-12:
            dist = np.linalg.norm(rel, axis=1)
        else:
            unit = axis / length
            dist = np.linalg.norm(rel - np.outer(rel @ unit, unit), axis=1)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            split = i0 + 1 + k
            keep[split] = True
            stack.append((i0, split))
            stack.append((split, i1))

    idx = np.flatnonzero(keep)
    return pts[idx], attrs[idx]
