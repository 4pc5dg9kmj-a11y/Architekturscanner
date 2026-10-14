"""Tonart, Akkordsymbole und korrekte Schreibweise (Kreuz/Be) der Noten."""

from __future__ import annotations

import numpy as np

from .rhythm import QNote

# Krumhansl-Kessler-Tonartprofile
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Tonartnamen nach Vorzeichenzahl (Quintenzirkel): Index = Grundton-Tonklasse
_MAJOR_NAMES = ["C", "D-", "D", "E-", "E", "F", "F#", "G", "A-", "A", "B-", "B"]
_MINOR_NAMES = ["c", "c#", "d", "e-", "e", "f", "f#", "g", "g#", "a", "b-", "b"]

# Vorzeichen je Dur-Grundton (positiv = Kreuze, negativ = Be)
_SHARPS_MAJOR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]


def pitch_class_histogram(notes: list[QNote]) -> np.ndarray:
    h = np.zeros(12)
    for n in notes:
        h[n.pitch % 12] += n.dur * (0.5 + n.velocity)
    return h


def detect_key(notes: list[QNote]) -> tuple[str, int]:
    """Tonart nach Krumhansl-Schmuckler.

    Rueckgabe: (music21-Tonartname, z. B. "E-" oder "f#", Vorzeichenzahl).
    """
    h = pitch_class_histogram(notes)
    if h.sum() == 0:
        return "C", 0
    best = (-2.0, "C", 0)
    for tonic in range(12):
        for profile, names, minor in ((_MAJOR, _MAJOR_NAMES, False),
                                      (_MINOR, _MINOR_NAMES, True)):
            r = np.corrcoef(h, np.roll(profile, tonic))[0, 1]
            if r > best[0]:
                rel_major = (tonic + 3) % 12 if minor else tonic
                best = (r, names[tonic], _SHARPS_MAJOR[rel_major])
    return best[1], best[2]


# --- Schreibweise ------------------------------------------------------------

_SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT_NAMES = ["C", "D-", "D", "E-", "E", "F", "G-", "G", "A-", "A", "B-", "B"]


def spell(midi: int, sharps: int) -> str:
    """MIDI-Nummer -> music21-Tonname passend zur Tonart (z. B. 'B-4')."""
    pc, octave = midi % 12, midi // 12 - 1
    name = (_FLAT_NAMES if sharps < 0 else _SHARP_NAMES)[pc]
    # Sonderfaelle extremer Tonarten
    if sharps >= 6 and pc == 5:
        name, octave = "E#", octave
    if sharps >= 7 and pc == 0:
        name, octave = "B#", octave - 1
    if sharps <= -6 and pc == 11:
        name, octave = "C-", octave + 1
    return f"{name}{octave}"


# --- Akkordsymbole -----------------------------------------------------------

_CHORD_TEMPLATES = {
    "": [0, 4, 7],
    "m": [0, 3, 7],
    "7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11],
    "m7": [0, 3, 7, 10],
    "dim": [0, 3, 6],
    "sus4": [0, 5, 7],
}


def chord_name(notes: list[QNote], sharps: int) -> str | None:
    """Akkordsymbol fuer eine Gruppe von Noten (z. B. ein Takt)."""
    if not notes:
        return None
    h = np.zeros(12)
    lowest = min(n.pitch for n in notes)
    for n in notes:
        w = n.dur * (0.5 + n.velocity)
        if n.pitch < lowest + 7:
            w *= 1.8  # Basston zaehlt staerker
        h[n.pitch % 12] += w
    if h.sum() == 0:
        return None
    h /= h.sum()
    best = (0.0, None)
    for root in range(12):
        for suffix, iv in _CHORD_TEMPLATES.items():
            pcs = [(root + i) % 12 for i in iv]
            inside = h[pcs].sum()
            score = inside - 0.1 * len(iv) - (h.sum() - inside) * 0.8
            if suffix == "":
                score += 0.03  # einfache Dreiklaenge bevorzugen
            if score > best[0]:
                best = (score, (root, suffix))
    if best[1] is None or best[0] < 0.1:
        return None
    root, suffix = best[1]
    name = spell(root + 60, sharps)[:-1]  # music21-Schreibweise: "B-" = Bb
    return name + suffix
