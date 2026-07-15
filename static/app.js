/* Architekturscanner – Canvas-Editor
 * Welt-Koordinaten = Pixel des vektorisierten Bildes. Screen = Welt * s + Offset.
 */
"use strict";

// ---------------------------------------------------------------- Zustand
let idCounter = 1;
const uid = () => idCounter++;

const state = {
  img: null,            // ImageBitmap der Unterlage
  imgW: 0, imgH: 0,
  sourceBlob: null,     // Quelle fuer Neu-Vektorisierung (PNG der Unterlage)
  pxPerMeter: null,
  layers: [],
  currentLayer: null,
  entities: [],         // {id, type:'line'|'dim'|'text', layer, ...}
  selection: new Set(), // Entity-IDs
  tool: "select",
  view: { x: 40, y: 40, s: 0.5 },
  opacity: 0.4,
  snapOn: true,
  decimals: 2,
};

const DEFAULT_LAYERS = [
  { name: "Bestand (alte Zeichnung)", color: "#cfd2d6", kind: "bestand" },
  { name: "Neu (neue Zeichnung)",     color: "#ff5252", kind: "neu" },
  { name: "Bemaßung Bestand",         color: "#57a8ff", kind: "mass_alt" },
  { name: "Bemaßung Neu",             color: "#57d977", kind: "mass_neu" },
  { name: "Text / Beschriftung",      color: "#d9a4ff", kind: "text" },
];

function initLayers() {
  state.layers = DEFAULT_LAYERS.map(l => ({ id: uid(), visible: true, ...l }));
  state.currentLayer = state.layers.find(l => l.kind === "neu").id;
}
initLayers();

const layerById = id => state.layers.find(l => l.id === id);
const entById = id => state.entities.find(e => e.id === id);
const layerByKind = k => state.layers.find(l => l.kind === k);

// ---------------------------------------------------------------- Undo/Redo
const undoStack = [], redoStack = [];
function snapshot() {
  return JSON.stringify({
    layers: state.layers, entities: state.entities,
    pxPerMeter: state.pxPerMeter, currentLayer: state.currentLayer,
  });
}
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}
function restore(json) {
  const d = JSON.parse(json);
  state.layers = d.layers; state.entities = d.entities;
  state.pxPerMeter = d.pxPerMeter; state.currentLayer = d.currentLayer;
  state.selection.clear();
  renderLayers(); updateScaleLabel(); requestDraw();
}
function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); } }
function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); } }

// ---------------------------------------------------------------- Canvas & View
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let needDraw = true;
const requestDraw = () => { needDraw = true; };

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestDraw();
}
window.addEventListener("resize", resizeCanvas);

const w2s = p => ({ x: p.x * state.view.s + state.view.x, y: p.y * state.view.s + state.view.y });
const s2w = p => ({ x: (p.x - state.view.x) / state.view.s, y: (p.y - state.view.y) / state.view.s });

function zoomFit() {
  if (!state.imgW) return;
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / state.imgW, r.height / state.imgH) * 0.94;
  state.view.s = s;
  state.view.x = (r.width - state.imgW * s) / 2;
  state.view.y = (r.height - state.imgH * s) / 2;
  requestDraw();
}

// ---------------------------------------------------------------- Geometrie
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function distPointSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/* Geometrie einer Masskette: Richtung = erster->letzter Punkt, Masslinie im
   Abstand ent.offset senkrecht dazu, Punkte werden auf die Masslinie projiziert. */
function dimGeometry(ent) {
  const pts = ent.points.map(p => ({ x: p[0], y: p[1] }));
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  let d = { x: last.x - first.x, y: last.y - first.y };
  const L = Math.hypot(d.x, d.y) || 1;
  d = { x: d.x / L, y: d.y / L };
  const n = { x: -d.y, y: d.x };
  const base = { x: first.x + n.x * ent.offset, y: first.y + n.y * ent.offset };
  const proj = pts.map(p => {
    const t = (p.x - first.x) * d.x + (p.y - first.y) * d.y;
    return { t, x: base.x + d.x * t, y: base.y + d.y * t, src: p };
  });
  proj.sort((a, b) => a.t - b.t);
  const segs = [];
  for (let i = 0; i < proj.length - 1; i++) {
    const lenPx = proj[i + 1].t - proj[i].t;
    segs.push({
      a: proj[i], b: proj[i + 1], lenPx,
      mid: { x: (proj[i].x + proj[i + 1].x) / 2, y: (proj[i].y + proj[i + 1].y) / 2 },
    });
  }
  return { d, n, proj, segs, angle: Math.atan2(d.y, d.x) };
}

function fmtMeters(px) {
  if (!state.pxPerMeter) return "?";
  return (px / state.pxPerMeter).toFixed(state.decimals).replace(".", ",");
}
function dimLabel(ent, i, seg) {
  const ov = ent.overrides && ent.overrides[String(i)];
  return ov != null && ov !== "" ? ov : fmtMeters(seg.lenPx);
}

// ---------------------------------------------------------------- Zeichnen
function draw() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  ctx.fillStyle = "#26282e";
  ctx.fillRect(0, 0, r.width, r.height);

  if (state.img && state.opacity > 0) {
    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.imageSmoothingEnabled = state.view.s < 1.5;
    ctx.setTransform((window.devicePixelRatio || 1) * state.view.s, 0, 0,
                     (window.devicePixelRatio || 1) * state.view.s,
                     (window.devicePixelRatio || 1) * state.view.x,
                     (window.devicePixelRatio || 1) * state.view.y);
    ctx.drawImage(state.img, 0, 0);
    ctx.restore();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const ent of state.entities) {
      if (ent.layer !== layer.id) continue;
      drawEntity(ent, layer.color, state.selection.has(ent.id));
    }
  }
  drawDraft();
}

function drawEntity(ent, color, selected) {
  ctx.strokeStyle = selected ? "#ffd54a" : color;
  ctx.fillStyle = ctx.strokeStyle;
  if (ent.type === "line") {
    const a = w2s({ x: ent.x1, y: ent.y1 }), b = w2s({ x: ent.x2, y: ent.y2 });
    ctx.lineWidth = selected ? 2.4 : 1.4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (selected) { handle(a); handle(b); }
  } else if (ent.type === "text") {
    const p = w2s({ x: ent.x, y: ent.y });
    const size = Math.max(9, ent.size * state.view.s);
    ctx.font = `${size}px sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    if (ent.angle) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-ent.angle * Math.PI / 180);
      ctx.fillText(ent.text, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(ent.text, p.x, p.y);
    }
    if (selected) handle(p);
  } else if (ent.type === "dim") {
    drawDim(ent, color, selected);
  }
}

function drawDim(ent, color, selected) {
  const g = dimGeometry(ent);
  if (!g) return;
  ctx.strokeStyle = selected ? "#ffd54a" : color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = selected ? 2 : 1.2;

  // Masslinie
  const A = w2s(g.proj[0]), B = w2s(g.proj[g.proj.length - 1]);
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();

  // Hilfslinien + Schraegstriche
  for (const pr of g.proj) {
    const s0 = w2s(pr.src), s1 = w2s(pr);
    ctx.save(); ctx.globalAlpha = 0.65; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
    ctx.restore();
    // 45°-Schraegstrich (Architektur-Tick)
    const t = 5;
    const tx = (g.d.x - g.n.x) * t, ty = (g.d.y - g.n.y) * t;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(s1.x - tx, s1.y - ty); ctx.lineTo(s1.x + tx, s1.y + ty); ctx.stroke();
  }

  // Maßzahlen
  ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  g.segs.forEach((seg, i) => {
    const m = w2s(seg.mid);
    ctx.save();
    ctx.translate(m.x, m.y);
    let ang = g.angle;
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI; // Text nie kopfueber
    ctx.rotate(ang);
    ctx.fillText(dimLabel(ent, i, seg), 0, -3);
    ctx.restore();
  });

  if (selected) {
    for (const pr of g.proj) handle(w2s(pr.src));
    const mid = w2s({
      x: (g.proj[0].x + g.proj[g.proj.length - 1].x) / 2,
      y: (g.proj[0].y + g.proj[g.proj.length - 1].y) / 2,
    });
    handle(mid, "#7fd4ff"); // Offset-Griff
  }
}

function handle(p, color = "#ffd54a") {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = "#222";
  ctx.beginPath(); ctx.rect(p.x - 4, p.y - 4, 8, 8); ctx.fill(); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- Draft (laufende Aktion)
let draft = null;   // s. Werkzeuge
let mouseWorld = { x: 0, y: 0 };
let snapPoint = null;

function drawDraft() {
  if (!draft) return;
  ctx.save();
  ctx.strokeStyle = "#7fd4ff"; ctx.fillStyle = "#7fd4ff"; ctx.lineWidth = 1.4;
  ctx.setLineDash([6, 4]);

  if (draft.kind === "line" && draft.pts.length) {
    const a = w2s(draft.pts[0]), b = w2s(draft.cur || draft.pts[0]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (state.pxPerMeter && draft.cur) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.setLineDash([]);
      ctx.font = "12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(fmtMeters(dist(draft.pts[0], draft.cur)) + " m", mid.x, mid.y - 8);
    }
  } else if (draft.kind === "dim") {
    for (let i = 0; i < draft.pts.length - 1; i++) {
      const a = w2s(draft.pts[i]), b = w2s(draft.pts[i + 1]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const p of draft.pts) { const s = w2s(p); ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, 7); ctx.fill(); }
    if (draft.phase === "offset" && draft.pts.length >= 2) {
      const preview = { type: "dim", points: draft.pts.map(p => [p.x, p.y]),
                        offset: draft.offset || 0, overrides: {} };
      ctx.setLineDash([]);
      drawDim(preview, "#7fd4ff", false);
    } else if (draft.cur && draft.pts.length) {
      const a = w2s(draft.pts[draft.pts.length - 1]), b = w2s(draft.cur);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  } else if (draft.kind === "calib" && draft.pts.length) {
    const a = w2s(draft.pts[0]), b = w2s(draft.cur || draft.pts[0]);
    ctx.strokeStyle = "#ffb74a";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  } else if (draft.kind === "rectify") {
    ctx.strokeStyle = "#ff8fe8"; ctx.fillStyle = "#ff8fe8";
    for (const p of draft.pts) { const s = w2s(p); ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill(); }
    if (draft.pts.length > 1) {
      ctx.beginPath();
      const s0 = w2s(draft.pts[0]); ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < draft.pts.length; i++) { const s = w2s(draft.pts[i]); ctx.lineTo(s.x, s.y); }
      if (draft.cur) { const s = w2s(draft.cur); ctx.lineTo(s.x, s.y); }
      ctx.stroke();
    }
  } else if (draft.kind === "marquee") {
    const a = w2s(draft.a), b = w2s(draft.b);
    ctx.strokeStyle = "#ffd54a"; ctx.fillStyle = "rgba(255,213,74,.08)";
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
  ctx.restore();

  if (snapPoint) {
    const s = w2s(snapPoint);
    ctx.save();
    ctx.strokeStyle = "#57d977"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- Fangen
function findSnap(world) {
  if (!state.snapOn) return null;
  const tol = 10 / state.view.s;
  let best = null, bestD = tol;
  const consider = p => { const d = dist(world, p); if (d < bestD) { bestD = d; best = p; } };
  for (const ent of state.entities) {
    const layer = layerById(ent.layer);
    if (!layer || !layer.visible) continue;
    if (ent.type === "line") { consider({ x: ent.x1, y: ent.y1 }); consider({ x: ent.x2, y: ent.y2 }); }
    else if (ent.type === "dim") for (const p of ent.points) consider({ x: p[0], y: p[1] });
  }
  return best ? { x: best.x, y: best.y } : null;
}

function applyOrtho(origin, p, shift) {
  if (!shift) return p;
  return Math.abs(p.x - origin.x) >= Math.abs(p.y - origin.y)
    ? { x: p.x, y: origin.y } : { x: origin.x, y: p.y };
}

// ---------------------------------------------------------------- Treffer-Tests
function hitEntity(world) {
  const tol = 7 / state.view.s;
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const ent = state.entities[i];
    const layer = layerById(ent.layer);
    if (!layer || !layer.visible) continue;
    if (ent.type === "line") {
      if (distPointSeg(world, { x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 }) < tol) return ent;
    } else if (ent.type === "text") {
      const wPix = ent.text.length * ent.size * 0.55;
      if (ent.angle === 90) {
        if (world.x >= ent.x - ent.size - tol && world.x <= ent.x + tol &&
            world.y >= ent.y - wPix - tol && world.y <= ent.y + tol) return ent;
      } else if (world.x >= ent.x - tol && world.x <= ent.x + wPix + tol &&
          world.y >= ent.y - ent.size - tol && world.y <= ent.y + tol) return ent;
    } else if (ent.type === "dim") {
      const g = dimGeometry(ent);
      if (!g) continue;
      if (distPointSeg(world, g.proj[0], g.proj[g.proj.length - 1]) < tol) return ent;
      for (const pr of g.proj)
        if (distPointSeg(world, pr.src, pr) < tol) return ent;
    }
  }
  return null;
}

/* Griffe der aktuellen Auswahl: {ent, kind:'p1'|'p2'|'pos'|'dimpt'|'dimoff', index} */
function hitHandle(world) {
  const tol = 8 / state.view.s;
  for (const id of state.selection) {
    const ent = entById(id);
    if (!ent) continue;
    if (ent.type === "line") {
      if (dist(world, { x: ent.x1, y: ent.y1 }) < tol) return { ent, kind: "p1" };
      if (dist(world, { x: ent.x2, y: ent.y2 }) < tol) return { ent, kind: "p2" };
    } else if (ent.type === "text") {
      if (dist(world, { x: ent.x, y: ent.y }) < tol) return { ent, kind: "pos" };
    } else if (ent.type === "dim") {
      for (let i = 0; i < ent.points.length; i++)
        if (dist(world, { x: ent.points[i][0], y: ent.points[i][1] }) < tol)
          return { ent, kind: "dimpt", index: i };
      const g = dimGeometry(ent);
      if (g) {
        const mid = { x: (g.proj[0].x + g.proj[g.proj.length - 1].x) / 2,
                      y: (g.proj[0].y + g.proj[g.proj.length - 1].y) / 2 };
        if (dist(world, mid) < tol) return { ent, kind: "dimoff" };
      }
    }
  }
  return null;
}

function hitDimLabel(world) {
  const tol = 14 / state.view.s;
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const ent = state.entities[i];
    if (ent.type !== "dim") continue;
    const layer = layerById(ent.layer);
    if (!layer || !layer.visible) continue;
    const g = dimGeometry(ent);
    if (!g) continue;
    for (let k = 0; k < g.segs.length; k++)
      if (dist(world, g.segs[k].mid) < tol) return { ent, index: k };
  }
  return null;
}

// ---------------------------------------------------------------- Maus / Tastatur
let panning = null;

canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const m = { x: e.offsetX, y: e.offsetY };
  const before = s2w(m);
  state.view.s = Math.min(40, Math.max(0.02, state.view.s * f));
  const after = w2s(before);
  state.view.x += m.x - after.x;
  state.view.y += m.y - after.y;
  requestDraw();
}, { passive: false });

canvas.addEventListener("mousedown", e => {
  const m = { x: e.offsetX, y: e.offsetY };
  if (e.button === 1 || state.tool === "pan") {
    panning = { mx: m.x, my: m.y, vx: state.view.x, vy: state.view.y };
    return;
  }
  if (e.button !== 0) { cancelDraft(); return; }
  let world = s2w(m);
  snapPoint = findSnap(world);
  const wp = snapPoint || world;

  if (state.tool === "select") {
    const h = hitHandle(world);
    if (h) {
      pushUndo();
      draft = { kind: "drag", handle: h };
      return;
    }
    const ent = hitEntity(world);
    if (ent) {
      if (e.shiftKey) {
        state.selection.has(ent.id) ? state.selection.delete(ent.id) : state.selection.add(ent.id);
      } else if (!state.selection.has(ent.id)) {
        state.selection.clear(); state.selection.add(ent.id);
      }
      pushUndo();
      draft = { kind: "move", last: world };
    } else {
      if (!e.shiftKey) state.selection.clear();
      draft = { kind: "marquee", a: world, b: world, additive: e.shiftKey };
    }
    requestDraw();
  } else if (state.tool === "line") {
    if (!draft) draft = { kind: "line", pts: [wp], cur: wp };
    else {
      const end = applyOrtho(draft.pts[0], wp, e.shiftKey);
      pushUndo();
      state.entities.push({ id: uid(), type: "line", layer: state.currentLayer,
                            x1: draft.pts[0].x, y1: draft.pts[0].y, x2: end.x, y2: end.y });
      draft = { kind: "line", pts: [end], cur: end };  // Kette fortsetzen
      requestDraw();
    }
  } else if (state.tool === "dim") {
    if (!draft) draft = { kind: "dim", phase: "points", pts: [], cur: wp };
    if (draft.phase === "points") {
      draft.pts.push(wp);
      setHint(`Maßkette: ${draft.pts.length} Punkt(e) – Enter/Doppelklick zum Abschließen`);
    } else if (draft.phase === "offset") {
      finishDim();
    }
    requestDraw();
  } else if (state.tool === "text") {
    const txt = prompt("Text:");
    if (txt) {
      pushUndo();
      state.entities.push({ id: uid(), type: "text", layer: state.currentLayer,
                            x: wp.x, y: wp.y, text: txt, size: 22 });
      requestDraw();
    }
  } else if (state.tool === "calibrate") {
    if (!draft) draft = { kind: "calib", pts: [wp], cur: wp };
    else {
      const px = dist(draft.pts[0], wp);
      draft = null;
      const val = prompt(`Gemessene Strecke: ${px.toFixed(1)} px.\nReale Länge in Metern (z. B. 4 oder 2,40):`);
      if (val) {
        const meters = parseFloat(val.replace(",", "."));
        if (meters > 0) {
          pushUndo();
          state.pxPerMeter = px / meters;
          updateScaleLabel();
          setHint("Maßstab kalibriert – alle Maßketten sind jetzt maßstäblich.");
        }
      }
      requestDraw();
    }
  } else if (state.tool === "rectify") {
    draft = draft || { kind: "rectify", pts: [] };
    draft.pts.push(world);   // Ecken nicht fangen
    setHint(`Entzerren: Ecke ${draft.pts.length}/4 gesetzt (Reihenfolge: lo → ro → ru → lu)`);
    if (draft.pts.length === 4) {
      const corners = draft.pts.map(p => [p.x, p.y]);
      draft = null;
      revectorize({ corners });
    }
    requestDraw();
  }
});

canvas.addEventListener("mousemove", e => {
  const m = { x: e.offsetX, y: e.offsetY };
  if (panning) {
    state.view.x = panning.vx + m.x - panning.mx;
    state.view.y = panning.vy + m.y - panning.my;
    requestDraw();
    return;
  }
  let world = s2w(m);
  mouseWorld = world;
  snapPoint = (state.tool === "line" || state.tool === "dim" || state.tool === "calibrate")
    ? findSnap(world) : null;
  const wp = snapPoint || world;
  updateCursorLabel(wp);

  if (!draft) { requestDraw(); return; }
  if (draft.kind === "line") draft.cur = applyOrtho(draft.pts[0], wp, e.shiftKey);
  else if (draft.kind === "dim") {
    if (draft.phase === "points") draft.cur = wp;
    else {
      // Offset = Abstand der Maus von der Basislinie (senkrecht)
      const first = draft.pts[0], last = draft.pts[draft.pts.length - 1];
      let d = { x: last.x - first.x, y: last.y - first.y };
      const L = Math.hypot(d.x, d.y) || 1;
      const n = { x: -d.y / L, y: d.x / L };
      draft.offset = (world.x - first.x) * n.x + (world.y - first.y) * n.y;
    }
  }
  else if (draft.kind === "calib" || draft.kind === "rectify") draft.cur = wp;
  else if (draft.kind === "marquee") draft.b = world;
  else if (draft.kind === "move") {
    const dx = world.x - draft.last.x, dy = world.y - draft.last.y;
    for (const id of state.selection) moveEntity(entById(id), dx, dy);
    draft.last = world;
  } else if (draft.kind === "drag") {
    dragHandle(draft.handle, snapPoint && draft.handle.kind !== "dimoff" ? wp : world, e.shiftKey);
  }
  requestDraw();
});

canvas.addEventListener("mouseup", e => {
  if (panning) { panning = null; return; }
  if (!draft) return;
  if (draft.kind === "marquee") {
    const x1 = Math.min(draft.a.x, draft.b.x), x2 = Math.max(draft.a.x, draft.b.x);
    const y1 = Math.min(draft.a.y, draft.b.y), y2 = Math.max(draft.a.y, draft.b.y);
    if (x2 - x1 > 2 || y2 - y1 > 2) {
      if (!draft.additive) state.selection.clear();
      for (const ent of state.entities) {
        const layer = layerById(ent.layer);
        if (!layer || !layer.visible) continue;
        if (entInRect(ent, x1, y1, x2, y2)) state.selection.add(ent.id);
      }
      setHint(`${state.selection.size} Element(e) ausgewählt`);
    }
    draft = null;
    requestDraw();
  } else if (draft.kind === "move" || draft.kind === "drag") {
    draft = null;
    requestDraw();
  }
});

canvas.addEventListener("dblclick", e => {
  const world = s2w({ x: e.offsetX, y: e.offsetY });
  if (state.tool === "dim" && draft && draft.phase === "points") {
    finishDimPoints();
    return;
  }
  // Maßzahl bearbeiten
  const lbl = hitDimLabel(world);
  if (lbl) {
    const cur = (lbl.ent.overrides && lbl.ent.overrides[String(lbl.index)]) || "";
    const g = dimGeometry(lbl.ent);
    const auto = fmtMeters(g.segs[lbl.index].lenPx);
    const val = prompt(`Maßtext (leer = automatisch ${auto} m):`, cur);
    if (val !== null) {
      pushUndo();
      lbl.ent.overrides = lbl.ent.overrides || {};
      if (val === "") delete lbl.ent.overrides[String(lbl.index)];
      else lbl.ent.overrides[String(lbl.index)] = val;
      requestDraw();
    }
    return;
  }
  const ent = hitEntity(world);
  if (ent && ent.type === "text") {
    const val = prompt("Text bearbeiten:", ent.text);
    if (val !== null && val !== "") { pushUndo(); ent.text = val; requestDraw(); }
  }
});

function entInRect(ent, x1, y1, x2, y2) {
  const inside = p => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  if (ent.type === "line") return inside({ x: ent.x1, y: ent.y1 }) && inside({ x: ent.x2, y: ent.y2 });
  if (ent.type === "text") return inside({ x: ent.x, y: ent.y });
  if (ent.type === "dim") return ent.points.every(p => inside({ x: p[0], y: p[1] }));
  return false;
}

function moveEntity(ent, dx, dy) {
  if (!ent) return;
  if (ent.type === "line") { ent.x1 += dx; ent.y1 += dy; ent.x2 += dx; ent.y2 += dy; }
  else if (ent.type === "text") { ent.x += dx; ent.y += dy; }
  else if (ent.type === "dim") for (const p of ent.points) { p[0] += dx; p[1] += dy; }
}

function dragHandle(h, wp, shift) {
  const ent = h.ent;
  if (h.kind === "p1") { const p = applyOrtho({ x: ent.x2, y: ent.y2 }, wp, shift); ent.x1 = p.x; ent.y1 = p.y; }
  else if (h.kind === "p2") { const p = applyOrtho({ x: ent.x1, y: ent.y1 }, wp, shift); ent.x2 = p.x; ent.y2 = p.y; }
  else if (h.kind === "pos") { ent.x = wp.x; ent.y = wp.y; }
  else if (h.kind === "dimpt") { ent.points[h.index][0] = wp.x; ent.points[h.index][1] = wp.y; }
  else if (h.kind === "dimoff") {
    const first = { x: ent.points[0][0], y: ent.points[0][1] };
    const last = { x: ent.points[ent.points.length - 1][0], y: ent.points[ent.points.length - 1][1] };
    let d = { x: last.x - first.x, y: last.y - first.y };
    const L = Math.hypot(d.x, d.y) || 1;
    const n = { x: -d.y / L, y: d.x / L };
    ent.offset = (wp.x - first.x) * n.x + (wp.y - first.y) * n.y;
  }
}

function finishDimPoints() {
  if (!draft) { cancelDraft(); return; }
  // Doppelklick erzeugt zwei Klicks auf derselben Stelle -> Duplikate entfernen
  draft.pts = draft.pts.filter((p, i) =>
    i === 0 || dist(p, draft.pts[i - 1]) > 2 / state.view.s);
  if (draft.pts.length < 2) { cancelDraft(); return; }
  draft.phase = "offset";
  draft.offset = 40;
  setHint("Position der Maßlinie mit der Maus wählen und klicken.");
  requestDraw();
}

function finishDim() {
  if (!draft || draft.pts.length < 2) { cancelDraft(); return; }
  pushUndo();
  state.entities.push({
    id: uid(), type: "dim", layer: state.currentLayer,
    points: draft.pts.map(p => [p.x, p.y]),
    offset: draft.offset || 40, overrides: {},
  });
  draft = null;
  setHint(state.pxPerMeter ? "Maßkette angelegt." :
          "Maßkette angelegt – noch nicht kalibriert! Werkzeug „Kalibrieren“ nutzen.");
  requestDraw();
}

function cancelDraft() { draft = null; snapPoint = null; requestDraw(); }

window.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "Escape") { cancelDraft(); return; }
  if (e.key === "Enter" && draft && draft.kind === "dim" && draft.phase === "points") {
    finishDimPoints(); return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && state.selection.size) {
    pushUndo();
    state.entities = state.entities.filter(ent => !state.selection.has(ent.id));
    state.selection.clear();
    requestDraw();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  const keys = { v: "select", l: "line", m: "dim", t: "text", k: "calibrate", h: "pan" };
  if (keys[e.key.toLowerCase()]) setTool(keys[e.key.toLowerCase()]);
});

// ---------------------------------------------------------------- Werkzeuge / UI
function setTool(tool) {
  cancelDraft();
  state.tool = tool;
  document.querySelectorAll("#toolbar .tool").forEach(b =>
    b.classList.toggle("active", b.dataset.tool === tool));
  // sinnvolle Layer-Vorwahl
  const cur = layerById(state.currentLayer);
  if (tool === "dim" && cur && !cur.kind.startsWith("mass")) {
    const l = layerByKind("mass_neu"); if (l) { state.currentLayer = l.id; renderLayers(); }
  } else if (tool === "line" && cur && cur.kind.startsWith("mass")) {
    const l = layerByKind("neu"); if (l) { state.currentLayer = l.id; renderLayers(); }
  }
  const hints = {
    select: "Klicken = auswählen, Ziehen = verschieben, Rahmen = Mehrfachauswahl, Entf = löschen.",
    line: "Startpunkt und Endpunkt klicken (Shift = orthogonal, Esc = beenden).",
    dim: "Messpunkte nacheinander klicken, Enter/Doppelklick beendet, dann Maßlinie platzieren.",
    text: "Position klicken und Text eingeben.",
    calibrate: "Zwei Punkte einer bekannten Strecke klicken.",
    pan: "Ziehen zum Verschieben der Ansicht.",
    rectify: "4 Ecken des Plans klicken: links oben → rechts oben → rechts unten → links unten.",
  };
  setHint(hints[tool] || "");
}
document.querySelectorAll("#toolbar .tool").forEach(b =>
  b.addEventListener("click", () => setTool(b.dataset.tool)));

document.getElementById("btnRectify").addEventListener("click", () => {
  if (!state.sourceBlob) { setHint("Zuerst einen Plan laden."); return; }
  setTool("rectify");
});
document.getElementById("btnUndo").addEventListener("click", undo);
document.getElementById("btnRedo").addEventListener("click", redo);

function setHint(t) { document.getElementById("stHint").textContent = t; }
function updateScaleLabel() {
  const el = document.getElementById("stScale");
  el.textContent = state.pxPerMeter
    ? `Maßstab: ${state.pxPerMeter.toFixed(1)} px/m (kalibriert)`
    : "Maßstab: nicht kalibriert";
}
function updateCursorLabel(wp) {
  const el = document.getElementById("stCursor");
  if (state.pxPerMeter)
    el.textContent = `x ${(wp.x / state.pxPerMeter).toFixed(2)} m, y ${((state.imgH - wp.y) / state.pxPerMeter).toFixed(2)} m`;
  else
    el.textContent = `x ${wp.x.toFixed(0)} px, y ${wp.y.toFixed(0)} px`;
}

// ---------------------------------------------------------------- Layer-Panel
function renderLayers() {
  const box = document.getElementById("layerList");
  box.innerHTML = "";
  for (const layer of state.layers) {
    const row = document.createElement("div");
    row.className = "layerRow" + (layer.id === state.currentLayer ? " current" : "");

    const vis = document.createElement("span");
    vis.className = "vis"; vis.textContent = layer.visible ? "👁" : "◌";
    vis.title = "Sichtbarkeit umschalten";
    vis.onclick = e => { e.stopPropagation(); layer.visible = !layer.visible; renderLayers(); requestDraw(); };

    const col = document.createElement("input");
    col.type = "color"; col.value = layer.color;
    col.onclick = e => e.stopPropagation();
    col.oninput = () => { layer.color = col.value; requestDraw(); };

    const name = document.createElement("span");
    name.className = "lname"; name.textContent = layer.name; name.title = layer.name;
    name.ondblclick = e => {
      e.stopPropagation();
      const v = prompt("Layername:", layer.name);
      if (v) { layer.name = v; renderLayers(); }
    };

    const del = document.createElement("span");
    del.className = "del"; del.textContent = "✕"; del.title = "Layer löschen (mit Inhalt)";
    del.onclick = e => {
      e.stopPropagation();
      if (!confirm(`Layer „${layer.name}“ und alle Elemente darauf löschen?`)) return;
      pushUndo();
      state.entities = state.entities.filter(x => x.layer !== layer.id);
      state.layers = state.layers.filter(x => x.id !== layer.id);
      if (state.currentLayer === layer.id && state.layers.length)
        state.currentLayer = state.layers[0].id;
      renderLayers(); requestDraw();
    };

    row.append(vis, col, name, del);
    row.onclick = () => { state.currentLayer = layer.id; renderLayers(); };
    box.appendChild(row);
  }
}
document.getElementById("btnAddLayer").addEventListener("click", () => {
  const name = prompt("Name des neuen Layers:", "Neuer Layer");
  if (!name) return;
  pushUndo();
  const layer = { id: uid(), name, color: "#ffca6b", visible: true, kind: "custom" };
  state.layers.push(layer);
  state.currentLayer = layer.id;
  renderLayers();
});

// ---------------------------------------------------------------- Seitenleiste
const bind = (id, label, fn) => {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    if (label) document.getElementById(label).textContent = el.value;
    fn(el);
  });
};
bind("pOpacity", "vOpacity", el => { state.opacity = el.value / 100; requestDraw(); });
bind("pMinLen", "vMinLen", () => {});
bind("pGap", "vGap", () => {});
bind("pAngle", "vAngle", () => {});
document.getElementById("pSnap").addEventListener("change", e => state.snapOn = e.target.checked);
document.getElementById("pDecimals").addEventListener("change", e => {
  state.decimals = parseInt(e.target.value, 10); requestDraw();
});

// ---------------------------------------------------------------- Vektorisierung
const spinner = document.getElementById("spinner");
function busy(on, text) {
  spinner.classList.toggle("hidden", !on);
  if (text) document.getElementById("spinnerText").textContent = text;
}

document.getElementById("fileInput").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  await runVectorize(f, {});
  e.target.value = "";
});

document.getElementById("btnRevectorize").addEventListener("click", () => revectorize({}));

async function revectorize(opts) {
  if (!state.sourceBlob) { setHint("Zuerst einen Plan laden."); return; }
  await runVectorize(state.sourceBlob, opts);
  if (state.tool === "rectify") setTool("select");
}

async function runVectorize(file, opts) {
  busy(true, opts.corners ? "Entzerre und vektorisiere …" : "Vektorisiere …");
  try {
    const fd = new FormData();
    fd.append("file", file, file.name || "source.png");
    fd.append("min_len", document.getElementById("pMinLen").value);
    fd.append("merge_gap", document.getElementById("pGap").value);
    fd.append("angle_snap_deg", document.getElementById("pAngle").value);
    fd.append("with_ocr", document.getElementById("pOcr").checked);
    if (opts.corners) fd.append("corners", JSON.stringify(opts.corners));
    const res = await fetch("/api/vectorize", { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    await applyVectorizeResult(data);
  } catch (err) {
    alert("Vektorisierung fehlgeschlagen: " + err.message);
  } finally {
    busy(false);
  }
}

async function applyVectorizeResult(data) {
  pushUndo();
  const bytes = Uint8Array.from(atob(data.image_png_base64), c => c.charCodeAt(0));
  state.sourceBlob = new Blob([bytes], { type: "image/png" });
  state.img = await createImageBitmap(state.sourceBlob);
  const scaleChanged = state.imgW && state.imgW !== data.width;
  state.imgW = data.width; state.imgH = data.height;
  if (scaleChanged) state.pxPerMeter = null;   // Bildgeometrie geaendert -> neu kalibrieren

  // Bestandslinien ersetzen, Nutzer-Elemente behalten
  const bestand = layerByKind("bestand") || state.layers[0];
  state.entities = state.entities.filter(ent => ent.layer !== bestand.id || ent.type !== "line");
  for (const s of data.segments)
    state.entities.push({ id: uid(), type: "line", layer: bestand.id,
                          x1: s[0], y1: s[1], x2: s[2], y2: s[3] });

  if (data.texts && data.texts.length) {
    const tl = layerByKind("text") || bestand;
    state.entities = state.entities.filter(ent => !(ent.layer === tl.id && ent.type === "text" && ent.ocr));
    for (const t of data.texts)
      state.entities.push({ id: uid(), type: "text", layer: tl.id, ocr: true,
                            x: t.x, y: t.y, text: t.text, angle: t.angle || 0,
                            size: Math.max(10, t.size) });
  }
  state.selection.clear();
  updateScaleLabel();
  zoomFit();
  setHint(`${data.segments.length} Linien erkannt` +
          (data.texts ? `, ${data.texts.length} Textzeilen (OCR)` : "") +
          (data.skew_corrected_deg ? ` – Verdrehung um ${data.skew_corrected_deg}° korrigiert` : "") +
          ". Jetzt mit „Kalibrieren“ den Maßstab festlegen.");
  requestDraw();
}

// ---------------------------------------------------------------- Projekt speichern/laden
document.getElementById("btnSave").addEventListener("click", async () => {
  const imgDataUrl = state.sourceBlob ? await blobToDataUrl(state.sourceBlob) : null;
  const proj = {
    version: 1, imgDataUrl, imgW: state.imgW, imgH: state.imgH,
    pxPerMeter: state.pxPerMeter, layers: state.layers,
    entities: state.entities, currentLayer: state.currentLayer, idCounter,
  };
  download(new Blob([JSON.stringify(proj)], { type: "application/json" }), "projekt.archscan.json");
});

document.getElementById("projInput").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const proj = JSON.parse(await f.text());
    state.layers = proj.layers; state.entities = proj.entities;
    state.pxPerMeter = proj.pxPerMeter; state.currentLayer = proj.currentLayer;
    state.imgW = proj.imgW; state.imgH = proj.imgH;
    idCounter = proj.idCounter || (idCounter + 100000);
    if (proj.imgDataUrl) {
      state.sourceBlob = await (await fetch(proj.imgDataUrl)).blob();
      state.img = await createImageBitmap(state.sourceBlob);
    }
    state.selection.clear();
    undoStack.length = 0; redoStack.length = 0;
    renderLayers(); updateScaleLabel(); zoomFit();
    setHint("Projekt geladen.");
  } catch (err) {
    alert("Projekt konnte nicht geladen werden: " + err.message);
  }
  e.target.value = "";
});

const blobToDataUrl = blob => new Promise(res => {
  const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob);
});
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------- DXF-Export
document.getElementById("btnExport").addEventListener("click", async () => {
  if (!state.entities.length) { setHint("Nichts zu exportieren – zuerst Plan laden."); return; }
  if (!state.pxPerMeter &&
      !confirm("Noch kein Maßstab kalibriert – DXF wird mit 100 px = 1 m exportiert.\nTrotzdem fortfahren?"))
    return;
  busy(true, "Erzeuge DXF …");
  try {
    const res = await fetch("/api/export-dxf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pxPerMeter: state.pxPerMeter, imgH: state.imgH,
        dimDecimals: state.decimals,
        layers: state.layers, entities: state.entities,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    download(await res.blob(), "plan.dxf");
    setHint("DXF exportiert – in CAD öffnen und bei Bedarf als DWG speichern.");
  } catch (err) {
    alert("Export fehlgeschlagen: " + err.message);
  } finally {
    busy(false);
  }
});

// ---------------------------------------------------------------- Render-Loop
function loop() {
  if (needDraw) { needDraw = false; draw(); }
  requestAnimationFrame(loop);
}
resizeCanvas();
renderLayers();
updateScaleLabel();
setTool("select");
loop();
