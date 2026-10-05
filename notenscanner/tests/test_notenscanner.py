"""Tests:  python -m pytest tests"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from notenscanner import harmony, pipeline, rhythm, score
from notenscanner.rhythm import QNote
from notenscanner.transcribe import Note, remove_ghost_octaves


def test_spell_follows_key_signature():
    assert harmony.spell(70, sharps=-2) == "B-4"   # B-Dur: b
    assert harmony.spell(70, sharps=2) == "A#4"    # D-Dur: ais
    assert harmony.spell(60, sharps=0) == "C4"


def test_detect_key_major_and_minor():
    c_major = [QNote(i, 1, p, 0.8) for i, p in enumerate([60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60])]
    assert harmony.detect_key(c_major) == ("C", 0)
    a_minor = [QNote(i, 1, p, 0.8) for i, p in enumerate([57, 60, 64, 57, 59, 60, 62, 64, 56, 57, 69, 57])]
    name, sharps = harmony.detect_key(a_minor)
    assert name == "a" and sharps == 0


def test_chord_names():
    assert harmony.chord_name([QNote(0, 2, p, 0.8) for p in (48, 64, 67)], 0) == "C"
    assert harmony.chord_name([QNote(0, 2, p, 0.8) for p in (45, 60, 64)], 0) == "Am"
    assert harmony.chord_name([QNote(0, 2, p, 0.8) for p in (43, 59, 62, 65)], 0) == "G7"
    assert harmony.chord_name([QNote(0, 2, p, 0.8) for p in (46, 62, 65)], -1) == "B-"


def test_quantize_follows_beats():
    beats = np.arange(0, 10, 0.5)  # 120 BPM
    grid = rhythm.BeatGrid(beats, 120, 4, 0)
    notes = [Note(0.01, 0.49, 60, 0.8), Note(0.52, 0.74, 62, 0.8), Note(0.76, 1.0, 64, 0.8)]
    q = rhythm.quantize(notes, grid)
    assert [(n.offset, n.dur) for n in q] == [(0.0, 1.0), (1.0, 0.5), (1.5, 0.5)]


def test_quantize_starts_bar_at_downbeat():
    beats = np.arange(0, 10, 0.5)
    grid = rhythm.BeatGrid(beats, 120, 4, 1)   # die "1" liegt auf Schlag 1
    q = rhythm.quantize([Note(0.0, 0.5, 60, 0.8), Note(0.5, 1.0, 62, 0.8)], grid)
    # Auftakt: erster Ton auf Zaehlzeit 4 des (leeren) ersten Takts
    assert q[0].offset == 3.0 and q[1].offset == 4.0


def test_ghost_octave_below_is_removed_but_real_octave_kept():
    notes = [Note(0, 1, 72, 0.8), Note(0.01, 1, 60, 0.3),     # Geist
             Note(2, 3, 72, 0.7), Note(2.0, 3, 60, 0.7)]      # echte Oktave
    kept = remove_ghost_octaves(notes)
    assert [(n.start, n.pitch) for n in kept] == [(0, 72), (2, 72), (2.0, 60)]


def test_events_close_small_gaps_and_limit_polyphony():
    notes = [QNote(0, 0.75, 60, 0.8), QNote(1, 1, 62, 0.8)]
    ev = score.to_events(notes, "chords", 5)
    assert ev[0] == (0, 1, [60])
    many = [QNote(0, 1, p, v) for p, v in [(60, .9), (64, .8), (67, .7), (70, .2), (72, .6)]]
    assert score.to_events(many, "chords", 3)[0][2] == [60, 64, 67]


def test_melody_extraction_skips_lower_notes_under_held_tone():
    notes = [QNote(0, 2, 79, 0.8), QNote(0, 1, 64, 0.6), QNote(1, 1, 64, 0.6), QNote(2, 1, 81, 0.8)]
    melody, accomp = score.extract_melody(notes)
    assert [n.pitch for n in melody] == [79, 81]
    assert len(accomp) == 2


def test_german_key_labels():
    assert [pipeline._key_label(k) for k in ("A-", "f#", "B-", "B", "e-")] == \
        ["As-Dur", "fis-Moll", "B-Dur", "H-Dur", "es-Moll"]


def test_build_score_has_measures_and_parts():
    notes = [QNote(i * 0.5, 0.5, 60 + (i % 8), 0.7) for i in range(32)]
    bass = [QNote(i * 4.0, 4, 48, 0.7) for i in range(4)]
    spec = score.ScoreSpec("Test", "", 100, 4, "C", 0, staves=[
        score.StaffSpec("Melodie", notes, "treble", "top"),
        score.StaffSpec("Klavier", [], "treble", group="Klavier"),
        score.StaffSpec("Klavier", bass, "bass", group="Klavier"),
    ])
    sc = score.build_score(spec)
    assert len(sc.parts) == 3
    assert len(sc.parts[0].getElementsByClass("Measure")) == 4


# --- Ende-zu-Ende: synthetisches Lied mit bekannter Melodie --------------------

def _synth_song(path: Path, bpm: float = 100.0) -> list[int]:
    import soundfile as sf

    sr, beat = 22050, 60 / bpm
    melody = [72, 74, 76, 77, 79, 77, 76, 74, 72, 76, 79, 84, 79, 76, 72, 72]
    y = np.zeros(int((len(melody) + 2) * beat * sr))
    for i, m in enumerate(melody):
        t = np.arange(int(beat * 0.9 * sr)) / sr
        f = 440 * 2 ** ((m - 69) / 12)
        tone = np.exp(-t * 3) * (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t))
        s = int(i * beat * sr)
        y[s:s + len(tone)] += 0.5 * tone
    sf.write(path, y, sr)
    return melody


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg fehlt")
def test_end_to_end_mp3(tmp_path):
    pytest.importorskip("basic_pitch")
    wav = tmp_path / "lied.wav"
    melody = _synth_song(wav)
    mp3 = tmp_path / "lied.mp3"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), str(mp3)], check=True)

    res = pipeline.run(mp3, tmp_path / "out", pipeline.Options(arrangement="leadsheet"),
                       pdf=False)
    assert res.musicxml.exists() and res.midi.exists()
    assert abs(res.bpm - 100) < 5
    assert res.key == "C-Dur"

    from music21 import converter

    sc = converter.parse(str(res.musicxml))
    got = [n.pitch.midi for n in sc.parts[0].recurse().notes if n.isNote]
    hits = sum(a == b for a, b in zip(got, melody))
    assert hits >= 0.8 * len(melody), got
