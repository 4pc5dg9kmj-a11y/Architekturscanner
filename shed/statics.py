"""Vereinfachter Tragfaehigkeitsnachweis und automatische Querschnittswahl.

Nachgewiesen werden Biegespannung und Durchbiegung der Sparren nach
DIN EN 1995-1-1 (Eurocode 5) mit den Teilsicherheitsbeiwerten des
deutschen Nationalen Anhangs. Der Nachweis ist bewusst konservativ
gehalten (Einfeldtraeger, keine Durchlaufwirkung) und dient der
Dimensionierung eines verfahrensfreien Nebengebaeudes - er ersetzt
keine Statik fuer genehmigungspflichtige Bauten.
"""

from __future__ import annotations

import math

# Baustoffkennwerte KVH C24
F_M_K = 24.0        # N/mm2 charakteristische Biegefestigkeit
E_MEAN = 11000.0    # N/mm2 mittlerer E-Modul
GAMMA_M = 1.3       # Teilsicherheitsbeiwert Holz
K_MOD_SNOW = 0.9    # kurze Lasteinwirkungsdauer, Nutzungsklasse 2
K_DEF = 0.8         # Kriechbeiwert NKL 2

# lieferbare Sparrenquerschnitte (b x h in mm), aufsteigend tragfaehig
RAFTER_SIZES = [(60, 120), (60, 140), (60, 160), (60, 180), (60, 200),
                (80, 200), (80, 220), (100, 220)]

SNOW_ZONE_SK = {"1": 0.65, "1a": 0.81, "2": 0.85, "2a": 1.06, "3": 1.10}


def snow_load(zone: str = "2", altitude: float = 250.0) -> float:
    """Charakteristische Schneelast sk auf dem Boden in kN/m2."""
    a = max(0.0, altitude)
    base = {"1": 0.19 + 0.91 * ((a + 140) / 760) ** 2,
            "1a": 0.19 + 0.91 * ((a + 140) / 760) ** 2,
            "2": 0.25 + 1.91 * ((a + 140) / 760) ** 2,
            "2a": 0.25 + 1.91 * ((a + 140) / 760) ** 2,
            "3": 0.31 + 2.91 * ((a + 140) / 760) ** 2}.get(zone, 0.85)
    return max(base, SNOW_ZONE_SK.get(zone, 0.85))


def roof_dead_load(roofing: str) -> float:
    """Staendige Last der Dachhaut inkl. Lattung in kN/m2 (Dachflaeche)."""
    return {"trapez": 0.15, "shingle": 0.35, "epdm": 0.28, "green": 1.35}.get(roofing, 0.20)


def check_rafter(b: float, h: float, span_mm: float, spacing_mm: float,
                 g_k: float, s_k: float, pitch_deg: float) -> dict:
    """Nachweis eines Sparrens. ``span_mm`` = waagerechte Stuetzweite."""
    alpha = math.radians(pitch_deg)
    span = span_mm / 1000.0
    e = spacing_mm / 1000.0

    # Lasten auf die Grundflaeche bezogen (Schnee wirkt vertikal)
    mu1 = 0.8 if pitch_deg <= 30 else 0.8 * (60 - pitch_deg) / 30
    s = mu1 * s_k
    g = g_k / max(math.cos(alpha), 0.1) + 0.10        # + Sparren-Eigengewicht
    q_k = g + s
    q_d = 1.35 * g + 1.5 * s

    p_d = q_d * e            # kN/m
    p_k = q_k * e
    m_d = p_d * span ** 2 / 8.0 * 1e6                 # Nmm
    w_res = b * h ** 2 / 6.0                          # mm3
    i_res = b * h ** 3 / 12.0                         # mm4

    sigma = m_d / w_res if w_res else 1e9
    f_m_d = K_MOD_SNOW * F_M_K / GAMMA_M
    eta_m = sigma / f_m_d

    # p_k in kN/m entspricht zahlenmaessig N/mm - keine weitere Umrechnung noetig
    l_mm = span_mm
    w_inst = 5 * p_k * l_mm ** 4 / (384 * E_MEAN * i_res)
    w_fin = w_inst * (1 + K_DEF * 0.4)
    lim_inst = l_mm / 300.0
    lim_fin = l_mm / 200.0
    eta_w = max(w_inst / lim_inst, w_fin / lim_fin)

    # Schubnachweis
    v_d = p_d * span / 2.0 * 1000.0                   # N
    tau = 1.5 * v_d / (b * h)
    f_v_d = K_MOD_SNOW * 4.0 / GAMMA_M
    eta_v = tau / f_v_d

    return {
        "b": b, "h": h, "span_m": round(span, 3), "spacing_m": round(e, 3),
        "g_k": round(g, 3), "s_k": round(s, 3), "q_d": round(q_d, 3),
        "M_d_kNm": round(m_d / 1e6, 2),
        "sigma": round(sigma, 2), "f_m_d": round(f_m_d, 2), "eta_m": round(eta_m, 2),
        "w_inst": round(w_inst, 1), "w_fin": round(w_fin, 1),
        "lim_inst": round(lim_inst, 1), "lim_fin": round(lim_fin, 1),
        "eta_w": round(eta_w, 2),
        "tau": round(tau, 2), "eta_v": round(eta_v, 2),
        "ok": eta_m <= 1.0 and eta_w <= 1.0 and eta_v <= 1.0,
        "eta_max": round(max(eta_m, eta_w, eta_v), 2),
    }


def select_rafter(span_mm: float, spacing_mm: float, roofing: str,
                  pitch_deg: float, zone: str = "2",
                  altitude: float = 250.0) -> tuple[tuple[float, float], dict]:
    """Kleinster tragfaehiger Sparrenquerschnitt aus dem Handelssortiment."""
    g_k = roof_dead_load(roofing)
    s_k = snow_load(zone, altitude)
    last: dict = {}
    for b, h in RAFTER_SIZES:
        res = check_rafter(b, h, span_mm, spacing_mm, g_k, s_k, pitch_deg)
        last = res
        if res["ok"]:
            return (float(b), float(h)), res
    return (float(RAFTER_SIZES[-1][0]), float(RAFTER_SIZES[-1][1])), last


def check_lintel(span_mm: float, load_width_mm: float, roofing: str,
                 pitch_deg: float, zone: str, altitude: float,
                 b: float = 60.0, h: float = 120.0) -> dict:
    """Nachweis des Tuersturzes (traegt die halbe Sparrenlast)."""
    g_k = roof_dead_load(roofing)
    s_k = snow_load(zone, altitude)
    return check_rafter(b, h, span_mm, load_width_mm, g_k, s_k, pitch_deg)
