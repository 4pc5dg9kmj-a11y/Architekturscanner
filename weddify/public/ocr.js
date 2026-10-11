// Texterkennung im Browser mit Tesseract.js (vendor/ocr, Apache-2.0). Bilder verlassen das Gerät dafür nicht.
let workerP = null, progressCb = null;

function loadScript(src) {
  return new Promise((ok, bad) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Texterkennung konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

async function worker() {
  if (!workerP) workerP = (async () => {
    await loadScript('/vendor/ocr/tesseract.min.js');
    return window.Tesseract.createWorker('deu+eng', 1, {
      workerPath: '/vendor/ocr/worker.min.js', corePath: '/vendor/ocr/core', langPath: '/vendor/ocr/lang', workerBlobURL: false,
      logger: m => progressCb?.(m),
    });
  })().catch(e => { workerP = null; throw e; });
  return workerP;
}

// Bild laden, verkleinern und für die Erkennung kontrastreicher machen
export async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Das Bild konnte nicht gelesen werden.')); i.src = url; });
  URL.revokeObjectURL(url);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const ocr = document.createElement('canvas'); ocr.width = w; ocr.height = h;
  const g = ocr.getContext('2d'); g.filter = 'grayscale(1) contrast(1.5) brightness(1.05)'; g.drawImage(img, 0, 0, w, h);
  const up = document.createElement('canvas'); const s2 = Math.min(1, 1600 / Math.max(img.width, img.height));
  up.width = Math.round(img.width * s2); up.height = Math.round(img.height * s2); up.getContext('2d').drawImage(img, 0, 0, up.width, up.height);
  const blob = await new Promise(ok => up.toBlob(ok, 'image/jpeg', 0.85));
  return { ocrCanvas: ocr, blob, preview: up.toDataURL('image/jpeg', 0.7) };
}

export async function recognize(canvas, onProgress) {
  const w = await worker();
  progressCb = onProgress;
  try { const { data } = await w.recognize(canvas); return data.text || ''; }
  finally { progressCb = null; }
}
