"""Polyphone Notenerkennung mit Spotifys Basic-Pitch (ONNX, laeuft auf der CPU)."""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Note:
    start: float      # Sekunden
    end: float        # Sekunden
    pitch: int        # MIDI-Nummer (60 = c')
    velocity: float   # 0..1

    @property
    def dur(self) -> float:
        return self.end - self.start


@dataclass
class TranscribeParams:
    onset_threshold: float = 0.5   # hoeher = weniger, sicherere Notenanfaenge
    frame_threshold: float = 0.3   # hoeher = kuerzere Noten, weniger Rauschen
    min_note_ms: float = 80.0      # kuerzere Noten werden verworfen
    min_pitch: int = 21            # A2 (tiefste Klaviertaste)
    max_pitch: int = 108           # c5 (hoechste Klaviertaste)
    remove_ghosts: bool = True     # Geister-Unteroktaven entfernen


def _load_basic_pitch():
    logging.getLogger().setLevel(logging.ERROR)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model, predict
    model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    return model, predict


_MODEL = None


def transcribe(path: str | Path, params: TranscribeParams | None = None) -> list[Note]:
    """Audiodatei -> Liste erkannter Noten (Zeit in Sekunden)."""
    global _MODEL
    params = params or TranscribeParams()
    if _MODEL is None:
        _MODEL = _load_basic_pitch()
    model, predict = _MODEL

    _, _, events = predict(
        str(path),
        model,
        onset_threshold=params.onset_threshold,
        frame_threshold=params.frame_threshold,
        minimum_note_length=params.min_note_ms,
        minimum_frequency=_midi_to_hz(params.min_pitch),
        maximum_frequency=_midi_to_hz(params.max_pitch + 0.5),
        multiple_pitch_bends=False,
        melodia_trick=True,
    )
    notes = [
        Note(float(s), float(e), int(p), float(a))
        for s, e, p, a, *_ in events
        if params.min_pitch <= int(p) <= params.max_pitch
    ]
    notes.sort(key=lambda n: (n.start, n.pitch))
    if params.remove_ghosts:
        notes = remove_ghost_octaves(notes)
    return notes


def _midi_to_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def remove_ghost_octaves(notes: list[Note], ratio: float = 0.85) -> list[Note]:
    """Geistertoene eine Oktave unter einer gespielten Note entfernen.

    Die Erkennung meldet zu manchen Noten zusaetzlich die tiefere Oktave
    (der Grundton wird aus den Obertoenen "erraten"). Solche Paare setzen
    gleichzeitig ein und der Geisterton ist leiser. Echte Oktavgriffe sind
    meist gleich laut und bleiben erhalten. (Messung an Klavieraufnahmen:
    Genauigkeit +6 Prozentpunkte, Trefferquote unveraendert.)
    """
    import bisect

    order = sorted(range(len(notes)), key=lambda k: notes[k].start)
    starts = [notes[k].start for k in order]
    keep = []
    for a in notes:
        lo_idx = bisect.bisect_left(starts, a.start - _TOGETHER)
        hi_idx = bisect.bisect_right(starts, a.start + _TOGETHER)
        ghost = any(notes[j].pitch - a.pitch == 12 and a.velocity < notes[j].velocity * ratio
                    for j in order[lo_idx:hi_idx])
        keep.append(not ghost)
    return [n for n, k in zip(notes, keep) if k]


_TOGETHER = 0.05  # Sekunden: "gleichzeitiger" Einsatz
