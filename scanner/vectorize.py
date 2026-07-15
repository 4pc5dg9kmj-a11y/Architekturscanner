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
    min_len: float = 14.0          # Mindestlaenge eines Segments in px
    merge_gap: float = 14.0        # max. Luecke beim Zusammenfuehren kollinearer Segmente
    merge_offset: float = 4.0      # max. seitlicher Versatz beim Zusammenfuehren
    angle_snap_deg: float = 4.0    # Toleranz fuer Snapping auf 0/90 Grad
    corner_snap: float = 8.0       # Radius fuer Eckpunkt-Clustering
    max_dim: int = 3000            # Bild wird auf diese Kantenlaenge begrenzt
    thick_stroke: int = 13         # ab dieser Strichstaerke gilt eine Flaeche als gefuellt


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


def binarize(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Beleuchtungsausgleich + adaptive Binarisierung.

    Liefert (binary, norm): Linien = weiss (255) im binary, norm ist das
    beleuchtungskorrigierte Graubild fuer spaetere Tinten-Pruefungen."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bg = cv2.medianBlur(gray, 41)
    norm = cv2.divide(gray, bg, scale=255)
    binary = cv2.adaptiveThreshold(norm, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                   cv2.THRESH_BINARY_INV, 31, 12)
    # Knicke/Falten im Papier erzeugen lange duenne Schatten -> kleine Oeffnung
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                              cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)))
    return binary, norm


def paper_mask(img: np.ndarray, margin: int = 12) -> np.ndarray:
    """Maske des Papierbogens (groesste helle Flaeche), leicht geschrumpft,
    damit Blattkanten und Hintergrund keine Linien erzeugen."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (0, 0), 5)
    # Otsu ist bei ungleichmaessiger Beleuchtung zu streng (schneidet dunklere
    # Papierbereiche ab) -> Schwelle deutlich darunter ansetzen
    otsu_thr, _ = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, bright = cv2.threshold(blur, otsu_thr * 0.55, 255, cv2.THRESH_BINARY)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(bright, 8)
    if num <= 1:
        return np.full(gray.shape, 255, dtype=np.uint8)
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = np.where(labels == biggest, 255, 0).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    mask = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                                     (2 * margin + 1, 2 * margin + 1)))
    # Falls die Erkennung fehlschlaegt (Papier fuellt Bild), alles behalten
    if cv2.countNonZero(mask) < 0.25 * mask.size:
        return np.full(gray.shape, 255, dtype=np.uint8)
    return mask


def filter_ink(segments: np.ndarray, norm: np.ndarray,
               max_brightness: float = 205.0) -> np.ndarray:
    """Verwirft Segmente, unter denen keine echte Tinte liegt (Faltenschatten).

    Entlang jedes Segments wird das dunkelste Pixel quer zur Linie (±2 px)
    gemittelt; echte Linien sind deutlich dunkler als Knick-Schatten."""
    if len(segments) == 0:
        return segments
    h, w = norm.shape
    keep = np.ones(len(segments), dtype=bool)
    for i, (x1, y1, x2, y2) in enumerate(segments):
        L = math.hypot(x2 - x1, y2 - y1)
        n = max(int(L / 4), 5)
        ts = np.linspace(0.05, 0.95, n)
        xs = x1 + (x2 - x1) * ts
        ys = y1 + (y2 - y1) * ts
        nx, ny = -(y2 - y1) / (L or 1), (x2 - x1) / (L or 1)
        vals = np.full(n, 255.0)
        for off in (-2, -1, 0, 1, 2):
            xi = np.clip((xs + nx * off).astype(int), 0, w - 1)
            yi = np.clip((ys + ny * off).astype(int), 0, h - 1)
            vals = np.minimum(vals, norm[yi, xi].astype(float))
        if float(np.mean(vals)) > max_brightness:
            keep[i] = False
    return segments[keep]


def detect_segments(binary: np.ndarray, p: VectorizeParams) -> np.ndarray:
    """Skelettierung + probabilistische Hough-Transformation -> Nx4 (x1,y1,x2,y2)."""
    skel = cv2.ximgproc.thinning(binary)
    lines = cv2.HoughLinesP(skel, 1, np.pi / 360, threshold=20,
                            minLineLength=max(6, int(p.min_len * 0.6)),
                            maxLineGap=5)
    if lines is None:
        return np.zeros((0, 4), dtype=np.float64)
    return lines.reshape(-1, 4).astype(np.float64)


def mask_word_boxes(binary: np.ndarray, words: list[dict]) -> np.ndarray:
    """Entfernt erkannte Textbereiche aus dem Linienbild (mit kleinem Rand)."""
    out = binary.copy()
    for wd in words:
        pad = 2
        x0 = max(0, wd["x"] - pad); y0 = max(0, wd["y"] - pad)
        x1 = min(out.shape[1], wd["x"] + wd["w"] + pad)
        y1 = min(out.shape[0], wd["y"] + wd["h"] + pad)
        out[y0:y1, x0:x1] = 0
    return out


def _glyph_candidates(binary: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Kompakte Komponenten in Buchstabengroesse (moeglicher Text)."""
    h, w = binary.shape
    tmax = max(14, int(0.025 * max(h, w)))
    num, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    boxes: list[tuple[int, int, int, int]] = []
    for i in range(1, num):
        x, y, bw, bh, area = stats[i]
        if bw > tmax or bh > tmax or area < 12 or bh < 6:
            continue
        sub = (labels[y:y + bh, x:x + bw] == i).astype(np.uint8)
        contours, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        (_, _), (rw, rh), _ = cv2.minAreaRect(max(contours, key=cv2.contourArea))
        long_side, short_side = max(rw, rh), max(min(rw, rh), 1.0)
        if long_side / short_side < 3.5:          # kompakt -> Glyphen-Kandidat
            boxes.append((x, y, bw, bh))
    return boxes


def rescue_text_groups(line_bin: np.ndarray, norm: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    """Findet Reihen unerkannter Buchstaben und liest sie gezielt nach.

    Nur wenn die Nachlese-OCR den Text bestaetigt, wird der Bereich aus dem
    Linienbild entfernt und als Textobjekt uebernommen. Unbestaetigte Bereiche
    bleiben unveraendert sichtbar - es verschwindet nichts vom Original."""
    boxes = _glyph_candidates(line_bin)
    if len(boxes) < 3:
        return line_bin, []
    # Reihen bilden: von links nach rechts, gleiche Zeile, horizontal benachbart
    boxes.sort(key=lambda b: b[0])
    rows: list[list[tuple[int, int, int, int]]] = []
    for b in boxes:
        placed = False
        for row in rows:
            lx, ly, lw, lh = row[-1]
            band = max(b[3], lh)
            same_band = abs((b[1] + b[3] / 2) - (ly + lh / 2)) < 0.6 * band
            gap = b[0] - (lx + lw)
            if same_band and -0.3 * lw <= gap < 2.0 * band:
                row.append(b)
                placed = True
                break
        if not placed:
            rows.append([b])

    out = line_bin.copy()
    rescued: list[dict] = []
    for row in rows:
        if len(row) < 3:                          # einzelne Blobs: Symbole, behalten
            continue
        x0 = min(b[0] for b in row); y0 = min(b[1] for b in row)
        x1 = max(b[0] + b[2] for b in row); y1 = max(b[1] + b[3] for b in row)
        words = ocr_crop(norm, (x0, y0, x1 - x0, y1 - y0))
        text = " ".join(w["text"] for w in words)
        if not words or sum(len(w["text"]) for w in words) < max(2, len(row) // 2):
            continue                              # nicht bestaetigt -> sichtbar lassen
        pad = 2
        out[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad] = 0
        rescued.append({"text": text, "conf": min(w["conf"] for w in words),
                        "angle": 0, "x": x0, "y": y0,
                        "w": x1 - x0, "h": y1 - y0})
    return out, rescued


def split_thick(binary: np.ndarray, thickness: int) -> tuple[np.ndarray, np.ndarray]:
    """Trennt gefuellte Flaechen (Waende/Decken, Pochee) von duennen Strichen."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (thickness, thickness))
    thick = cv2.morphologyEx(binary, cv2.MORPH_OPEN, k)
    thin = cv2.bitwise_and(binary, cv2.bitwise_not(thick))
    return thick, thin


def outline_segments(thick: np.ndarray, epsilon: float = 2.5) -> np.ndarray:
    """Konturen gefuellter Flaechen -> Polygonzuege -> Kantensegmente."""
    contours, _ = cv2.findContours(thick, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    segs: list[list[float]] = []
    for cnt in contours:
        if cv2.contourArea(cnt) < 80:
            continue
        poly = cv2.approxPolyDP(cnt, epsilon, closed=True).reshape(-1, 2)
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            segs.append([float(a[0]), float(a[1]), float(b[0]), float(b[1])])
    return np.array(segs, dtype=np.float64) if segs else np.zeros((0, 4))


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


def bridge_text_gaps(segments: np.ndarray, p: VectorizeParams,
                     gap: float = 90.0, min_support: float = 45.0) -> np.ndarray:
    """Ueberbrueckt grosse Luecken (z. B. wo Beschriftung auf der Linie sass),
    aber nur zwischen bereits langen kollinearen Segmenten, damit Strichlinien
    und benachbarte Details nicht faelschlich verklebt werden."""
    if len(segments) == 0:
        return segments
    length = np.hypot(segments[:, 2] - segments[:, 0], segments[:, 3] - segments[:, 1])
    long_mask = length >= min_support
    if long_mask.sum() < 2:
        return segments
    p2 = VectorizeParams(**{**p.__dict__, "merge_gap": gap})
    bridged = merge_collinear(segments[long_mask], p2)
    return np.vstack([bridged, segments[~long_mask]])


def merge_collinear(segments: np.ndarray, p: VectorizeParams) -> np.ndarray:
    """Fuehrt kollineare, sich beruehrende/ueberlappende Segmente zu langen
    Linien zusammen.

    Segmente werden nach Richtung geclustert, in die Richtungsachse rotiert und
    dort als 1D-Intervalle auf gemeinsamen "Spuren" (gleicher Querversatz)
    vereint. Spuren werden ueber fortlaufendes Gruppieren gebildet, nicht ueber
    feste Raster, damit keine Trennungen an Rundungsgrenzen entstehen.
    """
    if len(segments) == 0:
        return segments
    dx = segments[:, 2] - segments[:, 0]
    dy = segments[:, 3] - segments[:, 1]
    ang = np.degrees(np.arctan2(dy, dx)) % 180.0

    merged: list[list[float]] = []
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
        theta = math.radians(float(np.median(ang[cluster])))
        c, s = math.cos(-theta), math.sin(-theta)

        items: list[tuple[float, float, float]] = []   # (v, u_min, u_max)
        for k in cluster:
            x1, y1, x2, y2 = segments[k]
            u1, v1 = x1 * c - y1 * s, x1 * s + y1 * c
            u2, v2 = x2 * c - y2 * s, x2 * s + y2 * c
            items.append(((v1 + v2) / 2, min(u1, u2), max(u1, u2)))
        items.sort()

        # fortlaufend in Spuren gruppieren (gleicher Querversatz)
        tracks: list[list[tuple[float, float, float]]] = []
        for it in items:
            if tracks and it[0] - tracks[-1][-1][0] <= p.merge_offset:
                tracks[-1].append(it)
            else:
                tracks.append([it])

        for track in tracks:
            ivs = sorted((u1, u2, v) for v, u1, u2 in track)
            cur_a, cur_b = ivs[0][0], ivs[0][1]
            vs, ws = [ivs[0][2]], [max(ivs[0][1] - ivs[0][0], 1e-6)]
            for a, b, v in ivs[1:]:
                if a <= cur_b + p.merge_gap:
                    cur_b = max(cur_b, b)
                    vs.append(v)
                    ws.append(max(b - a, 1e-6))
                else:
                    merged.append(_unrotate(cur_a, cur_b, float(np.average(vs, weights=ws)), theta))
                    cur_a, cur_b, vs, ws = a, b, [v], [max(b - a, 1e-6)]
            merged.append(_unrotate(cur_a, cur_b, float(np.average(vs, weights=ws)), theta))
    return np.array(merged, dtype=np.float64) if merged else np.zeros((0, 4))


def _unrotate(u1: float, u2: float, v: float, theta: float) -> list[float]:
    c, s = math.cos(theta), math.sin(theta)
    return [u1 * c - v * s, u1 * s + v * c, u2 * c - v * s, u2 * s + v * c]


def close_corners(segments: np.ndarray, radius: float) -> np.ndarray:
    """Verlaengert Linien, deren Enden sich fast treffen, bis zum exakten
    Schnittpunkt -> saubere Ecken statt kleiner Luecken/Ueberstaende."""
    if len(segments) < 2:
        return segments
    out = segments.copy()
    n = len(out)
    pts = np.vstack([out[:, 0:2], out[:, 2:4]])   # Index e: Segment e % n, Ende e // n
    cell = radius
    grid: dict[tuple[int, int], list[int]] = {}
    for e, (x, y) in enumerate(pts):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(e)

    def seg_dir(k: int) -> tuple[float, float]:
        dx, dy = out[k, 2] - out[k, 0], out[k, 3] - out[k, 1]
        L = math.hypot(dx, dy) or 1.0
        return dx / L, dy / L

    for e1 in range(2 * n):
        k1 = e1 % n
        x, y = out[k1, (e1 // n) * 2], out[k1, (e1 // n) * 2 + 1]
        gx, gy = int(x // cell), int(y // cell)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for e2 in grid.get((gx + ox, gy + oy), []):
                    if e2 <= e1 or e2 % n == k1:
                        continue
                    k2 = e2 % n
                    x2, y2 = out[k2, (e2 // n) * 2], out[k2, (e2 // n) * 2 + 1]
                    if math.hypot(x - x2, y - y2) > radius:
                        continue
                    d1, d2 = seg_dir(k1), seg_dir(k2)
                    cross = d1[0] * d2[1] - d1[1] * d2[0]
                    if abs(cross) < 0.35:          # zu parallel -> kein Eckpunkt
                        continue
                    # Schnittpunkt der Geraden
                    t = ((x2 - x) * d2[1] - (y2 - y) * d2[0]) / cross
                    ix, iy = x + d1[0] * t, y + d1[1] * t
                    if (math.hypot(ix - x, iy - y) <= radius * 1.6 and
                            math.hypot(ix - x2, iy - y2) <= radius * 1.6):
                        out[k1, (e1 // n) * 2] = ix
                        out[k1, (e1 // n) * 2 + 1] = iy
                        out[k2, (e2 // n) * 2] = ix
                        out[k2, (e2 // n) * 2 + 1] = iy
                        x, y = ix, iy
    return out


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


_WORD_RE = None


def _has_content(txt: str) -> bool:
    return any(c.isalnum() for c in txt)


def _tess_words(gray: np.ndarray, psm: int, min_conf: int,
                scale: float = 1.0, origin: tuple[int, int] = (0, 0)) -> list[dict]:
    """Ein Tesseract-Durchgang -> Wortliste in Bildkoordinaten."""
    try:
        import pytesseract
        data = pytesseract.image_to_data(gray, lang="deu", config=f"--psm {psm}",
                                         output_type=pytesseract.Output.DICT)
    except Exception:
        return []
    words: list[dict] = []
    for i in range(len(data["text"])):
        txt = data["text"][i].strip()
        try:
            conf = int(float(data["conf"][i]))
        except (ValueError, TypeError):
            continue
        if not txt or conf < min_conf or not _has_content(txt):
            continue
        words.append({
            "text": txt, "conf": conf, "angle": 0,
            "x": int(data["left"][i] / scale) + origin[0],
            "y": int(data["top"][i] / scale) + origin[1],
            "w": max(int(data["width"][i] / scale), 1),
            "h": max(int(data["height"][i] / scale), 1),
        })
    return words


def _iou(a: dict, b: dict) -> float:
    x1 = max(a["x"], b["x"]); y1 = max(a["y"], b["y"])
    x2 = min(a["x"] + a["w"], b["x"] + b["w"])
    y2 = min(a["y"] + a["h"], b["y"] + b["h"])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    return inter / (a["w"] * a["h"] + b["w"] * b["h"] - inter)


def _dedupe_words(words: list[dict]) -> list[dict]:
    kept: list[dict] = []
    for wd in sorted(words, key=lambda w: -w["conf"]):
        if all(_iou(wd, k) <= 0.25 for k in kept):
            kept.append(wd)
    return kept


_MEASURE_RE = __import__("re").compile(r"^[~±+\-=≈]*\d+[.,]\d+[\"'°”]*$")


def _plausible(wd: dict) -> bool:
    """Filtert OCR-Phantomwoerter (Linienmuster, die wie Kurztext aussehen)."""
    txt = wd["text"]
    if wd["h"] < 9:
        return False
    if wd["angle"] == 90:
        # senkrecht stehen praktisch nur Masszahlen; sonst sehr strenge Regeln
        return bool(_MEASURE_RE.match(txt)) or (len(txt) >= 4 and wd["conf"] >= 80)
    if len(txt) <= 2 and wd["conf"] < 70 and not any(c.isdigit() for c in txt):
        return False
    # riesige "Woerter" mit wenigen Zeichen sind fast immer fehlgelesene Grafik
    if wd["h"] >= 60 and len(txt) <= 4 and not _MEASURE_RE.match(txt):
        return False
    return True


def ocr_words(norm: np.ndarray) -> list[dict]:
    """Mehrpass-Texterkennung auf dem beleuchtungskorrigierten Graubild:
    Layout-Modus + Streutext-Modus + um 90 Grad gedrehter Durchgang fuer
    senkrechte Beschriftungen (Masszahlen)."""
    words = _tess_words(norm, psm=3, min_conf=45)
    words += _tess_words(norm, psm=11, min_conf=55)

    # gedrehte Beschriftung (liest von unten nach oben)
    h = norm.shape[0]
    rot = cv2.rotate(norm, cv2.ROTATE_90_CLOCKWISE)
    for wd in _tess_words(rot, psm=11, min_conf=60):
        if len(wd["text"]) < 2:
            continue
        # Ruecktransformation: (x', y') = (H-1-y, x)
        x = wd["y"]
        y = h - 1 - (wd["x"] + wd["w"])
        words.append({**wd, "x": x, "y": y, "w": wd["h"], "h": wd["w"],
                      "angle": 90})
    return _dedupe_words([wd for wd in words if _plausible(wd)])


def ocr_crop(norm: np.ndarray, box: tuple[int, int, int, int],
             min_conf: int = 45) -> list[dict]:
    """Gezielter OCR-Versuch auf einem Ausschnitt (2x vergroessert, eine Zeile)."""
    x, y, w, h = box
    pad = max(4, h // 4)
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(norm.shape[1], x + w + pad), min(norm.shape[0], y + h + pad)
    sub = norm[y0:y1, x0:x1]
    if sub.size == 0:
        return []
    sub2 = cv2.resize(sub, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    return _tess_words(sub2, psm=7, min_conf=min_conf, scale=3.0, origin=(x0, y0))


def group_text_lines(words: list[dict], min_conf: int = 45) -> list[dict]:
    """Woerter geometrisch zu Textzeilen gruppieren (fuer Text-Entities)."""
    items: list[dict] = []
    for angle in (0, 90):
        ws = [w for w in words if w["angle"] == angle and w["conf"] >= min_conf]
        if angle == 0:
            ws.sort(key=lambda w: (w["y"] + w["h"] / 2, w["x"]))
        else:
            ws.sort(key=lambda w: (w["x"] + w["w"] / 2, -w["y"]))
        rows: list[list[dict]] = []
        for wd in ws:
            placed = False
            for row in rows:
                last = row[-1]
                if angle == 0:
                    same_band = abs((wd["y"] + wd["h"] / 2) - (last["y"] + last["h"] / 2)) \
                        < 0.7 * max(wd["h"], last["h"])
                    similar_size = min(wd["h"], last["h"]) / max(wd["h"], last["h"]) > 0.5
                    gap = wd["x"] - (last["x"] + last["w"])
                    # kein starkes Ueberlappen (Duplikate aus zwei OCR-Durchgaengen)
                    ok = same_band and similar_size and \
                        -0.4 * last["w"] < gap < 1.8 * max(wd["h"], last["h"])
                else:
                    same_band = abs((wd["x"] + wd["w"] / 2) - (last["x"] + last["w"] / 2)) \
                        < 0.7 * max(wd["w"], last["w"])
                    ok = same_band and (last["y"] - (wd["y"] + wd["h"])) < 2.5 * max(wd["w"], last["w"])
                if ok:
                    row.append(wd)
                    placed = True
                    break
            if not placed:
                rows.append([wd])
        for row in rows:
            if angle == 0:
                x = min(w["x"] for w in row)
                y = max(w["y"] + w["h"] for w in row)
                size = max(w["h"] for w in row)
            else:
                x = max(w["x"] + w["w"] for w in row)
                y = max(w["y"] + w["h"] for w in row)
                size = max(w["w"] for w in row)
            items.append({"text": " ".join(w["text"] for w in row),
                          "x": int(x), "y": int(y), "size": int(size),
                          "angle": angle})
    return items


def vectorize(img: np.ndarray, params: VectorizeParams | None = None,
              corners: list[list[float]] | None = None,
              with_ocr: bool = True) -> dict:
    p = params or VectorizeParams()
    if corners and len(corners) == 4:
        img = warp_perspective(img, corners)
    img = _limit_size(img, p.max_dim)

    # 1) Binarisieren + Verdrehung korrigieren
    binary, norm = binarize(img)
    skew = estimate_skew(detect_segments(binary, p))
    if abs(skew) > 0.15:
        img = rotate_image(img, skew)
        binary, norm = binarize(img)

    # 2) nur Inhalte auf dem Papierbogen betrachten (keine Blattkanten/Tisch)
    binary = cv2.bitwise_and(binary, paper_mask(img))

    # 3) Text erkennen und aus dem Linienbild entfernen (Text bleibt Text!)
    #    Entfernt wird nur, was die OCR wirklich gelesen hat - unbestaetigte
    #    Bereiche bleiben als Linien sichtbar, damit nichts verschwindet.
    words = ocr_words(norm) if with_ocr else []
    line_bin = mask_word_boxes(binary, words) if words else binary
    if with_ocr:
        line_bin, rescued = rescue_text_groups(line_bin, norm)
        words += rescued

    # 4) gefuellte Flaechen (Waende) als saubere Konturen, duenne Striche per Skelett
    thick, thin = split_thick(line_bin, p.thick_stroke)
    segs_thin = detect_segments(thin, p)
    segs_thick = outline_segments(thick)
    segs = np.vstack([segs_thin, segs_thick]) if len(segs_thick) else segs_thin

    # 5) Faltenschatten aussortieren, begradigen, zu langen Linien zusammenfuehren
    segs = filter_ink(segs, norm)
    segs = snap_angles(segs, p.angle_snap_deg)
    segs = merge_collinear(segs, p)
    segs = merge_collinear(segs, p)          # 2. Durchgang schliesst neue Luecken
    segs = bridge_text_gaps(segs, p)         # Luecken unter entfernter Beschriftung
    segs = snap_angles(segs, p.angle_snap_deg)
    segs = close_corners(segs, p.corner_snap)
    segs = snap_corners(segs, p.corner_snap * 0.75)
    segs = filter_short(segs, p.min_len)

    return {
        "width": int(img.shape[1]),
        "height": int(img.shape[0]),
        "skew_corrected_deg": round(skew, 3),
        "image_png_base64": encode_png_base64(img),
        "segments": [[round(v, 2) for v in s] for s in segs.tolist()],
        "texts": group_text_lines(words),
    }
