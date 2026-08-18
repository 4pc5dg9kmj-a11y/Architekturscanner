/* 3D-Druck-Builder: Regler -> Vorschau -> Druckdatei.
 *
 * Das Foto liegt nach dem Hochladen serverseitig; jede Reglerbewegung schickt
 * nur noch die Parameter. Laufende Vorschauen werden abgebrochen, sobald eine
 * neue angefordert wird - so bleibt der letzte Reglerstand massgeblich.
 */

const $ = (sel) => document.querySelector(sel);
const state = {
  id: null,          // Bild-Kennung auf dem Server
  sourceUrl: null,   // Data-URL des Originalfotos (Ansicht "Foto")
  previews: {},      // gerenderte Ansichten
  view: 'relief',
  defaults: {},
  presets: {},
  pending: null,     // laufender fetch-Abbruch
  timer: null,
};

const CONTROLS = [
  'width_mm', 'height_mm', 'plate_thickness_mm', 'margin_mm', 'frame',
  'frame_height_mm', 'line_count', 'angle_deg', 'line_width_min_mm',
  'line_width_max_mm', 'line_height_min_mm', 'line_height_max_mm',
  'wave_amp_mm', 'wave_len_mm', 'wave_phase_deg', 'invert', 'auto_levels',
  'brightness', 'contrast', 'gamma', 'blur_px', 'samples_per_mm',
  'simplify_tol_mm', 'embed_mm',
];

// ---------------------------------------------------------------------------
// Parameter lesen und schreiben
// ---------------------------------------------------------------------------

function readParams() {
  const params = {};
  for (const name of CONTROLS) {
    const el = document.getElementById(name);
    if (!el) continue;
    params[name] = el.type === 'checkbox' ? el.checked : Number(el.value);
  }
  return params;
}

function writeParams(values) {
  for (const [name, value] of Object.entries(values)) {
    const el = document.getElementById(name);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  }
  syncOutputs();
}

function syncOutputs() {
  document.querySelectorAll('#sidebar output[data-for]').forEach((out) => {
    const el = document.getElementById(out.dataset.for);
    if (!el) return;
    out.textContent = num(Number(el.value));
  });
  $('#frame_height_mm').disabled = !$('#frame').checked;
}

/** Zahl mit deutschem Dezimalkomma, ohne überflüssige Nullen. */
function num(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0$/, '').replace('.', ',');
}

// ---------------------------------------------------------------------------
// Vorschau
// ---------------------------------------------------------------------------

function schedulePreview(delay = 220) {
  if (!state.id) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(requestPreview, delay);
}

async function requestPreview() {
  if (!state.id) return;
  if (state.pending) {           // laufende Anfrage verwerfen, neueste zaehlt
    state.pending.abort();
    state.pending = null;
  }
  const controller = new AbortController();
  state.pending = controller;
  $('#busy').classList.remove('hidden');

  try {
    const res = await fetch('/api/relief/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.id, params: readParams() }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Vorschau fehlgeschlagen');
      if (data.reupload) state.id = null;
      return;
    }
    state.previews = data.previews;
    showStats(data.stats);
    renderView();
  } catch (err) {
    if (err.name !== 'AbortError') showError(err.message);
  } finally {
    if (state.pending === controller) {
      state.pending = null;
      $('#busy').classList.add('hidden');
    }
  }
}

function renderView() {
  const img = $('#previewImg');
  const src = state.view === 'source' ? state.sourceUrl : state.previews[state.view];
  if (!src) {
    // Nur bei PDF-Vorlagen: es gibt kein Originalbild zum Anzeigen.
    if (state.view === 'source' && state.id) {
      $('#viewHint').textContent = 'Für PDF-Vorlagen gibt es keine Foto-Ansicht.';
    }
    return;
  }
  img.src = src;
  img.classList.add('ready');
  $('#dropHint').classList.add('hidden');
}

function showStats(s) {
  const parts = [
    `Platte <b>${num(s.width_mm)} × ${num(s.height_mm)} × ${num(s.total_height_mm)} mm</b>`,
    `Linien <b>${s.line_count}</b> im Abstand <b>${num(s.spacing_mm)} mm</b>`,
    `Strich <b>${num(s.width_max_mm)} mm</b> max.`,
    `Länge <b>${num(s.line_length_m)} m</b>`,
    `Dreiecke <b>${s.triangles.toLocaleString('de-DE')}</b>`,
    `STL ca. <b>${num(s.stl_mb)} MB</b>`,
  ];
  if (s.filament_g) {
    parts.push(`Material ca. <b>${num(s.filament_g)} g</b> (${num(s.filament_m)} m)`);
  }
  const notes = (s.notes || []).map((n) => `<span class="note">⚠ ${n}</span>`);
  $('#statsbar').innerHTML = parts.map((p) => `<span>${p}</span>`).join('') + notes.join('');
}

function showError(message) {
  $('#statsbar').innerHTML = `<span class="err">⚠ ${message}</span>`;
}

// ---------------------------------------------------------------------------
// Foto laden
// ---------------------------------------------------------------------------

async function loadFile(file) {
  if (!file) return;
  $('#busy').classList.remove('hidden');
  $('#viewHint').textContent = 'Foto wird gelesen …';

  // Altes Original verwerfen, sonst zeigt die Foto-Ansicht die Vorgängerdatei
  state.sourceUrl = null;
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    const reader = new FileReader();
    reader.onload = () => {
      state.sourceUrl = reader.result;
      if (state.view === 'source') renderView();
    };
    reader.readAsDataURL(file);
  }

  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/relief/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Datei konnte nicht gelesen werden'); return; }
    state.id = data.id;
    $('#viewHint').textContent =
      `${file.name} – ${data.img_w} × ${data.img_h} px`;
    await requestPreview();
  } catch (err) {
    showError(err.message);
  } finally {
    $('#busy').classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function exportModel() {
  if (!state.id) { showError('Erst ein Foto laden.'); return; }
  const btn = $('#btnExport');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Baue Modell …';
  try {
    const res = await fetch('/api/relief/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: state.id, params: readParams(), format: $('#exportFormat').value,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError(data.error || 'Export fehlgeschlagen');
      return;
    }
    const blob = await res.blob();
    const name = (res.headers.get('Content-Disposition') || '')
      .match(/filename="([^"]+)"/)?.[1] || `relief.${$('#exportFormat').value}`;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

function buildPresetButtons() {
  const host = $('#presetButtons');
  host.innerHTML = '';
  for (const [key, preset] of Object.entries(state.presets)) {
    const btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.title = preset.hint;
    btn.addEventListener('click', () => {
      host.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      writeParams(preset.values);
      schedulePreview(0);
    });
    host.appendChild(btn);
  }
  host.firstChild?.classList.add('active');
}

async function init() {
  try {
    const res = await fetch('/api/relief/presets');
    const data = await res.json();
    state.defaults = data.defaults;
    state.presets = data.presets;
    writeParams(state.defaults);
    buildPresetButtons();
  } catch (err) {
    showError(`Server nicht erreichbar: ${err.message}`);
  }

  document.querySelectorAll('#sidebar input').forEach((el) => {
    el.addEventListener('input', () => { syncOutputs(); schedulePreview(); });
    el.addEventListener('change', () => { syncOutputs(); schedulePreview(0); });
  });

  document.querySelectorAll('#viewTabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#viewTabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.view = tab.dataset.view;
      renderView();
    });
  });

  $('#fileInput').addEventListener('change', (e) => loadFile(e.target.files[0]));
  $('#btnExport').addEventListener('click', exportModel);
  $('#btnReset').addEventListener('click', () => {
    writeParams(state.defaults);
    const buttons = $('#presetButtons').querySelectorAll('button');
    buttons.forEach((b) => b.classList.remove('active'));
    buttons[0]?.classList.add('active');   // Vorgaben entsprechen dem ersten Preset
    schedulePreview(0);
  });

  const stage = $('#stage');
  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.classList.add('dragover');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('dragover');
    loadFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'e' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); exportModel(); }
  });
}

init();
