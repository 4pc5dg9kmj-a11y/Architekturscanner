// Sitzplan-Generator: Grundriss einfügen → Raumkontur erkennen → Tische platzieren → Gäste zuordnen.
// Alle Maße intern in Zentimetern. Das SVG nutzt dieselben Einheiten (1 Einheit = 1 cm).

const SVGNS = 'http://www.w3.org/2000/svg';

export const TYPES = {
  rund150: { label: 'Rund Ø 150', kind: 'table', shape: 'round', d: 150, seats: 8 },
  rund180: { label: 'Rund Ø 180', kind: 'table', shape: 'round', d: 180, seats: 10 },
  rechteck: { label: 'Rechteck 200×80', kind: 'table', shape: 'rect', w: 200, h: 80, seats: 8, ends: true, sides: 'both' },
  tafel: { label: 'Tafel 400×80', kind: 'table', shape: 'rect', w: 400, h: 80, seats: 14, ends: true, sides: 'both' },
  quadrat: { label: 'Quadrat 90×90', kind: 'table', shape: 'rect', w: 90, h: 90, seats: 4, ends: true, sides: 'both' },
  braut: { label: 'Brauttisch', kind: 'table', shape: 'rect', w: 240, h: 80, seats: 4, ends: false, sides: 'one' },
  tanz: { label: 'Tanzfläche', kind: 'zone', shape: 'rect', w: 500, h: 500 },
  dj: { label: 'DJ / Band', kind: 'zone', shape: 'rect', w: 300, h: 200 },
  buffet: { label: 'Buffet', kind: 'zone', shape: 'rect', w: 400, h: 80 },
  bar: { label: 'Bar', kind: 'zone', shape: 'rect', w: 250, h: 80 },
  torte: { label: 'Tortentisch', kind: 'zone', shape: 'round', d: 100 },
  saeule: { label: 'Säule / Hindernis', kind: 'zone', shape: 'rect', w: 40, h: 40 },
};
const CHAIR_GAP = 32;     // Abstand Stuhlmitte zur Tischkante
const CHAIR_R = 22;
const AISLE_MIN = 100;    // darunter: zu eng
const AISLE_OK = 150;     // empfohlener Abstand Tischkante zu Tischkante

/* ---------------- Geometrie ---------------- */
const rot = ([x, y], a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
const toWorld = (it, p) => { const [x, y] = rot(p, (it.rot || 0) * Math.PI / 180); return [x + it.x, y + it.y]; };
function outline(it) {
  if (it.shape === 'round') return Array.from({ length: 24 }, (_, i) => toWorld(it, [Math.cos(i / 24 * 2 * Math.PI) * it.d / 2, Math.sin(i / 24 * 2 * Math.PI) * it.d / 2]));
  return [[-it.w / 2, -it.h / 2], [it.w / 2, -it.h / 2], [it.w / 2, it.h / 2], [-it.w / 2, it.h / 2]].map(p => toWorld(it, p));
}
export function seatsOf(it) {
  const n = it.kind === 'table' ? Math.max(0, it.seats | 0) : 0; const out = [];
  if (!n) return out;
  if (it.shape === 'round') {
    const R = it.d / 2 + CHAIR_GAP;
    for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI - Math.PI / 2; out.push([Math.cos(a) * R, Math.sin(a) * R]); }
    return out;
  }
  const ends = it.ends && it.sides !== 'one' && n >= 4 ? 2 : 0;
  const rest = n - ends;
  const line = (count, y) => { for (let i = 0; i < count; i++) out.push([-it.w / 2 + it.w * (i + 0.5) / count, y]); };
  if (it.sides === 'one') line(n, -(it.h / 2 + CHAIR_GAP));
  else { line(Math.ceil(rest / 2), -(it.h / 2 + CHAIR_GAP)); line(Math.floor(rest / 2), it.h / 2 + CHAIR_GAP); }
  if (ends) { out.push([-(it.w / 2 + CHAIR_GAP), 0]); out.push([it.w / 2 + CHAIR_GAP, 0]); }
  return out;
}
function pointInPoly([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function polyDist(A, B) {
  if (A.some(p => pointInPoly(p, B)) || B.some(p => pointInPoly(p, A))) return 0;
  let d = Infinity;
  for (const p of A) for (let i = 0; i < B.length; i++) d = Math.min(d, segDist(p, B[i], B[(i + 1) % B.length]));
  for (const p of B) for (let i = 0; i < A.length; i++) d = Math.min(d, segDist(p, A[i], A[(i + 1) % A.length]));
  return d;
}
const area = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

// Prüft Platzbedarf: Tisch außerhalb des Raums, Überschneidungen, zu enge Gänge.
export function checkPlan(plan) {
  const res = new Map(); const add = (id, level, msg) => { const r = res.get(id) || { level: 0, msgs: [] }; r.level = Math.max(r.level, level); r.msgs.push(msg); res.set(id, r); };
  const room = plan.room?.pts || [];
  const polys = plan.items.map(it => ({ it, poly: outline(it) }));
  for (const { it, poly } of polys) {
    if (room.length >= 3) {
      const pts = [...poly, ...seatsOf(it).map(p => toWorld(it, p))];
      if (pts.some(p => !pointInPoly(p, room))) add(it.id, 2, 'Steht teilweise außerhalb des Raums');
    }
  }
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    const a = polys[i], b = polys[j]; const d = polyDist(a.poly, b.poly);
    const tables = a.it.kind === 'table' && b.it.kind === 'table';
    const need = tables ? AISLE_MIN : (a.it.kind === 'table' || b.it.kind === 'table') ? 60 : 0;
    if (d <= 0) { add(a.it.id, 2, `Überschneidet sich mit ${b.it.name}`); add(b.it.id, 2, `Überschneidet sich mit ${a.it.name}`); }
    else if (d < need) { add(a.it.id, 2, `Nur ${Math.round(d)} cm bis ${b.it.name}`); add(b.it.id, 2, `Nur ${Math.round(d)} cm bis ${a.it.name}`); }
    else if (tables && d < AISLE_OK) { add(a.it.id, 1, `Knapp: ${Math.round(d)} cm bis ${b.it.name}`); add(b.it.id, 1, `Knapp: ${Math.round(d)} cm bis ${a.it.name}`); }
  }
  return res;
}

/* ---------------- Grundriss-Erkennung ---------------- */
// Sucht die äußeren Wände: Zeilen/Spalten, in denen ein großer Teil der Pixel dunkel ist.
export function detectRoom(imgData, w, h) {
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = imgData[i * 4], g = imgData[i * 4 + 1], b = imgData[i * 4 + 2], a = imgData[i * 4 + 3]; dark[i] = a > 100 && (0.299 * r + 0.587 * g + 0.114 * b) < 110 ? 1 : 0; }
  const rows = new Array(h).fill(0), cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark[y * w + x]) { rows[y]++; cols[x]++; }
  // Wände sind dicker als Maß- und Hilfslinien: bevorzugt werden Bänder mit mehreren dunklen Zeilen in Folge.
  const minThick = Math.max(2, Math.round(Math.max(w, h) / 170));
  const pick = (arr, len) => {
    for (const f of [0.35, 0.2, 0.1]) {
      const bands = []; arr.forEach((c, i) => { if (c > len * f) { const b = bands[bands.length - 1]; if (b && i - b.e <= 1) b.e = i; else bands.push({ s: i, e: i }); } });
      for (const set of [bands.filter(b => b.e - b.s + 1 >= minThick), bands]) {
        if (set.length >= 2 && set[set.length - 1].e - set[0].s > arr.length * 0.2) return [set[0].s, set[set.length - 1].e];
      }
    }
    return null;
  };
  const ry = pick(rows, w), rx = pick(cols, h);
  if (ry && rx) return { x0: rx[0], y0: ry[0], x1: rx[1], y1: ry[1], found: true };
  // Rückfall: Umriss aller dunklen Pixel
  let x0 = w, y0 = h, x1 = 0, y1 = 0, any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark[y * w + x]) { any = true; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return any && x1 - x0 > w * 0.2 && y1 - y0 > h * 0.2 ? { x0, y0, x1, y1, found: true } : { x0: w * 0.05, y0: h * 0.05, x1: w * 0.95, y1: h * 0.95, found: false };
}

/* ---------------- Editor ---------------- */
export async function vSeating(ctx) {
  const { api, S, esc, toast, view } = ctx;
  const wid = S.w.id; const editable = S.role === 'paar';
  const [{ data, has_floorplan }, guestsRes] = await Promise.all([api(`/api/w/${wid}/seating`), api(`/api/w/${wid}/guests`)]);
  const P = normalize(data);
  if (!has_floorplan) P.img = null;
  let sel = null, mode = 'tische', calib = [], saveT = null, saving = false;

  // Personen, die einen Platz brauchen
  const people = new Map();
  people.set('p1', `${S.w.name1} (Paar)`); people.set('p2', `${S.w.name2} (Paar)`);
  for (const t of guestsRes.team) if (t.role === 'trauzeuge') people.set(`u${t.id}`, `${t.name} (Trauzeug:in)`);
  for (const g of guestsRes.guests) if (g.status === 'zusage') { people.set(`u${g.id}`, g.name); for (let k = 2; k <= g.persons; k++) people.set(`u${g.id}#${k}`, `${g.name} · Begleitung ${k - 1}`); }
  for (const x of P.extra) people.set(x.id, x.name);
  const label = key => people.get(key) || 'Unbekannt';
  const party = key => key.split('#')[0];

  function normalize(d) {
    const p = d && typeof d === 'object' ? structuredClone(d) : {};
    p.v = 1; p.items = Array.isArray(p.items) ? p.items : []; p.extra = Array.isArray(p.extra) ? p.extra : [];
    if (!p.room || !Array.isArray(p.room.pts) || p.room.pts.length < 3) p.room = { pts: [[0, 0], [1400, 0], [1400, 2000], [0, 2000]] };
    p.nextId = p.nextId || p.items.length + 1;
    p.items.forEach(it => { it.guests = Array.isArray(it.guests) ? it.guests : []; it.guests.length = it.kind === 'table' ? it.seats : 0; });
    return p;
  }

  /* ---- Layout ---- */
  view.innerHTML = `
  <div class="row between"><div><span class="eyebrow">Sitzplan</span><h1>Raum &amp; Tische</h1></div><span class="small muted" id="stSave">${editable ? '' : 'Nur das Paar kann den Sitzplan ändern.'}</span></div>
  <div class="seat-layout">
    <section class="card seat-canvas">
      ${editable ? `<div class="row between seat-tools">
        <div class="seg" id="stMode"><button data-m="tische" aria-pressed="true">Tische</button><button data-m="raum" aria-pressed="false">Raum</button><button data-m="massstab" aria-pressed="false">Maßstab</button></div>
        <div class="row"><button class="mini" data-z="out" aria-label="Verkleinern">−</button><button class="mini" data-z="in" aria-label="Vergrößern">+</button><button class="mini" data-z="fit">Ganzer Raum</button></div>
      </div>
      <p class="small muted" id="stHint"></p>` : `<div class="row"><button class="mini" data-z="out">−</button><button class="mini" data-z="in">+</button><button class="mini" data-z="fit">Ganzer Raum</button></div>`}
      <div class="seat-svgwrap" id="stWrap"><svg id="stSvg" xmlns="${SVGNS}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Sitzplan"></svg></div>
      ${editable ? `<div class="seat-palette" id="stPalette" aria-label="Tisch hinzufügen">${Object.entries(TYPES).map(([k, t]) => `<button class="pal" data-add="${k}">${palIcon(t)}<span>${t.label}</span></button>`).join('')}</div>` : ''}
    </section>
    <div class="stack">
      <section class="card" id="stPanel"></section>
      <section class="card" id="stStats"></section>
    </div>
  </div>
  <div class="grid2">
    ${editable ? `<section class="card" id="stSetup">
      <span class="eyebrow">Grundriss</span><h3>Saal einfügen</h3>
      <p class="small muted">Fügt einen Grundriss als Bild ein: per Einfügen (Strg+V / ⌘+V), durch Hineinziehen oder über „Bild wählen“. Die Raumkontur wird automatisch erkannt. Danach den Maßstab setzen, damit die Tische in echter Größe erscheinen. PDF-Pläne bitte vorher als Bildschirmfoto einfügen.</p>
      <div class="dropzone" id="stDrop"><input type="file" id="stFile" accept="image/png,image/jpeg,image/webp" hidden><button class="btn small" id="stPick">Bild wählen</button><span class="small muted">oder hier hineinziehen / einfügen</span></div>
      <div id="stImgCtl"></div>
      <div class="lbl" style="margin-top:6px">Ohne Grundriss: Raummaße</div>
      <div class="fields2"><div class="field"><label for="stW">Breite (m)</label><input id="stW" type="number" min="3" max="200" step="0.5" inputmode="decimal"></div><div class="field"><label for="stL">Länge (m)</label><input id="stL" type="number" min="3" max="200" step="0.5" inputmode="decimal"></div></div>
      <button class="btn sec small" id="stRect">Rechteckigen Raum anlegen</button>
    </section>` : ''}
    <section class="card" id="stGuests"></section>
  </div>
  <section class="card seat-print" id="stList"></section>`;

  const svg = view.querySelector('#stSvg');
  let vb = null;

  /* ---- Ansicht ---- */
  function bounds() {
    const pts = [...P.room.pts]; P.items.forEach(it => pts.push(...outline(it)));
    if (P.img) pts.push([0, 0], [P.img.w * P.img.cmPerPx, P.img.h * P.img.cmPerPx]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  // Fläche an die Raumform anpassen, damit auf dem Handy kein leerer Rand bleibt
  function sizeSvg() { const r = Math.min(1.8, Math.max(0.7, vb.w / vb.h)); svg.style.aspectRatio = `${r}`; }
  function fit() { const b = bounds(); const m = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.06 + 50; vb = { x: b.x0 - m, y: b.y0 - m, w: b.x1 - b.x0 + 2 * m, h: b.y1 - b.y0 + 2 * m }; sizeSvg(); }
  function zoom(f, cx, cy) { cx ??= vb.x + vb.w / 2; cy ??= vb.y + vb.h / 2; vb = { x: cx - (cx - vb.x) * f, y: cy - (cy - vb.y) * f, w: vb.w * f, h: vb.h * f }; draw(); }
  function svgPt(e) { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const r = pt.matrixTransform(svg.getScreenCTM().inverse()); return [r.x, r.y]; }

  /* ---- Zeichnen ---- */
  function draw() {
    const warn = checkPlan(P);
    const u = vb.w / 100; // eine „Bildschirm-Einheit“ für Griffe und Schrift
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    if (!svg.style.aspectRatio) sizeSvg();
    let h = `<defs><pattern id="stGrid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" class="st-grid" vector-effect="non-scaling-stroke"/></pattern></defs>`;
    if (P.img) h += `<image href="/api/w/${wid}/floorplan?v=${P.img.ver || 0}" x="0" y="0" width="${P.img.w * P.img.cmPerPx}" height="${P.img.h * P.img.cmPerPx}" opacity="${P.img.opacity ?? 0.55}" preserveAspectRatio="none"/>`;
    const rp = P.room.pts.map(p => p.join(',')).join(' ');
    h += `<polygon points="${rp}" class="st-room ${P.img ? 'has-img' : ''}" vector-effect="non-scaling-stroke"/><polygon points="${rp}" fill="url(#stGrid)" pointer-events="none"/>`;
    for (const it of P.items) {
      const w = warn.get(it.id); const cls = `st-item ${it.kind} ${sel === it.id ? 'sel' : ''} ${w ? (w.level === 2 ? 'bad' : 'warn') : ''}`;
      h += `<g class="${cls}" data-h="item:${it.id}" transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">`;
      seatsOf(it).forEach((s, i) => { h += `<circle cx="${s[0]}" cy="${s[1]}" r="${CHAIR_R}" class="st-chair ${it.guests[i] ? 'taken' : ''}" vector-effect="non-scaling-stroke"/>`; });
      h += it.shape === 'round' ? `<circle r="${it.d / 2}" class="st-top" vector-effect="non-scaling-stroke"/>` : `<rect x="${-it.w / 2}" y="${-it.h / 2}" width="${it.w}" height="${it.h}" rx="${it.kind === 'zone' ? 8 : 4}" class="st-top" vector-effect="non-scaling-stroke"/>`;
      h += `</g>`;
      const fs = Math.max(12, Math.min(u * 3.2, (it.shape === 'round' ? it.d : Math.min(it.w, it.h * 2.4)) * 0.2));
      const used = it.guests.filter(Boolean).length;
      if (it.kind === 'zone' && Math.max(it.w || 0, it.d || 0) < 90) continue; // kleine Hindernisse ohne Beschriftung
      h += `<text x="${it.x}" y="${it.y}" class="st-label" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" pointer-events="none">${esc(it.name)}${it.kind === 'table' ? `<tspan x="${it.x}" dy="${fs * 1.1}" class="st-sub" font-size="${fs * 0.8}">${used}/${it.seats}</tspan>` : ''}</text>`;
    }
    if (mode === 'raum' && editable) {
      const pts = P.room.pts;
      pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; h += `<circle cx="${(p[0] + q[0]) / 2}" cy="${(p[1] + q[1]) / 2}" r="${u * 1.1}" class="st-mid" data-h="mid:${i}"/>`; });
      pts.forEach((p, i) => { h += `<circle cx="${p[0]}" cy="${p[1]}" r="${u * 1.6}" class="st-vtx ${sel === 'v' + i ? 'sel' : ''}" data-h="vtx:${i}"/>`; });
      pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; const len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len > vb.w / 12) h += `<text x="${(p[0] + q[0]) / 2}" y="${(p[1] + q[1]) / 2 - u * 2}" font-size="${u * 2.2}" text-anchor="middle" class="st-dim" pointer-events="none">${(len / 100).toFixed(2).replace('.', ',')} m</text>`; });
    }
    if (mode === 'massstab') {
      calib.forEach(p => { h += `<circle cx="${p[0]}" cy="${p[1]}" r="${u * 1.4}" class="st-cal"/>`; });
      if (calib.length === 2) h += `<line x1="${calib[0][0]}" y1="${calib[0][1]}" x2="${calib[1][0]}" y2="${calib[1][1]}" class="st-cal-line" vector-effect="non-scaling-stroke"/>`;
    }
    svg.innerHTML = h;
    drawStats(warn);
  }

  function drawStats(warn) {
    const tables = P.items.filter(i => i.kind === 'table');
    const seats = tables.reduce((s, t) => s + t.seats, 0);
    const assigned = new Set(tables.flatMap(t => t.guests.filter(Boolean)));
    const m2 = area(P.room.pts) / 1e4;
    const bad = [...warn.values()].filter(w => w.level === 2).length, soso = [...warn.values()].filter(w => w.level === 1).length;
    view.querySelector('#stStats').innerHTML = `<div class="stats">
      <div class="stat"><b>${tables.length}</b><span>Tische</span></div><div class="stat"><b>${seats}</b><span>Plätze</span></div>
      <div class="stat ${seats < people.size ? 'no' : 'yes'}"><b>${people.size}</b><span>Personen</span></div><div class="stat"><b>${assigned.size}</b><span>zugewiesen</span></div></div>
      <p class="small muted">Raum ${m2.toFixed(0)} m²${people.size ? ` · ${(m2 / Math.max(1, people.size)).toFixed(1).replace('.', ',')} m² pro Person (empfohlen ab 1,5)` : ''}${seats < people.size ? ` · <b style="color:var(--accent)">${people.size - seats} Plätze fehlen</b>` : ''}</p>
      ${bad || soso ? `<p class="${bad ? 'err' : 'ok-note'}" style="${bad ? '' : 'background:var(--gold-soft);color:var(--gold)'}">${bad ? `${bad} Tische stehen zu eng oder außerhalb des Raums.` : ''} ${soso ? `${soso} Tische stehen knapp (unter ${String(AISLE_OK / 100).replace('.', ',')} m Abstand).` : ''}</p>` : `<p class="small muted">Alle Abstände passen (mind. ${String(AISLE_OK / 100).replace('.', ',')} m zwischen Tischen).</p>`}`;
    drawList();
  }

  function drawPanel() {
    const el = view.querySelector('#stPanel');
    const it = P.items.find(i => i.id === sel);
    if (mode === 'massstab' && editable) {
      el.innerHTML = `<span class="eyebrow">Maßstab</span><h3>Bekannte Länge markieren</h3>
        <p class="small muted">Tippt zwei Punkte im Grundriss an, deren Abstand ihr kennt, zum Beispiel die Enden einer Wand. Dann tragt die echte Länge ein.</p>
        ${calib.length === 2 ? `<form class="stack" id="stCalForm"><div class="field"><label for="stCalM">Abstand in Metern</label><input id="stCalM" type="number" step="0.01" min="0.5" required inputmode="decimal" value="${(Math.hypot(calib[1][0] - calib[0][0], calib[1][1] - calib[0][1]) / 100).toFixed(2)}"></div><div class="row"><button class="btn small" type="submit">Maßstab übernehmen</button><button class="btn sec small" type="button" id="stCalReset">Neu markieren</button></div></form>` : `<p class="small"><b>${calib.length} von 2</b> Punkten gesetzt.</p>`}`;
      const f = el.querySelector('#stCalForm');
      if (f) { f.onsubmit = e => { e.preventDefault(); applyScale(parseFloat(el.querySelector('#stCalM').value)); }; el.querySelector('#stCalReset').onclick = () => { calib = []; draw(); drawPanel(); }; }
      return;
    }
    if (mode === 'raum' && editable) {
      el.innerHTML = `<span class="eyebrow">Raumkontur</span><h3>Wände anpassen</h3>
        <p class="small muted">Zieht die Ecken an die richtige Stelle. Über die kleinen Punkte in der Mitte einer Wand entsteht eine neue Ecke, so lassen sich auch L-förmige Säle abbilden.</p>
        ${typeof sel === 'string' && sel.startsWith('v') && P.room.pts.length > 3 ? `<button class="btn danger small" id="stDelV">Ausgewählte Ecke entfernen</button>` : ''}`;
      const d = el.querySelector('#stDelV'); if (d) d.onclick = () => { P.room.pts.splice(+sel.slice(1), 1); sel = null; changed(); drawPanel(); };
      return;
    }
    if (!it) {
      el.innerHTML = `<span class="eyebrow">Tisch</span><h3>${editable ? 'Tisch auswählen oder hinzufügen' : 'Tisch auswählen'}</h3><p class="small muted">${editable ? 'Wählt unten eine Tischform. Danach könnt ihr den Tisch verschieben, drehen und Gäste auf die Plätze setzen.' : 'Tippt auf einen Tisch, um die Belegung zu sehen.'}</p>`;
      return;
    }
    const warn = checkPlan(P).get(it.id);
    const free = [...people.keys()].filter(k => !P.items.some(t => t.guests.includes(k)));
    const dis = editable ? '' : 'disabled';
    el.innerHTML = `<span class="eyebrow">${esc(TYPES[it.type]?.label || '')}</span>
      <div class="field"><label for="stName">Name</label><input id="stName" maxlength="40" value="${esc(it.name)}" ${dis}></div>
      ${warn ? `<p class="${warn.level === 2 ? 'err' : 'ok-note'}" style="${warn.level === 2 ? '' : 'background:var(--gold-soft);color:var(--gold)'}">${warn.msgs.map(esc).join('<br>')}</p>` : ''}
      ${editable ? `<div class="fields2">
        ${it.shape === 'round' ? `<div class="field"><label for="stD">Durchmesser (cm)</label><input id="stD" type="number" min="50" max="400" step="10" value="${it.d}"></div>`
          : `<div class="field"><label for="stWd">Länge (cm)</label><input id="stWd" type="number" min="50" max="3000" step="10" value="${it.w}"></div><div class="field"><label for="stHt">Breite (cm)</label><input id="stHt" type="number" min="40" max="1000" step="10" value="${it.h}"></div>`}
        ${it.kind === 'table' ? `<div class="field"><label for="stSeats">Plätze</label><input id="stSeats" type="number" min="1" max="60" value="${it.seats}"></div>` : ''}
      </div>
      ${it.kind === 'table' && it.shape === 'rect' ? `<div class="row small"><label class="row"><input type="checkbox" id="stOne" ${it.sides === 'one' ? 'checked' : ''}> Nur eine Seite (Brauttisch)</label><label class="row"><input type="checkbox" id="stEnds" ${it.ends ? 'checked' : ''} ${it.sides === 'one' ? 'disabled' : ''}> Stirnseiten besetzen</label></div>` : ''}
      <div class="row"><button class="mini" data-r="-15">↺ 15°</button><button class="mini" data-r="15">↻ 15°</button><button class="mini" data-r="90">90°</button><button class="mini" id="stDup">Duplizieren</button><button class="mini acc" id="stDel">Entfernen</button></div>` : ''}
      ${it.kind === 'table' ? `<div class="lbl">Plätze</div><ol class="seatlist">${it.guests.map((g, i) => `<li><span class="mono small">${i + 1}</span>${editable ? `<select data-seat="${i}" aria-label="Platz ${i + 1}"><option value="">— frei —</option>${g ? `<option value="${esc(g)}" selected>${esc(label(g))}</option>` : ''}${free.map(k => `<option value="${esc(k)}">${esc(label(k))}</option>`).join('')}</select>` : `<span>${g ? esc(label(g)) : '<span class="muted">frei</span>'}</span>`}</li>`).join('')}</ol>` : ''}`;
    if (!editable) return;
    const num = (id, fn) => { const x = el.querySelector(id); if (x) x.onchange = () => { const v = parseFloat(x.value); if (v > 0) { fn(v); changed(); drawPanel(); } }; };
    el.querySelector('#stName').oninput = e => { it.name = e.target.value.slice(0, 40); changed(false); };
    num('#stD', v => it.d = Math.min(400, v)); num('#stWd', v => it.w = v); num('#stHt', v => it.h = v);
    num('#stSeats', v => setSeats(it, Math.min(60, Math.round(v))));
    const one = el.querySelector('#stOne'); if (one) one.onchange = () => { it.sides = one.checked ? 'one' : 'both'; changed(); drawPanel(); };
    const ends = el.querySelector('#stEnds'); if (ends) ends.onchange = () => { it.ends = ends.checked; changed(); drawPanel(); };
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { it.rot = ((it.rot || 0) + +b.dataset.r + 360) % 360; changed(); drawPanel(); });
    el.querySelector('#stDup').onclick = () => { const c = structuredClone(it); c.id = 'i' + P.nextId++; c.x += 60; c.y += 60; c.name = nextName(it.kind, it.type); c.guests = new Array(c.guests.length).fill(null); P.items.push(c); sel = c.id; changed(); drawPanel(); };
    el.querySelector('#stDel').onclick = () => { P.items = P.items.filter(x => x !== it); sel = null; changed(); drawPanel(); drawGuests(); };
    el.querySelectorAll('[data-seat]').forEach(s => s.onchange = () => { it.guests[+s.dataset.seat] = s.value || null; changed(); drawPanel(); drawGuests(); });
  }

  function setSeats(it, n) { const g = it.guests.slice(0, n); while (g.length < n) g.push(null); it.guests = g; it.seats = n; drawGuests(); }
  function nextName(kind, type) {
    if (kind === 'zone') return TYPES[type].label;
    if (type === 'braut') return 'Brauttisch';
    const used = new Set(P.items.map(i => i.name)); let n = 1; while (used.has(`Tisch ${n}`)) n++; return `Tisch ${n}`;
  }

  function drawGuests() {
    const el = view.querySelector('#stGuests');
    const free = [...people.keys()].filter(k => !P.items.some(t => t.guests.includes(k)));
    el.innerHTML = `<div class="row between"><div><span class="eyebrow">Gäste</span><h3>${free.length ? `${free.length} ohne Platz` : 'Alle haben einen Platz'}</h3></div>
      ${editable && free.length ? `<button class="btn small" id="stAuto">Automatisch verteilen</button>` : ''}</div>
      <p class="small muted">Hier stehen alle Zusagen aus der Gästeliste, mit Begleitung, dazu das Paar und die Trauzeug:innen. Beim automatischen Verteilen sitzen Begleitungen nebeneinander, das Paar kommt an den Brauttisch.</p>
      ${free.length ? `<div class="meta">${free.map(k => `<span class="pill">${esc(label(k))}</span>`).join('')}</div>` : ''}
      ${editable ? `<form class="row" id="stExtra"><input name="n" maxlength="60" placeholder="Gast ohne App, z. B. Opa Karl" style="flex:1;min-width:160px" aria-label="Gast hinzufügen"><button class="btn sec small" type="submit">Hinzufügen</button></form>
      ${P.extra.length ? `<div class="meta">${P.extra.map(x => `<button class="mini" data-xdel="${esc(x.id)}" title="Entfernen">${esc(x.name)} ×</button>`).join('')}</div>` : ''}` : ''}`;
    if (!editable) return;
    const a = el.querySelector('#stAuto'); if (a) a.onclick = () => { autoAssign(); changed(); drawPanel(); drawGuests(); toast('Gäste verteilt'); };
    el.querySelector('#stExtra').onsubmit = e => { e.preventDefault(); const n = e.target.n.value.trim(); if (!n) return; const id = 'x' + P.nextId++; P.extra.push({ id, name: n.slice(0, 60) }); people.set(id, n.slice(0, 60)); changed(); drawGuests(); drawPanel(); };
    el.querySelectorAll('[data-xdel]').forEach(b => b.onclick = () => { const id = b.dataset.xdel; P.extra = P.extra.filter(x => x.id !== id); people.delete(id); P.items.forEach(t => t.guests = t.guests.map(g => g === id ? null : g)); changed(); drawGuests(); drawPanel(); });
  }

  function autoAssign() {
    const tables = P.items.filter(i => i.kind === 'table');
    const taken = new Set(tables.flatMap(t => t.guests.filter(Boolean)));
    const freeKeys = [...people.keys()].filter(k => !taken.has(k));
    const head = tables.find(t => t.type === 'braut' || t.sides === 'one');
    const place = (t, keys) => { let i = 0; for (const k of keys) { while (i < t.guests.length && t.guests[i]) i++; if (i >= t.guests.length) return false; t.guests[i] = k; } return true; };
    const groups = new Map(); for (const k of freeKeys) { const p = party(k); if (!groups.has(p)) groups.set(p, []); groups.get(p).push(k); }
    if (head) { const couple = ['p1', 'p2'].filter(k => groups.has(k)); couple.forEach(k => groups.delete(k)); place(head, couple); }
    const order = tables.filter(t => t !== head).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    for (const [, keys] of groups) {
      const fits = order.find(t => t.guests.filter(g => !g).length >= keys.length) || (head && head.guests.filter(g => !g).length >= keys.length ? head : null);
      if (fits) place(fits, keys);
      else for (const k of keys) { const t = order.find(t => t.guests.some(g => !g)); if (t) place(t, [k]); }
    }
  }

  function drawList() {
    const tables = P.items.filter(i => i.kind === 'table').sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    view.querySelector('#stList').innerHTML = `<div class="row between"><div><span class="eyebrow">Übersicht</span><h3>Wer sitzt wo</h3></div>
      <div class="row"><button class="btn sec small" id="stPrint">Drucken</button><a class="btn small" href="/#shop">Sitzplan-Poster bestellen</a></div></div>
      ${tables.length ? `<div class="tablelist">${tables.map(t => `<div><b>${esc(t.name)}</b><ul>${t.guests.filter(Boolean).map(g => `<li>${esc(label(g))}</li>`).join('') || '<li class="muted">noch leer</li>'}</ul></div>`).join('')}</div>` : '<p class="empty">Noch keine Tische im Plan.</p>'}`;
    view.querySelector('#stPrint').onclick = () => window.print();
  }

  /* ---- Maßstab & Grundriss ---- */
  function applyScale(meters) {
    if (!(meters > 0) || calib.length !== 2) return;
    const cur = Math.hypot(calib[1][0] - calib[0][0], calib[1][1] - calib[0][1]);
    if (cur < 1) return;
    const k = meters * 100 / cur;
    if (P.img) P.img.cmPerPx *= k;
    P.room.pts = P.room.pts.map(([x, y]) => [Math.round(x * k), Math.round(y * k)]);
    P.items.forEach(it => { it.x = Math.round(it.x * k); it.y = Math.round(it.y * k); });
    calib = []; mode = 'tische'; setMode('tische'); fit(); changed(); toast('Maßstab übernommen');
  }

  async function useImage(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Bitte ein Bild (PNG, JPG oder WebP) verwenden.');
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; }).catch(() => null);
    URL.revokeObjectURL(url);
    if (!img) return toast('Das Bild konnte nicht gelesen werden.');
    const max = 2400, s = Math.min(1, max / Math.max(img.width, img.height));
    const W = Math.round(img.width * s), H = Math.round(img.height * s);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
    // Erkennung auf verkleinerter Kopie
    const ds = Math.min(1, 500 / Math.max(W, H)); const w2 = Math.round(W * ds), h2 = Math.round(H * ds);
    const c2 = document.createElement('canvas'); c2.width = w2; c2.height = h2; const g2 = c2.getContext('2d'); g2.drawImage(c, 0, 0, w2, h2);
    const det = detectRoom(g2.getImageData(0, 0, w2, h2).data, w2, h2);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
    const r = await fetch(`/api/w/${wid}/floorplan`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return toast(e.error || 'Hochladen hat nicht geklappt.'); }
    const cmPerPx = 2000 / W; // vorläufig: Bildbreite = 20 m, bis der Maßstab gesetzt ist
    P.img = { w: W, h: H, cmPerPx, opacity: 0.55, ver: Date.now() };
    const f = cmPerPx / ds;
    P.room.pts = [[det.x0, det.y0], [det.x1, det.y0], [det.x1, det.y1], [det.x0, det.y1]].map(([x, y]) => [Math.round(x * f), Math.round(y * f)]);
    const cx = (P.room.pts[0][0] + P.room.pts[2][0]) / 2, cy = (P.room.pts[0][1] + P.room.pts[2][1]) / 2;
    P.items.forEach((it, i) => { it.x = cx + (i % 4 - 1.5) * 260; it.y = cy + (Math.floor(i / 4) - 1) * 260; });
    fit(); changed(); drawImgCtl();
    toast(det.found ? 'Raumkontur erkannt. Jetzt den Maßstab setzen.' : 'Keine klare Kontur gefunden. Bitte die Ecken anpassen.');
    setMode('massstab');
  }

  function drawImgCtl() {
    const el = view.querySelector('#stImgCtl'); if (!el) return;
    el.innerHTML = P.img ? `<div class="row"><label class="small" for="stOp">Grundriss sichtbar</label><input id="stOp" type="range" min="0" max="1" step="0.05" value="${P.img.opacity ?? 0.55}" style="flex:1"><button class="mini acc" id="stImgDel">Bild entfernen</button></div>` : '';
    if (!P.img) return;
    el.querySelector('#stOp').oninput = e => { P.img.opacity = +e.target.value; draw(); changed(false); };
    el.querySelector('#stImgDel').onclick = async () => { await api(`/api/w/${wid}/floorplan`, { method: 'DELETE' }); P.img = null; fit(); changed(); drawImgCtl(); };
  }

  /* ---- Speichern ---- */
  function changed(redraw = true) {
    if (redraw) draw();
    if (!editable) return;
    const st = view.querySelector('#stSave'); if (st) st.textContent = 'Wird gespeichert …';
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      if (saving) return changed(false); saving = true;
      try { await api(`/api/w/${wid}/seating`, { method: 'PUT', body: { data: P } }); if (st.isConnected) st.textContent = 'Gespeichert'; }
      catch (e) { if (st.isConnected) st.textContent = 'Nicht gespeichert: ' + e.message; }
      finally { saving = false; }
    }, 700);
  }

  /* ---- Modus ---- */
  function setMode(m) {
    mode = m; sel = null; calib = [];
    view.querySelectorAll('#stMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
    const hint = view.querySelector('#stHint');
    if (hint) hint.textContent = { tische: 'Tische antippen und ziehen. Leere Fläche ziehen verschiebt die Ansicht.', raum: 'Ecken ziehen, Mittelpunkte ziehen fügt eine Ecke hinzu.', massstab: 'Zwei Punkte mit bekanntem Abstand antippen.' }[m];
    draw(); drawPanel();
  }

  /* ---- Zeiger: Ziehen, Verschieben, Zoomen ---- */
  const pointers = new Map(); let drag = null, pinch = null;
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), vb: { ...vb } }; drag = null; return; }
    const p = svgPt(e); const h = e.target.closest('[data-h]')?.dataset.h || '';
    const [kind, id] = h.split(':');
    if (mode === 'massstab' && editable) { if (calib.length >= 2) calib = []; calib.push(p); draw(); drawPanel(); return; }
    if (kind === 'item') {
      sel = id; const it = P.items.find(i => i.id === id);
      drag = editable && mode === 'tische' ? { type: 'item', it, dx: p[0] - it.x, dy: p[1] - it.y, moved: false } : null;
      draw(); drawPanel(); return;
    }
    if (editable && mode === 'raum' && kind === 'vtx') { sel = 'v' + id; drag = { type: 'vtx', i: +id, moved: false }; drawPanel(); return; }
    if (editable && mode === 'raum' && kind === 'mid') { const i = +id; P.room.pts.splice(i + 1, 0, p.map(Math.round)); sel = 'v' + (i + 1); drag = { type: 'vtx', i: i + 1, moved: true }; draw(); drawPanel(); return; }
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vb: { ...vb }, moved: false };
  });
  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const f = pinch.d / Math.max(d, 1);
      const cx = pinch.vb.x + pinch.vb.w / 2, cy = pinch.vb.y + pinch.vb.h / 2;
      vb = { x: cx - pinch.vb.w * f / 2, y: cy - pinch.vb.h * f / 2, w: pinch.vb.w * f, h: pinch.vb.h * f }; draw(); return;
    }
    if (!drag) return;
    const snap = v => Math.round(v / 5) * 5;
    if (drag.type === 'item') { const p = svgPt(e); drag.it.x = snap(p[0] - drag.dx); drag.it.y = snap(p[1] - drag.dy); drag.moved = true; draw(); }
    else if (drag.type === 'vtx') { const p = svgPt(e); P.room.pts[drag.i] = [snap(p[0]), snap(p[1])]; drag.moved = true; draw(); }
    else if (drag.type === 'pan') {
      const r = svg.getBoundingClientRect(); const k = Math.max(vb.w / r.width, vb.h / r.height);
      const dx = (e.clientX - drag.sx) * k, dy = (e.clientY - drag.sy) * k;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      vb = { ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy }; draw();
    }
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    if (drag.type === 'pan' && !drag.moved && mode === 'tische' && sel) { sel = null; draw(); drawPanel(); }
    if ((drag.type === 'item' || drag.type === 'vtx') && drag.moved) { changed(false); if (drag.type === 'item') drawPanel(); }
    drag = null;
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', e => { e.preventDefault(); const p = svgPt(e); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, p[0], p[1]); }, { passive: false });

  view.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { const z = b.dataset.z; if (z === 'fit') { fit(); draw(); } else zoom(z === 'in' ? 0.8 : 1.25); });
  view.querySelectorAll('#stMode button').forEach(b => b.onclick = () => setMode(b.dataset.m));
  view.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const type = b.dataset.add, t = TYPES[type];
    const it = { id: 'i' + P.nextId++, type, ...structuredClone(t), x: Math.round(vb.x + vb.w / 2), y: Math.round(vb.y + vb.h / 2), rot: 0, name: nextName(t.kind, type) };
    delete it.label; it.guests = new Array(t.kind === 'table' ? t.seats : 0).fill(null);
    P.items.push(it); if (mode !== 'tische') setMode('tische'); sel = it.id; changed(); drawPanel(); drawGuests();
  });

  if (editable) {
    const file = view.querySelector('#stFile');
    view.querySelector('#stPick').onclick = () => file.click();
    file.onchange = () => useImage(file.files[0]);
    const drop = view.querySelector('#stDrop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); useImage(e.dataTransfer.files[0]); });
    const onPaste = e => {
      if (!view.querySelector('#stSvg')) return document.removeEventListener('paste', onPaste);
      const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
      if (f) { e.preventDefault(); useImage(f); }
    };
    document.addEventListener('paste', onPaste);
    view.querySelector('#stRect').onclick = () => {
      const W = parseFloat(view.querySelector('#stW').value), L = parseFloat(view.querySelector('#stL').value);
      if (!(W >= 3 && L >= 3)) return toast('Bitte Breite und Länge in Metern eintragen.');
      P.room.pts = [[0, 0], [W * 100, 0], [W * 100, L * 100], [0, L * 100]];
      if (P.img) { api(`/api/w/${wid}/floorplan`, { method: 'DELETE' }).catch(() => {}); P.img = null; drawImgCtl(); }
      fit(); changed(); toast('Raum angelegt');
    };
    const b = bounds(); view.querySelector('#stW').value = ((b.x1 - b.x0) / 100).toFixed(1); view.querySelector('#stL').value = ((b.y1 - b.y0) / 100).toFixed(1);
    drawImgCtl();
  }

  fit(); setMode('tische'); drawGuests();
}

function palIcon(t) {
  const c = 'fill="none" stroke="currentColor" stroke-width="1.6"';
  if (t.shape === 'round') return `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="${t.kind === 'zone' ? 7 : 8}" ${c}/>${t.kind === 'table' ? Array.from({ length: 8 }, (_, i) => `<circle cx="${16 + Math.cos(i / 8 * 6.283) * 12.5}" cy="${16 + Math.sin(i / 8 * 6.283) * 12.5}" r="2" fill="currentColor"/>`).join('') : ''}</svg>`;
  const w = Math.min(26, t.w / (Math.max(t.w, t.h) / 22)), h = Math.max(6, t.h / (Math.max(t.w, t.h) / 22));
  return `<svg viewBox="0 0 32 32"><rect x="${16 - w / 2}" y="${16 - h / 2}" width="${w}" height="${h}" rx="1.5" ${c} ${t.kind === 'zone' ? 'stroke-dasharray="3 2"' : ''}/></svg>`;
}
