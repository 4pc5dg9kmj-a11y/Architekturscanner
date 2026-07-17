/* Heizungsrechner – Frontend: Formular, Charts (SVG), PDF-Export */
"use strict";

const $ = (sel) => document.querySelector(sel);
const SVGNS = "http://www.w3.org/2000/svg";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SERIEN = () => [css("--s1"), css("--s2"), css("--s3"), css("--s4"),
                      css("--s5"), css("--s6"), css("--s7"), css("--s8")];

const eur = (v) => Math.round(v).toLocaleString("de-DE") + " €";
const zahl = (v, stellen = 0) => Number(v).toLocaleString("de-DE",
  { minimumFractionDigits: stellen, maximumFractionDigits: stellen });

const HEIZART_LABEL = {
  fussbodenheizung: "Fußbodenheizung", wandheizung: "Wandheizung",
  deckenheizung: "Deckenheizung", heizkoerper: "Heizkörper",
  konvektor: "Konvektor", keine: "Unbeheizt",
};

let letztesErgebnis = null;

/* ======================= Räume ======================= */

function raumZeile(name = "", flaeche = "", heizart = "heizkoerper") {
  const tr = document.createElement("tr");
  const arten = Object.entries(HEIZART_LABEL)
    .map(([k, l]) => `<option value="${k}" ${k === heizart ? "selected" : ""}>${l}</option>`)
    .join("");
  tr.innerHTML = `
    <td><input type="text" class="r-name" value="${name}" placeholder="z. B. Wohnzimmer"></td>
    <td><input type="number" class="r-flaeche" value="${flaeche}" min="1" max="500" step="0.5"></td>
    <td><select class="r-heizart">${arten}</select></td>
    <td><button type="button" class="raum-loeschen" title="Raum entfernen">✕</button></td>`;
  tr.querySelector(".raum-loeschen").addEventListener("click", () => {
    tr.remove(); raumSummeAktualisieren();
  });
  tr.querySelector(".r-flaeche").addEventListener("input", raumSummeAktualisieren);
  $("#raum-tabelle tbody").appendChild(tr);
}

function raumSummeAktualisieren() {
  let summe = 0;
  document.querySelectorAll(".r-flaeche").forEach((i) => { summe += Number(i.value) || 0; });
  const wf = Number($("#g-wohnflaeche").value) || 0;
  $("#raum-summe").textContent = summe
    ? `Σ ${zahl(summe)} m² von ${zahl(wf)} m² Wohnfläche`
    : "";
}

function standardRaeume() {
  const wf = Number($("#g-wohnflaeche").value) || 140;
  $("#raum-tabelle tbody").innerHTML = "";
  const vorlage = [
    ["Wohnzimmer", 0.22, "heizkoerper"], ["Küche", 0.10, "heizkoerper"],
    ["Bad", 0.07, "fussbodenheizung"], ["Schlafzimmer", 0.13, "heizkoerper"],
    ["Kinder-/Arbeitszimmer", 0.13, "heizkoerper"], ["Kinder-/Gästezimmer", 0.12, "heizkoerper"],
    ["Flur & Treppe", 0.15, "heizkoerper"], ["Nebenräume", 0.08, "heizkoerper"],
  ];
  vorlage.forEach(([n, anteil, art]) => raumZeile(n, Math.round(wf * anteil), art));
  raumSummeAktualisieren();
}

/* ======================= Eingabe sammeln ======================= */

function eingabeSammeln() {
  const raeume = [...document.querySelectorAll("#raum-tabelle tbody tr")].map((tr) => ({
    name: tr.querySelector(".r-name").value || "Raum",
    flaeche: Number(tr.querySelector(".r-flaeche").value) || 0,
    heizart: tr.querySelector(".r-heizart").value,
  })).filter((r) => r.flaeche > 0);

  return {
    gebaeude: {
      baujahr: Number($("#g-baujahr").value),
      wohnflaeche: Number($("#g-wohnflaeche").value),
      etagen: Number($("#g-etagen").value),
      raumhoehe: Number($("#g-raumhoehe").value),
      personen: Number($("#g-personen").value),
      dachform: $("#g-dachform").value,
      dach_daemmung: $("#g-dach-daemmung").value,
      wand_aufbau: $("#g-wand-aufbau").value,
      wand_daemmung: $("#g-wand-daemmung").value,
      fenster: $("#g-fenster").value,
      keller: $("#g-keller").value,
      keller_daemmung: $("#g-keller-daemmung").value,
    },
    heizung_bestand: {
      art: $("#b-art").value,
      baujahr: Number($("#b-baujahr").value),
    },
    foerderung: {
      klimabonus: $("#f-klimabonus").checked,
      einkommensbonus: $("#f-einkommensbonus").checked,
    },
    raeume,
  };
}

/* ======================= Tooltip ======================= */

const tooltip = $("#tooltip");
function tooltipZeigen(ev, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const b = tooltip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 12;
  if (x + b.width > window.innerWidth - 8) x = ev.clientX - b.width - 14;
  if (y + b.height > window.innerHeight - 8) y = ev.clientY - b.height - 12;
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}
function tooltipVerbergen() { tooltip.hidden = true; }

/* ======================= SVG-Helfer ======================= */

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/* Runde Achsenteilung: liefert {max, step} mit "schönen" Werten. */
function niceScale(maxWert, zielTicks = 4) {
  const roh = maxWert / zielTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(roh)));
  let step = 10 * mag;
  for (const f of [1, 2, 2.5, 5, 10]) {
    if (f * mag >= roh) { step = f * mag; break; }
  }
  return { step, max: Math.ceil(maxWert / step) * step };
}

/* Horizontales Balkendiagramm.
   items: [{label, wert, farbe, note, tooltipHtml}] */
function hBarChart(container, items, { einheit = "", xLabel = "" } = {}) {
  container.innerHTML = "";
  const W = 860, zeilenH = 34, padL = 250, padR = 150, padT = 6;
  const H = padT + items.length * zeilenH + 34;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  container.appendChild(svg);
  const skala = niceScale(Math.max(...items.map((i) => i.wert), 1));
  const max = skala.max;
  const plotW = W - padL - padR;

  // Gitterlinien (recessiv) + X-Ticks auf runden Werten
  for (let v = 0; v <= max + 1e-9; v += skala.step) {
    const x = padL + (plotW * v) / max;
    el("line", { x1: x, y1: padT, x2: x, y2: H - 30, stroke: css("--grid"), "stroke-width": 1 }, svg);
    const label = el("text", {
      x, y: H - 14, "text-anchor": "middle", "font-size": 11, fill: css("--muted"),
    }, svg);
    label.textContent = zahl(v) + (v >= max - 1e-9 && einheit ? " " + einheit : "");
  }
  if (xLabel) {
    const xl = el("text", { x: padL + plotW / 2, y: H - 1, "text-anchor": "middle",
                            "font-size": 11, fill: css("--ink2") }, svg);
    xl.textContent = xLabel;
  }

  items.forEach((it, i) => {
    const y = padT + i * zeilenH;
    const bw = Math.max(2, (it.wert / max) * plotW);
    const barH = 20;
    // Kategorielabel (Text-Token, nie Serienfarbe)
    const lbl = el("text", {
      x: padL - 10, y: y + barH / 2 + 4.5, "text-anchor": "end",
      "font-size": 12.5, fill: css("--ink"),
    }, svg);
    lbl.textContent = it.label.length > 29 ? it.label.slice(0, 28) + "…" : it.label;
    // Balken: 4px gerundetes Datenende, eckig an der Basislinie
    const r = 4;
    const d = `M ${padL} ${y} H ${padL + bw - r} Q ${padL + bw} ${y} ${padL + bw} ${y + r}
               V ${y + barH - r} Q ${padL + bw} ${y + barH} ${padL + bw - r} ${y + barH}
               H ${padL} Z`;
    el("path", { d, fill: it.farbe }, svg);
    // Wert am Balkenende
    const wt = el("text", {
      x: padL + bw + 8, y: y + barH / 2 + 4.5, "font-size": 11.5, fill: css("--ink2"),
    }, svg);
    wt.textContent = it.note || (zahl(it.wert) + (einheit ? " " + einheit : ""));
    // Hover-Ziel (größer als der Balken)
    const hit = el("rect", { x: 0, y: y - 4, width: W, height: zeilenH, fill: "transparent" }, svg);
    if (it.tooltipHtml) {
      hit.addEventListener("mousemove", (ev) => tooltipZeigen(ev, it.tooltipHtml));
      hit.addEventListener("mouseleave", tooltipVerbergen);
    }
  });
  // Basislinie
  el("line", { x1: padL, y1: padT, x2: padL, y2: H - 30,
               stroke: css("--baseline"), "stroke-width": 1 }, svg);
}

/* Liniendiagramm kumulierte Kosten mit Crosshair-Tooltip.
   serien: [{label, farbe, werte[], gestrichelt}] – werte[j] = Jahr j */
function lineChart(container, serien, { yEinheit = "€" } = {}) {
  container.innerHTML = "";
  // Legende (immer vorhanden bei >= 2 Serien)
  const legende = document.createElement("div");
  legende.className = "legende";
  serien.forEach((s) => {
    const e = document.createElement("span");
    e.className = "l-eintrag";
    e.innerHTML = `<span class="l-farbe" style="background:${s.farbe};
      ${s.gestrichelt ? "background:repeating-linear-gradient(90deg," + s.farbe + " 0 4px,transparent 4px 7px);" : ""}"></span>${s.label}`;
    legende.appendChild(e);
  });
  container.appendChild(legende);

  const W = 860, H = 330, padL = 62, padR = 16, padT = 12, padB = 34;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  container.appendChild(svg);
  const n = Math.max(...serien.map((s) => s.werte.length));
  const skala = niceScale(Math.max(...serien.flatMap((s) => s.werte)), 5);
  const maxY = skala.max;
  const x = (j) => padL + ((W - padL - padR) * j) / (n - 1);
  const y = (v) => padT + (H - padT - padB) * (1 - v / maxY);

  // Y-Gitter auf runden Werten
  for (let v = 0; v <= maxY + 1e-9; v += skala.step) {
    el("line", { x1: padL, y1: y(v), x2: W - padR, y2: y(v),
                 stroke: css("--grid"), "stroke-width": 1 }, svg);
    const lb = el("text", { x: padL - 8, y: y(v) + 4, "text-anchor": "end",
                            "font-size": 11, fill: css("--muted") }, svg);
    lb.textContent = v >= 1000 ? zahl(v / 1000) + "k" : zahl(v);
  }
  // X-Ticks (alle 5 Jahre)
  for (let j = 0; j < n; j += 5) {
    const lb = el("text", { x: x(j), y: H - 14, "text-anchor": "middle",
                            "font-size": 11, fill: css("--muted") }, svg);
    lb.textContent = j;
  }
  const xl = el("text", { x: padL + (W - padL - padR) / 2, y: H - 1,
                          "text-anchor": "middle", "font-size": 11, fill: css("--ink2") }, svg);
  xl.textContent = "Jahre ab Einbau";

  // Linien (2px, runde Enden)
  serien.forEach((s) => {
    const d = s.werte.map((v, j) => `${j ? "L" : "M"} ${x(j)} ${y(v)}`).join(" ");
    el("path", {
      d, fill: "none", stroke: s.farbe, "stroke-width": 2,
      "stroke-linecap": "round", "stroke-linejoin": "round",
      ...(s.gestrichelt ? { "stroke-dasharray": "6 5" } : {}),
    }, svg);
  });

  // Crosshair + Tooltip
  const cursor = el("line", { y1: padT, y2: H - padB, stroke: css("--baseline"),
                              "stroke-width": 1, visibility: "hidden" }, svg);
  const punkte = serien.map((s) =>
    el("circle", { r: 4.5, fill: s.farbe, stroke: css("--surface"),
                   "stroke-width": 2, visibility: "hidden" }, svg));
  const hit = el("rect", { x: padL, y: padT, width: W - padL - padR,
                           height: H - padT - padB, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (ev) => {
    const box = svg.getBoundingClientRect();
    const mx = ((ev.clientX - box.left) / box.width) * W;
    const j = Math.max(0, Math.min(n - 1, Math.round(((mx - padL) / (W - padL - padR)) * (n - 1))));
    cursor.setAttribute("x1", x(j)); cursor.setAttribute("x2", x(j));
    cursor.setAttribute("visibility", "visible");
    let html = `<div class="t-titel">Jahr ${j}</div>`;
    serien.forEach((s, i) => {
      const v = s.werte[j];
      punkte[i].setAttribute("cx", x(j));
      punkte[i].setAttribute("cy", y(v));
      punkte[i].setAttribute("visibility", "visible");
      html += `<div class="t-zeile"><span>${s.label}</span><strong>${eur(v)}</strong></div>`;
    });
    tooltipZeigen(ev, html);
  });
  hit.addEventListener("mouseleave", () => {
    cursor.setAttribute("visibility", "hidden");
    punkte.forEach((p) => p.setAttribute("visibility", "hidden"));
    tooltipVerbergen();
  });
}

/* ======================= Ergebnis rendern ======================= */

function kachel(label, wert, einheit) {
  return `<div class="kachel"><div class="k-label">${label}</div>
    <div class="k-wert">${wert}&nbsp;<span class="k-einheit">${einheit}</span></div></div>`;
}

function ergebnisRendern(res) {
  letztesErgebnis = res;
  $("#ergebnis").hidden = false;
  const S = SERIEN();
  const geb = res.gebaeude, emp = res.empfehlung, bestand = res.bestand;

  // Empfehlung
  $("#e-system").textContent = emp.system;
  $("#e-heizart").textContent = emp.heizart;
  $("#e-ersparnis").textContent = eur(emp.ersparnis_jahr_vs_bestand) + "/Jahr";
  $("#e-amortisation").textContent =
    emp.amortisation != null ? "≈ " + emp.amortisation + " Jahre" : "> 20 Jahre";
  $("#e-text").textContent = emp.text;

  // Kennzahlen
  $("#kennzahlen").innerHTML = [
    kachel("Heizlast (Auslegung)", zahl(geb.heizlast_kw, 1), "kW"),
    kachel("Heizwärmebedarf", zahl(geb.heizwaermebedarf), "kWh/a"),
    kachel("Spezifischer Bedarf", zahl(geb.spezifisch), "kWh/m²a"),
    kachel("Beheiztes Volumen", zahl(geb.volumen), "m³"),
    kachel("Gebäudekubatur", zahl(geb.bruttovolumen), "m³"),
    kachel("Wärmehüllfläche", zahl(geb.huellflaeche), "m²"),
    kachel("Mittl. Vorlauftemperatur", zahl(res.vorlauf.vl_mittel), "°C"),
    kachel("Bestand: Kosten", zahl(bestand.kosten_jahr), "€/a"),
  ].join("");

  // Verluste
  hBarChart($("#chart-verluste"),
    geb.verlust_anteile.map((v) => ({
      label: v.bauteil, wert: v.anteil * 100, farbe: S[0],
      note: Math.round(v.anteil * 100) + " %",
      tooltipHtml: `<div class="t-titel">${v.bauteil}</div>
        <div class="t-zeile"><span>Anteil</span><strong>${(v.anteil * 100).toFixed(1)} %</strong></div>
        <div class="t-zeile"><span>Verlustleistung</span><strong>${zahl(v.watt_pro_k, 1)} W/K</strong></div>`,
    })), { xLabel: "Anteil an den Wärmeverlusten (%)" });

  // Vollkosten
  hBarChart($("#chart-vollkosten"),
    res.systeme.map((s) => ({
      label: s.label, wert: s.vollkosten_jahr,
      farbe: s.key === emp.system_key ? css("--good") : S[0],
      note: eur(s.vollkosten_jahr) + "/a",
      tooltipHtml: `<div class="t-titel">${s.label}</div>
        <div class="t-zeile"><span>Effizienz</span><strong>${s.effizienz_text}</strong></div>
        <div class="t-zeile"><span>Energie</span><strong>${eur(s.energiekosten_jahr)}/a</strong></div>
        <div class="t-zeile"><span>Wartung</span><strong>${eur(s.wartung)}/a</strong></div>
        <div class="t-zeile"><span>Invest (nach Förderung)</span><strong>${eur(s.invest_netto)}</strong></div>
        <div class="t-zeile"><span>Vollkosten</span><strong>${eur(s.vollkosten_jahr)}/a</strong></div>`,
    })), { xLabel: "Vollkosten pro Jahr (€)" });

  // Kumulierte Kosten
  const auswahl = res.systeme.filter((s) => s.key !== "strom_direkt").slice(0, 5);
  lineChart($("#chart-kumuliert"), [
    { label: `Bestand: ${bestand.label} (${bestand.baujahr})`, farbe: css("--muted"),
      werte: bestand.kostenverlauf, gestrichelt: true },
    ...auswahl.map((s, i) => ({ label: s.label, farbe: S[i % S.length], werte: s.kostenverlauf })),
  ]);

  // Systemtabelle
  $("#tab-systeme").innerHTML =
    `<thead><tr><th>System</th><th>Effizienz</th><th>Invest</th><th>Förderung</th>
      <th>Energie €/a</th><th>Vollkosten €/a</th><th>Gesamt 20 J.</th><th>CO₂ t/a</th>
      <th>Amortisation</th></tr></thead><tbody>` +
    res.systeme.map((s) => `
      <tr class="${s.key === emp.system_key ? "best" : ""}">
        <td>${s.label}</td><td>${s.effizienz_text}</td><td>${eur(s.invest)}</td>
        <td>${s.foerderung ? eur(s.foerderung) + " (" + Math.round(s.foerdersatz * 100) + " %)" : "–"}</td>
        <td>${eur(s.energiekosten_jahr)}</td><td>${eur(s.vollkosten_jahr)}</td>
        <td>${eur(s.gesamt_20a)}</td><td>${zahl(s.co2_jahr, 1)}</td>
        <td>${s.amortisation != null ? "≈ " + s.amortisation + " J." : "> 20 J."}</td>
      </tr>`).join("") + "</tbody>";

  // Heizarten-Tabelle
  const besteHa = res.heizarten.reduce((a, b) => (b.bestes_gesamt_20a < a.bestes_gesamt_20a ? b : a));
  $("#tab-heizarten").innerHTML =
    `<thead><tr><th>Szenario</th><th>Mittl. Vorlauf</th><th>JAZ Luft-WP</th>
      <th>WP-Kosten €/a</th><th>Bestes System</th><th>Gesamt 20 J.</th></tr></thead><tbody>` +
    res.heizarten.map((h) => `
      <tr class="${h.key === besteHa.key ? "best" : ""}">
        <td>${h.label}</td><td>${zahl(h.vl_mittel)} °C</td><td>${zahl(h.wp_jaz, 1)}</td>
        <td>${eur(h.wp_kosten_jahr)}</td><td>${h.bestes_system}</td>
        <td>${eur(h.bestes_gesamt_20a)}</td>
      </tr>`).join("") + "</tbody>";

  // CO2
  const co2Items = [...res.systeme.map((s) => ({
      label: s.label, wert: s.co2_jahr, farbe: S[0], note: zahl(s.co2_jahr, 1) + " t",
      tooltipHtml: `<div class="t-titel">${s.label}</div>
        <div class="t-zeile"><span>CO₂ pro Jahr</span><strong>${zahl(s.co2_jahr, 1)} t</strong></div>
        <div class="t-zeile"><span>CO₂ über 20 Jahre</span><strong>${zahl(s.co2_20a, 1)} t</strong></div>`,
    })),
    { label: `Bestand (${bestand.label})`, wert: bestand.co2_jahr, farbe: css("--muted"),
      note: zahl(bestand.co2_jahr, 1) + " t",
      tooltipHtml: `<div class="t-titel">Bestand: ${bestand.label}</div>
        <div class="t-zeile"><span>CO₂ pro Jahr</span><strong>${zahl(bestand.co2_jahr, 1)} t</strong></div>` },
  ].sort((a, b) => a.wert - b.wert);
  hBarChart($("#chart-co2"), co2Items, { xLabel: "CO₂-Ausstoß pro Jahr (t)" });

  // Maßnahmen
  const mm = res.massnahmen.filter((m) => m.ersparnis_euro > 0);
  hBarChart($("#chart-massnahmen"),
    mm.map((m) => ({
      label: m.name, wert: m.ersparnis_euro, farbe: S[4],
      note: eur(m.ersparnis_euro) + "/a" +
        (m.amortisation != null ? " · amort. " + zahl(m.amortisation) + " J." : ""),
      tooltipHtml: `<div class="t-titel">${m.name}</div>
        <div class="t-zeile"><span>Kosten (netto)</span><strong>${eur(m.kosten_netto)}</strong></div>
        <div class="t-zeile"><span>Ersparnis</span><strong>${eur(m.ersparnis_euro)}/a</strong></div>
        ${m.ersparnis_kwh ? `<div class="t-zeile"><span>Energieersparnis</span><strong>${zahl(m.ersparnis_kwh)} kWh/a</strong></div>` : ""}
        <div class="t-zeile"><span>Amortisation</span><strong>${m.amortisation != null ? zahl(m.amortisation, 1) + " Jahre" : "> 20 Jahre"}</strong></div>
        ${m.hinweis ? `<div style="margin-top:4px;color:var(--muted)">${m.hinweis}</div>` : ""}`,
    })), { xLabel: "Jährliche Ersparnis (€)" });

  $("#tab-massnahmen").innerHTML =
    `<thead><tr><th>Maßnahme</th><th>Kosten</th><th>Förderung</th><th>netto</th>
      <th>Ersparnis €/a</th><th>Ersparnis kWh/a</th><th>Amortisation</th></tr></thead><tbody>` +
    res.massnahmen.map((m) => `
      <tr><td>${m.name}</td><td>${eur(m.kosten)}</td>
        <td>${m.foerderung ? eur(m.foerderung) : "–"}</td><td>${eur(m.kosten_netto)}</td>
        <td>${eur(m.ersparnis_euro)}</td>
        <td>${m.ersparnis_kwh ? zahl(m.ersparnis_kwh) : "–"}</td>
        <td>${m.amortisation != null ? zahl(m.amortisation, 1) + " J." : "> 20 J."}</td>
      </tr>`).join("") + "</tbody>";
}

/* ======================= Aktionen ======================= */

async function berechnen() {
  const eingabe = eingabeSammeln();
  localStorage.setItem("heizungsrechner", JSON.stringify(eingabe));
  $("#status").textContent = "Berechne …";
  $("#btn-berechnen").disabled = true;
  try {
    const antwort = await fetch("/api/heizung/berechnen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eingabe),
    });
    const res = await antwort.json();
    if (!antwort.ok || res.error) throw new Error(res.error || antwort.statusText);
    ergebnisRendern(res);
    $("#btn-pdf").disabled = false;
    $("#status").textContent = "";
    $("#ergebnis").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    $("#status").textContent = "Fehler: " + e.message;
  } finally {
    $("#btn-berechnen").disabled = false;
  }
}

async function pdfLaden() {
  const eingabe = eingabeSammeln();
  $("#status").textContent = "Erzeuge PDF-Bericht …";
  $("#btn-pdf").disabled = true;
  try {
    const antwort = await fetch("/api/heizung/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eingabe),
    });
    if (!antwort.ok) {
      const res = await antwort.json().catch(() => ({}));
      throw new Error(res.error || antwort.statusText);
    }
    const blob = await antwort.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "heizungsbericht.pdf";
    a.click();
    URL.revokeObjectURL(url);
    $("#status").textContent = "";
  } catch (e) {
    $("#status").textContent = "Fehler: " + e.message;
  } finally {
    $("#btn-pdf").disabled = false;
  }
}

/* ======================= Init ======================= */

function wiederherstellen() {
  let daten = null;
  try { daten = JSON.parse(localStorage.getItem("heizungsrechner")); } catch { /* leer */ }
  if (!daten) { standardRaeume(); return; }
  const g = daten.gebaeude || {}, b = daten.heizung_bestand || {}, f = daten.foerderung || {};
  const setze = (id, wert) => { if (wert != null && $(id)) $(id).value = wert; };
  setze("#g-baujahr", g.baujahr); setze("#g-wohnflaeche", g.wohnflaeche);
  setze("#g-etagen", g.etagen); setze("#g-raumhoehe", g.raumhoehe);
  setze("#g-personen", g.personen); setze("#g-dachform", g.dachform);
  setze("#g-dach-daemmung", g.dach_daemmung); setze("#g-wand-aufbau", g.wand_aufbau);
  setze("#g-wand-daemmung", g.wand_daemmung); setze("#g-fenster", g.fenster);
  setze("#g-keller", g.keller); setze("#g-keller-daemmung", g.keller_daemmung);
  setze("#b-art", b.art); setze("#b-baujahr", b.baujahr);
  if (f.klimabonus != null) $("#f-klimabonus").checked = f.klimabonus;
  if (f.einkommensbonus != null) $("#f-einkommensbonus").checked = f.einkommensbonus;
  if (daten.raeume && daten.raeume.length) {
    daten.raeume.forEach((r) => raumZeile(r.name, r.flaeche, r.heizart));
    raumSummeAktualisieren();
  } else {
    standardRaeume();
  }
}

$("#formular").addEventListener("submit", (ev) => { ev.preventDefault(); berechnen(); });
$("#btn-pdf").addEventListener("click", pdfLaden);
$("#raum-plus").addEventListener("click", () => raumZeile());
$("#raum-standard").addEventListener("click", standardRaeume);
$("#g-wohnflaeche").addEventListener("input", raumSummeAktualisieren);

// Bei Theme-Wechsel Charts neu zeichnen (Farben kommen aus CSS-Variablen)
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (letztesErgebnis) ergebnisRendern(letztesErgebnis);
});

wiederherstellen();
