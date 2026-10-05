"""Aus quantisierten Noten einen Notensatz (music21-Partitur) bauen."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from .harmony import chord_name, spell
from .rhythm import QNote


@dataclass
class StaffSpec:
    """Ein Notensystem der Partitur."""

    name: str
    notes: list[QNote]
    clef: str = "treble"          # treble, bass, treble8vb
    mode: str = "chords"          # chords | top (Melodie) | bottom (Bass)
    group: str | None = None      # gleiche Gruppe = mit Akkolade verbunden
    instrument: str = "Piano"     # music21-Instrumentklasse


@dataclass
class ScoreSpec:
    title: str
    composer: str
    bpm: float
    beats_per_bar: int
    key_name: str
    sharps: int
    staves: list[StaffSpec] = field(default_factory=list)
    chord_symbols: bool = True
    max_poly: int = 5


# --- Noten fuer ein System aufbereiten --------------------------------------

def to_events(notes: list[QNote], mode: str, max_poly: int,
              min_dur: float = 0.25) -> list[tuple[float, float, list[int]]]:
    """Ueberlappende Noten in eine lesbare Folge (Einsatz, Dauer, Tonhoehen)."""
    by_onset: dict[float, list[QNote]] = defaultdict(list)
    for n in notes:
        by_onset[n.offset].append(n)
    onsets = sorted(by_onset)
    events = []
    for i, t in enumerate(onsets):
        group = by_onset[t]
        nxt = onsets[i + 1] if i + 1 < len(onsets) else None
        if mode == "top":
            group = [_top(group)]
        elif mode == "bottom":
            group = [min(group, key=lambda n: n.pitch)]
        elif len(group) > max_poly:
            group = sorted(group, key=lambda n: -n.velocity)[:max_poly]
        durs = sorted(n.dur for n in group)
        dur = durs[len(durs) // 2]
        if nxt is not None:
            gap = nxt - (t + dur)
            # gebundenes Spiel: kleine Luecken bis zum naechsten Einsatz schliessen
            if gap <= 0 or gap <= max(0.25, 0.34 * dur):
                dur = nxt - t
        dur = max(dur, min_dur if nxt is None or nxt - t >= min_dur else nxt - t)
        events.append((t, dur, sorted({n.pitch for n in group})))
    return events


def split_hands(notes: list[QNote], split: int = 60) -> tuple[list[QNote], list[QNote]]:
    """Klaviersatz: Noten auf rechte/linke Hand verteilen.

    Grundsaetzlich am c' getrennt; bei weiten Griffen bleibt eine Note bei
    der Hand, deren Akkord sie naeher ist.
    """
    rh, lh = [], []
    by_onset: dict[float, list[QNote]] = defaultdict(list)
    for n in notes:
        by_onset[n.offset].append(n)
    for group in by_onset.values():
        group.sort(key=lambda n: n.pitch)
        lo = [n for n in group if n.pitch < split]
        hi = [n for n in group if n.pitch >= split]
        # Eine Hand greift hoechstens eine None (14 Halbtoene) - der Rest wandert
        while len(hi) > 1 and hi[-1].pitch - hi[0].pitch > 14 and hi[0].pitch < split + 5:
            lo.append(hi.pop(0))
        while len(lo) > 1 and lo[-1].pitch - lo[0].pitch > 14 and lo[-1].pitch > split - 5:
            hi.insert(0, lo.pop())
        rh += hi
        lh += lo
    return rh, lh


def _top(group: list[QNote]) -> QNote:
    """Hoechste Note, die nicht deutlich leiser ist als die lauteste."""
    loud = max(n.velocity for n in group)
    return max((n for n in group if n.velocity >= 0.75 * loud), key=lambda n: n.pitch)


def extract_melody(notes: list[QNote], min_pitch: int = 55) -> tuple[list[QNote], list[QNote]]:
    """Melodie (oberste Stimme) von der Begleitung trennen."""
    by_onset: dict[float, list[QNote]] = defaultdict(list)
    for n in notes:
        by_onset[n.offset].append(n)
    melody, rest = [], []
    for t in sorted(by_onset):
        group = by_onset[t]
        top = _top(group)
        # Klingt die Melodie noch und der neue Ton liegt tiefer, ist er Begleitung
        held = melody and melody[-1].offset + melody[-1].dur > t + 1e-6
        if held and top.pitch < melody[-1].pitch - 2:
            rest += group
        elif top.pitch >= min_pitch:
            melody.append(top)
            rest += [n for n in group if n is not top]
        else:
            rest += group
    return melody, rest


# --- Partitur ---------------------------------------------------------------

def build_score(spec: ScoreSpec):
    from music21 import (chord, clef, harmony, instrument, key, layout, metadata,
                         meter, note, stream, tempo)

    score = stream.Score()
    score.insert(0, metadata.Metadata())
    score.metadata.movementName = spec.title
    score.metadata.composer = spec.composer or "Transkription: Notenscanner"

    end = max((n.offset + n.dur for s in spec.staves for n in s.notes), default=4.0)
    bar_len = float(spec.beats_per_bar)
    total = math.ceil(end / bar_len - 1e-6) * bar_len

    groups: dict[str, list] = defaultdict(list)
    first = True
    for st in spec.staves:
        part = stream.PartStaff() if st.group else stream.Part()
        part.partName = st.name
        inst = getattr(instrument, st.instrument, instrument.Piano)()
        inst.partName = st.name
        inst.partAbbreviation = st.name[:3] + "."
        part.partAbbreviation = inst.partAbbreviation
        part.insert(0, inst)
        part.insert(0, {"bass": clef.BassClef, "treble8vb": clef.Treble8vbClef}
                    .get(st.clef, clef.TrebleClef)())
        part.insert(0, key.KeySignature(spec.sharps))
        part.insert(0, meter.TimeSignature(f"{spec.beats_per_bar}/4"))
        if first:
            part.insert(0, tempo.MetronomeMark(number=round(spec.bpm)))

        for t, d, pitches in to_events(st.notes, st.mode, spec.max_poly):
            names = [spell(p, spec.sharps) for p in pitches]
            el = note.Note(names[0]) if len(names) == 1 else chord.Chord(names)
            el.quarterLength = d
            part.insert(t, el)

        if first and spec.chord_symbols:
            _add_chord_symbols(part, spec, total, harmony)
        first = False

        # Luecken und das Ende bis zum letzten Taktstrich mit Pausen fuellen
        part.makeRests(fillGaps=True, inPlace=True, timeRangeFromBarDuration=False,
                       refStreamOrTimeRange=[0.0, total])
        score.insert(0, part)
        if st.group:
            groups[st.group].append(part)

    for name, parts in groups.items():
        sg = layout.StaffGroup(parts, name=name, abbreviation=name[:3] + ".",
                               symbol="brace", barTogether=True)
        score.insert(0, sg)

    return score.makeNotation()


def _add_chord_symbols(part, spec: ScoreSpec, total: float, harmony) -> None:
    """Akkordsymbole je halbem Takt (nur bei Akkordwechsel) eintragen."""
    all_notes = [n for st in spec.staves for n in st.notes]
    seg = spec.beats_per_bar / 2 if spec.beats_per_bar % 2 == 0 else spec.beats_per_bar
    buckets: dict[int, list[QNote]] = defaultdict(list)
    for n in all_notes:
        a = int(n.offset // seg)
        b = int((n.offset + n.dur - 1e-6) // seg)
        for k in range(a, b + 1):
            lo, hi = max(n.offset, k * seg), min(n.offset + n.dur, (k + 1) * seg)
            buckets[k].append(QNote(lo, hi - lo, n.pitch, n.velocity))
    prev = None
    for k in range(int(total // seg)):
        name = chord_name(buckets.get(k, []), spec.sharps)
        if name and name != prev:
            try:
                cs = harmony.ChordSymbol(name)
            except Exception:  # unbekanntes Symbol
                continue
            cs.writeAsChord = False
            part.insert(k * seg, cs)
            prev = name
