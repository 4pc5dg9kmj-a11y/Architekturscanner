"""PDF-Bericht des Heizungsrechners (fpdf2 + matplotlib)."""

from __future__ import annotations

import io
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from fpdf import FPDF

from .berechnung import BETRACHTUNG_JAHRE

# ---------------------------------------------------------------------------
# Farben (validierte Referenzpalette, Light-Mode)
# ---------------------------------------------------------------------------

SERIES = ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834",
          "#4a3aa7", "#e34948"]
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
SURFACE = "#fcfcfb"
ACCENT = SERIES[0]
GOOD = "#0ca30c"

_FONT_DIRS = [
    Path("/usr/share/fonts/truetype/dejavu"),
    Path(matplotlib.get_data_path()) / "fonts" / "ttf",
]


def _font(name: str) -> str:
    for d in _FONT_DIRS:
        p = d / name
        if p.exists():
            return str(p)
    raise FileNotFoundError(name)


def _eur(v: float) -> str:
    return f"{v:,.0f} €".replace(",", ".")


def _mpl_style(ax):
    ax.set_facecolor(SURFACE)
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=INK2, labelsize=9, length=0)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def _fig_png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight",
                facecolor=SURFACE)
    plt.close(fig)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def chart_vollkosten(res: dict) -> bytes:
    systeme = res["systeme"]
    best_key = res["empfehlung"]["system_key"]
    labels = [s["label"] for s in systeme][::-1]
    werte = [s["vollkosten_jahr"] for s in systeme][::-1]
    farben = [GOOD if s["key"] == best_key else ACCENT for s in systeme][::-1]

    fig, ax = plt.subplots(figsize=(7.4, 3.2))
    bars = ax.barh(labels, werte, color=farben, height=0.62, zorder=3)
    _mpl_style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    ax.tick_params(axis="y", labelsize=9.5, labelcolor=INK)
    for bar, w in zip(bars, werte):
        ax.text(w + max(werte) * 0.012, bar.get_y() + bar.get_height() / 2,
                _eur(w), va="center", fontsize=8.5, color=INK2)
    ax.set_xlim(0, max(werte) * 1.18)
    ax.set_xlabel("Vollkosten pro Jahr (Energie + Wartung + Kapitalkosten)",
                  fontsize=9, color=INK2)
    return _fig_png(fig)


def chart_kumuliert(res: dict) -> bytes:
    systeme = [s for s in res["systeme"] if s["key"] != "strom_direkt"][:5]
    bestand = res["bestand"]
    jahre = list(range(BETRACHTUNG_JAHRE + 1))

    fig, ax = plt.subplots(figsize=(7.4, 3.6))
    _mpl_style(ax)
    ax.plot(jahre, bestand["kostenverlauf"], color=MUTED, linewidth=2,
            linestyle="--", label=f"Bestand: {bestand['label']} ({bestand['baujahr']})",
            zorder=3)
    ref = bestand["kostenverlauf"]
    for i, s in enumerate(systeme):
        farbe = SERIES[i % len(SERIES)]
        ax.plot(jahre, s["kostenverlauf"], color=farbe, linewidth=2,
                solid_capstyle="round", label=s["label"], zorder=4)
        # Amortisationspunkt: erster Schnitt mit der Bestandslinie
        be = next((j for j, (neu, alt) in enumerate(zip(s["kostenverlauf"], ref))
                   if j > 0 and neu <= alt), None)
        if be is not None:
            ax.plot(be, s["kostenverlauf"][be], "o", color=farbe, markersize=7,
                    markeredgecolor=SURFACE, markeredgewidth=2, zorder=5)
    ax.set_xlim(0, BETRACHTUNG_JAHRE)
    ax.set_xlabel("Jahre ab Einbau", fontsize=9, color=INK2)
    ax.set_ylabel("Kumulierte Kosten (€)", fontsize=9, color=INK2)
    ax.yaxis.set_major_formatter(
        matplotlib.ticker.FuncFormatter(lambda v, _: f"{v / 1000:.0f}k"))
    ax.legend(fontsize=8, frameon=False, loc="upper left", labelcolor=INK2)
    return _fig_png(fig)


def chart_co2(res: dict) -> bytes:
    systeme = res["systeme"]
    bestand = res["bestand"]
    labels = [s["label"] for s in systeme] + [f"Bestand ({bestand['label']})"]
    werte = [s["co2_jahr"] for s in systeme] + [bestand["co2_jahr"]]
    order = sorted(range(len(werte)), key=lambda i: werte[i])
    labels = [labels[i] for i in order][::-1]
    werte = [werte[i] for i in order][::-1]
    farben = [MUTED if l.startswith("Bestand") else ACCENT for l in labels]

    fig, ax = plt.subplots(figsize=(7.4, 3.2))
    bars = ax.barh(labels, werte, color=farben, height=0.62, zorder=3)
    _mpl_style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    ax.tick_params(axis="y", labelsize=9.5, labelcolor=INK)
    for bar, w in zip(bars, werte):
        ax.text(w + max(werte) * 0.012, bar.get_y() + bar.get_height() / 2,
                f"{w:.1f} t", va="center", fontsize=8.5, color=INK2)
    ax.set_xlim(0, max(werte) * 1.15)
    ax.set_xlabel("CO₂-Ausstoß pro Jahr (Tonnen)", fontsize=9, color=INK2)
    return _fig_png(fig)


def chart_verluste(res: dict) -> bytes:
    teile = res["gebaeude"]["verlust_anteile"]
    labels = [t["bauteil"] for t in teile][::-1]
    werte = [t["anteil"] * 100 for t in teile][::-1]

    fig, ax = plt.subplots(figsize=(7.4, 2.4))
    bars = ax.barh(labels, werte, color=ACCENT, height=0.6, zorder=3)
    _mpl_style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    ax.tick_params(axis="y", labelsize=9.5, labelcolor=INK)
    for bar, w in zip(bars, werte):
        ax.text(w + max(werte) * 0.012, bar.get_y() + bar.get_height() / 2,
                f"{w:.0f} %", va="center", fontsize=8.5, color=INK2)
    ax.set_xlim(0, max(werte) * 1.15)
    ax.set_xlabel("Anteil an den Wärmeverlusten", fontsize=9, color=INK2)
    return _fig_png(fig)


def _variante_kurz(v: dict) -> str:
    kurz = {"waermepumpe_luft": "Luft-WP", "waermepumpe_sole": "Sole-WP",
            "gas_brennwert": "Gas", "oel_brennwert": "Öl", "pellets": "Pellets",
            "fernwaerme": "Fernwärme", "strom_direkt": "Strom"}
    s = kurz.get(v["system_key"], v["system"])
    s += " · FBH" if v["uebergabe_key"] == "fbh" else " · Ist-Übergabe"
    if v["paket_key"] != "ohne":
        s += " + Dämmung"
    return s


def chart_rentabilitaet(res: dict) -> bytes:
    varianten = res["rentabilitaet"]["varianten"][:8]
    labels = [("★ " if v.get("ist_optimum") else "") + _variante_kurz(v)
              for v in varianten][::-1]
    werte = [max(0, v["netto_20a"]) for v in varianten][::-1]
    farben = [GOOD if v.get("ist_optimum") else ACCENT for v in varianten][::-1]
    amort = [v["amortisation"] for v in varianten][::-1]

    fig, ax = plt.subplots(figsize=(7.4, 3.4))
    bars = ax.barh(labels, werte, color=farben, height=0.62, zorder=3)
    _mpl_style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    ax.tick_params(axis="y", labelsize=9, labelcolor=INK)
    for bar, w, a in zip(bars, werte, amort):
        txt = _eur(w) + (f"  ·  amort. {a} J." if a is not None else "")
        ax.text(w + max(werte) * 0.012, bar.get_y() + bar.get_height() / 2,
                txt, va="center", fontsize=8, color=INK2)
    ax.set_xlim(0, max(werte) * 1.32)
    ax.set_xlabel("Nettovorteil gegenüber Weiterbetrieb der Bestandsanlage "
                  f"(€ über {BETRACHTUNG_JAHRE} Jahre)", fontsize=9, color=INK2)
    return _fig_png(fig)


def chart_massnahmen(res: dict) -> bytes:
    mm = [m for m in res["massnahmen"] if m.get("ersparnis_euro")]
    mm = sorted(mm, key=lambda m: -m["ersparnis_euro"])[:7]
    labels = [m["name"] for m in mm][::-1]
    werte = [m["ersparnis_euro"] for m in mm][::-1]
    amort = [m["amortisation"] for m in mm][::-1]

    fig, ax = plt.subplots(figsize=(7.4, 3.0))
    bars = ax.barh(labels, werte, color=SERIES[4], height=0.6, zorder=3)
    _mpl_style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    ax.tick_params(axis="y", labelsize=9, labelcolor=INK)
    for bar, w, a in zip(bars, werte, amort):
        txt = _eur(w) + "/a" + (f"  ·  amortisiert in {a:.0f} J." if a else "")
        ax.text(w + max(werte) * 0.012, bar.get_y() + bar.get_height() / 2,
                txt, va="center", fontsize=8, color=INK2)
    ax.set_xlim(0, max(werte) * 1.45)
    ax.set_xlabel("Jährliche Kostenersparnis (bewertet mit der Bestandsanlage)",
                  fontsize=9, color=INK2)
    return _fig_png(fig)


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

class _PDF(FPDF):
    def __init__(self):
        super().__init__(format="A4")
        self.add_font("dejavu", "", _font("DejaVuSans.ttf"))
        self.add_font("dejavu", "B", _font("DejaVuSans-Bold.ttf"))
        self.set_auto_page_break(True, margin=18)
        self.set_margins(16, 16, 16)

    def footer(self):
        self.set_y(-13)
        self.set_font("dejavu", "", 7.5)
        self.set_text_color(137, 135, 129)
        self.cell(0, 5, "Heizungsrechner – Richtwerte, ersetzt keine Energieberatung nach GEG",
                  align="L")
        self.cell(0, 5, f"Seite {self.page_no()}", align="R")

    # -- Bausteine ----------------------------------------------------------
    def h1(self, text: str):
        self.set_font("dejavu", "B", 17)
        self.set_text_color(11, 11, 11)
        self.cell(0, 9, text, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def h2(self, text: str):
        self.ln(2)
        self.set_font("dejavu", "B", 12)
        self.set_text_color(11, 11, 11)
        self.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def p(self, text: str, size: float = 9.5, color=(82, 81, 78)):
        self.set_font("dejavu", "", size)
        self.set_text_color(*color)
        self.multi_cell(0, 4.8, text, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def kv_grid(self, pairs: list[tuple[str, str]], cols: int = 3):
        """Kennzahlen-Kacheln."""
        w = (self.w - self.l_margin - self.r_margin) / cols
        rows = [pairs[i:i + cols] for i in range(0, len(pairs), cols)]
        for row in rows:
            y0 = self.get_y()
            for i, (label, value) in enumerate(row):
                x = self.l_margin + i * w
                self.set_xy(x, y0)
                self.set_font("dejavu", "", 7.8)
                self.set_text_color(137, 135, 129)
                self.cell(w - 3, 4, label, new_x="LEFT", new_y="NEXT")
                self.set_x(x)
                self.set_font("dejavu", "B", 11.5)
                self.set_text_color(11, 11, 11)
                self.cell(w - 3, 6, value)
            self.set_y(y0 + 11.5)
        self.ln(2)

    def tabelle(self, header: list[str], zeilen: list[list[str]],
                breiten: list[float], highlight_row: int | None = None):
        self.set_font("dejavu", "B", 8)
        self.set_text_color(82, 81, 78)
        self.set_draw_color(225, 224, 217)
        for h, b in zip(header, breiten):
            self.cell(b, 6, h, border="B")
        self.ln()
        self.set_font("dejavu", "", 8)
        for idx, zeile in enumerate(zeilen):
            if highlight_row is not None and idx == highlight_row:
                self.set_fill_color(232, 242, 252)
                fill = True
                self.set_font("dejavu", "B", 8)
            else:
                fill = False
                self.set_font("dejavu", "", 8)
            self.set_text_color(11, 11, 11)
            for i, (z, b) in enumerate(zip(zeile, breiten)):
                self.cell(b, 5.6, str(z), border="B", fill=fill,
                          align="R" if i else "L")
            self.ln()
        self.ln(2)

    def bild(self, png: bytes, w: float | None = None):
        w = w or (self.w - self.l_margin - self.r_margin)
        self.image(io.BytesIO(png), w=w)
        self.ln(2)


def _amort_text(a) -> str:
    return f"{a} J." if a is not None else "> 20 J."


def report_pdf(res: dict, eingabe: dict | None = None) -> bytes:
    geb = res["gebaeude"]
    bestand = res["bestand"]
    emp = res["empfehlung"]
    pdf = _PDF()

    # ---------------- Seite 1: Gebäude ----------------
    pdf.add_page()
    pdf.h1("Heizungs-Effizienzbericht")
    pdf.p(f"Erstellt am {date.today().strftime('%d.%m.%Y')} · Betrachtungszeitraum "
          f"{BETRACHTUNG_JAHRE} Jahre · Gradtagzahl {res['parameter']['gradtagzahl']:.0f} K·d/a")

    pdf.h2("Empfehlung auf einen Blick")
    pdf.set_fill_color(232, 242, 252)
    pdf.set_font("dejavu", "B", 10.5)
    pdf.set_text_color(11, 11, 11)
    pdf.multi_cell(0, 6.5,
                   f"  Wärmeerzeuger: {emp['system']}   ·   Wärmeübergabe: {emp['heizart']}",
                   fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)
    pdf.p(emp["text"])

    pdf.h2("Gebäude")
    pdf.kv_grid([
        ("Wohnfläche", f"{geb['wohnflaeche']:.0f} m²"),
        ("Etagen", f"{geb['etagen']}"),
        ("Baujahr", f"{geb['baujahr']}"),
        ("Beheiztes Volumen", f"{geb['volumen']:.0f} m³"),
        ("Gebäudekubatur (brutto)", f"{geb['bruttovolumen']:.0f} m³"),
        ("Dachform", geb["dachform"]),
        ("Wärmehüllfläche", f"{geb['huellflaeche']:.0f} m²"),
        ("Heizlast (Auslegung)", f"{geb['heizlast_kw']:.1f} kW"),
        ("Heizwärmebedarf", f"{geb['heizwaermebedarf']:,.0f} kWh/a".replace(",", ".")),
        ("Warmwasser", f"{geb['warmwasserbedarf']:,.0f} kWh/a".replace(",", ".")),
        ("Spezifischer Bedarf", f"{geb['spezifisch']:.0f} kWh/m²a"),
        ("Mittlere Vorlauftemp.", f"{res['vorlauf']['vl_mittel']:.0f} °C"),
    ])
    pdf.p(f"U-Werte (W/m²K): Wand {geb['u_werte']['wand']} · Dach {geb['u_werte']['dach']} · "
          f"Fenster {geb['u_werte']['fenster']} · Boden {geb['u_werte']['boden']}", size=8.5)

    pdf.h2("Wo die Wärme verloren geht")
    pdf.bild(chart_verluste(res))

    pdf.h2("Bestandsanlage")
    verbrauch_fmt = f"{bestand['verbrauch_kwh']:,.0f}".replace(",", ".")
    pdf.p(f"{bestand['label']} von {bestand['baujahr']} ({bestand['alter']} Jahre alt), "
          f"Wirkungsgrad {bestand['effizienz_text']}. Endenergieverbrauch ca. "
          f"{verbrauch_fmt} kWh/a ({bestand['energie']}), laufende Kosten ca. "
          f"{_eur(bestand['kosten_jahr'])}/Jahr, CO₂-Ausstoß ca. {bestand['co2_jahr']:.1f} t/Jahr.")

    # ---------------- Seite 2: Systemvergleich ----------------
    pdf.add_page()
    pdf.h1("Vergleich der Wärmeerzeuger")
    pdf.p("Alle Systeme sind mit dem eingegebenen Übergabesystem (Heizkörper/Fußboden­heizung "
          "je Raum) gerechnet. Vollkosten = Energie + Wartung + Investition (abzüglich "
          "Förderung) verteilt auf die Lebensdauer.")

    systeme = res["systeme"]
    best_idx = next(i for i, s in enumerate(systeme) if s["key"] == emp["system_key"])
    pdf.tabelle(
        ["System", "Effizienz", "Invest", "Förderung", "Energie €/a",
         f"Gesamt {BETRACHTUNG_JAHRE} J.", "Amort."],
        [[s["label"], s["effizienz_text"], _eur(s["invest"]),
          _eur(s["foerderung"]), _eur(s["energiekosten_jahr"]),
          _eur(s["gesamt_20a"]), _amort_text(s["amortisation"])]
         for s in systeme],
        [52, 20, 22, 22, 24, 26, 12],
        highlight_row=best_idx,
    )
    pdf.h2("Bau- und Investitionskosten im Detail")
    pdf.p("Enthalten sind Gerät, Installation, Speicher und Umfeldkosten (Demontage, "
          "Bohrung, Hausanschluss, Öltank-Entsorgung usw.), skaliert mit der Heizlast. "
          "Alle Sätze sind im Rechner anpassbar.", size=8.5)
    for s in systeme[:3]:
        teile = " + ".join(f"{name} {_eur(wert)}"
                           for name, wert in s["invest_komponenten"].items())
        pdf.p(f"• {s['label']}: {teile}  =  {_eur(s['invest'])}"
              + (f" (Förderung −{_eur(s['foerderung'])} → {_eur(s['invest_netto'])})"
                 if s["foerderung"] else ""), size=8.5)

    pdf.h2("Jährliche Vollkosten")
    pdf.bild(chart_vollkosten(res))
    pdf.h2("Kumulierte Kosten und Amortisation")
    pdf.p("Der Punkt auf jeder Linie markiert den Amortisationszeitpunkt: Dort schneidet "
          "die Variante die gestrichelte Linie des Weiterbetriebs der Bestandsanlage.",
          size=8.5)
    pdf.bild(chart_kumuliert(res))

    # ---------------- Seite 3: Heizart + CO2 ----------------
    pdf.add_page()
    pdf.h1("Wärmeübergabe: Heizkörper vs. Fußbodenheizung")
    pdf.p("Die Übergabeart bestimmt die nötige Vorlauftemperatur – und damit vor allem die "
          "Effizienz einer Wärmepumpe (Jahresarbeitszahl, JAZ).")
    heizarten = res["heizarten"]
    best_ha = min(range(len(heizarten)), key=lambda i: heizarten[i]["bestes_gesamt_20a"])
    pdf.tabelle(
        ["Szenario", "Vorlauf", "JAZ Luft-WP", "WP-Kosten €/a",
         "Bestes System", f"Gesamt {BETRACHTUNG_JAHRE} J."],
        [[h["label"], f"{h['vl_mittel']:.0f} °C", f"{h['wp_jaz']:.1f}",
          _eur(h["wp_kosten_jahr"]),
          h["bestes_system"].split(" (")[0],
          _eur(h["bestes_gesamt_20a"])]
         for h in heizarten],
        [46, 14, 20, 24, 50, 24],
        highlight_row=best_ha,
    )

    pdf.h2("CO₂-Vergleich")
    pdf.bild(chart_co2(res))

    pdf.h2("Räume und Übergabesystem (Eingabe)")
    from .berechnung import HEIZARTEN
    pdf.tabelle(
        ["Raum", "Fläche", "Heizart"],
        [[r["name"], f"{r['flaeche']:.0f} m²", HEIZARTEN[r["heizart"]]["label"]]
         for r in res["raeume"]],
        [70, 25, 60],
    )

    # ---------------- Seite 4: Rentabilität & Optimum ----------------
    pdf.add_page()
    pdf.h1("Rentabilität und optimale Variante")
    rent = res["rentabilitaet"]
    o = rent["optimum"]
    pdf.p(rent["definition"], size=8.5)
    pdf.p("Referenz („nichts tun“): " + rent["referenz"]
          + f" · {rent['anzahl_varianten']} Varianten verglichen"
          + (f" · Dämmpaket: {', '.join(rent['daemmpaket'])}" if rent["daemmpaket"] else ""),
          size=8.5)

    pdf.set_fill_color(232, 242, 252)
    pdf.set_font("dejavu", "B", 10.5)
    pdf.set_text_color(11, 11, 11)
    pdf.multi_cell(0, 6.5, f"  ★ Optimum: {o['label']}", fill=True,
                   new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)
    pdf.kv_grid([
        ("Investition gesamt", _eur(o["invest_gesamt"])),
        ("Ersparnis pro Jahr", _eur(o["ersparnis_jahr"])),
        ("Amortisation", _amort_text(o["amortisation"])),
        (f"Nettovorteil {BETRACHTUNG_JAHRE} J.", _eur(o["netto_20a"])),
        ("Rendite aufs Kapital", f"{o['rendite'] * 100:.1f} %/Jahr".replace(".", ",")),
        ("Effizienz", o["effizienz_text"]),
    ])
    pdf.h2("Nettovorteil der Varianten")
    pdf.bild(chart_rentabilitaet(res))
    pdf.tabelle(
        ["Variante", "Invest ges.", "Ersparnis €/a", "Amort.", f"Netto {BETRACHTUNG_JAHRE} J.", "Rendite"],
        [[("★ " if v.get("ist_optimum") else "") + _variante_kurz(v),
          _eur(v["invest_gesamt"]), _eur(v["ersparnis_jahr"]),
          _amort_text(v["amortisation"]), _eur(v["netto_20a"]),
          f"{v['rendite'] * 100:.1f} %".replace(".", ",")]
         for v in rent["varianten"]],
        [58, 24, 24, 18, 30, 20],
        highlight_row=next((i for i, v in enumerate(rent["varianten"])
                            if v.get("ist_optimum")), None),
    )

    # ---------------- Seite 5: Maßnahmen + Hinweise ----------------
    pdf.add_page()
    pdf.h1("Sanierungsmaßnahmen und Ersparnis")
    pdf.p("Ersparnis bewertet mit Preis und Wirkungsgrad der Bestandsanlage; Förderung: "
          "15 % BEG-Einzelmaßnahme (Gebäudehülle). Maßnahmen senken zugleich Heizlast und "
          "nötige Vorlauftemperatur – ein gedämmtes Haus macht die Wärmepumpe effizienter.")
    mm = res["massnahmen"]
    pdf.tabelle(
        ["Maßnahme", "Kosten (netto)", "Ersparnis €/a", "Ersparnis kWh/a", "Amortisation"],
        [[m["name"], _eur(m["kosten_netto"]), _eur(m["ersparnis_euro"]),
          f"{m.get('ersparnis_kwh', 0):,.0f}".replace(",", ".") if m.get("ersparnis_kwh") else "–",
          _amort_text(m["amortisation"])]
         for m in mm],
        [72, 26, 26, 28, 24],
    )
    pdf.bild(chart_massnahmen(res))

    pdf.h2("Hinweise und Annahmen")
    pdf.p(
        "• Überschlägige Berechnung nach Hüllflächen- und Gradtagzahlverfahren; Geometrie aus "
        "Wohnfläche und Etagenzahl genähert (quadratischer Grundriss).\n"
        "• Preise, Investitions- und Förderwerte sind Richtwerte (Stand 2026) und regional "
        "unterschiedlich; Förderung nach BEG: 30 % Grundförderung, +20 % Klimageschwindigkeits-"
        "Bonus, +30 % Einkommensbonus (max. 70 %, förderfähige Kosten 30.000 €).\n"
        "• Energiepreissteigerungen: Strom 2 %/a, Gas 4,5 %/a, Öl 5 %/a, Pellets 3 %/a, "
        "Fernwärme 3,5 %/a (inkl. CO₂-Bepreisung).\n"
        "• Die Jahresarbeitszahl der Wärmepumpe wird aus der mittleren Vorlauftemperatur des "
        "Übergabesystems abgeschätzt (Carnot-Ansatz mit Gütegrad).\n"
        "• Für eine verbindliche Auslegung ist eine Heizlastberechnung nach DIN EN 12831 und "
        "eine Energieberatung (z. B. iSFP) erforderlich.", size=8.5)

    return bytes(pdf.output())
