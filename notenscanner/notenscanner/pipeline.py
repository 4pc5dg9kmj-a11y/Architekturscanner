"""Gesamtablauf: MP3 -> Noten -> Rhythmus -> Tonart -> Partitur -> Dateien."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import audio, harmony, rhythm, score, transcribe

ARRANGEMENTS = {
    "klavier": "Klaviersatz (2 Systeme)",
    "melodie+klavier": "Melodie-System + Klavierbegleitung",
    "leadsheet": "Leadsheet (Melodie + Akkordsymbole)",
    "band": "Band: Gesang, Begleitung, Bass (braucht Demucs)",
}


@dataclass
class Options:
    arrangement: str = "melodie+klavier"
    bpm: float | None = None             # None = automatisch erkennen
    beats_per_bar: int | None = None     # None = automatisch (3 oder 4)
    key: str | None = None               # z. B. "G", "e", "B-"; None = automatisch
    division: int = 4                    # 4 = Sechzehntel-Raster, 2 = Achtel
    triplets: bool = False
    chord_symbols: bool = True
    max_poly: int = 5
    split_pitch: int = 60
    transcribe: transcribe.TranscribeParams = field(
        default_factory=transcribe.TranscribeParams)
    title: str | None = None
    composer: str | None = None


@dataclass
class Result:
    musicxml: Path
    midi: Path
    pdf: Path | None
    title: str
    bpm: float
    time_signature: str
    key: str
    note_count: int
    measures: int


Progress = Callable[[str, float], None]


def run(mp3: str | Path, out_dir: str | Path, opts: Options | None = None,
        progress: Progress | None = None, pdf: bool = True) -> Result:
    opts = opts or Options()
    mp3 = Path(mp3)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    say = progress or (lambda msg, frac: None)

    say("Lese Audiodatei", 0.02)
    meta = audio.read_metadata(mp3)
    title = opts.title or meta.title or mp3.stem
    composer = opts.composer if opts.composer is not None else meta.artist
    y = audio.load_audio(mp3)

    stems = None
    try:
        if opts.arrangement == "band":
            say("Trenne Instrumente (Demucs) – das dauert", 0.05)
            stems = audio.separate(mp3)
            sources = {
                "Gesang": stems.paths.get("vocals"),
                "Begleitung": stems.paths.get("other"),
                "Bass": stems.paths.get("bass"),
            }
        else:
            sources = {"Gesamt": mp3}

        raw: dict[str, list[transcribe.Note]] = {}
        for i, (name, path) in enumerate(sources.items()):
            if path is None:
                continue
            say(f"Erkenne Noten: {name}", 0.15 + 0.5 * i / len(sources))
            params = opts.transcribe
            if name == "Bass":
                params = transcribe.TranscribeParams(**{**params.__dict__, "max_pitch": 67})
            raw[name] = transcribe.transcribe(path, params)
    finally:
        if stems:
            stems.cleanup()

    all_raw = [n for notes in raw.values() for n in notes]
    if not all_raw:
        raise RuntimeError("In der Datei wurden keine Noten erkannt.")

    say("Erkenne Tempo und Taktart", 0.7)
    grid = rhythm.build_grid(y, all_raw, bpm=opts.bpm, beats_per_bar=opts.beats_per_bar)
    origin = min(n.start for n in all_raw)
    q = {name: rhythm.quantize(notes, grid, opts.division, opts.triplets, origin)
         for name, notes in raw.items()}

    say("Bestimme Tonart und Akkorde", 0.78)
    all_q = [n for notes in q.values() for n in notes]
    if opts.key:
        key_name, sharps = opts.key, _sharps_for(opts.key)
    else:
        key_name, sharps = harmony.detect_key(all_q)

    staves = _arrange(q, opts)
    spec = score.ScoreSpec(
        title=title, composer=composer, bpm=grid.bpm,
        beats_per_bar=grid.beats_per_bar, key_name=key_name, sharps=sharps,
        staves=staves, chord_symbols=opts.chord_symbols, max_poly=opts.max_poly,
    )

    say("Setze Noten", 0.85)
    sc = score.build_score(spec)
    stem = _safe_name(title)
    xml_path = out_dir / f"{stem}.musicxml"
    midi_path = out_dir / f"{stem}.mid"
    sc.write("musicxml", fp=str(xml_path))
    sc.write("midi", fp=str(midi_path))

    pdf_path = None
    if pdf:
        say("Erzeuge PDF", 0.93)
        pdf_path = render_pdf(xml_path, out_dir / f"{stem}.pdf")

    say("Fertig", 1.0)
    measures = len(sc.parts[0].getElementsByClass("Measure")) if sc.parts else 0
    return Result(
        musicxml=xml_path, midi=midi_path, pdf=pdf_path, title=title,
        bpm=round(grid.bpm, 1), time_signature=f"{grid.beats_per_bar}/4",
        key=_key_label(key_name), note_count=len(all_q), measures=measures,
    )


def _arrange(q: dict[str, list[rhythm.QNote]], opts: Options) -> list[score.StaffSpec]:
    S = score.StaffSpec
    if opts.arrangement == "band":
        staves = []
        if q.get("Gesang"):
            voice = [n for n in q["Gesang"] if n.pitch >= 45]  # Gesangsumfang ab A2
            staves.append(S("Gesang", voice, "treble", "top", instrument="Vocalist"))
        if q.get("Begleitung"):
            rh, lh = score.split_hands(q["Begleitung"], opts.split_pitch)
            staves += [S("Klavier", rh, "treble", group="Klavier"),
                       S("Klavier", lh, "bass", group="Klavier")]
        if q.get("Bass"):
            staves.append(S("Bass", q["Bass"], "bass", "bottom",
                            instrument="ElectricBass"))
        return staves

    notes = q["Gesamt"]
    if opts.arrangement == "klavier":
        rh, lh = score.split_hands(notes, opts.split_pitch)
        return [S("Klavier", rh, "treble", group="Klavier"),
                S("Klavier", lh, "bass", group="Klavier")]
    melody, accomp = score.extract_melody(notes)
    if opts.arrangement == "leadsheet":
        return [S("Melodie", melody, "treble", "top")]
    rh, lh = score.split_hands(accomp, opts.split_pitch)
    return [S("Melodie", melody, "treble", "top"),
            S("Klavier", rh, "treble", group="Klavier"),
            S("Klavier", lh, "bass", group="Klavier")]


def _sharps_for(name: str) -> int:
    from music21 import key

    return key.Key(name).sharps


def _key_label(name: str) -> str:
    """music21-Tonart -> deutscher Name, z. B. "A-" -> "As-Dur", "f#" -> "fis-Moll"."""
    from music21 import key

    k = key.Key(name)
    step, alter = k.tonic.step, int(k.tonic.alter)
    if step == "B":
        de = {-1: "B", 0: "H", 1: "His"}.get(alter, "H")
    elif alter < 0:
        de = {"E": "Es", "A": "As"}.get(step, step + "es")
        de += "es" * (-alter - 1)
    else:
        de = step + "is" * alter
    return f"{de.lower()}-Moll" if k.mode == "minor" else f"{de}-Dur"


def _safe_name(s: str) -> str:
    keep = "".join(c if c.isalnum() or c in " -_" else "_" for c in s).strip()
    return keep or "noten"


# --- PDF ---------------------------------------------------------------------

def render_pdf(xml_path: Path, pdf_path: Path) -> Path | None:
    """PDF ueber MuseScore (bevorzugt) oder LilyPond erzeugen, falls installiert."""
    for exe in _musescore_candidates():
        if shutil.which(exe) or Path(exe).is_file():
            proc = subprocess.run([exe, "-o", str(pdf_path), str(xml_path)],
                                  capture_output=True, timeout=600)
            if proc.returncode == 0 and pdf_path.exists():
                return pdf_path
    if shutil.which("musicxml2ly") and shutil.which("lilypond"):
        with tempfile.TemporaryDirectory() as tmp:
            ly = Path(tmp) / "score.ly"
            subprocess.run(["musicxml2ly", "--no-beaming", "-o", str(ly), str(xml_path)],
                           capture_output=True, timeout=600)
            if ly.exists():
                # musicxml2ly schreibt Dur/Moll als ":5"/":m5" (LilyPond: Powerchord "C5")
                text = re.sub(r":(m?)5(?=[\s}|])", lambda m: ":m" if m.group(1) else "",
                              ly.read_text(encoding="utf-8"))
                ly.write_text(text, encoding="utf-8")
                subprocess.run(["lilypond", "-dno-point-and-click", "-o",
                                str(Path(tmp) / "score"), str(ly)],
                               capture_output=True, timeout=900)
                out = Path(tmp) / "score.pdf"
                if out.exists():
                    shutil.copy(out, pdf_path)
                    return pdf_path
    return None


def _musescore_candidates() -> list[str]:
    names = ["mscore", "musescore", "mscore4portable", "MuseScore4", "musescore4", "musescore3"]
    names += [  # uebliche Installationsorte unter Windows und macOS
        r"C:\Program Files\MuseScore 4\bin\MuseScore4.exe",
        r"C:\Program Files\MuseScore 3\bin\MuseScore3.exe",
        "/Applications/MuseScore 4.app/Contents/MacOS/mscore",
        "/Applications/MuseScore 3.app/Contents/MacOS/mscore",
    ]
    return names


def pdf_renderer_available() -> bool:
    if any(shutil.which(n) or Path(n).is_file() for n in _musescore_candidates()):
        return True
    return bool(shutil.which("musicxml2ly") and shutil.which("lilypond"))
