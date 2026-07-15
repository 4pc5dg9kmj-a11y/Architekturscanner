"""Vektorisierungs-Pipeline: fotografierter Plan -> gerade, achsen-ausgerichtete Liniensegmente.

Schritte:
  1. Bild laden (Foto/Scan, beliebige Beleuchtung)
  2. optional: perspektivische Entzerrung ueber 4 vom Nutzer geklickte Eckpunkte
  3. Beleuchtungsausgleich + Binarisierung
  4. globale Entzerrung der Verdrehung (Deskew ueber dominante Linienrichtung)
  5. Skelettierung + Segmenterkennung (Hough)
  6. Winkel-Snapping (fast horizontale/vertikale Linien werden exakt), kollineares
     Zusammenfuehren, Eckpunkt-Snapping, Rauschfilter
"""

from __future__ import annotations

import base64
import math
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class VectorizeParams:
    min_len: float = 12.0          # Mindestlaenge eines Segments in px
    merge_gap: float = 8.0         # max. Luecke beim Zusammenfuehren kollinearer Segmente
    merge_offset: float = 4.0      # max. seitlicher Versatz beim Zusammenfuehren
    angle_snap_deg: float = 4.0    # Toleranz fuer Snapping auf 0/90 Grad
    corner_snap: float = 7.0       # Radius fuer Eckpunkt-Clustering
    max_dim: int = 3000            # Bild wird auf diese Kantenlaenge begrenzt


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Bild konnte nicht gelesen werden")
    return img


def pdf_to_image(data: bytes, page: int = 0, dpi: int = 300) -> np.ndarray:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    if page >= len(doc):
        page = 0
    pix = doc[page].get_pixmap(dpi=dpi)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    else:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    return img


def warp_perspective(img: np.ndarray, corners: list[list[float]]) -> np.ndarray:
    """Entzerrt das Bild ueber 4 Eckpunkte (Reihenfolge: lo, ro, ru, lu)."""
    src = np.array(corners, dtype=np.float32)
    w = max(np.linalg.norm(src[1] - src[0]), np.linalg.norm(src[2] - src[3]))
    h = max(np.linalg.norm(src[3] - src[0]), np.linalg.norm(src[2] - src[1]))
    w, h = int(round(w)), int(round(h))
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, m, (w, h), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)


def _limit_size(img: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = max(h, w)
    if s <= max_dim:
        return img
    f = max_dim / s
    return cv2.resize(img, (int(w * f), int(h * f)), interpolation=cv2.INTER_AREA)


def binarize(img: np.ndarray) -> np.ndarray:
    """Beleuchtungsausgleich + adaptive Binarisierung. Linien = weiss (255)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bg = cv2.medianBlur(gray, 41)
    norm = cv2.divide(gray, bg, scale=255)
    binary = cv2.adaptiveThreshold(norm, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                   cv2.THRESH_BINARY_INV, 31, 12)
    # Knicke/Falten im Papier erzeugen lange duenne Schatten -> kleine Oeffnung
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                              cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)))
    return binary


def detect_segments(binary: np.ndarray, p: VectorizeParams) -> np.ndarray:
    """Skelettierung + probabilistische Hough-Transformation -> Nx4 (x1,y1,x2,y2)."""
    skel = cv2.ximgproc.thinning(binary)
    lines = cv2.HoughLinesP(skel, 1, np.pi / 360, threshold=20,
                            minLineLength=max(6, int(p.min_len * 0.6)),
                            maxLineGap=4)
    if lines is None:
        return np.zeros((0, 4), dtype=np.float64)
    return lines.reshape(-1, 4).astype(np.float64)


def estimate_skew(segments: np.ndarray) -> float:
    """Dominante Abweichung der Linien vom 0/90-Grad-Raster (gewichtetes Mittel)."""
    if len(segments) == 0:
        return 0.0
    dx = segments[:, 2] - segments[:, 0]
    dy = segments[:, 3] - segments[:, 1]
    length = np.hypot(dx, dy)
    ang = np.degrees(np.arctan2(dy, dx))
    dev = (ang + 45.0) % 90.0 - 45.0  # Abweichung vom naechsten 90-Grad-Raster
    mask = (np.abs(dev) < 10.0) & (length > 20)
    if not mask.any():
        return 0.0
    return float(np.average(dev[mask], weights=length[mask]))


def rotate_image(img: np.ndarray, angle_deg: float) -> np.ndarray:
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, m, (nw, nh), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REPLICATE)


def snap_angles(segments: np.ndarray, tol_deg: float) -> np.ndarray:
    """Fast horizontale/vertikale Segmente exakt ausrichten (um den Mittelpunkt)."""
    out = segments.copy()
    for s in out:
        dx, dy = s[2] - s[0], s[3] - s[1]
        ang = math.degrees(math.atan2(dy, dx)) % 180.0
        cx, cy = (s[0] + s[2]) / 2, (s[1] + s[3]) / 2
        half = math.hypot(dx, dy) / 2
        if ang < tol_deg or ang > 180 - tol_deg:      # horizontal
            s[:] = [cx - half, cy, cx + half, cy]
        elif abs(ang - 90) < tol_deg:                 # vertikal
            s[:] = [cx, cy - half, cx, cy + half]
    return out


def merge_collinear(segments: np.ndarray, p: VectorizeParams) -> np.ndarray:
    """Fuehrt kollineare, sich beruehrende/ueberlappende Segmente zusammen.

    Segmente werden nach Richtung geclustert, in die Richtungsachse rotiert und
    dort als 1D-Intervalle auf gemeinsamen "Spuren" (gleicher Querversatz) vereint.
    """
    if len(segments) == 0:
        return segments
    dx = segments[:, 2] - segments[:, 0]
    dy = segments[:, 3] - segments[:, 1]
    ang = np.degrees(np.arctan2(dy, dx)) % 180.0

    merged: list[list[float]] = []
    used = np.zeros(len(segments), dtype=bool)
    order = np.argsort(ang)
    i = 0
    while i < len(order):
        j = i
        a0 = ang[order[i]]
        cluster = []
        while j < len(order) and (ang[order[j]] - a0) <= 1.5:
            cluster.append(order[j])
            j += 1
        i = j
        theta = math.radians(np.median(ang[cluster]))
        c, s = math.cos(-theta), math.sin(-theta)

        rows: dict[int, list[tuple[float, float, float]]] = {}
        for k in cluster:
            x1, y1, x2, y2 = segments[k]
            u1, v1 = x1 * c - y1 * s, x1 * s + y1 * c
            u2, v2 = x2 * c - y2 * s, x2 * s + y2 * c
            v = (v1 + v2) / 2
            key = int(round(v / p.merge_offset))
            rows.setdefault(key, []).append((min(u1, u2), max(u1, u2), v))
        for items in rows.values():
            items.sort()
            cur_a, cur_b, vs, ws = items[0][0], items[0][1], [items[0][2]], [items[0][1] - items[0][0]]
            for a, b, v in items[1:]:
                if a <= cur_b + p.merge_gap:
                    cur_b = max(cur_b, b)
                    vs.append(v)
                    ws.append(b - a)
                else:
                    merged.append(_unrotate(cur_a, cur_b, np.average(vs, weights=np.maximum(ws, 1e-6)), theta))
                    cur_a, cur_b, vs, ws = a, b, [v], [b - a]
            merged.append(_unrotate(cur_a, cur_b, np.average(vs, weights=np.maximum(ws, 1e-6)), theta))
        used[cluster] = True
    return np.array(merged, dtype=np.float64) if merged else np.zeros((0, 4))


def _unrotate(u1: float, u2: float, v: float, theta: float) -> list[float]:
    c, s = math.cos(theta), math.sin(theta)
    return [u1 * c - v * s, u1 * s + v * c, u2 * c - v * s, u2 * s + v * c]


def snap_corners(segments: np.ndarray, radius: float) -> np.ndarray:
    """Endpunkte, die nah beieinander liegen, auf einen gemeinsamen Punkt ziehen."""
    if len(segments) == 0:
        return segments
    pts = np.vstack([segments[:, 0:2], segments[:, 2:4]])
    grid: dict[tuple[int, int], list[int]] = {}
    cell = radius
    for idx, (x, y) in enumerate(pts):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(idx)

    parent = list(range(len(pts)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for (gx, gy), idxs in grid.items():
        cand: list[int] = []
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                cand.extend(grid.get((gx + ox, gy + oy), []))
        for a in idxs:
            for b in cand:
                if b > a and np.hypot(*(pts[a] - pts[b])) <= radius:
                    parent[find(a)] = find(b)

    clusters: dict[int, list[int]] = {}
    for idx in range(len(pts)):
        clusters.setdefault(find(idx), []).append(idx)
    out = pts.copy()
    for members in clusters.values():
        if len(members) > 1:
            out[members] = pts[members].mean(axis=0)
    n = len(segments)
    result = segments.copy()
    result[:, 0:2] = out[:n]
    result[:, 2:4] = out[n:]
    return result


def filter_short(segments: np.ndarray, min_len: float) -> np.ndarray:
    if len(segments) == 0:
        return segments
    length = np.hypot(segments[:, 2] - segments[:, 0], segments[:, 3] - segments[:, 1])
    return segments[length >= min_len]


def encode_png_base64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("PNG-Encoding fehlgeschlagen")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def run_ocr(img: np.ndarray) -> list[dict]:
    """Texterkennung (Beschriftungen des Zeichners) mit Tesseract, falls verfuegbar."""
    try:
        import pytesseract
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        data = pytesseract.image_to_data(gray, lang="deu",
                                         output_type=pytesseract.Output.DICT)
    except Exception:
        return []
    items: list[dict] = []
    n = len(data["text"])
    # Woerter zeilenweise gruppieren
    lines: dict[tuple, list[int]] = {}
    for i in range(n):
        txt = data["text"][i].strip()
        if not txt or int(data.get("conf", ["-1"] * n)[i]) < 55:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(i)
    for idxs in lines.values():
        words = [data["text"][i].strip() for i in idxs]
        x = min(data["left"][i] for i in idxs)
        y = min(data["top"][i] for i in idxs)
        h = max(data["height"][i] for i in idxs)
        items.append({"text": " ".join(words), "x": x, "y": y + h, "size": h})
    return items


def vectorize(img: np.ndarray, params: VectorizeParams | None = None,
              corners: list[list[float]] | None = None,
              with_ocr: bool = False) -> dict:
    p = params or VectorizeParams()
    if corners and len(corners) == 4:
        img = warp_perspective(img, corners)
    img = _limit_size(img, p.max_dim)

    binary = binarize(img)
    raw = detect_segments(binary, p)
    skew = estimate_skew(raw)
    if abs(skew) > 0.15:
        img = rotate_image(img, skew)
        binary = binarize(img)
        raw = detect_segments(binary, p)

    segs = snap_angles(raw, p.angle_snap_deg)
    segs = merge_collinear(segs, p)
    segs = snap_angles(segs, p.angle_snap_deg)
    segs = snap_corners(segs, p.corner_snap)
    segs = filter_short(segs, p.min_len)

    result = {
        "width": int(img.shape[1]),
        "height": int(img.shape[0]),
        "skew_corrected_deg": round(skew, 3),
        "image_png_base64": encode_png_base64(img),
        "segments": [[round(v, 2) for v in s] for s in segs.tolist()],
    }
    if with_ocr:
        result["texts"] = run_ocr(img)
    return result
