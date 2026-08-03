"""Pruefung nach Hessischer Bauordnung (HBO 2018) und Optimierer.

Geprueft wird die Grenzbebauung eines Nebengebaeudes ohne Aufenthaltsraeume.
Rechtsgrundlagen (Stand HBO in der Fassung vom 28.05.2018, zuletzt geaendert):

* § 63 Abs. 1 Nr. 1 a HBO - verfahrensfrei sind Gebaeude bis 30 m3
  Brutto-Rauminhalt ohne Aufenthaltsraeume, Toiletten und Feuerstaetten;
  im Aussenbereich gilt diese Verfahrensfreiheit nicht.
* § 6 Abs. 8 HBO - in den Abstandsflaechen und ohne eigene Abstandsflaechen
  zulaessig: Gebaeude ohne Aufenthaltsraeume und ohne Feuerstaetten mit einer
  mittleren Wandhoehe bis 3,00 m und einer Gesamtlaenge je Grundstuecksgrenze
  von 15,00 m.
* § 63 Abs. 4 HBO - Verfahrensfreiheit entbindet nicht von der Einhaltung
  der materiellen Anforderungen (Bauordnungs- und Bauplanungsrecht).
* § 30 HBO / Anlage - Gebaeude ohne Aufenthaltsraeume bis 50 m3 Brutto-
  Rauminhalt brauchen an der Grenze keine Brandwand.

Diese Pruefung ersetzt keine Rechtsberatung und keine Bauvoranfrage.
Oertliche Bebauungsplaene, Gestaltungs- und Stellplatzsatzungen koennen
strengere Regeln enthalten.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .model import Building, compute_dims
from .text import nz
from .spec import (
    FAHRRAD_LAENGE,
    DACH_UEBERSTAND_GRENZE,
    FASSADE_LUFT,
    HBO_BRI_RESERVE,
    HBO_MAX_BRI,
    HBO_MAX_GRENZLAENGE,
    HBO_MAX_WANDHOEHE,
    WAND_STIEL,
    ShedSpec,
)


# kleinste sinnvolle Aussentiefe: Rad 1,90 m + 15 cm Bewegung + Wandaufbau
MIN_DEPTH = FAHRRAD_LAENGE + 150.0 + 2 * WAND_STIEL[0] + 2 * FASSADE_LUFT


@dataclass
class Check:
    key: str
    title: str
    value: str
    limit: str
    status: str          # ok | warn | fail | info
    law: str
    hint: str = ""

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def boundary_wall_height(dims: dict) -> float:
    """Mittlere Wandhoehe der Grenzwand ab Gelaende bis Schnittpunkt Dachhaut.

    Die Grenzwand ist die hohe Seite des Pultdaches und damit rechteckig -
    die mittlere Wandhoehe entspricht ihrer Hoehe.
    """
    return dims["z_roof_rear"]


def check_all(b: Building) -> list[Check]:
    d, spec = b.dims, b.spec
    out: list[Check] = []

    bri = d["bri"]
    out.append(Check(
        "bri", "Brutto-Rauminhalt (Verfahrensfreiheit)",
        f"{nz(bri, 2)} m3", f"max. {HBO_MAX_BRI:.0f} m3",
        "ok" if bri <= HBO_MAX_BRI else "fail",
        "§ 63 Abs. 1 Nr. 1 a HBO",
        "Bis 30 m3 ist das Gebaeude ohne Aufenthaltsraeume verfahrensfrei - "
        "kein Bauantrag noetig. Darueber wird ein Genehmigungsverfahren faellig."
        if bri <= HBO_MAX_BRI else
        "Ueber 30 m3: Bauantrag erforderlich. Laenge, Tiefe oder Traufhoehe "
        "reduzieren, um verfahrensfrei zu bleiben."))

    h = boundary_wall_height(d)
    out.append(Check(
        "wandhoehe", "Mittlere Wandhoehe an der Grenze",
        f"{nz(h / 1000, 2)} m", f"max. {nz(HBO_MAX_WANDHOEHE / 1000, 2)} m",
        "ok" if h <= HBO_MAX_WANDHOEHE else "fail",
        "§ 6 Abs. 8 HBO",
        "Gemessen ab Gelaendeoberflaeche bis Oberkante Dachhaut an der "
        "Grenzwand. Die Grenzwand ist hier die hohe Pultdachseite."
        + ("" if h <= HBO_MAX_WANDHOEHE else
           " Traufhoehe oder Dachneigung verringern.")))

    gl = d["length_out"]
    out.append(Check(
        "grenzlaenge", "Bebauungslaenge an dieser Grenze",
        f"{nz(gl / 1000, 2)} m", f"max. {nz(HBO_MAX_GRENZLAENGE / 1000, 2)} m",
        "ok" if gl <= HBO_MAX_GRENZLAENGE else "fail",
        "§ 6 Abs. 8 HBO",
        "Alle grenzstaendigen Gebaeude an derselben Grenze zaehlen zusammen - "
        "vorhandene Garagen oder Schuppen mitrechnen."))

    ueberstand = DACH_UEBERSTAND_GRENZE - FASSADE_LUFT
    out.append(Check(
        "ueberstand", "Dachueberstand zur Grenze",
        f"{ueberstand:.0f} mm", "0 mm",
        "ok" if ueberstand <= 0 else "fail",
        "§ 6 HBO / § 903 BGB",
        "Kein Bauteil darf ueber die Grundstuecksgrenze ragen. Das Dach endet "
        "buendig mit der Fassadenaussenkante der Grenzwand; oben schliesst ein "
        "Wandanschlussprofil den Blechrand ab."))

    out.append(Check(
        "wasser", "Niederschlagswasser",
        "Traufe auf der Gartenseite", "kein Ablauf zum Nachbarn",
        "ok" if spec.with_gutter else "warn",
        "§ 37 Abs. 4 HBO, Nachbarrecht",
        "Das Pultdach faellt von der Grenze weg. Dachrinne mit Ablauf in "
        "Regentonne oder Sickerschacht auf dem eigenen Grundstueck."
        if spec.with_gutter else
        "Ohne Rinne tropft Traufwasser vor die Wand - direkt an der Grenze "
        "ist eine Rinne dringend zu empfehlen."))

    out.append(Check(
        "brandschutz", "Brandschutz der Grenzwand",
        f"{nz(bri, 2)} m3", "unter 50 m3 keine Brandwand",
        "ok" if bri <= 50 else "warn",
        "§ 30 HBO",
        "Gebaeude ohne Aufenthaltsraeume unter 50 m3 brauchen an der Grenze "
        "keine Brandwand - die Holzwand ist zulaessig. Eine nicht brennbare "
        "Beplankung der Grenzwand bleibt trotzdem empfehlenswert."))

    out.append(Check(
        "nutzung", "Nutzung ohne Aufenthaltsraum",
        "Fahrraeder + Gartengeraete", "kein Aufenthaltsraum, keine Feuerstaette",
        "ok",
        "§ 63 Abs. 1, § 6 Abs. 8 HBO",
        "Sobald ein Aufenthaltsraum, ein Ofen oder eine Toilette eingebaut "
        "wird, entfallen Verfahrensfreiheit und Grenzprivileg."))

    if spec.site == "aussenbereich":
        out.append(Check(
            "lage", "Lage des Grundstuecks", "Aussenbereich",
            "Innenbereich erforderlich", "fail",
            "§ 63 Abs. 1 Nr. 1 a HBO, § 35 BauGB",
            "Im Aussenbereich gilt die Verfahrensfreiheit nicht - hier ist "
            "immer ein Bauantrag bzw. eine Bauvoranfrage noetig."))
    else:
        out.append(Check(
            "lage", "Lage des Grundstuecks", "Innenbereich (§ 34 BauGB)",
            "Innenbereich", "ok", "§ 34 BauGB",
            "Das Vorhaben muss sich in die Eigenart der naeheren Umgebung "
            "einfuegen. Bebauungsplan pruefen: Baugrenzen, ueberbaubare "
            "Grundstuecksflaeche und GRZ gelten auch fuer Nebenanlagen."))

    sc = d.get("sparren_check", {})
    if sc:
        out.append(Check(
            "statik", "Sparrennachweis (Biegung/Durchbiegung)",
            f"Ausnutzung {nz(sc.get('eta_max', 0), 2)}", "<= 1,00",
            "ok" if sc.get("ok") else "fail",
            "DIN EN 1995-1-1 (EC5)",
            f"Gewaehlt {d['sparren'][0]:.0f}x{d['sparren'][1]:.0f} mm bei "
            f"{sc.get('spacing_m', 0):.3f} m Achsabstand und "
            f"{nz(sc.get('span_m', 0), 2)} m Stuetzweite, Schneelast "
            f"sk = {nz(sc.get('s_k', 0), 2)} kN/m2."))

    out.append(Check(
        "hinweis", "Weitere Pflichten", "Bebauungsplan / Satzungen pruefen",
        "vor Baubeginn", "info", "§ 63 Abs. 4 HBO",
        "Verfahrensfrei heisst nicht anforderungsfrei: Bebauungsplan, "
        "Gestaltungssatzung, Denkmalschutz, Baumschutzsatzung und "
        "Leitungsrechte pruefen. Nachbarn vorab informieren - das erspart "
        "Streit, auch wenn keine Zustimmung noetig ist."))
    return out


def summary(checks: list[Check]) -> dict:
    fails = [c for c in checks if c.status == "fail"]
    warns = [c for c in checks if c.status == "warn"]
    if fails:
        state, text = "fail", f"{len(fails)} Anforderung(en) nicht erfuellt"
    elif warns:
        state, text = "warn", f"zulaessig, {len(warns)} Hinweis(e) beachten"
    else:
        state, text = "ok", "verfahrensfrei und grenzstaendig zulaessig"
    return {"state": state, "text": text,
            "fails": [c.key for c in fails], "warns": [c.key for c in warns]}


# ---------------------------------------------------------------------------
# Optimierer: groesstes zulaessiges Haeuschen
# ---------------------------------------------------------------------------


def is_compliant(spec: ShedSpec, reserve: float = HBO_BRI_RESERVE) -> bool:
    d = compute_dims(spec)
    return (d["bri"] <= HBO_MAX_BRI - reserve
            and d["z_roof_rear"] <= HBO_MAX_WANDHOEHE - 40
            and d["length_out"] <= HBO_MAX_GRENZLAENGE)


def optimize(base: ShedSpec | None = None, *,
             min_tool_width: float = 1200.0,
             min_eaves: float = 2000.0) -> ShedSpec:
    """Sucht die groesste noch verfahrensfreie und grenzstaendige Variante.

    Zielfunktion: moeglichst viele Fahrradstellplaetze, danach moeglichst
    breiter Geraeteteil, danach moeglichst grosszuegige lichte Hoehe.
    """
    base = base or ShedSpec()
    best: tuple[tuple, ShedSpec] | None = None

    for depth in (2500.0, 2450.0, 2400.0, 2350.0, MIN_DEPTH):
        for pitch in (7.0, 8.0, 9.0, 10.0, 12.0):
            for eaves in (2300.0, 2200.0, 2100.0, 2050.0, min_eaves):
                if eaves < min_eaves:
                    continue
                for tool in (2000.0, 1800.0, 1600.0, 1500.0, min_tool_width):
                    if tool < min_tool_width:
                        continue
                    for bikes in range(10, 1, -1):
                        cand = ShedSpec(**{**base.to_dict(),
                                           "n_bikes": bikes, "tool_width": tool,
                                           "depth": depth, "roof_pitch": pitch,
                                           "eaves_height": eaves})
                        if not is_compliant(cand):
                            continue
                        d = compute_dims(cand)
                        score = (bikes, tool, eaves, depth, -d["bri"])
                        if best is None or score > best[0]:
                            best = (score, cand)
                        break        # groesste Radzahl fuer diese Kombination
    return best[1] if best else base


def max_bikes_for(spec: ShedSpec) -> int:
    """Wie viele Raeder passen bei sonst gleichen Einstellungen maximal?"""
    n = 0
    for bikes in range(1, 15):
        cand = ShedSpec(**{**spec.to_dict(), "n_bikes": bikes})
        if is_compliant(cand, reserve=0.0):
            n = bikes
        else:
            break
    return n
