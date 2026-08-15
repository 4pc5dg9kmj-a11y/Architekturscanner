"""Architekturscanner – Webserver.

Start:  python server.py   (dann http://localhost:8000 oeffnen)
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from scanner.dxf_export import export_dxf
from scanner.relief_api import router as relief_router
from scanner.vectorize import VectorizeParams, decode_image, pdf_to_image, vectorize

ROOT = Path(__file__).parent
app = FastAPI(title="Architekturscanner")
app.include_router(relief_router)


@app.post("/api/vectorize")
async def api_vectorize(
    file: UploadFile = File(...),
    min_len: float = Form(12.0),
    merge_gap: float = Form(8.0),
    angle_snap_deg: float = Form(4.0),
    corner_snap: float = Form(7.0),
    max_dim: int = Form(3000),
    corners: str = Form(""),        # JSON: [[x,y],[x,y],[x,y],[x,y]] oder leer
    with_ocr: bool = Form(True),
    pdf_page: int = Form(0),
):
    data = await file.read()
    try:
        if (file.filename or "").lower().endswith(".pdf") or data[:5] == b"%PDF-":
            img = pdf_to_image(data, page=pdf_page)
        else:
            img = decode_image(data)
    except Exception as exc:
        return JSONResponse({"error": f"Datei konnte nicht gelesen werden: {exc}"},
                            status_code=400)

    params = VectorizeParams(
        min_len=min_len, merge_gap=merge_gap, angle_snap_deg=angle_snap_deg,
        corner_snap=corner_snap, max_dim=max_dim,
    )
    corner_pts = None
    if corners:
        try:
            corner_pts = json.loads(corners)
        except json.JSONDecodeError:
            corner_pts = None
    result = vectorize(img, params, corners=corner_pts, with_ocr=with_ocr)
    return JSONResponse(result)


@app.post("/api/export-dxf")
async def api_export_dxf(project: dict):
    try:
        dxf_bytes = export_dxf(project)
    except Exception as exc:
        return JSONResponse({"error": f"DXF-Export fehlgeschlagen: {exc}"},
                            status_code=400)
    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={"Content-Disposition": 'attachment; filename="plan.dxf"'},
    )


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/relief")
async def relief_page():
    """3D-Druck-Builder: Foto -> Platte mit bildgebenden Linien."""
    return FileResponse(ROOT / "static" / "relief.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
