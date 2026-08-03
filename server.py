"""Architekturscanner – Webserver.

Start:  python server.py   (dann http://localhost:8000 oeffnen)
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from shed.api import plan_payload
from shed.compliance import optimize
from shed.dxf import export_dxf as export_shed_dxf
from shed.model import build as build_shed
from shed.pdf import build_pdf as build_shed_pdf
from shed.spec import ShedSpec

ROOT = Path(__file__).parent
app = FastAPI(title="Architekturscanner & Fahrradhaeuschen-Planer")


def _scanner():
    """Scanner-Module erst bei Bedarf laden - der Planer laeuft ohne OpenCV."""
    from scanner.dxf_export import export_dxf
    from scanner.vectorize import (VectorizeParams, decode_image, pdf_to_image,
                                   vectorize)
    return export_dxf, VectorizeParams, decode_image, pdf_to_image, vectorize


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
    try:
        _, VectorizeParams, decode_image, pdf_to_image, vectorize = _scanner()
    except ImportError as exc:
        return JSONResponse(
            {"error": f"Scanner-Abhaengigkeiten fehlen ({exc}). "
                      "pip install -r requirements.txt ausfuehren."}, status_code=503)

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
        export_dxf = _scanner()[0]
        dxf_bytes = export_dxf(project)
    except Exception as exc:
        return JSONResponse({"error": f"DXF-Export fehlgeschlagen: {exc}"},
                            status_code=400)
    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={"Content-Disposition": 'attachment; filename="plan.dxf"'},
    )


# ---------------------------------------------------------------------------
# Fahrradhaeuschen-Planer
# ---------------------------------------------------------------------------


@app.post("/api/shed/plan")
async def api_shed_plan(spec: dict):
    try:
        return JSONResponse(plan_payload(ShedSpec.from_dict(spec)))
    except Exception as exc:
        return JSONResponse({"error": f"Berechnung fehlgeschlagen: {exc}"},
                            status_code=400)


@app.post("/api/shed/optimize")
async def api_shed_optimize(spec: dict):
    base = ShedSpec.from_dict(spec)
    best = optimize(base,
                    min_tool_width=float(spec.get("min_tool_width", 1200.0)),
                    min_eaves=float(spec.get("min_eaves", 2000.0)))
    return JSONResponse(plan_payload(best))


@app.post("/api/shed/pdf")
async def api_shed_pdf(spec: dict):
    try:
        data = build_shed_pdf(build_shed(ShedSpec.from_dict(spec)))
    except Exception as exc:
        return JSONResponse({"error": f"PDF-Erzeugung fehlgeschlagen: {exc}"},
                            status_code=400)
    return Response(content=data, media_type="application/pdf", headers={
        "Content-Disposition": 'attachment; filename="fahrradhaeuschen.pdf"'})


@app.post("/api/shed/dxf")
async def api_shed_dxf(spec: dict):
    try:
        data = export_shed_dxf(build_shed(ShedSpec.from_dict(spec)))
    except Exception as exc:
        return JSONResponse({"error": f"DXF-Export fehlgeschlagen: {exc}"},
                            status_code=400)
    return Response(content=data, media_type="application/dxf", headers={
        "Content-Disposition": 'attachment; filename="fahrradhaeuschen.dxf"'})


@app.get("/planer")
async def planer():
    return FileResponse(ROOT / "static" / "planer.html")


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "planer.html")


@app.get("/scanner")
async def scanner_index():
    return FileResponse(ROOT / "static" / "index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
