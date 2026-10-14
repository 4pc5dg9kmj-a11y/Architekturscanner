"""Tempo, Schlaege, Taktart und Quantisierung der Noten auf ein Notenraster."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .audio import SR
from .transcribe import Note


@dataclass
class BeatGrid:
    beats: np.ndarray        # Zeitpunkte (s) aller Schlaege
    bpm: float
    beats_per_bar: int       # 3 = 3/4, 4 = 4/4, ...
    first_downbeat: int      # Index des ersten Schlags, der eine "1" ist

    def time_to_beat(self, t: np.ndarray | float) -> np.ndarray:
        """Sekunden -> Schlagposition (Gleitkomma), folgt Tempo-Schwankungen."""
        b = self.beats
        idx = np.arange(len(b), dtype=float)
        t = np.asarray(t, dtype=float)
        period_start = b[1] - b[0]
        period_end = b[-1] - b[-2]
        out = np.interp(t, b, idx)
        out = np.where(t < b[0], (t - b[0]) / period_start, out)
        out = np.where(t > b[-1], len(b) - 1 + (t - b[-1]) / period_end, out)
        return out


def detect_beats(y: np.ndarray, bpm: float | None = None) -> tuple[np.ndarray, float]:
    """Schlagzeitpunkte ermitteln. Mit ``bpm`` wird ein festes Raster genutzt."""
    import librosa

    onset_env = librosa.onset.onset_strength(y=y, sr=SR)
    duration = len(y) / SR
    if bpm:
        # Festes Tempo: nur die Phase (Lage des ersten Schlags) bestimmen.
        _, frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR, bpm=bpm,
                                            tightness=400)
        period = 60.0 / bpm
        times = librosa.frames_to_time(frames, sr=SR)
        phase = float(np.median(np.mod(times, period))) if len(times) else 0.0
        beats = np.arange(phase, duration + period, period)
        return beats, float(bpm)

    tempo, frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR, trim=False)
    beats = librosa.frames_to_time(frames, sr=SR)
    tempo = float(np.atleast_1d(tempo)[0])
    if len(beats) < 4:
        period = 60.0 / (tempo or 120.0)
        beats = np.arange(0.0, duration + period, period)
    else:
        beats = _extend_beats(beats, duration)
    bpm_est = 60.0 / float(np.median(np.diff(beats)))
    return beats, bpm_est


def _extend_beats(beats: np.ndarray, duration: float) -> np.ndarray:
    """Schlagraster bis Anfang und Ende des Stuecks fortsetzen."""
    period = float(np.median(np.diff(beats)))
    head = np.arange(beats[0] - period, -period, -period)[::-1]
    tail = np.arange(beats[-1] + period, duration + period, period)
    return np.concatenate([head, beats, tail])


def detect_meter(notes: list[Note], beats: np.ndarray, y: np.ndarray,
                 beats_per_bar: int | None = None) -> tuple[int, int]:
    """Taktart (3 oder 4 Schlaege) und Lage der ersten "1" schaetzen.

    Betonte Zaehlzeiten erkennt man an Basstoenen, neuen Akkorden und
    lauten Einsaetzen; das Raster mit dem deutlichsten Akzentmuster gewinnt.
    """
    import librosa

    onset_env = librosa.onset.onset_strength(y=y, sr=SR)
    frames = np.clip(librosa.time_to_frames(beats, sr=SR), 0, len(onset_env) - 1)
    accent = onset_env[frames].astype(float)
    accent /= accent.max() + 1e-9

    # Basstoene und Notendichte je Schlag
    bass = np.zeros(len(beats))
    dens = np.zeros(len(beats))
    if notes:
        grid = BeatGrid(beats, 0, 4, 0)
        pos = np.rint(grid.time_to_beat([n.start for n in notes])).astype(int)
        for n, p in zip(notes, pos):
            if 0 <= p < len(beats):
                dens[p] += n.velocity
                if n.pitch < 55:
                    bass[p] += n.velocity * n.dur
    for arr in (bass, dens):
        if arr.max() > 0:
            arr /= arr.max()
    strength = accent + 1.5 * bass + 0.5 * dens

    candidates = [beats_per_bar] if beats_per_bar else [4, 3]
    best = (-np.inf, 4, 0)
    for m in candidates:
        for phase in range(m):
            on = strength[phase::m]
            off = np.delete(strength, np.arange(phase, len(strength), m))
            if len(on) < 2 or len(off) < 2:
                continue
            score = on.mean() - off.mean()
            if m == 4:
                # Halbe Taktbetonung (Zaehlzeit 3) staerkt die 4/4-Hypothese
                score += 0.3 * (strength[phase + 2::m].mean() - off.mean())
            if score > best[0]:
                best = (score, m, phase)
    _, m, phase = best
    return m, phase


def build_grid(y: np.ndarray, notes: list[Note], bpm: float | None = None,
               beats_per_bar: int | None = None) -> BeatGrid:
    beats, bpm_est = detect_beats(y, bpm)
    m, phase = detect_meter(notes, beats, y, beats_per_bar)
    return BeatGrid(beats=beats, bpm=bpm_est, beats_per_bar=m, first_downbeat=phase)


@dataclass
class QNote:
    """Quantisierte Note: Position/Dauer in Viertelnoten ab Taktanfang 1."""

    offset: float
    dur: float
    pitch: int
    velocity: float


def quantize(notes: list[Note], grid: BeatGrid, division: int = 4,
             triplets: bool = False, origin: float | None = None) -> list[QNote]:
    """Noten auf das Raster legen.

    ``division`` = Unterteilungen je Viertel (4 = Sechzehntel, 2 = Achtel).
    Mit ``triplets`` wird je Note zusaetzlich das Triolenraster geprueft.
    ``origin`` (Sekunden) legt fest, ab wann Takt 1 gesucht wird – so
    bekommen mehrere Spuren denselben Taktbeginn.
    """
    if not notes:
        return []
    starts = grid.time_to_beat([n.start for n in notes])
    ends = grid.time_to_beat([n.end for n in notes])
    # Taktanfang 1 auf den ersten Downbeat legen, der vor der ersten Note liegt
    first = starts.min() if origin is None else float(grid.time_to_beat(origin))
    shift = grid.first_downbeat
    while shift > first + 0.25:
        shift -= grid.beats_per_bar
    starts = starts - shift
    ends = ends - shift

    out: list[QNote] = []
    for n, s, e in zip(notes, starts, ends):
        qs, qe = _snap(s, division, triplets), _snap(e, division, triplets)
        step = 1.0 / division
        if qe - qs < step:
            qe = qs + step
        out.append(QNote(round(qs, 6), round(qe - qs, 6), n.pitch, n.velocity))
    # Doppelte Noten (gleiche Tonhoehe, gleicher Einsatz) zusammenfassen
    uniq: dict[tuple[float, int], QNote] = {}
    for q in out:
        key = (q.offset, q.pitch)
        if key not in uniq or q.dur > uniq[key].dur:
            uniq[key] = q
    return sorted(uniq.values(), key=lambda q: (q.offset, q.pitch))


def _snap(x: float, division: int, triplets: bool) -> float:
    straight = round(x * division) / division
    if not triplets:
        return straight
    trip = round(x * 3) / 3
    # Triole nur, wenn sie klar besser passt
    return trip if abs(x - trip) + 0.02 < abs(x - straight) else straight
