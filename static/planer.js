/* Fahrradhäuschen-Planer – Steuerung, 3D-Ansicht, Zeichnungen, Listen.
   Ohne Build-Schritt und ohne Fremdbibliotheken. */
(() => {
"use strict";

const $ = (s) => document.querySelector(s);
const fmt = (n, d = 0) => Number(n).toLocaleString("de-DE",
  { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (n) => fmt(Math.round(n)) + " €";
const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Der Server liefert bereits korrektes Deutsch (siehe shed/text.py). */
const de = (s) => (s == null ? "" : String(s));

/* ------------------------------------------------------------------ Zustand */

const DEF = {
  n_bikes: 6, tool_width: 1500, depth: 2350, eaves_height: 2100, roof_pitch: 10,
  closure: "closed_double", roofing: "trapez", foundation: "slabs",
  cladding: "rhombus", snow_zone: "2", altitude: 250, site: "innenbereich",
  with_gutter: true, with_floor: true, with_workbench: false, tool_shelves: 2,
  price_level: "mittel",
};
let spec = { ...DEF };
let data = null;
/* Laufende Nummer der Anfragen: eine verspätete Antwort darf eine neuere
   nicht überschreiben – sonst zeigt die Oberfläche einen älteren Stand. */
let reqSeq = 0;
let shownSeq = -1;

const CTRL = [
  ["s-bikes", "n_bikes", "int"], ["s-tool", "tool_width", "num"],
  ["s-depth", "depth", "num"], ["s-eaves", "eaves_height", "num"],
  ["s-pitch", "roof_pitch", "num"],
  ["f-closure", "closure", "str"], ["f-roofing", "roofing", "str"],
  ["f-foundation", "foundation", "str"], ["f-cladding", "cladding", "str"],
  ["f-site", "site", "str"], ["f-snow", "snow_zone", "str"],
  ["f-price", "price_level", "str"],
  ["n-alt", "altitude", "num"], ["n-shelves", "tool_shelves", "int"],
  ["c-gutter", "with_gutter", "bool"], ["c-floor", "with_floor", "bool"],
  ["c-bench", "with_workbench", "bool"],
];

function writeControls() {
  for (const [id, key, kind] of CTRL) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (kind === "bool") el.checked = !!spec[key];
    else el.value = spec[key];
  }
  $("#o-bikes").textContent = spec.n_bikes + (spec.n_bikes === 1 ? " Rad" : " Räder");
  $("#o-tool").textContent = spec.tool_width >= 600
    ? fmt(spec.tool_width / 1000, 2) + " m" : "keiner";
  $("#o-depth").textContent = fmt(spec.depth / 1000, 2) + " m";
  $("#o-eaves").textContent = fmt(spec.eaves_height) + " mm";
  $("#o-pitch").textContent = spec.roof_pitch + "°";
  $("#h-pitch").textContent = spec.roof_pitch < 8
    ? "Unter 8° ist Trapezblech nur mit Dichtband im Stoß sicher dicht."
    : spec.roof_pitch > 15
      ? "Steiler heißt höhere Grenzwand – das kostet Rauminhalt."
      : "Guter Bereich für Trapezblech auf einem Pultdach.";
  $("#h-depth").textContent = spec.depth < 2270
    ? "Zu flach: ein Fahrrad braucht rund 1,90 m plus Bewegungsraum."
    : "Lichte Tiefe innen: " + fmt(spec.depth - 220) + " mm.";
}

function readControls() {
  for (const [id, key, kind] of CTRL) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (kind === "bool") spec[key] = el.checked;
    else if (kind === "int") spec[key] = parseInt(el.value, 10) || 0;
    else if (kind === "num") spec[key] = parseFloat(el.value) || 0;
    else spec[key] = el.value;
  }
}

/* ------------------------------------------------------------- Serverabruf */

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r;
}

let timer = null;
function schedule(delay = 180) {
  clearTimeout(timer);
  timer = setTimeout(recompute, delay);
}

async function request(url, adoptSpec) {
  const seq = ++reqSeq;
  try {
    const r = await post(url, spec);
    const j = await r.json();
    if (j.error) { alert(j.error); return; }
    if (seq < shownSeq) return;          // eine neuere Antwort ist schon da
    shownSeq = seq;
    data = j;
    spec = { ...spec, ...j.spec };
    if (adoptSpec) writeControls();
    render();
  } catch (e) {
    console.error(e);
  }
}

function recompute() {
  return request("/api/shed/plan", false);
}

async function runOptimize() {
  clearTimeout(timer);                   // geplante Neuberechnung verwerfen
  $("#busy").classList.add("on");
  try {
    await request("/api/shed/optimize", true);
  } finally {
    $("#busy").classList.remove("on");
  }
}

async function download(url, name) {
  $("#busy").classList.add("on");
  try {
    const r = await post(url, spec);
    if (!r.ok) { alert("Export fehlgeschlagen."); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } finally {
    $("#busy").classList.remove("on");
  }
}

/* ---------------------------------------------------------------- Seitenleiste */

function renderSide() {
  const k = data.kpi, s = data.summary;
  const v = $("#verdict");
  v.className = "verdict " + s.state;
  v.querySelector(".txt").textContent =
    { ok: "Verfahrensfrei und an der Grenze zulässig",
      warn: "Zulässig – Hinweise beachten",
      fail: "So nicht zulässig" }[s.state] || de(s.text);

  const gauge = (lbl, val, max, unit, dec) => {
    const pct = Math.min(100, val / max * 100);
    const cls = val > max ? "fail" : pct > 92 ? "warn" : "";
    return `<div class="gauge ${cls}">
      <div class="lbl"><span>${lbl}</span>
        <span><b>${fmt(val, dec)}</b> / ${fmt(max, dec)} ${unit}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  };
  $("#gauges").innerHTML =
    gauge("Brutto-Rauminhalt (§ 63 HBO)", k.bri, 30, "m³", 2) +
    gauge("Höhe an der Grenze (§ 6 HBO)", k.grenzhoehe / 1000, 3, "m", 2) +
    gauge("Länge an der Grenze (§ 6 HBO)", k.grenzlaenge / 1000, 15, "m", 2);

  $("#h-bikes").textContent = k.max_bikes > 0
    ? `Bei diesen Maßen sind maximal ${k.max_bikes} Plätze verfahrensfrei möglich.`
    : "Maße reduzieren – so bleibt kein Platz übrig.";
  $("#h-roofing").textContent = {
    trapez: "Leicht, günstig, ab 8° dicht. Beste Wahl für dieses Pultdach.",
    shingle: "Braucht durchgehende Schalung und mindestens 15° Neigung.",
    epdm: "Fugenlos, auch bei sehr geringer Neigung dicht.",
    green: "Schwer – die Sparren werden automatisch stärker dimensioniert.",
  }[spec.roofing] || "";

  const c = data.cost, w = data.weight;
  $("#costbox").innerHTML = `
    <div class="row"><span>Holz (${fmt(c.holz_lfm, 0)} lfm)</span><b>${eur(c.holz)}</b></div>
    <div class="row"><span>Schrauben und Verbinder</span><b>${eur(c.verbindungsmittel)}</b></div>
    <div class="row"><span>Übriges Material</span><b>${eur(c.material)}</b></div>
    <div class="row total"><span>Material gesamt</span><b>${eur(c.gesamt)}</b></div>
    <div class="note">
      ${spec.n_bikes > 0 ? eur(c.pro_stellplatz) + " je Stellplatz · " : ""}
      Verschnitt ${fmt(c.verschnitt_pct, 0)} % ·
      Eigenlast ${fmt(w.eigenlast_kg)} kg auf ${w.auflager} Auflagern<br>
      Sparren ${k.sparren} mm, Ausnutzung ${fmt(k.sparren_eta, 2)} ·
      Richtpreise, ohne Werkzeug
    </div>`;
}

/* ------------------------------------------------------------------- 3D */

const FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
               [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
const cam = { yaw: 2.42, pitch: 0.52, dist: 2.1, panx: 0, pany: 0 };
let hidden = new Set();
let lastFaces = [];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function draw3d() {
  const cv = $("#c3d"), m = data.model3d;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#f7fafc"); grd.addColorStop(1, "#e7ecf1");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);

  const cx = m.center, size = m.size;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const zoom = Math.min(W, H) / (size * cam.dist);
  const ox = W / 2 + cam.panx, oy = H / 2 + cam.pany + H * 0.08;

  const proj = (p) => {
    const x = p[0] - cx[0], y = p[1] - cx[1], z = p[2] - cx[2];
    const xr = x * cy - y * sy;
    const yr = x * sy + y * cy;
    const yz = yr * sp + z * cp;
    const depth = yr * cp - z * sp;
    return [ox + xr * zoom, oy - yz * zoom, depth];
  };

  // Bodenraster, quadratisch um das Gebäude gelegt
  const st = 500;
  const gx0 = Math.floor((cx[0] - size) / st) * st;
  const gx1 = Math.ceil((cx[0] + size) / st) * st;
  const gy0 = 0;                                    // an der Grenze abschneiden
  const gy1 = Math.ceil((cx[1] * 2 + size * 0.6) / st) * st;
  g.strokeStyle = "#d3dae1"; g.lineWidth = 1;
  g.beginPath();
  for (let v = gx0; v <= gx1; v += st) {
    const a = proj([v, gy0, 0]), b = proj([v, gy1, 0]);
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
  }
  for (let v = gy0; v <= gy1; v += st) {
    const a = proj([gx0, v, 0]), b = proj([gx1, v, 0]);
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
  }
  g.stroke();

  // Grundstücksgrenze bei y = 0
  const ga = proj([gx0, 0, 0]), gb = proj([gx1, 0, 0]);
  g.strokeStyle = "#c0392b"; g.lineWidth = 2; g.setLineDash([9, 5]);
  g.beginPath(); g.moveTo(ga[0], ga[1]); g.lineTo(gb[0], gb[1]); g.stroke();
  g.setLineDash([]);
  g.fillStyle = "#c0392b"; g.font = "600 11px sans-serif";
  g.fillText("GRUNDSTÜCKSGRENZE", Math.min(gb[0], W - 150), gb[1] - 8);

  // Flächen sammeln
  const L = [0.42, -0.68, 0.60];
  const faces = [];
  for (const s of m.solids) {
    if (hidden.has(s.g)) continue;
    const polys = s.kind === "poly" ? [s.v.map((_, i) => i)] : FACES;
    for (const f of polys) {
      const p = f.map((i) => s.v[i]);
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2],
               u[0] * w[1] - u[1] * w[0]];
      const ln = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / ln, n[1] / ln, n[2] / ln];
      const lam = Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      const pr = p.map(proj);
      let dep = 0; for (const q of pr) dep += q[2];
      faces.push({ pr, dep: dep / pr.length, c: shade(s.c, 0.55 + 0.55 * lam), s });
    }
  }
  faces.sort((a, b) => b.dep - a.dep);
  // Die Dachhaut liegt über allem und wird immer von oben gesehen. Der
  // Maleralgorithmus sortiert nur nach Schwerpunkt-Tiefe und würde eine große
  // Fläche sonst hinter kleinen Bauteilen einsortieren, die darunter liegen.
  const skin = faces.filter((f) => f.s.g === "Dachhaut");
  if (skin.length) {
    lastFaces = faces.filter((f) => f.s.g !== "Dachhaut").concat(skin);
  } else {
    lastFaces = faces;
  }
  faces.length = 0;
  faces.push(...lastFaces);

  g.lineJoin = "round";
  for (const f of faces) {
    g.beginPath();
    g.moveTo(f.pr[0][0], f.pr[0][1]);
    for (let i = 1; i < f.pr.length; i++) g.lineTo(f.pr[i][0], f.pr[i][1]);
    g.closePath();
    g.fillStyle = f.c; g.fill();
    g.strokeStyle = "rgba(0,0,0,.22)"; g.lineWidth = 0.6; g.stroke();
  }

  // Maßangaben als Overlay
  const k = data.kpi;
  g.fillStyle = "#1a1d21"; g.font = "600 12px sans-serif";
  g.fillText(`${fmt(k.laenge / 1000, 2)} m × ${fmt(k.tiefe / 1000, 2)} m · ` +
    `${fmt(k.bri, 2)} m³ · Grenzwand ${fmt(k.grenzhoehe / 1000, 2)} m`, 14, H - 32);
}

function renderLegend() {
  const el = $("#legend3d");
  el.innerHTML = data.model3d.layers.map((g) => {
    const s = data.model3d.solids.find((x) => x.g === g);
    if (!s) return "";
    return `<label><input type="checkbox" data-g="${esc(g)}"
      ${hidden.has(g) ? "" : "checked"}>
      <i style="background:${s.c}"></i>${de(g)}</label>`;
  }).join("");
  el.querySelectorAll("input").forEach((i) => i.onchange = () => {
    const g = i.dataset.g;
    if (i.checked) hidden.delete(g); else hidden.add(g);
    draw3d();
  });
}

function bind3d() {
  const cv = $("#c3d");
  let drag = null;
  cv.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.shift) { cam.panx += dx; cam.pany += dy; }
      else {
        cam.yaw += dx * 0.008;
        cam.pitch = Math.max(-0.2, Math.min(1.45, cam.pitch + dy * 0.006));
      }
      draw3d();
      return;
    }
    hover3d(e);
  });
  const stop = () => { drag = null; };
  cv.addEventListener("pointerup", stop);
  cv.addEventListener("pointercancel", stop);
  cv.addEventListener("pointerleave", () => { stop(); $("#tip3d").style.display = "none"; });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.dist = Math.max(0.7, Math.min(6, cam.dist * (e.deltaY > 0 ? 1.1 : 0.91)));
    draw3d();
  }, { passive: false });

  document.querySelectorAll(".viewcube button").forEach((b) => b.onclick = () => {
    const v = b.dataset.view;
    const P = { iso: [2.42, 0.52], front: [Math.PI, 0.06], rear: [0, 0.06],
                side: [Math.PI / 2, 0.06], top: [Math.PI, 1.44] }[v];
    cam.yaw = P[0]; cam.pitch = P[1]; cam.panx = 0; cam.pany = 0;
    draw3d();
  });
}

function hover3d(e) {
  const cv = $("#c3d"), r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  for (let i = lastFaces.length - 1; i >= 0; i--) {
    if (inPoly(x, y, lastFaces[i].pr)) {
      const s = lastFaces[i].s;
      const t = $("#tip3d");
      t.innerHTML = `<b>${esc(de(s.n))}</b><br>${esc(s.p)} mm` +
        (s.l ? ` · Länge ${fmt(s.l)} mm` : "");
      t.style.display = "block";
      t.style.left = (x + 14) + "px";
      t.style.top = (y + 14) + "px";
      return;
    }
  }
  $("#tip3d").style.display = "none";
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------- 2D */

const view2 = { zoom: 1, x: 0, y: 0, key: null, fit: true };

function renderDrawSelect() {
  const sel = $("#sel-draw");
  const cur = view2.key;
  sel.innerHTML = data.drawings.map((d, i) =>
    `<option value="${d.key}">${i + 1}. ${esc(de(d.title))}</option>`).join("");
  if (cur && data.drawings.some((d) => d.key === cur)) sel.value = cur;
  else view2.key = data.drawings[0].key;
  sel.onchange = () => { view2.key = sel.value; view2.fit = true; draw2d(); };
}

function currentDrawing() {
  return data.drawings.find((d) => d.key === view2.key) || data.drawings[0];
}

function fit2d() {
  const cv = $("#c2d"), d = currentDrawing();
  const [x0, y0, x1, y1] = d.bounds;
  const W = cv.clientWidth, H = cv.clientHeight;
  const z = Math.min(W / Math.max(x1 - x0, 1), H / Math.max(y1 - y0, 1)) * 0.88;
  view2.zoom = z;
  view2.x = W / 2 - (x0 + x1) / 2 * z;
  view2.y = H / 2 + (y0 + y1) / 2 * z;
  view2.fit = false;
}

function draw2d() {
  if (!data) return;
  const cv = $("#c2d"), d = currentDrawing();
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr;
  if (view2.fit) fit2d();
  $("#draw-sub").textContent = de(d.subtitle) + "  ·  M 1:" + d.scale;

  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const z = view2.zoom;
  const P = (p) => [view2.x + p[0] * z, view2.y - p[1] * z];

  for (const e of d.ents) {
    const L = data.layers[e.layer] || { width: 0.25, color: "#333", style: "solid" };
    g.strokeStyle = L.color; g.fillStyle = L.color;
    g.lineWidth = Math.max(0.6, L.width * d.scale * z);
    g.setLineDash(L.style === "dash" ? [6 * z * d.scale * 0.08, 4 * z * d.scale * 0.08]
      : L.style === "dashdot" ? [10 * z * d.scale * 0.08, 4 * z * d.scale * 0.08,
                                 2 * z * d.scale * 0.08, 4 * z * d.scale * 0.08] : []);

    if (e.kind === "line" || e.kind === "poly") {
      const pts = e.pts.map(P);
      if (pts.length < 2) continue;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      if (e.closed) g.closePath();
      g.stroke();
    } else if (e.kind === "circle") {
      const c = P(e.pts[0]);
      g.beginPath(); g.arc(c[0], c[1], e.pts[1][0] * z, 0, Math.PI * 2); g.stroke();
    } else if (e.kind === "hatch") {
      hatch2d(g, P(e.pts[0]), P(e.pts[1]));
    } else if (e.kind === "text") {
      const c = P(e.pts[0]);
      const px = Math.max(6, e.size * d.scale * z * 0.85);
      g.save(); g.translate(c[0], c[1]);
      if (e.angle) g.rotate(-e.angle * Math.PI / 180);
      g.font = px + "px sans-serif";
      g.textAlign = e.align === "left" ? "left" : e.align === "right" ? "right" : "center";
      g.setLineDash([]);
      de(e.text).split("\n").forEach((ln, i) => g.fillText(ln, 0, i * px * 1.15));
      g.restore();
    } else if (e.kind === "dim") {
      dim2d(g, P(e.pts[0]), P(e.pts[1]), e.text, d.scale * z);
    }
  }
  g.setLineDash([]);
}

function hatch2d(g, a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 1.5 || y1 - y0 < 1.5) return;
  g.save();
  g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
  g.setLineDash([]); g.lineWidth = 0.5; g.globalAlpha = 0.55;
  const h = y1 - y0, step = 6;
  g.beginPath();
  for (let s = x0 - h; s < x1 + h; s += step) { g.moveTo(s, y1); g.lineTo(s + h, y0); }
  g.stroke();
  g.restore();
}

function dim2d(g, a, b, label, sc) {
  g.setLineDash([]);
  g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  for (const p of [a, b]) {
    g.save(); g.translate(p[0], p[1]); g.rotate(ang + Math.PI / 4);
    g.beginPath(); g.moveTo(-4, 0); g.lineTo(4, 0); g.stroke(); g.restore();
  }
  let t = ang;
  if (t > Math.PI / 2 || t < -Math.PI / 2) t += Math.PI;
  g.save();
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  g.rotate(t);
  g.font = "600 " + Math.max(8, Math.min(14, sc * 0.09)) + "px sans-serif";
  g.textAlign = "center";
  g.fillText(label, 0, -4);
  g.restore();
}

function bind2d() {
  const cv = $("#c2d");
  let drag = null;
  cv.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    view2.x += e.clientX - drag.x; view2.y += e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    draw2d();
  });
  const stop = () => { drag = null; };
  cv.addEventListener("pointerup", stop);
  cv.addEventListener("pointerleave", stop);
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = e.deltaY > 0 ? 0.9 : 1.111;
    view2.x = mx - (mx - view2.x) * f;
    view2.y = my - (my - view2.y) * f;
    view2.zoom *= f;
    draw2d();
  }, { passive: false });
  $("#btn-fit").onclick = () => { view2.fit = true; draw2d(); };
}

/* -------------------------------------------------------------- Listen */

function renderHolz() {
  const t = data.timber;
  const rows = t.map((l) => `<tr>
    <td><b>${l.profile} mm</b></td><td>${esc(de(l.material))}</td>
    <td>${l.buy.map((b) => `${b.n} × ${fmt(b.len / 1000, 2)} m`).join("<br>")}</td>
    <td class="num">${fmt(l.bought_m, 1)}</td>
    <td class="num">${fmt(l.waste, 0)} %</td>
    <td class="num">${eur(l.cost)}</td></tr>`).join("");

  const cuts = t.map((l) => `<h3>${l.profile} mm – ${esc(de(l.material))}</h3>
    <table><thead><tr><th>Stange</th><th>Zuschnitt</th><th class="num">Rest</th>
    <th>Belegung</th></tr></thead><tbody>` +
    l.bars.map((b, i) => {
      const tot = b.len;
      const segs = b.cuts.map((c) =>
        `<span style="width:${c.l / tot * 100}%" title="${esc(de(c.n))}">${c.l}</span>`).join("") +
        (b.rest > 20 ? `<span class="rest" style="width:${b.rest / tot * 100}%">${b.rest}</span>` : "");
      return `<tr><td>#${i + 1} · ${fmt(b.len / 1000, 2)} m</td>
        <td><div class="bararea">${segs}</div></td>
        <td class="num">${fmt(b.rest)} mm</td>
        <td class="cutbar">${esc(de([...new Set(b.cuts.map((c) => c.n.split(":").pop().trim()))].join(", ")))}</td></tr>`;
    }).join("") + "</tbody></table>").join("");

  $("#vholz").innerHTML = `<h2>Holzliste und Zuschnitt</h2>
    <p class="lead">Alle Querschnitte sind Standardware aus dem Baustoffhandel.
    Die Handelslängen sind so kombiniert, dass möglichst wenig Verschnitt
    entsteht – der Zuschnittplan zeigt jede einzelne Stange.</p>
    <table><thead><tr><th>Querschnitt</th><th>Material</th><th>Einkauf</th>
    <th class="num">lfm</th><th class="num">Verschnitt</th><th class="num">Kosten</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="callout"><b>Vor dem Zuschnitt</b>
    Jede Stange auf Krummschaft prüfen und die Aufwölbung nach oben einbauen.
    Zwischen zwei Stücken sind 5 mm Sägeblattbreite eingerechnet. Zuerst die
    langen Stücke schneiden – aus einem Fehlschnitt am Anfang wird sonst ein
    zweiter Einkauf.</div>
    <h2 style="margin-top:26px">Zuschnittplan</h2>${cuts}`;
}

function renderMat() {
  const grp = (items) => {
    const g = {};
    items.forEach((i) => (g[i.group] = g[i.group] || []).push(i));
    return g;
  };
  const tbl = (items) => `<table><thead><tr><th>Bezeichnung</th>
    <th class="num">Menge</th><th>Einheit</th><th>Hinweis</th><th class="num">Kosten</th>
    </tr></thead><tbody>` + items.map((i) => `<tr>
      <td>${esc(de(i.name))}</td><td class="num">${fmt(i.qty, i.qty % 1 ? 1 : 0)}</td>
      <td>${esc(i.unit)}</td><td class="muted">${esc(de(i.note))}</td>
      <td class="num">${i.cost ? eur(i.cost) : "–"}</td></tr>`).join("") + "</tbody></table>";

  const fg = grp(data.fasteners), mg = grp(data.materials);
  let html = `<h2>Schrauben, Verbinder und Werkstoffe</h2>
    <p class="lead">Mengen sind aus der tatsächlichen Bauteilzahl gerechnet und
    auf handelsübliche Gebinde aufgerundet.</p>`;
  for (const k in fg) html += `<h3>${esc(de(k))}</h3>${tbl(fg[k])}`;
  for (const k in mg) html += `<h3>${esc(de(k))}</h3>${tbl(mg[k])}`;
  html += `<h3>Werkzeug</h3><ul>${data.tools.map((t) =>
    `<li>${esc(de(t))}</li>`).join("")}</ul>`;
  $("#vmat").innerHTML = html;
}

function renderBau() {
  const steps = data.steps.map((s) => `<div class="step">
    <h4>Schritt ${s.no}: ${esc(de(s.title))}</h4>
    <div class="meta">${esc(de(s.duration))} · ${s.people} Person(en) ·
      ${esc(de(s.tools.join(", ")))}</div>
    <ul>${s.body.map((p) => `<li>${esc(de(p))}</li>`).join("")}</ul>
    ${s.checks.length ? `<div class="checks"><b>Kontrolle vor dem nächsten Schritt</b>
      ${s.checks.map((c) => "☐ " + esc(de(c))).join("<br>")}</div>` : ""}
  </div>`).join("");

  $("#vbau").innerHTML = `<h2>Bauanleitung</h2>
    <p class="lead">Die Reihenfolge ist bindend. Besonders die Regel, die
    Grenzwand samt Fassade und Anstrich zuerst fertigzustellen – danach ist
    dort kein Arbeitsraum mehr.</p>
    <div class="callout"><b>Vor dem ersten Spatenstich</b>
      ${data.notes.map((n) => "• " + esc(de(n))).join("<br>")}</div>
    ${steps}
    <h3>Wartung</h3><ul>${data.maintenance.map((m) =>
      `<li>${esc(de(m))}</li>`).join("")}</ul>`;
}

function renderHbo() {
  const k = data.kpi, sc = data.sparren_check;
  const cards = [
    ["Brutto-Rauminhalt", fmt(k.bri, 2) + " m³", "zulässig 30,00 m³ · § 63 HBO"],
    ["Höhe an der Grenze", fmt(k.grenzhoehe / 1000, 2) + " m", "zulässig 3,00 m · § 6 HBO"],
    ["Länge an der Grenze", fmt(k.grenzlaenge / 1000, 2) + " m", "zulässig 15,00 m · § 6 HBO"],
    ["Grundfläche", fmt(k.grundflaeche, 2) + " m²", `${fmt(k.laenge / 1000, 2)} × ${fmt(k.tiefe / 1000, 2)} m`],
    ["Lichte Höhe", fmt(k.lichte_vorn) + " / " + fmt(k.lichte_hinten) + " mm", "vorn / hinten"],
    ["Geräteraum", k.geraetflaeche ? fmt(k.geraetflaeche, 2) + " m²" : "keiner", "abgetrennt mit eigener Tür"],
    ["Dachfläche", fmt(k.dachflaeche, 2) + " m²", "inklusive Überstand"],
    ["Sparren", k.sparren + " mm", `Ausnutzung ${fmt(k.sparren_eta, 2)} · e = 625 mm`],
  ].map(([a, b, c]) => `<div class="card"><div class="k">${a}</div>
    <div class="v">${b}</div><div class="s">${c}</div></div>`).join("");

  const checks = data.checks.map((c) => `<div class="chk ${c.status}">
    <div class="h"><b>${esc(de(c.title))}</b>
      <span class="val">${esc(de(c.value))} · Grenzwert ${esc(de(c.limit))}</span></div>
    <div class="law">${esc(c.law)}</div>
    <p>${esc(de(c.hint))}</p></div>`).join("");

  $("#vhbo").innerHTML = `<h2>Prüfung nach Hessischer Bauordnung</h2>
    <p class="lead">Geprüft wird die grenzständige Errichtung eines Nebengebäudes
    ohne Aufenthaltsräume. Das Pultdach fällt bewusst von der Grenze weg, damit
    kein Niederschlagswasser auf das Nachbargrundstück läuft.</p>
    <div class="cards">${cards}</div>
    <h3>Einzelnachweise</h3>${checks}
    <h3>Lastannahmen</h3>
    <p>Schneelastzone ${spec.snow_zone}, ${fmt(spec.altitude)} m über NN,
    charakteristische Schneelast s<sub>k</sub> = ${fmt(sc.s_k, 2)} kN/m².
    Sparren ${k.sparren} mm C24, Stützweite ${fmt(sc.span_m, 2)} m,
    Achsabstand ${fmt(sc.spacing_m, 3)} m.
    Biegespannung ${fmt(sc.sigma, 1)} N/mm² gegen ${fmt(sc.f_m_d, 1)} N/mm² zulässig
    (Ausnutzung ${fmt(sc.eta_m, 2)}), Durchbiegung ${fmt(sc.w_inst, 1)} mm gegen
    ${fmt(sc.lim_inst, 1)} mm zulässig (Ausnutzung ${fmt(sc.eta_w, 2)}).
    Nachweis als Einfeldträger nach DIN EN 1995-1-1, Nutzungsklasse 2,
    k<sub>mod</sub> = 0,90, γ<sub>M</sub> = 1,30.</p>
    <div class="callout"><b>Was diese Prüfung nicht leistet</b>
    Verfahrensfrei heißt nicht anforderungsfrei. Bebauungsplan, örtliche
    Gestaltungssatzung, Baulasten und Leitungsrechte müssen zusätzlich geprüft
    werden – die Auskunft beim Bauamt ist kostenlos. Diese Unterlagen sind eine
    Selbstbauplanung und ersetzen weder geprüfte Bauvorlagen noch eine Statik
    noch eine Rechtsberatung.</div>`;
}

/* --------------------------------------------------------------- Steuerung */

function render() {
  renderSide();
  renderLegend();
  renderDrawSelect();
  draw3d();
  draw2d();
  renderHolz(); renderMat(); renderBau(); renderHbo();
}

function bindTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("on"));
    document.querySelectorAll(".view").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    $("#" + b.dataset.tab).classList.add("on");
    if (b.dataset.tab === "v3d") draw3d();
    if (b.dataset.tab === "v2d") { view2.fit = true; draw2d(); }
  });
}

function bindControls() {
  for (const [id] of CTRL) {
    const el = document.getElementById(id);
    if (!el) continue;
    const ev = el.type === "range" ? "input" : "change";
    el.addEventListener(ev, () => {
      readControls(); writeControls();
      schedule(el.type === "range" ? 160 : 0);
    });
  }
  $("#btn-optimize").onclick = runOptimize;
  $("#btn-pdf").onclick = () => download("/api/shed/pdf", "fahrradhaeuschen.pdf");
  $("#btn-dxf").onclick = () => download("/api/shed/dxf", "fahrradhaeuschen.dxf");
  window.addEventListener("resize", () => { draw3d(); view2.fit = true; draw2d(); });
}

writeControls();
bindTabs(); bindControls(); bind3d(); bind2d();
runOptimize();

})();
