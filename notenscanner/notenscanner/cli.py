"""Kommandozeile:  python -m notenscanner lied.mp3 [-o ausgabe] [Optionen]"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import pipeline
from .transcribe import TranscribeParams


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="notenscanner",
        description="Erzeugt aus MP3-Dateien einen Notensatz (MusicXML, MIDI, PDF).",
    )
    ap.add_argument("dateien", nargs="+", type=Path, help="MP3/WAV/FLAC/OGG-Dateien")
    ap.add_argument("-o", "--ausgabe", type=Path, default=Path("noten"),
                    help="Ausgabeordner (Standard: ./noten)")
    ap.add_argument("-a", "--satz", choices=list(pipeline.ARRANGEMENTS),
                    default="melodie+klavier",
                    help="Besetzung: " + "; ".join(f"{k} = {v}"
                                                  for k, v in pipeline.ARRANGEMENTS.items()))
    ap.add_argument("--tempo", type=float, help="Tempo in BPM festlegen (sonst automatisch)")
    ap.add_argument("--takt", choices=["2/4", "3/4", "4/4", "6/4"],
                    help="Taktart festlegen (sonst automatisch 3/4 oder 4/4)")
    ap.add_argument("--tonart", help='Tonart festlegen, z. B. "G", "e", "B-" (= B-Dur)')
    ap.add_argument("--raster", choices=["8", "16"], default="16",
                    help="Feinstes Notenraster: Achtel oder Sechzehntel")
    ap.add_argument("--triolen", action="store_true", help="Triolen erkennen")
    ap.add_argument("--keine-akkorde", action="store_true", help="Keine Akkordsymbole")
    ap.add_argument("--max-stimmen", type=int, default=5,
                    help="Hoechstens so viele Noten pro Akkord (Lesbarkeit)")
    ap.add_argument("--empfindlichkeit", type=float, default=0.5,
                    help="0.1 (viele Noten) .. 0.9 (nur deutliche Noten), Standard 0.5")
    ap.add_argument("--min-dauer", type=float, default=80,
                    help="Kuerzere Noten (ms) werden ignoriert, Standard 80")
    ap.add_argument("--kein-pdf", action="store_true", help="Kein PDF erzeugen")
    args = ap.parse_args(argv)

    opts = pipeline.Options(
        arrangement=args.satz,
        bpm=args.tempo,
        beats_per_bar=int(args.takt.split("/")[0]) if args.takt else None,
        key=args.tonart,
        division=int(args.raster) // 4,
        triplets=args.triolen,
        chord_symbols=not args.keine_akkorde,
        max_poly=args.max_stimmen,
        transcribe=TranscribeParams(
            onset_threshold=args.empfindlichkeit,
            frame_threshold=max(0.1, args.empfindlichkeit - 0.2),
            min_note_ms=args.min_dauer,
        ),
    )

    failed = 0
    for f in args.dateien:
        if not f.exists():
            print(f"✗ {f}: Datei nicht gefunden", file=sys.stderr)
            failed += 1
            continue
        print(f"♪ {f.name}")

        def progress(msg: str, frac: float) -> None:
            print(f"  [{frac * 100:5.1f} %] {msg}", flush=True)

        try:
            res = pipeline.run(f, args.ausgabe, opts, progress, pdf=not args.kein_pdf)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {f.name}: {exc}", file=sys.stderr)
            failed += 1
            continue
        print(f"  Tempo {res.bpm} BPM · {res.time_signature}-Takt · {res.key} · "
              f"{res.measures} Takte · {res.note_count} Noten")
        print(f"  → {res.musicxml}")
        print(f"  → {res.midi}")
        if res.pdf:
            print(f"  → {res.pdf}")
        elif not args.kein_pdf:
            print("  (kein PDF: MuseScore oder LilyPond nicht installiert – "
                  "MusicXML in MuseScore oeffnen und dort drucken)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
