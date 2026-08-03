"""Tragfaehigkeitsnachweis aller Hoelzer nach DIN EN 1995-1-1 (Eurocode 5).

Nachgewiesen werden Biegung, Schub, Durchbiegung, Knicken und Querdruck an
den Auflagern, dazu die Bodenpressung unter den Fundamenten. Verwendet
werden die Teilsicherheitsbeiwerte des deutschen Nationalen Anhangs.

Der Lastpfad des Bauwerks ist durchgehend als Auflagerkette ausgebildet -
jedes Bauteil liegt auf dem darunterliegenden auf, es gibt keine
biegesteif angehaengten Balken:

    Boden -> Fundamentplatte -> Schwelle -> Deckenbalken -> Bodenplatte
          -> Fussriegel -> Staender -> Raehm -> Sparren -> Traglatte -> Dachhaut

An jeder Auflagerstelle wird zusaetzlich die Querdruckspannung
(Eindrueckung des liegenden Holzes) nachgewiesen - das ist der Nachweis,
der bei Balken auf Stuetzen tatsaechlich massgebend werden kann.

Der Nachweis ist bewusst konservativ (Einfeldtraeger ohne Durchlaufwirkung,
Staender ohne Aussteifung durch die Beplankung) und dient der Dimensionierung
eines verfahrensfreien Nebengebaeudes - er ersetzt keine geprueften
Standsicherheitsnachweise fuer genehmigungspflichtige Bauten.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Baustoffkennwerte Nadelholz C24 (KVH), Nutzungsklasse 2
# ---------------------------------------------------------------------------

F_M_K = 24.0        # N/mm2 Biegefestigkeit
F_C_0_K = 21.0      # N/mm2 Druck in Faserrichtung
F_C_90_K = 2.5      # N/mm2 Druck quer zur Faser
F_V_K = 4.0         # N/mm2 Schub
E_MEAN = 11000.0    # N/mm2 mittlerer E-Modul
E_05 = 7400.0       # N/mm2 5-%-Quantil (Stabilitaetsnachweise)
RHO_K = 350.0       # kg/m3
GAMMA_M = 1.3       # Teilsicherheitsbeiwert Holz
BETA_C = 0.2        # Imperfektionsbeiwert Vollholz
K_DEF = 0.8         # Kriechbeiwert NKL 2
K_C90 = 1.25        # Auflagerbeiwert Schwelle/Rähm (durchlaufend aufliegend)

# Modifikationsbeiwerte nach Lasteinwirkungsdauer, NKL 2
KMOD = {"staendig": 0.60, "lang": 0.70, "mittel": 0.80, "kurz": 0.90}

# Handelsquerschnitte, aufsteigend tragfaehig
SECTIONS_60 = [(60, 120), (60, 140), (60, 160), (60, 180), (60, 200),
               (80, 200), (80, 220), (100, 220), (100, 240)]
SECTIONS_FLAT = [(60, 120), (60, 140), (60, 160), (80, 160), (80, 180)]

SNOW_ZONE_SK = {"1": 0.65, "1a": 0.81, "2": 0.85, "2a": 1.06, "3": 1.10}

# Nutzlasten
Q_FLOOR = 2.5       # kN/m2 Abstellflaeche mit Fahrraedern und Geraeten
G_FLOOR = 0.30      # kN/m2 Bodenplatte + Balkenlage
G_WALL = 0.35       # kN/m2 Wandflaeche (Staenderwerk, Lattung, Schalung)

# zulaessige Bodenpressung: nicht frostfrei gegruendetes Plattenlager
SIGMA_SOIL = 120.0  # kN/m2


# ---------------------------------------------------------------------------
# Lasten
# ---------------------------------------------------------------------------


def snow_load(zone: str = "2", altitude: float = 250.0) -> float:
    """Charakteristische Schneelast sk auf dem Boden in kN/m2."""
    a = max(0.0, altitude)
    base = {"1": 0.19 + 0.91 * ((a + 140) / 760) ** 2,
            "1a": 0.19 + 0.91 * ((a + 140) / 760) ** 2,
            "2": 0.25 + 1.91 * ((a + 140) / 760) ** 2,
            "2a": 0.25 + 1.91 * ((a + 140) / 760) ** 2,
            "3": 0.31 + 2.91 * ((a + 140) / 760) ** 2}.get(zone, 0.85)
    return max(base, SNOW_ZONE_SK.get(zone, 0.85))


def roof_snow(zone: str, altitude: float, pitch_deg: float) -> float:
    """Schneelast auf dem Dach, bezogen auf die Grundflaeche."""
    mu1 = 0.8 if pitch_deg <= 30 else max(0.0, 0.8 * (60 - pitch_deg) / 30)
    return mu1 * snow_load(zone, altitude)


def roof_dead_load(roofing: str) -> float:
    """Staendige Last der Dachhaut inklusive Lattung, kN/m2 Dachflaeche."""
    return {"trapez": 0.15, "shingle": 0.35, "epdm": 0.28,
            "green": 1.35}.get(roofing, 0.20)


# ---------------------------------------------------------------------------
# Ergebnis eines Nachweises
# ---------------------------------------------------------------------------


@dataclass
class Proof:
    """Ein einzelner Nachweis mit allen Zwischenwerten."""

    key: str
    title: str
    member: str                 # welches Bauteil
    kind: str                   # biegung | knicken | querdruck | boden
    profile: str = ""
    span: str = ""
    load: str = ""
    results: list[tuple[str, str, str, float]] = field(default_factory=list)
    #                  Nachweis, Wert, Grenzwert, Ausnutzung
    note: str = ""

    @property
    def util(self) -> float:
        return max([r[3] for r in self.results], default=0.0)

    @property
    def ok(self) -> bool:
        return self.util <= 1.0

    def to_dict(self) -> dict:
        return {"key": self.key, "title": self.title, "member": self.member,
                "kind": self.kind, "profile": self.profile, "span": self.span,
                "load": self.load, "note": self.note,
                "util": round(self.util, 2), "ok": self.ok,
                "results": [{"name": n, "value": v, "limit": l,
                             "util": round(u, 2)} for n, v, l, u in self.results]}


def _nz(v: float, d: int = 2) -> str:
    return f"{v:.{d}f}".replace(".", ",")


# ---------------------------------------------------------------------------
# Grundnachweise
# ---------------------------------------------------------------------------


def beam_proof(key: str, title: str, member: str, b: float, h: float,
               span_mm: float, p_k: float, p_d: float, duration: str = "kurz",
               limit_denom: int = 300, note: str = "",
               cantilever_mm: float = 0.0) -> Proof:
    """Einfeldtraeger: Biegung, Schub und Durchbiegung.

    ``p_k`` / ``p_d`` sind Streckenlasten in kN/m (charakteristisch bzw.
    im Bemessungswert). ``cantilever_mm`` beruecksichtigt einen Kragarm
    am Traegerende (Dachueberstand).
    """
    kmod = KMOD[duration]
    span = span_mm / 1000.0
    cant = cantilever_mm / 1000.0

    # Feldmoment des Einfeldtraegers und Kragmoment am Ueberstand;
    # massgebend ist der groessere der beiden Werte
    m_field = p_d * span ** 2 / 8.0
    m_cant = p_d * cant ** 2 / 2.0
    m_d = max(m_field, m_cant)

    w_res = b * h ** 2 / 6.0
    i_res = b * h ** 3 / 12.0

    sigma = m_d * 1e6 / w_res if w_res else 1e9
    f_m_d = kmod * F_M_K / GAMMA_M
    eta_m = sigma / f_m_d

    v_d = p_d * (span / 2.0 + cant) * 1000.0
    tau = 1.5 * v_d / (b * h)
    f_v_d = kmod * F_V_K / GAMMA_M
    eta_v = tau / f_v_d

    w_inst = 5 * p_k * span_mm ** 4 / (384 * E_MEAN * i_res)
    w_fin = w_inst * (1 + K_DEF * 0.4)
    lim_inst = span_mm / limit_denom
    lim_fin = span_mm / (limit_denom * 2 // 3)
    eta_w = max(w_inst / lim_inst, w_fin / lim_fin)

    return Proof(
        key=key, title=title, member=member, kind="biegung",
        profile=f"{b:.0f} x {h:.0f} mm",
        span=f"{_nz(span)} m",
        load=f"{_nz(p_d)} kN/m",
        note=note,
        results=[
            ("Biegespannung", f"{_nz(sigma)} N/mm²", f"{_nz(f_m_d)} N/mm²", eta_m),
            ("Schubspannung", f"{_nz(tau)} N/mm²", f"{_nz(f_v_d)} N/mm²", eta_v),
            ("Durchbiegung", f"{_nz(w_inst, 1)} mm", f"{_nz(lim_inst, 1)} mm (L/{limit_denom})", eta_w),
        ])


def column_proof(key: str, title: str, member: str, b: float, h: float,
                 length_mm: float, n_d: float, duration: str = "kurz",
                 note: str = "") -> Proof:
    """Knicknachweis eines Staenders. ``n_d`` = Normalkraft in kN."""
    kmod = KMOD[duration]
    area = b * h
    # massgebend ist die schwache Achse
    i_min = min(b, h) / math.sqrt(12.0)
    lam = length_mm / i_min
    lam_rel = lam / math.pi * math.sqrt(F_C_0_K / E_05)
    if lam_rel <= 0.3:
        k_c = 1.0
    else:
        k = 0.5 * (1 + BETA_C * (lam_rel - 0.3) + lam_rel ** 2)
        k_c = 1.0 / (k + math.sqrt(max(k ** 2 - lam_rel ** 2, 1e-9)))
    sigma_c = n_d * 1000.0 / area
    f_c_d = kmod * F_C_0_K / GAMMA_M
    eta = sigma_c / (k_c * f_c_d)

    return Proof(
        key=key, title=title, member=member, kind="knicken",
        profile=f"{b:.0f} x {h:.0f} mm",
        span=f"{_nz(length_mm / 1000)} m Knicklaenge",
        load=f"{_nz(n_d)} kN",
        note=note or ("Konservativ ohne aussteifende Wirkung von Konterlattung "
                      "und Beplankung gerechnet."),
        results=[
            ("Schlankheit", f"{lam:.0f}", "-", 0.0),
            ("Knickbeiwert kc", _nz(k_c), "-", 0.0),
            ("Druckspannung", f"{_nz(sigma_c)} N/mm²",
             f"{_nz(k_c * f_c_d)} N/mm²", eta),
        ])


def bearing_proof(key: str, title: str, member: str, width: float, depth: float,
                  n_d: float, duration: str = "kurz", note: str = "") -> Proof:
    """Querdruck an der Auflagerflaeche - der Nachweis 'Balken auf Stuetze'."""
    kmod = KMOD[duration]
    area = width * depth
    sigma = n_d * 1000.0 / area if area else 1e9
    f_c90_d = K_C90 * kmod * F_C_90_K / GAMMA_M
    return Proof(
        key=key, title=title, member=member, kind="querdruck",
        profile=f"Auflager {width:.0f} x {depth:.0f} mm",
        span=f"{area / 100:.0f} cm² Kontaktflaeche",
        load=f"{_nz(n_d)} kN",
        note=note,
        results=[("Querdruckspannung", f"{_nz(sigma)} N/mm²",
                  f"{_nz(f_c90_d)} N/mm²", sigma / f_c90_d)])


def soil_proof(key: str, title: str, member: str, area_mm2: float,
               n_k: float, note: str = "") -> Proof:
    """Bodenpressung unter einem Auflagerpunkt. ``n_k`` in kN."""
    area = area_mm2 / 1e6
    sigma = n_k / area if area else 1e9
    return Proof(
        key=key, title=title, member=member, kind="boden",
        profile=f"{area * 1e4:.0f} cm² Aufstandsflaeche",
        span="-", load=f"{_nz(n_k)} kN", note=note,
        results=[("Bodenpressung", f"{sigma:.0f} kN/m²",
                  f"{SIGMA_SOIL:.0f} kN/m²", sigma / SIGMA_SOIL)])


# ---------------------------------------------------------------------------
# Querschnittswahl
# ---------------------------------------------------------------------------


def select_section(sections, check) -> tuple[tuple[float, float], Proof]:
    """Kleinster Querschnitt der Liste, der den Nachweis erfuellt."""
    last = None
    for b, h in sections:
        proof = check(float(b), float(h))
        last = proof
        if proof.ok:
            return (float(b), float(h)), proof
    b, h = sections[-1]
    return (float(b), float(h)), last


def select_rafter(span_mm: float, spacing_mm: float, roofing: str,
                  pitch_deg: float, zone: str = "2", altitude: float = 250.0,
                  cantilever_mm: float = 0.0) -> tuple[tuple[float, float], Proof]:
    """Kleinster tragfaehiger Sparrenquerschnitt."""
    alpha = math.radians(pitch_deg)
    g = roof_dead_load(roofing) / max(math.cos(alpha), 0.1) + 0.10
    s = roof_snow(zone, altitude, pitch_deg)
    e = spacing_mm / 1000.0
    p_k = (g + s) * e
    p_d = (1.35 * g + 1.5 * s) * e

    def check(b, h):
        return beam_proof(
            "sparren", "Sparren", "Dachtragwerk", b, h, span_mm, p_k, p_d,
            "kurz", 300, cantilever_mm=cantilever_mm,
            note=f"Staendige Last {_nz(g)} kN/m², Schnee {_nz(s)} kN/m², "
                 f"Achsabstand {_nz(e)} m.")

    return select_section(SECTIONS_60, check)


def select_joist(span_mm: float, spacing_mm: float) -> tuple[tuple[float, float], Proof]:
    """Kleinster tragfaehiger Deckenbalken der Bodenlage."""
    e = spacing_mm / 1000.0
    p_k = (G_FLOOR + Q_FLOOR) * e
    p_d = (1.35 * G_FLOOR + 1.5 * Q_FLOOR) * e

    def check(b, h):
        return beam_proof(
            "deckenbalken", "Deckenbalken der Bodenlage", "Schwellenrost",
            b, h, span_mm, p_k, p_d, "mittel", 300,
            note=f"Nutzlast {_nz(Q_FLOOR)} kN/m² (Abstellflaeche), "
                 f"Achsabstand {_nz(e)} m. Auflager: Schwellen unter den Enden "
                 "und in der Mitte.")

    return select_section(SECTIONS_60, check)


def select_lintel_with_posts(opening_mm: float, reveal_mm: float,
                             load_width_mm: float, roofing: str,
                             pitch_deg: float, zone: str, altitude: float
                             ) -> tuple[tuple[float, float], Proof, int]:
    """Sturz fuer eine Oeffnung - notfalls mit Zwischenstuetzen.

    Sehr breite Oeffnungen (offene Front) lassen sich mit Handelsquerschnitten
    nicht mehr frei ueberspannen. Statt den Nachweis zu reissen, teilt der
    Planer die Oeffnung mit Zwischenstuetzen auf: jede Stuetze traegt den
    Sturz direkt ab, die Auflagerkette bleibt geschlossen.
    """
    for posts in range(0, 6):
        span = opening_mm / (posts + 1) + reveal_mm
        sec, proof = select_lintel(span, load_width_mm, roofing, pitch_deg,
                                   zone, altitude)
        if proof.ok:
            if posts:
                proof.note += (f" Die Oeffnung ist mit {posts} Zwischenstuetze(n) "
                               f"in {posts + 1} Felder von je "
                               f"{opening_mm / (posts + 1):.0f} mm geteilt - "
                               "frei ueberspannen laesst sie sich mit "
                               "Handelsquerschnitten nicht.")
            return sec, proof, posts
    return sec, proof, 5


def select_lintel(span_mm: float, load_width_mm: float, roofing: str,
                  pitch_deg: float, zone: str, altitude: float
                  ) -> tuple[tuple[float, float], Proof]:
    """Kleinster tragfaehiger Sturz ueber einer Wandoeffnung."""
    alpha = math.radians(pitch_deg)
    g = roof_dead_load(roofing) / max(math.cos(alpha), 0.1) + 0.15 + G_WALL * 0.5
    s = roof_snow(zone, altitude, pitch_deg)
    lw = load_width_mm / 1000.0
    p_k = (g + s) * lw
    p_d = (1.35 * g + 1.5 * s) * lw

    def check(b, h):
        return beam_proof(
            "sturz", "Sturz ueber der Oeffnung", "Staenderwerk",
            b, h, span_mm, p_k, p_d, "kurz", 300,
            note=f"Lasteinzugsbreite {_nz(lw)} m (halbe Sparrenspannweite plus "
                 "Ueberstand). Der Sturz liegt beidseitig auf den "
                 "Zargenstaendern auf.")

    def check_double(b, h):
        # zwei Hoelzer nebeneinander
        return beam_proof("sturz", "Sturz ueber der Oeffnung", "Staenderwerk",
                          2 * b, h, span_mm, p_k, p_d, "kurz", 300)

    sec, proof = select_section(SECTIONS_60, check)
    if proof.ok:
        return sec, proof
    # bei grossen Oeffnungen zwei Hoelzer nebeneinander
    for b, h in SECTIONS_60:
        p = check_double(float(b), float(h))
        if p.ok:
            p.profile = f"2 x {b:.0f} x {h:.0f} mm"
            p.note += " Zwei Hoelzer nebeneinander verschraubt."
            return (float(b), float(h)), p
    return sec, proof
