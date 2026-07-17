"""Berechnungskern des Heizungsrechners.

Vereinfachtes Huellflaechenverfahren (angelehnt an DIN EN 12831 /
Gradtagzahl-Methode) zur Abschaetzung von Heizlast und Jahres-Heizwaermebedarf,
darauf aufbauend ein Vollkostenvergleich verschiedener Waermeerzeuger und
Uebergabesysteme (Heizkoerper, Fussbodenheizung, ...) sowie die Bewertung von
Sanierungsmassnahmen inklusive Amortisationszeiten.

Alle Werte sind Richtwerte fuer Deutschland (Stand 2026) und ersetzen keine
Energieberatung nach GEG.
"""

from __future__ import annotations

import math
from copy import deepcopy
from typing import Any

# ---------------------------------------------------------------------------
# Klima- und Rechenkonstanten (Deutschland, Mittelwerte)
# ---------------------------------------------------------------------------

GRADTAGZAHL = 3500.0          # K*d/a  (Heizgradtage 20/15, Mittelwert D)
NORM_AUSSENTEMP = -12.0       # Grad C  Norm-Aussentemperatur
RAUMTEMP = 20.0               # Grad C
NUTZUNGSGRAD_GEWINNE = 0.90   # solare + interne Gewinne pauschal
WAERMEBRUECKEN_ZUSCHLAG = 0.10  # +10 % auf Transmissionsverluste
BETRACHTUNG_JAHRE = 20        # Betrachtungszeitraum Wirtschaftlichkeit
WW_BEDARF_PRO_PERSON = 500.0  # kWh/a Warmwasser je Person

# ---------------------------------------------------------------------------
# U-Werte (W/m2K) je Bauteil und Daemmzustand
# ---------------------------------------------------------------------------

U_WAND_BASIS = {  # unsanierter Grundwert je Wandaufbau
    "massiv": 1.4,        # Vollziegel/Mauerwerk unsaniert
    "zweischalig": 1.0,   # zweischalig mit Luftschicht
    "beton": 2.1,
    "fachwerk": 1.8,
    "holz": 0.5,          # Holzstaender/Holzbau
}

U_WAND_GEDAEMMT = {"keine": None, "maessig": 0.60, "gut": 0.28, "sehr_gut": 0.18}
U_DACH = {"keine": 1.40, "maessig": 0.50, "gut": 0.24, "sehr_gut": 0.14}
U_BODEN = {"keine": 1.20, "maessig": 0.50, "gut": 0.30, "sehr_gut": 0.22}
U_FENSTER = {
    "einfach": 5.0,
    "zweifach_alt": 2.8,   # Isolierglas bis ca. 1995
    "zweifach_neu": 1.3,   # Waermeschutzglas
    "dreifach": 0.9,
}

# Dachflaechenfaktor (Dachflaeche = Grundflaeche * Faktor) und Anteil
# beheizter Dachschraege
DACHFORM = {
    "flachdach": {"faktor": 1.02, "label": "Flachdach"},
    "pultdach": {"faktor": 1.08, "label": "Pultdach"},
    "satteldach": {"faktor": 1.22, "label": "Satteldach"},
    "walmdach": {"faktor": 1.28, "label": "Walmdach"},
    "mansarddach": {"faktor": 1.35, "label": "Mansarddach"},
    "zeltdach": {"faktor": 1.26, "label": "Zeltdach"},
}

# Temperatur-Korrekturfaktor Bauteile gegen Erdreich/unbeheizte Zonen
F_BODEN = {"bodenplatte": 0.60, "unbeheizt": 0.55, "beheizt": 0.15}

FENSTERANTEIL = 0.16  # Fensterflaeche ~16 % der Wohnflaeche (Richtwert)

# Baukosten-Richtwerte (EUR/m2, Stand 2026, inkl. Montage) – per Eingabe
# ueberschreibbar ("preise.baukosten")
BAUKOSTEN = {
    "fbh_m2": 95.0,          # Fussbodenheizung nachruesten (Frästechnik)
    "dach_m2": 190.0,        # Dachdaemmung
    "fassade_m2": 180.0,     # WDVS Fassade
    "fenster_m2": 750.0,     # Fenstertausch 3-fach
    "kellerdecke_m2": 80.0,  # Kellerdeckendaemmung
}


def _baukosten(preise: dict | None) -> dict:
    bk = dict(BAUKOSTEN)
    for k, v in ((preise or {}).get("baukosten") or {}).items():
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        if k in bk and v > 0:
            bk[k] = v
    return bk

# ---------------------------------------------------------------------------
# Uebergabesysteme (Heizart je Raum) -> benoetigte Vorlauftemperatur
# ---------------------------------------------------------------------------

HEIZARTEN = {
    "fussbodenheizung": {"label": "Fußbodenheizung", "vl_offset": 0.0, "flaechenheizung": True},
    "wandheizung": {"label": "Wandheizung", "vl_offset": 2.0, "flaechenheizung": True},
    "deckenheizung": {"label": "Deckenheizung", "vl_offset": 3.0, "flaechenheizung": True},
    "heizkoerper": {"label": "Heizkörper", "vl_offset": None, "flaechenheizung": False},
    "konvektor": {"label": "Konvektor", "vl_offset": None, "flaechenheizung": False},
    "keine": {"label": "Unbeheizt", "vl_offset": None, "flaechenheizung": False},
}

# ---------------------------------------------------------------------------
# Waermeerzeuger: Neuanlagen (Stand 2026, Richtwerte inkl. Montage)
# ---------------------------------------------------------------------------

SYSTEME = {
    "waermepumpe_luft": {
        "label": "Luft-Wasser-Wärmepumpe",
        "energie": "Strom (WP-Tarif)",
        "preis": 0.26,            # EUR/kWh
        "preissteigerung": 0.02,  # pro Jahr
        "co2": 0.320,             # kg CO2/kWh Endenergie (Strommix, sinkend)
        "co2_trend": -0.04,       # relative Aenderung pro Jahr
        "invest": 30000.0,
        "wartung": 200.0,
        "lebensdauer": 18,
        "typ": "waermepumpe",
        "quelle_temp": 0.0,       # effektive Quellentemperatur
        "guetegrad": 0.45,        # Anteil am Carnot-Wirkungsgrad
        "foerderfaehig": True,
    },
    "waermepumpe_sole": {
        "label": "Sole-Wasser-Wärmepumpe (Erdwärme)",
        "energie": "Strom (WP-Tarif)",
        "preis": 0.26,
        "preissteigerung": 0.02,
        "co2": 0.320,
        "co2_trend": -0.04,
        "invest": 42000.0,
        "wartung": 200.0,
        "lebensdauer": 20,
        "typ": "waermepumpe",
        "quelle_temp": 5.0,
        "guetegrad": 0.48,
        "foerderfaehig": True,
        "effizienzbonus": True,   # +5 % BEG-Effizienzbonus (Erdwaerme)
    },
    "gas_brennwert": {
        "label": "Gas-Brennwertkessel",
        "energie": "Erdgas",
        "preis": 0.115,           # inkl. CO2-Preis 2026
        "preissteigerung": 0.045,  # inkl. steigendem CO2-Preis
        "co2": 0.201,
        "co2_trend": 0.0,
        "invest": 11500.0,
        "wartung": 280.0,
        "lebensdauer": 20,
        "typ": "kessel",
        "eta_flaeche": 0.97,      # Brennwertnutzen bei Flaechenheizung
        "eta_hk": 0.93,
        "foerderfaehig": False,
    },
    "oel_brennwert": {
        "label": "Öl-Brennwertkessel",
        "energie": "Heizöl",
        "preis": 0.113,
        "preissteigerung": 0.05,
        "co2": 0.266,
        "co2_trend": 0.0,
        "invest": 14000.0,
        "wartung": 320.0,
        "lebensdauer": 20,
        "typ": "kessel",
        "eta_flaeche": 0.95,
        "eta_hk": 0.91,
        "foerderfaehig": False,
    },
    "pellets": {
        "label": "Pelletheizung",
        "energie": "Holzpellets",
        "preis": 0.080,
        "preissteigerung": 0.03,
        "co2": 0.027,
        "co2_trend": 0.0,
        "invest": 27000.0,
        "wartung": 400.0,
        "lebensdauer": 20,
        "typ": "kessel",
        "eta_flaeche": 0.90,
        "eta_hk": 0.88,
        "foerderfaehig": True,
    },
    "fernwaerme": {
        "label": "Fernwärme",
        "energie": "Fernwärme",
        "preis": 0.150,
        "preissteigerung": 0.035,
        "co2": 0.160,
        "co2_trend": -0.02,
        "invest": 9500.0,
        "wartung": 120.0,
        "lebensdauer": 30,
        "typ": "uebergabe",
        "eta_flaeche": 0.98,
        "eta_hk": 0.98,
        "foerderfaehig": False,
    },
    "strom_direkt": {
        "label": "Strom-Direktheizung",
        "energie": "Strom (Haushalt)",
        "preis": 0.32,
        "preissteigerung": 0.02,
        "co2": 0.320,
        "co2_trend": -0.04,
        "invest": 5000.0,
        "wartung": 50.0,
        "lebensdauer": 25,
        "typ": "direkt",
        "eta_flaeche": 1.0,
        "eta_hk": 1.0,
        "foerderfaehig": False,
    },
}

# Bestandsanlagen: Energietraeger-Zuordnung + Wirkungsgrad nach Baujahr
BESTAND_ARTEN = {
    "gas": {"label": "Gasheizung", "system": "gas_brennwert"},
    "oel": {"label": "Ölheizung", "system": "oel_brennwert"},
    "waermepumpe_luft": {"label": "Luft-Wärmepumpe", "system": "waermepumpe_luft"},
    "waermepumpe_sole": {"label": "Sole-Wärmepumpe", "system": "waermepumpe_sole"},
    "pellets": {"label": "Pellet-/Holzheizung", "system": "pellets"},
    "fernwaerme": {"label": "Fernwärme", "system": "fernwaerme"},
    "nachtspeicher": {"label": "Nachtspeicher/Strom", "system": "strom_direkt"},
}


def _kessel_eta_bestand(baujahr: int) -> float:
    """Anlagenwirkungsgrad alter Gas-/Oelkessel nach Baujahr."""
    if baujahr < 1987:
        return 0.68
    if baujahr < 1998:
        return 0.78
    if baujahr < 2010:
        return 0.85
    return 0.93


def _wp_altersfaktor(baujahr: int) -> float:
    """Effizienzabschlag aelterer Waermepumpen gegenueber Neugeraeten."""
    if baujahr < 2010:
        return 0.70
    if baujahr < 2018:
        return 0.82
    return 0.95


# ---------------------------------------------------------------------------
# Gebaeudemodell
# ---------------------------------------------------------------------------

def _norm(value: Any, mapping: dict, default: str) -> str:
    key = str(value or "").strip().lower()
    return key if key in mapping else default


def gebaeude_analyse(inp: dict) -> dict:
    """Huellflaechen, Waermeverluste, Heizlast und Heizwaermebedarf."""
    g = inp.get("gebaeude", {})
    wohnflaeche = max(20.0, float(g.get("wohnflaeche", 140)))
    etagen = max(1, int(g.get("etagen", 2)))
    raumhoehe = min(4.0, max(2.0, float(g.get("raumhoehe", 2.6))))
    personen = max(1, int(g.get("personen", 3)))
    baujahr = int(g.get("baujahr", 1980))

    dachform = _norm(g.get("dachform"), DACHFORM, "satteldach")
    dach_d = _norm(g.get("dach_daemmung"), U_DACH, "keine")
    wand_aufbau = _norm(g.get("wand_aufbau"), U_WAND_BASIS, "massiv")
    wand_d = _norm(g.get("wand_daemmung"), U_WAND_GEDAEMMT, "keine")
    fenster = _norm(g.get("fenster"), U_FENSTER, "zweifach_alt")
    keller = _norm(g.get("keller"), F_BODEN, "unbeheizt")
    keller_d = _norm(g.get("keller_daemmung"), U_BODEN, "keine")

    # --- Geometrie (quadratischer Grundriss als Naeherung) ---
    grundflaeche = wohnflaeche / etagen
    seite = math.sqrt(grundflaeche)
    umfang = 4.0 * seite
    geschosshoehe = raumhoehe + 0.35  # inkl. Deckenaufbau
    fassadenflaeche = umfang * geschosshoehe * etagen
    fensterflaeche = wohnflaeche * FENSTERANTEIL
    wandflaeche = max(0.0, fassadenflaeche - fensterflaeche)
    dachflaeche = grundflaeche * DACHFORM[dachform]["faktor"]
    bodenflaeche = grundflaeche
    volumen = wohnflaeche * raumhoehe
    bruttovolumen = grundflaeche * geschosshoehe * etagen

    # --- U-Werte ---
    if wand_d == "keine":
        u_wand = U_WAND_BASIS[wand_aufbau]
        # Neubauten sind auch "ungedaemmt" besser
        if baujahr >= 2002:
            u_wand = min(u_wand, 0.35)
        elif baujahr >= 1984:
            u_wand = min(u_wand, 0.80)
    else:
        u_wand = U_WAND_GEDAEMMT[wand_d]
    u_dach = U_DACH[dach_d]
    if dach_d == "keine" and baujahr >= 1995:
        u_dach = min(u_dach, 0.40)
    u_boden = U_BODEN[keller_d]
    u_fenster = U_FENSTER[fenster]
    f_boden = F_BODEN[keller]

    # --- Transmissionsverluste H_T (W/K) ---
    ht_teile = {
        "Außenwände": u_wand * wandflaeche,
        "Dach": u_dach * dachflaeche,
        "Fenster": u_fenster * fensterflaeche,
        "Boden/Keller": u_boden * bodenflaeche * f_boden,
    }
    h_t = sum(ht_teile.values()) * (1.0 + WAERMEBRUECKEN_ZUSCHLAG)

    # --- Lueftungsverluste H_V (W/K) ---
    luftwechsel = 0.70 if fenster in ("einfach", "zweifach_alt") else 0.50
    h_v = 0.34 * luftwechsel * volumen

    h_ges = h_t + h_v
    heizlast_kw = h_ges * (RAUMTEMP - NORM_AUSSENTEMP) / 1000.0

    # --- Jahres-Heizwaermebedarf (Gradtagzahl) ---
    q_heiz = h_ges * GRADTAGZAHL * 24.0 / 1000.0 * NUTZUNGSGRAD_GEWINNE  # kWh/a
    q_ww = personen * WW_BEDARF_PRO_PERSON
    q_nutz = q_heiz + q_ww

    verluste = dict(ht_teile)
    verluste["Lüftung"] = h_v
    v_sum = sum(verluste.values())
    verlust_anteile = [
        {"bauteil": k, "watt_pro_k": round(v, 1), "anteil": round(v / v_sum, 4)}
        for k, v in sorted(verluste.items(), key=lambda kv: -kv[1])
    ]

    return {
        "wohnflaeche": wohnflaeche,
        "etagen": etagen,
        "personen": personen,
        "baujahr": baujahr,
        "grundflaeche": round(grundflaeche, 1),
        "wandflaeche": round(wandflaeche, 1),
        "dachflaeche": round(dachflaeche, 1),
        "fensterflaeche": round(fensterflaeche, 1),
        "bodenflaeche": round(bodenflaeche, 1),
        "huellflaeche": round(wandflaeche + dachflaeche + fensterflaeche + bodenflaeche, 1),
        "volumen": round(volumen, 1),
        "bruttovolumen": round(bruttovolumen, 1),
        "dachform": DACHFORM[dachform]["label"],
        "u_werte": {
            "wand": round(u_wand, 2), "dach": round(u_dach, 2),
            "fenster": round(u_fenster, 2), "boden": round(u_boden, 2),
        },
        "h_t": round(h_t, 1),
        "h_v": round(h_v, 1),
        "heizlast_kw": round(heizlast_kw, 1),
        "heizwaermebedarf": round(q_heiz),
        "warmwasserbedarf": round(q_ww),
        "nutzenergie": round(q_nutz),
        "spezifisch": round(q_heiz / wohnflaeche, 1),  # kWh/m2a
        "verlust_anteile": verlust_anteile,
    }


# ---------------------------------------------------------------------------
# Uebergabesystem -> Vorlauftemperatur & Waermepumpen-JAZ
# ---------------------------------------------------------------------------

def raeume_normalisieren(inp: dict, geb: dict) -> list[dict]:
    raeume = []
    for r in inp.get("raeume", []) or []:
        art = _norm(r.get("heizart"), HEIZARTEN, "heizkoerper")
        try:
            fl = float(r.get("flaeche", 0) or 0)
        except (TypeError, ValueError):
            fl = 0.0
        if fl <= 0:
            continue
        raeume.append({"name": str(r.get("name") or "Raum"), "flaeche": fl, "heizart": art})
    if not raeume:
        raeume = [{"name": "Gesamtes Haus", "flaeche": geb["wohnflaeche"], "heizart": "heizkoerper"}]
    return raeume


def vorlauftemperatur(geb: dict, raeume: list[dict]) -> dict:
    """Mittlere noetige Vorlauftemperatur aus Raum-Heizarten und spezifischem Bedarf."""
    spez = geb["spezifisch"]
    # Heizkoerper: je schlechter das Haus, desto hoeher der noetige Vorlauf
    vl_hk = min(70.0, max(45.0, 38.0 + 0.16 * spez))
    vl_flaeche = 35.0 if spez < 130 else 38.0

    gewichtet = 0.0
    flaeche_sum = 0.0
    anteil_flaechenheizung = 0.0
    for r in raeume:
        art = HEIZARTEN[r["heizart"]]
        if r["heizart"] == "keine":
            continue
        vl = (vl_flaeche + art["vl_offset"]) if art["flaechenheizung"] else (
            vl_hk + (4.0 if r["heizart"] == "konvektor" else 0.0))
        gewichtet += vl * r["flaeche"]
        flaeche_sum += r["flaeche"]
        if art["flaechenheizung"]:
            anteil_flaechenheizung += r["flaeche"]
    vl_mittel = gewichtet / flaeche_sum if flaeche_sum else vl_hk
    return {
        "vl_mittel": round(vl_mittel, 1),
        "vl_heizkoerper": round(vl_hk, 1),
        "vl_flaechenheizung": round(vl_flaeche, 1),
        "anteil_flaechenheizung": round(anteil_flaechenheizung / flaeche_sum, 3) if flaeche_sum else 0.0,
    }


def wp_jaz(system: dict, vl: float) -> float:
    """Jahresarbeitszahl einer Waermepumpe (Carnot-Ansatz mit Guetegrad)."""
    t_q = system["quelle_temp"]
    dt = max(12.0, vl - t_q)
    jaz = system["guetegrad"] * (vl + 273.15) / dt
    return max(1.8, min(5.5, jaz))


def system_effizienz(key: str, system: dict, vl_info: dict) -> tuple[float, str]:
    """Anlagen-'Wirkungsgrad' (Nutzenergie/Endenergie) fuer Neuanlagen."""
    if system["typ"] == "waermepumpe":
        jaz = wp_jaz(system, vl_info["vl_mittel"])
        return jaz, f"JAZ {jaz:.1f}"
    anteil_f = vl_info["anteil_flaechenheizung"]
    eta = system["eta_flaeche"] * anteil_f + system["eta_hk"] * (1.0 - anteil_f)
    return eta, f"η {eta * 100:.0f} %"


# ---------------------------------------------------------------------------
# Foerderung (BEG, vereinfacht)
# ---------------------------------------------------------------------------

def foerderung_berechnen(key: str, system: dict, optionen: dict,
                         invest: float) -> tuple[float, float]:
    """Foerdersatz und Foerderbetrag (BEG EM, max. 70 %, foerderfaehig 30.000 EUR)."""
    if not system.get("foerderfaehig"):
        return 0.0, 0.0
    satz = 0.30
    if optionen.get("klimabonus", True):     # Austausch funktionstuechtiger fossiler Heizung
        satz += 0.20
    if optionen.get("einkommensbonus", False):  # zu verst. Einkommen < 40.000 EUR
        satz += 0.30
    if system.get("effizienzbonus"):
        satz += 0.05
    satz = min(0.70, satz)
    betrag = min(invest, 30000.0) * satz
    return satz, round(betrag)


# ---------------------------------------------------------------------------
# Investitions-/Baukosten je System (aufgeschluesselt)
# ---------------------------------------------------------------------------

# Zuordnung System -> Energiepreis-Schluessel in "preise.energie" (EUR/kWh)
ENERGIE_PREIS_KEY = {
    "waermepumpe_luft": "strom_wp", "waermepumpe_sole": "strom_wp",
    "gas_brennwert": "gas", "oel_brennwert": "oel", "pellets": "pellets",
    "fernwaerme": "fernwaerme", "strom_direkt": "strom",
}


def _energie_preis(preise: dict | None, system_key: str, standard: float) -> float:
    e = (preise or {}).get("energie") or {}
    try:
        v = float(e.get(ENERGIE_PREIS_KEY.get(system_key, ""), 0) or 0)
    except (TypeError, ValueError):
        return standard
    return v if v > 0 else standard


def invest_aufschluesselung(key: str, heizlast_kw: float, bestand_art: str,
                            invest_override: float | None = None) -> dict[str, float]:
    """Baukosten-Aufschluesselung einer Neuanlage (Richtwerte inkl. Montage).

    Groessenabhaengig ueber die Heizlast; enthaelt Umfeldkosten wie Demontage,
    Speicher, Bohrung, Hausanschluss oder Oeltank-Entsorgung.
    """
    kw = max(6.0, heizlast_kw)
    k: dict[str, float] = {}
    if key == "waermepumpe_luft":
        k["Wärmepumpe (Gerät)"] = 12000 + 450 * kw
        k["Installation & Hydraulik"] = 6000
        k["Puffer-/Warmwasserspeicher"] = 3500
        k["Elektroinstallation & Zähler"] = 2500
    elif key == "waermepumpe_sole":
        k["Wärmepumpe (Gerät)"] = 11000 + 450 * kw
        k["Erdsonden-Bohrung"] = max(9000.0, 950 * kw)
        k["Installation & Hydraulik"] = 6000
        k["Puffer-/Warmwasserspeicher"] = 3500
        k["Elektroinstallation & Zähler"] = 2500
    elif key == "gas_brennwert":
        k["Brennwertkessel"] = 5500 + 150 * kw
        k["Installation"] = 2500
        k["Abgas-/Schornsteinsanierung"] = 1500
        k["Warmwasserspeicher"] = 1200
        if bestand_art != "gas":
            k["Gas-Hausanschluss"] = 2500
    elif key == "oel_brennwert":
        k["Brennwertkessel"] = 7000 + 150 * kw
        k["Installation"] = 2500
        k["Abgas-/Schornsteinsanierung"] = 1500
        k["Warmwasserspeicher"] = 1200
        if bestand_art != "oel":
            k["Tankanlage"] = 3000
    elif key == "pellets":
        k["Pelletkessel"] = 14000 + 250 * kw
        k["Pelletlager & Austragung"] = 4500
        k["Installation"] = 3000
        k["Pufferspeicher"] = 2000
        k["Schornsteinsanierung"] = 1500
    elif key == "fernwaerme":
        k["Übergabestation"] = 4500
        if bestand_art != "fernwaerme":
            k["Hausanschluss Fernwärme"] = 5000
        k["Installation"] = 2000
    elif key == "strom_direkt":
        k["Heizgeräte"] = 3500
        k["Elektroinstallation"] = 1500
    k["Demontage Altanlage"] = 1200
    if bestand_art == "oel" and key != "oel_brennwert":
        k["Öltank-Stilllegung/-Entsorgung"] = 1300
    if invest_override and invest_override > 0:
        faktor = invest_override / sum(k.values())
        k = {name: wert * faktor for name, wert in k.items()}
    return {name: round(wert) for name, wert in k.items()}


# ---------------------------------------------------------------------------
# Wirtschaftlichkeit
# ---------------------------------------------------------------------------

def _kostenverlauf(invest: float, verbrauch_kwh: float, preis: float,
                   steigerung: float, wartung: float, jahre: int = BETRACHTUNG_JAHRE) -> list[float]:
    """Kumulierte Kosten [Jahr 0..n]; Jahr 0 = Investition."""
    verlauf = [invest]
    kum = invest
    p = preis
    for _ in range(jahre):
        kum += verbrauch_kwh * p + wartung
        verlauf.append(round(kum))
        p *= (1.0 + steigerung)
    return verlauf


def _co2_gesamt(verbrauch_kwh: float, co2: float, trend: float,
                jahre: int = BETRACHTUNG_JAHRE) -> float:
    summe = 0.0
    f = co2
    for _ in range(jahre):
        summe += verbrauch_kwh * f
        f *= (1.0 + trend)
    return summe / 1000.0  # Tonnen


def bestand_bewerten(inp: dict, geb: dict, vl_info: dict,
                     preise: dict | None = None) -> dict:
    b = inp.get("heizung_bestand", {})
    art = _norm(b.get("art"), BESTAND_ARTEN, "gas")
    baujahr = int(b.get("baujahr", 1995))
    ref_key = BESTAND_ARTEN[art]["system"]
    ref = SYSTEME[ref_key]
    preis = _energie_preis(preise, ref_key, ref["preis"])

    if ref["typ"] == "waermepumpe":
        eff = wp_jaz(ref, vl_info["vl_mittel"]) * _wp_altersfaktor(baujahr)
        eff_text = f"JAZ {eff:.1f}"
    elif art == "nachtspeicher":
        eff, eff_text = 0.95, "η 95 %"
        preis = _energie_preis(preise, "strom_direkt", 0.30)
    elif art == "fernwaerme":
        eff, eff_text = 0.95, "η 95 %"
    elif art == "pellets":
        eff = 0.78 if baujahr < 2005 else 0.85
        eff_text = f"η {eff * 100:.0f} %"
    else:  # gas / oel
        eff = _kessel_eta_bestand(baujahr)
        eff_text = f"η {eff * 100:.0f} %"

    verbrauch = geb["nutzenergie"] / eff
    wartung = ref["wartung"] * 1.2  # aeltere Anlagen: mehr Wartung/Schornsteinfeger
    kosten_jahr = verbrauch * preis + wartung
    alter = max(0, 2026 - baujahr)

    return {
        "art": art,
        "label": BESTAND_ARTEN[art]["label"],
        "baujahr": baujahr,
        "alter": alter,
        "effizienz": round(eff, 2),
        "effizienz_text": eff_text,
        "energie": ref["energie"],
        "preis": preis,
        "preissteigerung": ref["preissteigerung"],
        "verbrauch_kwh": round(verbrauch),
        "wartung": round(wartung),
        "kosten_jahr": round(kosten_jahr),
        "co2_jahr": round(verbrauch * ref["co2"] / 1000.0, 1),
        "co2": ref["co2"],
        "co2_trend": ref["co2_trend"],
        "kostenverlauf": _kostenverlauf(0.0, verbrauch, preis, ref["preissteigerung"], wartung),
    }


def _amortisation_gegen_bestand(verlauf: list[float], bestand: dict) -> int | None:
    for jahr, (neu, alt) in enumerate(zip(verlauf, bestand["kostenverlauf"])):
        if neu <= alt:
            return jahr
    return None


def systeme_vergleichen(geb: dict, vl_info: dict, bestand: dict, optionen: dict,
                        preise: dict | None = None) -> list[dict]:
    """Alle Neuanlagen mit dem Ist-Uebergabesystem durchrechnen."""
    ergebnisse = []
    q = geb["nutzenergie"]
    invest_over = (preise or {}).get("invest") or {}
    for key, sys0 in SYSTEME.items():
        system = deepcopy(sys0)
        system["preis"] = _energie_preis(preise, key, system["preis"])
        eff, eff_text = system_effizienz(key, system, vl_info)
        verbrauch = q / eff

        try:
            override = float(invest_over.get(key, 0) or 0)
        except (TypeError, ValueError):
            override = 0.0
        komponenten = invest_aufschluesselung(
            key, geb["heizlast_kw"], bestand["art"],
            invest_override=override if override > 0 else None)
        invest = sum(komponenten.values())

        satz, foerderung = foerderung_berechnen(key, system, optionen, invest)
        invest_netto = invest - foerderung
        kosten_jahr = verbrauch * system["preis"] + system["wartung"]
        vollkosten_jahr = kosten_jahr + invest_netto / system["lebensdauer"]
        verlauf = _kostenverlauf(invest_netto, verbrauch, system["preis"],
                                 system["preissteigerung"], system["wartung"])

        ergebnisse.append({
            "key": key,
            "label": system["label"],
            "energie": system["energie"],
            "effizienz": round(eff, 2),
            "effizienz_text": eff_text,
            "verbrauch_kwh": round(verbrauch),
            "invest": round(invest),
            "invest_komponenten": komponenten,
            "foerdersatz": satz,
            "foerderung": round(foerderung),
            "invest_netto": round(invest_netto),
            "wartung": system["wartung"],
            "energiekosten_jahr": round(verbrauch * system["preis"]),
            "kosten_jahr": round(kosten_jahr),
            "vollkosten_jahr": round(vollkosten_jahr),
            "kostenverlauf": verlauf,
            "gesamt_20a": verlauf[-1],
            "co2_jahr": round(verbrauch * system["co2"] / 1000.0, 1),
            "co2_20a": round(_co2_gesamt(verbrauch, system["co2"], system["co2_trend"]), 1),
            "amortisation": _amortisation_gegen_bestand(verlauf, bestand),
        })
    ergebnisse.sort(key=lambda e: e["gesamt_20a"])
    return ergebnisse


# ---------------------------------------------------------------------------
# Heizart-Vergleich (Uebergabesystem)
# ---------------------------------------------------------------------------

def heizarten_vergleichen(inp: dict, geb: dict, bestand: dict, optionen: dict,
                          preise: dict | None) -> list[dict]:
    """Ist-Zustand vs. komplett Heizkoerper vs. komplett Flaechenheizung."""
    raeume = raeume_normalisieren(inp, geb)
    szenarien = [
        ("ist", "Ist-Zustand (eingegebene Räume)", raeume),
        ("heizkoerper", "Alles Heizkörper", [dict(r, heizart="heizkoerper") for r in raeume if r["heizart"] != "keine"]),
        ("flaechenheizung", "Alles Fußbodenheizung", [dict(r, heizart="fussbodenheizung") for r in raeume if r["heizart"] != "keine"]),
    ]
    out = []
    for key, label, rr in szenarien:
        vl = vorlauftemperatur(geb, rr)
        systeme = systeme_vergleichen(geb, vl, bestand, optionen, preise)
        bestes = systeme[0]
        wp = next(s for s in systeme if s["key"] == "waermepumpe_luft")
        out.append({
            "key": key,
            "label": label,
            "vl_mittel": vl["vl_mittel"],
            "bestes_system": bestes["label"],
            "bestes_gesamt_20a": bestes["gesamt_20a"],
            "wp_jaz": wp["effizienz"],
            "wp_kosten_jahr": wp["kosten_jahr"],
            "wp_gesamt_20a": wp["gesamt_20a"],
        })
    return out


# ---------------------------------------------------------------------------
# Sanierungsmassnahmen
# ---------------------------------------------------------------------------

FOERDERSATZ_DAEMMUNG = 0.15  # BEG EM Einzelmassnahme Gebaeudehuelle


def massnahmen_bewerten(inp: dict, geb: dict, bestand: dict,
                        preise: dict | None = None) -> list[dict]:
    """Einzelmassnahmen: Kosten, Energie-/Kostenersparnis, Amortisation."""
    g = inp.get("gebaeude", {})
    bk = _baukosten(preise)
    kandidaten = []

    def variante(name: str, aenderung: dict, kosten: float, foerderbar: bool = True,
                 hinweis: str = "") -> None:
        neu = deepcopy(inp)
        neu.setdefault("gebaeude", {}).update(aenderung)
        geb_neu = gebaeude_analyse(neu)
        ersparnis_kwh = max(0.0, geb["nutzenergie"] - geb_neu["nutzenergie"])
        if ersparnis_kwh < 200:
            return
        # Ersparnis bewertet mit der Bestandsanlage
        ersparnis_euro = ersparnis_kwh / bestand["effizienz"] * bestand["preis"]
        foerderung = kosten * FOERDERSATZ_DAEMMUNG if foerderbar else 0.0
        netto = kosten - foerderung
        kandidaten.append({
            "name": name,
            "aenderung": aenderung,
            "kosten": round(kosten),
            "foerderung": round(foerderung),
            "kosten_netto": round(netto),
            "ersparnis_kwh": round(ersparnis_kwh),
            "ersparnis_euro": round(ersparnis_euro),
            "ersparnis_prozent": round(ersparnis_kwh / geb["nutzenergie"] * 100, 1),
            "amortisation": round(netto / ersparnis_euro, 1) if ersparnis_euro > 0 else None,
            "co2_ersparnis": round(ersparnis_kwh / bestand["effizienz"] * bestand["co2"] / 1000.0, 2),
            "hinweis": hinweis,
        })

    if _norm(g.get("dach_daemmung"), U_DACH, "keine") != "sehr_gut":
        variante("Dach dämmen (U ≈ 0,14)", {"dach_daemmung": "sehr_gut"},
                 geb["dachflaeche"] * bk["dach_m2"])
    if _norm(g.get("wand_daemmung"), U_WAND_GEDAEMMT, "keine") not in ("gut", "sehr_gut"):
        variante("Fassade dämmen / WDVS (U ≈ 0,18)", {"wand_daemmung": "sehr_gut"},
                 geb["wandflaeche"] * bk["fassade_m2"])
    if _norm(g.get("fenster"), U_FENSTER, "zweifach_alt") != "dreifach":
        variante("Fenster tauschen (3-fach, U ≈ 0,9)", {"fenster": "dreifach"},
                 geb["fensterflaeche"] * bk["fenster_m2"])
    if _norm(g.get("keller_daemmung"), U_BODEN, "keine") in ("keine", "maessig"):
        variante("Kellerdecke dämmen (U ≈ 0,30)", {"keller_daemmung": "gut"},
                 geb["bodenflaeche"] * bk["kellerdecke_m2"])

    # Hydraulischer Abgleich: pauschal ~7 % des Heizwaermebedarfs
    ersparnis_kwh = geb["heizwaermebedarf"] * 0.07
    ersparnis_euro = ersparnis_kwh / bestand["effizienz"] * bestand["preis"]
    kosten = 950.0
    netto = kosten - kosten * FOERDERSATZ_DAEMMUNG
    kandidaten.append({
        "name": "Hydraulischer Abgleich + Pumpentausch",
        "kosten": round(kosten), "foerderung": round(kosten * FOERDERSATZ_DAEMMUNG),
        "kosten_netto": round(netto),
        "ersparnis_kwh": round(ersparnis_kwh),
        "ersparnis_euro": round(ersparnis_euro),
        "ersparnis_prozent": round(ersparnis_kwh / geb["nutzenergie"] * 100, 1),
        "amortisation": round(netto / ersparnis_euro, 1) if ersparnis_euro > 0 else None,
        "co2_ersparnis": round(ersparnis_kwh / bestand["effizienz"] * bestand["co2"] / 1000.0, 2),
        "hinweis": "Pauschalwert ~7 % des Heizwärmebedarfs",
    })

    kandidaten.sort(key=lambda m: (m["amortisation"] is None, m["amortisation"]))
    return kandidaten


def fbh_nachruestung_bewerten(inp: dict, geb: dict, bestand: dict, optionen: dict,
                              preise: dict | None) -> dict | None:
    """Umstellung aller Heizkoerper-Raeume auf Fussbodenheizung, bewertet
    ueber den Effizienzgewinn der besten Waermepumpe."""
    raeume = raeume_normalisieren(inp, geb)
    hk_raeume = [r for r in raeume if not HEIZARTEN[r["heizart"]]["flaechenheizung"]
                 and r["heizart"] != "keine"]
    if not hk_raeume:
        return None
    flaeche = sum(r["flaeche"] for r in hk_raeume)
    kosten = flaeche * _baukosten(preise)["fbh_m2"]

    vl_ist = vorlauftemperatur(geb, raeume)
    vl_neu = vorlauftemperatur(geb, [dict(r, heizart="fussbodenheizung")
                                     if not HEIZARTEN[r["heizart"]]["flaechenheizung"]
                                     and r["heizart"] != "keine" else r for r in raeume])
    sys_ist = systeme_vergleichen(geb, vl_ist, bestand, optionen, preise)
    sys_neu = systeme_vergleichen(geb, vl_neu, bestand, optionen, preise)
    wp_ist = next(s for s in sys_ist if s["key"] == "waermepumpe_luft")
    wp_neu = next(s for s in sys_neu if s["key"] == "waermepumpe_luft")
    ersparnis = wp_ist["kosten_jahr"] - wp_neu["kosten_jahr"]
    return {
        "name": "Fußbodenheizung nachrüsten",
        "flaeche": round(flaeche),
        "kosten": round(kosten),
        "foerderung": 0,
        "kosten_netto": round(kosten),
        "jaz_vorher": wp_ist["effizienz"],
        "jaz_nachher": wp_neu["effizienz"],
        "ersparnis_euro": round(max(0.0, ersparnis)),
        "amortisation": round(kosten / ersparnis, 1) if ersparnis > 50 else None,
        "hinweis": "Ersparnis bezogen auf Betrieb mit Luft-Wärmepumpe "
                   f"(JAZ {wp_ist['effizienz']:.1f} → {wp_neu['effizienz']:.1f})",
    }


# ---------------------------------------------------------------------------
# Rentabilitaet: alle Varianten durchrechnen und das Optimum bestimmen
# ---------------------------------------------------------------------------

OPTIMUM_DEFINITION = (
    "Als optimal gilt die Variante mit dem höchsten Nettovorteil über "
    f"{BETRACHTUNG_JAHRE} Jahre: Gesamtkosten des Weiterbetriebs der Bestandsanlage "
    "minus Gesamtkosten der Variante – inklusive aller Bau- und Investitionskosten "
    "(Anlage, Umfeldmaßnahmen, ggf. Fußbodenheizung und Dämmung, abzüglich Förderung). "
    "Die Variante muss sich innerhalb des Betrachtungszeitraums amortisieren; "
    "der Amortisationspunkt ist in den Verläufen markiert."
)


def rentabilitaet_analyse(inp: dict, geb: dict, bestand: dict, optionen: dict,
                          preise: dict | None, massnahmen: list[dict]) -> dict:
    """Varianten (System x Uebergabe x Daemmpaket) vergleichen.

    Referenz ist immer der Weiterbetrieb der unsanierten Bestandsanlage.
    Nettovorteil = Bestandskosten(20a) - Variantenkosten(20a) inkl. aller
    Bau-/Investitionskosten. Rendite = mittlere Jahresersparnis / Kapitaleinsatz.
    """
    bk = _baukosten(preise)
    raeume = raeume_normalisieren(inp, geb)
    bestand20 = bestand["kostenverlauf"][-1]

    # "Wirtschaftliches Daemmpaket": Gebaeude-Massnahmen mit Amortisation <= 15 a
    paket = [m for m in massnahmen
             if m.get("aenderung") and m.get("amortisation") and m["amortisation"] <= 15]
    paket_kosten = sum(m["kosten_netto"] for m in paket)
    paket_namen = [m["name"].split(" (")[0] for m in paket]

    hk_raeume = [r for r in raeume if not HEIZARTEN[r["heizart"]]["flaechenheizung"]
                 and r["heizart"] != "keine"]
    fbh_kosten = sum(r["flaeche"] for r in hk_raeume) * bk["fbh_m2"]
    alles_fbh = [dict(r, heizart="fussbodenheizung")
                 if not HEIZARTEN[r["heizart"]]["flaechenheizung"] and r["heizart"] != "keine"
                 else r for r in raeume]

    pakete = [("ohne", "ohne Dämmung", [], 0.0)]
    if paket:
        pakete.append(("daemmung", "mit Dämmpaket", paket, paket_kosten))
    uebergaben = [("ist", "Übergabe wie eingegeben", raeume, 0.0)]
    if hk_raeume:
        uebergaben.append(("fbh", "alles Fußbodenheizung", alles_fbh, fbh_kosten))

    varianten = []
    for p_key, p_label, p_ms, p_kosten in pakete:
        inp2 = deepcopy(inp)
        for m in p_ms:
            inp2.setdefault("gebaeude", {}).update(m["aenderung"])
        geb2 = gebaeude_analyse(inp2) if p_ms else geb
        for u_key, u_label, rr, u_kosten in uebergaben:
            vl = vorlauftemperatur(geb2, rr)
            zusatz = p_kosten + u_kosten
            for s in systeme_vergleichen(geb2, vl, bestand, optionen, preise):
                if s["key"] == "strom_direkt":
                    continue
                verlauf = [round(v + zusatz) for v in s["kostenverlauf"]]
                netto = bestand20 - verlauf[-1]
                invest_gesamt = s["invest_netto"] + zusatz
                ersparnis_jahr = bestand["kosten_jahr"] - s["kosten_jahr"]
                rendite = (netto / BETRACHTUNG_JAHRE) / invest_gesamt if invest_gesamt > 0 else 0.0
                varianten.append({
                    "system": s["label"],
                    "system_key": s["key"],
                    "uebergabe": u_label,
                    "uebergabe_key": u_key,
                    "paket": p_label,
                    "paket_key": p_key,
                    "label": f"{s['label']} · {u_label}" + (f" · {p_label}" if p_key != "ohne" else ""),
                    "effizienz_text": s["effizienz_text"],
                    "invest_anlage": s["invest_netto"],
                    "kosten_fbh": round(u_kosten),
                    "kosten_daemmung": round(p_kosten),
                    "invest_gesamt": round(invest_gesamt),
                    "ersparnis_jahr": round(ersparnis_jahr),
                    "netto_20a": round(netto),
                    "amortisation": _amortisation_gegen_bestand(verlauf, bestand),
                    "rendite": round(rendite, 4),
                    "kostenverlauf": verlauf,
                })

    varianten.sort(key=lambda v: -v["netto_20a"])
    amortisierende = [v for v in varianten if v["amortisation"] is not None]
    optimum = (amortisierende or varianten)[0]
    optimum["ist_optimum"] = True

    top = varianten[:10]
    if optimum not in top:
        top = top[:9] + [optimum]

    return {
        "definition": OPTIMUM_DEFINITION,
        "referenz": f"Weiterbetrieb {bestand['label']} ({bestand['baujahr']}): "
                    f"{bestand20:,.0f} € über {BETRACHTUNG_JAHRE} Jahre".replace(",", "."),
        "bestand_20a": bestand20,
        "daemmpaket": paket_namen,
        "varianten": [{k: v for k, v in var.items() if k != "kostenverlauf"} for var in top],
        "optimum": optimum,
        "anzahl_varianten": len(varianten),
    }


# ---------------------------------------------------------------------------
# Hauptfunktion
# ---------------------------------------------------------------------------

def berechnen(inp: dict) -> dict:
    """Komplette Auswertung; Eingabe- und Ausgabeformat siehe README."""
    optionen = inp.get("foerderung", {}) or {}
    preise = inp.get("preise") or None

    geb = gebaeude_analyse(inp)
    raeume = raeume_normalisieren(inp, geb)
    vl_info = vorlauftemperatur(geb, raeume)
    bestand = bestand_bewerten(inp, geb, vl_info, preise)
    systeme = systeme_vergleichen(geb, vl_info, bestand, optionen, preise)
    heizarten = heizarten_vergleichen(inp, geb, bestand, optionen, preise)
    massnahmen = massnahmen_bewerten(inp, geb, bestand, preise)
    rentabilitaet = rentabilitaet_analyse(inp, geb, bestand, optionen, preise, massnahmen)
    fbh = fbh_nachruestung_bewerten(inp, geb, bestand, optionen, preise)
    if fbh:
        massnahmen.append(fbh)

    bestes = systeme[0]
    beste_heizart = min(heizarten, key=lambda h: h["bestes_gesamt_20a"])
    co2_bestes = min(systeme, key=lambda s: s["co2_jahr"])

    gesamt_fmt = f"{bestes['gesamt_20a']:,.0f}".replace(",", ".")
    empfehlung = {
        "system": bestes["label"],
        "system_key": bestes["key"],
        "heizart": beste_heizart["label"],
        "heizart_key": beste_heizart["key"],
        "co2_sieger": co2_bestes["label"],
        "ersparnis_jahr_vs_bestand": round(bestand["kosten_jahr"] - bestes["kosten_jahr"]),
        "amortisation": bestes["amortisation"],
        "text": (
            f"Wirtschaftlich am besten schneidet über {BETRACHTUNG_JAHRE} Jahre "
            f"die {bestes['label']} ab ({bestes['effizienz_text']}, "
            f"{gesamt_fmt} € Gesamtkosten). "
            + (f"Die Amortisation gegenüber dem Weiterbetrieb der bestehenden "
               f"{bestand['label']} ({bestand['baujahr']}) liegt bei etwa "
               f"{bestes['amortisation']} Jahren. " if bestes["amortisation"] is not None
               else "Gegenüber dem Weiterbetrieb der Bestandsanlage amortisiert sich "
                    "die Anlage im Betrachtungszeitraum nicht. ")
            + f"Als Wärmeübergabe ist „{beste_heizart['label']}“ am günstigsten "
              f"(mittlere Vorlauftemperatur {beste_heizart['vl_mittel']:.0f} °C)."
        ),
    }

    return {
        "gebaeude": geb,
        "raeume": raeume,
        "vorlauf": vl_info,
        "bestand": bestand,
        "systeme": systeme,
        "heizarten": heizarten,
        "massnahmen": massnahmen,
        "rentabilitaet": rentabilitaet,
        "empfehlung": empfehlung,
        "baukosten": _baukosten(preise),
        "parameter": {
            "gradtagzahl": GRADTAGZAHL,
            "betrachtung_jahre": BETRACHTUNG_JAHRE,
            "norm_aussentemp": NORM_AUSSENTEMP,
        },
    }
