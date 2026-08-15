"""HTTP-Schnittstelle des 3D-Druck-Builders.

Der Ablauf ist zweistufig: Das Foto wird einmal hochgeladen und serverseitig
zwischengespeichert; jede Reglerbewegung schickt danach nur noch die Parameter.
So bleibt die Vorschau auch bei grossen Fotos fluessig.
"""

from __future__ import annotations

import base64
import time
import uuid
from collections import OrderedDict
from threading import Lock

import numpy as np
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from printbuilder.builder import build_relief, plate_size
from printbuilder.image_prep import MAX_WORK_DIM, decode_image, fit_working_size
from printbuilder.mesh import EXPORTERS, MEDIA_TYPES
from printbuilder.params import PRESETS, ReliefParams

router = APIRouter(prefix="/api/relief", tags=["relief"])

MAX_CACHED_IMAGES = 12
CACHE_TTL_SECONDS = 6 * 3600


class _ImageCache:
    """Wenige Bilder im Speicher halten - aelteste fliegen zuerst raus."""

    def __init__(self, limit: int = MAX_CACHED_IMAGES) -> None:
        self._items: OrderedDict[str, tuple[float, np.ndarray]] = OrderedDict()
        self._limit = limit
        self._lock = Lock()

    def put(self, gray: np.ndarray) -> str:
        key = uuid.uuid4().hex
        with self._lock:
            self._items[key] = (time.time(), gray)
            self._items.move_to_end(key)
            while len(self._items) > self._limit:
                self._items.popitem(last=False)
        return key

    def get(self, key: str) -> np.ndarray | None:
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            stamp, gray = item
            if time.time() - stamp > CACHE_TTL_SECONDS:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return gray


_cache = _ImageCache()


@router.get("/presets")
async def api_presets():
    """Voreinstellungen und Vorgabewerte fuer die Oberflaeche."""
    return {
        "presets": {k: {"label": v["label"], "hint": v["hint"],
                        "values": v["values"]} for k, v in PRESETS.items()},
        "defaults": ReliefParams().to_dict(),
    }


@router.post("/upload")
async def api_upload(file: UploadFile = File(...), pdf_page: int = Form(0)):
    """Foto entgegennehmen, in Graustufen umrechnen und zwischenspeichern."""
    data = await file.read()
    try:
        gray = fit_working_size(decode_image(data, page=pdf_page))
    except Exception as exc:
        return JSONResponse({"error": f"Datei konnte nicht gelesen werden: {exc}"},
                            status_code=400)

    height, width = gray.shape[:2]
    return {
        "id": _cache.put(gray),
        "img_w": int(width),
        "img_h": int(height),
        "aspect": round(height / max(1, width), 4),
        "max_work_dim": MAX_WORK_DIM,
    }


@router.post("/preview")
async def api_preview(payload: dict):
    """Vorschaubilder und Kennzahlen fuer die aktuellen Parameter."""
    gray = _cache.get(str(payload.get("id", "")))
    if gray is None:
        return JSONResponse({"error": "Bild nicht mehr im Speicher – bitte neu laden.",
                             "reupload": True}, status_code=410)

    params = ReliefParams.from_dict(payload.get("params"))
    scale = float(payload.get("preview_px_per_mm", 8.0))
    try:
        result = build_relief(gray, params, with_previews=True,
                              preview_px_per_mm=max(2.0, min(16.0, scale)))
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    return {
        "stats": result.stats,
        "previews": result.previews,
        "params": result.params.to_dict(),
    }


@router.post("/export")
async def api_export(payload: dict):
    """Druckdatei erzeugen und als Download ausliefern."""
    gray = _cache.get(str(payload.get("id", "")))
    if gray is None:
        return JSONResponse({"error": "Bild nicht mehr im Speicher – bitte neu laden.",
                             "reupload": True}, status_code=410)

    fmt = str(payload.get("format", "stl")).lower()
    if fmt not in EXPORTERS:
        return JSONResponse({"error": f"Format '{fmt}' wird nicht unterstuetzt"},
                            status_code=400)

    params = ReliefParams.from_dict(payload.get("params"))
    try:
        result = build_relief(gray, params, with_previews=False)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    width_mm, height_mm = plate_size(gray, result.params)
    name = f"relief_{width_mm:.0f}x{height_mm:.0f}mm"
    data = EXPORTERS[fmt](result.mesh, name)
    return Response(
        content=data,
        media_type=MEDIA_TYPES.get(fmt, "application/octet-stream"),
        headers={
            "Content-Disposition": f'attachment; filename="{name}.{fmt}"',
            "X-Relief-Triangles": str(result.stats["triangles"]),
        },
    )


def data_url_to_png(data_url: str) -> bytes:
    """Hilfsfunktion fuer Tests/Skripte: data:-URL wieder in PNG-Bytes."""
    return base64.b64decode(data_url.split(",", 1)[1])
