"""Weboberflaeche:  python -m notenscanner.server   (dann http://localhost:8001)"""

from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from . import audio, pipeline
from .transcribe import TranscribeParams

STATIC = Path(__file__).parent / "static"
WORK = Path(tempfile.gettempdir()) / "notenscanner_jobs"
app = FastAPI(title="Notenscanner")

JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()  # Basic-Pitch/Demucs nacheinander ausfuehren


@app.post("/api/transcribe")
async def api_transcribe(
    file: UploadFile = File(...),
    arrangement: str = Form("melodie+klavier"),
    bpm: float = Form(0),
    beats_per_bar: int = Form(0),
    key: str = Form(""),
    division: int = Form(4),
    triplets: bool = Form(False),
    chord_symbols: bool = Form(True),
    max_poly: int = Form(5),
    sensitivity: float = Form(0.5),
    min_note_ms: float = Form(80),
):
    if arrangement not in pipeline.ARRANGEMENTS:
        return JSONResponse({"error": "Unbekannte Besetzung"}, status_code=400)
    if arrangement == "band" and not audio.demucs_available():
        return JSONResponse({"error": "Für „Band“ muss Demucs installiert sein "
                                      "(pip install demucs)."}, status_code=400)
    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    src = job_dir / Path(file.filename or "lied.mp3").name
    with src.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)

    opts = pipeline.Options(
        arrangement=arrangement,
        bpm=bpm or None,
        beats_per_bar=beats_per_bar or None,
        key=key.strip() or None,
        division=division,
        triplets=triplets,
        chord_symbols=chord_symbols,
        max_poly=max_poly,
        transcribe=TranscribeParams(
            onset_threshold=sensitivity,
            frame_threshold=max(0.1, sensitivity - 0.2),
            min_note_ms=min_note_ms,
        ),
    )
    JOBS[job_id] = {"status": "wartet", "progress": 0.0, "message": "In Warteschlange"}
    threading.Thread(target=_work, args=(job_id, src, job_dir, opts), daemon=True).start()
    return {"job": job_id}


def _work(job_id: str, src: Path, job_dir: Path, opts: pipeline.Options) -> None:
    job = JOBS[job_id]

    def progress(msg: str, frac: float) -> None:
        job.update(status="läuft", message=msg, progress=frac)

    try:
        with _LOCK:
            res = pipeline.run(src, job_dir / "out", opts, progress)
    except Exception as exc:  # noqa: BLE001
        job.update(status="fehler", message=str(exc))
        return
    job.update(
        status="fertig", progress=1.0, message="Fertig",
        result={
            "title": res.title, "bpm": res.bpm, "time_signature": res.time_signature,
            "key": res.key, "notes": res.note_count, "measures": res.measures,
            "files": {
                "musicxml": res.musicxml.name,
                "midi": res.midi.name,
                **({"pdf": res.pdf.name} if res.pdf else {}),
            },
        },
    )


@app.get("/api/job/{job_id}")
async def api_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return JSONResponse({"error": "Unbekannter Auftrag"}, status_code=404)
    return job


@app.get("/api/job/{job_id}/file/{name}")
async def api_file(job_id: str, name: str):
    path = (WORK / job_id / "out" / name).resolve()
    if not path.is_relative_to(WORK.resolve()) or not path.is_file():
        return JSONResponse({"error": "Datei nicht gefunden"}, status_code=404)
    return FileResponse(path, filename=name)


@app.get("/api/info")
async def api_info():
    return {
        "arrangements": pipeline.ARRANGEMENTS,
        "demucs": audio.demucs_available(),
        "pdf": pipeline.pdf_renderer_available(),
    }


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


def main() -> None:
    import argparse

    import uvicorn

    ap = argparse.ArgumentParser(description="Notenscanner-Weboberflaeche")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8001)
    args = ap.parse_args()
    print(f"Notenscanner läuft auf http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
