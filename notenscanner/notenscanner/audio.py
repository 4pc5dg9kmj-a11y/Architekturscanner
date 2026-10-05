"""Audio laden, Metadaten lesen und (optional) Instrumente trennen."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SR = 22050  # Abtastrate fuer Basic-Pitch und die Rhythmusanalyse


@dataclass
class Metadata:
    title: str = ""
    artist: str = ""
    duration: float = 0.0


@dataclass
class Stems:
    """Getrennte Spuren als WAV-Dateien (Pfad je Spurname)."""

    paths: dict[str, Path] = field(default_factory=dict)
    tmpdir: Path | None = None

    def cleanup(self) -> None:
        if self.tmpdir and self.tmpdir.exists():
            shutil.rmtree(self.tmpdir, ignore_errors=True)


def read_metadata(path: str | Path) -> Metadata:
    """Titel/Interpret aus den ID3-Tags lesen (ueber ffprobe, falls vorhanden)."""
    path = Path(path)
    meta = Metadata(title=path.stem.replace("_", " "))
    if not shutil.which("ffprobe"):
        return meta
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
        fmt = json.loads(out).get("format", {})
        tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
        meta.title = tags.get("title") or meta.title
        meta.artist = tags.get("artist") or tags.get("album_artist") or ""
        meta.duration = float(fmt.get("duration") or 0.0)
    except (subprocess.SubprocessError, ValueError, OSError):
        pass
    return meta


def load_audio(path: str | Path, sr: int = SR) -> np.ndarray:
    """MP3/WAV/FLAC/... als Mono-Signal laden."""
    import librosa

    y, _ = librosa.load(str(path), sr=sr, mono=True)
    return y


def demucs_available() -> bool:
    try:
        import demucs  # noqa: F401
    except ImportError:
        return False
    return True


def separate(path: str | Path, model: str = "htdemucs") -> Stems:
    """Lied mit Demucs in Gesang, Bass, Schlagzeug und Rest trennen.

    Benoetigt ``pip install demucs`` (laedt beim ersten Lauf das Modell).
    """
    if not demucs_available():
        raise RuntimeError(
            "Instrumententrennung braucht Demucs: pip install demucs"
        )
    tmp = Path(tempfile.mkdtemp(prefix="notenscanner_"))
    cmd = [sys.executable, "-m", "demucs", "-n", model, "-o", str(tmp), str(path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError(f"Demucs fehlgeschlagen:\n{proc.stderr[-2000:]}")
    stems = Stems(tmpdir=tmp)
    for wav in tmp.rglob("*.wav"):
        stems.paths[wav.stem] = wav  # vocals, bass, drums, other
    return stems
