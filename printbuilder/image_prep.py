"""Foto -> "Dunkelheitskarte" (0 = hell/wenig Material, 1 = dunkel/viel Material)."""

from __future__ import annotations

import numpy as np

try:  # OpenCV ist im Projekt ohnehin vorhanden
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None

from .params import ReliefParams

MAX_WORK_DIM = 1400
"""Arbeitsaufloesung; feiner bringt fuer 0,4-mm-Linien nichts."""


def decode_image(data: bytes, page: int = 0) -> np.ndarray:
    """Bytes (JPG/PNG/... oder PDF) als Graustufenbild 0..255, uint8."""
    if not data:
        raise ValueError("Leere Datei")

    if data[:5] == b"%PDF-":
        return _pdf_to_gray(data, page)

    if cv2 is None:  # pragma: no cover
        raise RuntimeError("OpenCV wird zum Lesen von Bildern benoetigt")
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Bildformat nicht erkannt")
    return img


def _pdf_to_gray(data: bytes, page: int) -> np.ndarray:
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover
        raise ValueError("PDF benoetigt PyMuPDF (pip install pymupdf)") from exc
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        pix = doc[max(0, min(page, doc.page_count - 1))].get_pixmap(
            matrix=fitz.Matrix(2, 2), colorspace=fitz.csGRAY
        )
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    finally:
        doc.close()


def fit_working_size(gray: np.ndarray, max_dim: int = MAX_WORK_DIM) -> np.ndarray:
    """Grosse Fotos auf Arbeitsgroesse bringen (flaechentreu gemittelt)."""
    h, w = gray.shape[:2]
    scale = max_dim / float(max(h, w))
    if scale >= 1.0:
        return gray
    return cv2.resize(gray, (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                      interpolation=cv2.INTER_AREA)


def darkness_map(gray: np.ndarray, p: ReliefParams) -> np.ndarray:
    """Graubild -> float32-Karte 0..1. 1 bedeutet "hier soll viel Material hin"."""
    img = gray.astype(np.float32) / 255.0

    if p.blur_px > 0.1 and cv2 is not None:
        k = int(p.blur_px * 3) | 1
        img = cv2.GaussianBlur(img, (k, k), p.blur_px)

    if p.auto_levels:
        lo, hi = np.percentile(img, (1.0, 99.0))
        if hi - lo > 1e-3:
            img = (img - lo) / (hi - lo)

    span = max(1e-3, p.white_point - p.black_point)
    img = (img - p.black_point) / span
    img = (img - 0.5) * p.contrast + 0.5 + p.brightness
    img = np.clip(img, 0.0, 1.0)

    dark = img if p.invert else 1.0 - img
    if abs(p.gamma - 1.0) > 1e-3:
        dark = np.power(dark, 1.0 / p.gamma)
    return np.clip(dark, 0.0, 1.0).astype(np.float32)


class DarknessField:
    """Bilineare Abtastung der Dunkelheitskarte in Platten-Koordinaten (mm).

    Die Bildflaeche liegt im Rechteck ``(x0, y0)-(x1, y1)``; y zeigt nach oben
    (Druckbett-Sicht von oben), die Bildzeilen laufen nach unten - das Bild
    wird deshalb hier gespiegelt abgetastet und erscheint im Druck richtig
    herum.
    """

    def __init__(self, dark: np.ndarray, rect: tuple[float, float, float, float]):
        self.dark = np.ascontiguousarray(dark, dtype=np.float32)
        self.rect = rect
        self.h, self.w = self.dark.shape[:2]

    def sample(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        x0, y0, x1, y1 = self.rect
        u = (np.asarray(x, dtype=np.float32) - x0) / max(1e-6, x1 - x0) * (self.w - 1)
        v = (y1 - np.asarray(y, dtype=np.float32)) / max(1e-6, y1 - y0) * (self.h - 1)
        u = np.clip(u, 0, self.w - 1)
        v = np.clip(v, 0, self.h - 1)

        u0 = np.floor(u).astype(np.int32)
        v0 = np.floor(v).astype(np.int32)
        u1i = np.minimum(u0 + 1, self.w - 1)
        v1i = np.minimum(v0 + 1, self.h - 1)
        fu = (u - u0).astype(np.float32)
        fv = (v - v0).astype(np.float32)

        d = self.dark
        top = d[v0, u0] * (1 - fu) + d[v0, u1i] * fu
        bot = d[v1i, u0] * (1 - fu) + d[v1i, u1i] * fu
        return top * (1 - fv) + bot * fv
