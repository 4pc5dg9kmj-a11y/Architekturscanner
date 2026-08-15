"""Parameter des Linien-Reliefs.

Alle Laengen in Millimetern - das ist die Einheit, in der Slicer und Drucker
rechnen. Die Voreinstellungen sind auf eine 0,4-mm-Duese und 0,2-mm-Schichten
ausgelegt: kleinste Linienbreite 0,45 mm (= eine saubere Extrusionsbahn),
Linienhoehe ein Vielfaches von 0,2 mm.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields


@dataclass
class ReliefParams:
    """Vollstaendige Beschreibung eines Linien-Reliefs."""

    # ---- Platte -----------------------------------------------------------
    width_mm: float = 120.0
    """Breite der Grundplatte."""
    height_mm: float = 0.0
    """Hoehe der Grundplatte; 0 = aus dem Seitenverhaeltnis des Fotos."""
    plate_thickness_mm: float = 1.6
    """Dicke der Grundplatte (8 Schichten a 0,2 mm)."""
    margin_mm: float = 5.0
    """Rand ohne Linien rundherum."""
    frame: bool = True
    """Erhabener Rahmen auf dem Rand."""
    frame_height_mm: float = 1.2

    # ---- Linien -----------------------------------------------------------
    line_count: int = 60
    """Anzahl der Linien ueber die Bildbreite."""
    angle_deg: float = 0.0
    """0 = senkrechte Linien, 90 = waagerechte Linien."""
    line_width_min_mm: float = 0.40
    """Linienbreite in hellen Bereichen."""
    line_width_max_mm: float = 1.40
    """Linienbreite in dunklen Bereichen."""
    line_height_min_mm: float = 0.8
    """Linienhoehe in hellen Bereichen."""
    line_height_max_mm: float = 0.8
    """Linienhoehe in dunklen Bereichen (> min = zusaetzliches Relief)."""
    wave_amp_mm: float = 3.0
    """Maximale seitliche Auslenkung in dunklen Bereichen."""
    wave_len_mm: float = 80.0
    """Wellenlaenge der Auslenkung entlang der Linie.

    Lang (halbe Plattenhoehe und mehr) laesst die Linien weich um das Motiv
    herumlaufen - so entsteht der Eindruck der Vorlage. Kurze Wellenlaengen
    wirken als unruhige Kraeuselung.
    """
    wave_phase_deg: float = 0.0
    """Phasenversatz von Linie zu Linie (0 = alle im Gleichtakt)."""
    embed_mm: float = 0.3
    """Wie tief die Linien in die Platte eintauchen (sichere Verschmelzung)."""

    # ---- Bildaufbereitung -------------------------------------------------
    invert: bool = False
    """Hell und Dunkel tauschen (Negativ)."""
    auto_levels: bool = True
    """Tonwertumfang automatisch auf 0..1 spreizen."""
    black_point: float = 0.0
    white_point: float = 1.0
    brightness: float = 0.0
    """-1 .. +1"""
    contrast: float = 1.0
    """0,2 .. 3"""
    gamma: float = 1.0
    """< 1 betont dunkle, > 1 betont helle Bereiche."""
    blur_px: float = 1.2
    """Weichzeichnen gegen Bildrauschen (Pixel im Arbeitsbild)."""

    # ---- Qualitaet / Datenmenge ------------------------------------------
    samples_per_mm: float = 3.0
    """Stuetzpunkte je mm Linienlaenge."""
    simplify_tol_mm: float = 0.02
    """Zulaessige Abweichung beim Ausduennen der Stuetzpunkte."""

    # ---------------------------------------------------------------------
    def sanitized(self) -> "ReliefParams":
        """Grenzen erzwingen, damit nie ein kaputtes Mesh entsteht."""
        p = ReliefParams(**asdict(self))
        p.width_mm = _clamp(p.width_mm, 10.0, 1000.0)
        p.height_mm = 0.0 if p.height_mm <= 0 else _clamp(p.height_mm, 10.0, 1000.0)
        p.plate_thickness_mm = _clamp(p.plate_thickness_mm, 0.4, 20.0)
        p.margin_mm = _clamp(p.margin_mm, 0.0, min(p.width_mm, 1000.0) / 3.0)
        p.frame_height_mm = _clamp(p.frame_height_mm, 0.0, 20.0)

        p.line_count = int(_clamp(p.line_count, 4, 600))
        p.angle_deg = float(p.angle_deg) % 180.0
        p.line_width_min_mm = _clamp(p.line_width_min_mm, 0.2, 20.0)
        p.line_width_max_mm = _clamp(p.line_width_max_mm, p.line_width_min_mm, 30.0)
        p.line_height_min_mm = _clamp(p.line_height_min_mm, 0.2, 30.0)
        p.line_height_max_mm = _clamp(p.line_height_max_mm, p.line_height_min_mm, 40.0)
        p.wave_amp_mm = _clamp(p.wave_amp_mm, 0.0, 50.0)
        p.wave_len_mm = _clamp(p.wave_len_mm, 0.5, 500.0)
        p.wave_phase_deg = _clamp(p.wave_phase_deg, -180.0, 180.0)
        p.embed_mm = _clamp(p.embed_mm, 0.0, p.plate_thickness_mm * 0.9)

        p.black_point = _clamp(p.black_point, 0.0, 0.95)
        p.white_point = _clamp(p.white_point, p.black_point + 0.05, 1.0)
        p.brightness = _clamp(p.brightness, -1.0, 1.0)
        p.contrast = _clamp(p.contrast, 0.2, 3.0)
        p.gamma = _clamp(p.gamma, 0.2, 4.0)
        p.blur_px = _clamp(p.blur_px, 0.0, 30.0)

        p.samples_per_mm = _clamp(p.samples_per_mm, 0.5, 12.0)
        p.simplify_tol_mm = _clamp(p.simplify_tol_mm, 0.0, 0.5)
        return p

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "ReliefParams":
        """Unbekannte Schluessel ignorieren, fehlende mit Vorgaben fuellen."""
        data = data or {}
        defaults = cls()
        kwargs = {}
        for f in fields(cls):
            if f.name not in data or data[f.name] is None:
                continue
            value = data[f.name]
            default = getattr(defaults, f.name)
            try:
                if isinstance(default, bool):
                    kwargs[f.name] = (
                        value.strip().lower() in ("1", "true", "on", "yes", "ja")
                        if isinstance(value, str) else bool(value)
                    )
                elif isinstance(default, int):
                    kwargs[f.name] = int(round(float(value)))
                else:
                    kwargs[f.name] = float(value)
            except (TypeError, ValueError):
                continue
        return cls(**kwargs)


def _clamp(value: float, lo: float, hi: float) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = lo
    if value != value:  # NaN
        value = lo
    return max(lo, min(hi, value))


# Fertige Ausgangspunkte fuer typische Motive; die UI setzt damit nur die
# Linien-Parameter, Plattengroesse und Bildregler bleiben unangetastet.
PRESETS: dict[str, dict] = {
    "welle": {
        "label": "Welle (wie das Vorbild)",
        "hint": "Lange Wellen, die um das Motiv herumlaufen und sich in dunklen Zonen draengen.",
        "values": {
            "line_count": 60, "wave_amp_mm": 3.0, "wave_len_mm": 80.0,
            "wave_phase_deg": 0.0,
            "line_width_min_mm": 0.4, "line_width_max_mm": 1.4,
            "line_height_min_mm": 0.8, "line_height_max_mm": 0.8,
        },
    },
    "strichstaerke": {
        "label": "Strichstärke",
        "hint": "Gerade Linien, nur die Breite traegt das Bild. Sehr klar.",
        "values": {
            "line_count": 70, "wave_amp_mm": 0.0, "wave_len_mm": 80.0,
            "line_width_min_mm": 0.4, "line_width_max_mm": 1.25,
            "line_height_min_mm": 0.8, "line_height_max_mm": 0.8,
        },
    },
    "relief": {
        "label": "Relief (Höhe)",
        "hint": "Gerade Linien unterschiedlicher Hoehe - wirkt im Streiflicht.",
        "values": {
            "line_count": 80, "wave_amp_mm": 0.0,
            "line_width_min_mm": 0.9, "line_width_max_mm": 0.9,
            "line_height_min_mm": 0.4, "line_height_max_mm": 3.0,
        },
    },
    "kombi": {
        "label": "Kombiniert",
        "hint": "Welle + Strichstaerke + Hoehe. Plastischster Eindruck.",
        "values": {
            "line_count": 60, "wave_amp_mm": 3.0, "wave_len_mm": 80.0,
            "line_width_min_mm": 0.4, "line_width_max_mm": 1.4,
            "line_height_min_mm": 0.6, "line_height_max_mm": 2.2,
        },
    },
    "fein": {
        "label": "Fein & dicht",
        "hint": "Viele duenne Linien - feine Zeichnung, laengere Druckzeit.",
        "values": {
            "line_count": 110, "wave_amp_mm": 2.0, "wave_len_mm": 60.0,
            "line_width_min_mm": 0.4, "line_width_max_mm": 0.8,
            "line_height_min_mm": 0.6, "line_height_max_mm": 0.6,
        },
    },
}
