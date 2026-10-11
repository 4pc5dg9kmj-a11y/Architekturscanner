// Durchläuft die wichtigsten Abläufe für alle drei Rollen gegen einen frischen Server.
// Aufruf: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'weddify-test-'));
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, PUBLIC_URL: BASE }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, bad) => { srv.stdout.on('data', d => String(d).includes('läuft') && ok()); srv.on('exit', bad); });

function client() {
  let cookie = '';
  const fn = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) }, body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  };
  fn.cookie = () => cookie;
  return fn;
}
let passed = 0;
const step = (name, fn) => fn().then(() => { passed++; console.log('  ✓', name); });

try {
  const paar = client(), tz = client(), gast = client(), fremd = client();
  let wid, codes, tasks;

  await step('Seiten werden ausgeliefert', async () => {
    const shop = await fetch(BASE + '/'); assert.equal(shop.status, 200); assert.match(await shop.text(), /weddify/);
    const app = await fetch(BASE + '/app'); assert.equal(app.status, 200);
    assert.equal((await fetch(BASE + '/..%2fserver.js')).status, 404);
  });

  await step('Registrierung, Login und Schutz', async () => {
    assert.equal((await paar('POST', '/api/register', { name: 'Lena', email: 'lena@test.de', password: 'kurz' })).status, 400);
    assert.equal((await paar('POST', '/api/register', { name: 'Lena', email: 'lena@test.de', password: 'geheim123' })).status, 201);
    assert.equal((await paar('POST', '/api/register', { name: 'Lena', email: 'LENA@test.de', password: 'geheim123' })).status, 409);
    assert.equal((await fremd('GET', '/api/me')).status, 401);
    assert.equal((await fremd('POST', '/api/login', { email: 'lena@test.de', password: 'falsch123' })).status, 401);
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(r.status, 415, 'Nicht-JSON wird abgelehnt (CSRF-Schutz)');
  });

  await step('Hochzeit anlegen erzeugt Zeitstrahl automatisch', async () => {
    const r = await paar('POST', '/api/weddings', { name1: 'Lena', name2: 'Jonas', date: '2027-06-12', time: '14:00', location: 'Gut Sonnenhof' });
    assert.equal(r.status, 201); wid = r.body.id;
    const w = await paar('GET', `/api/w/${wid}`);
    codes = w.body.wedding; assert.ok(codes.guest_code && codes.witness_code && codes.partner_code);
    tasks = (await paar('GET', `/api/w/${wid}/tasks`)).body.tasks;
    assert.ok(tasks.length >= 25);
    const standesamt = tasks.find(t => t.title.includes('Standesamt'));
    assert.equal(standesamt.due, '2026-12-12', '182 Tage vor dem 12.06.2027');
  });

  await step('Jeder Schritt lässt sich anpassen', async () => {
    const t = tasks[0];
    const e = await paar('PATCH', `/api/tasks/${t.id}`, { title: 'Budget mit Eltern besprechen', due: '2026-07-01', done: true });
    assert.equal(e.body.task.title, 'Budget mit Eltern besprechen'); assert.equal(e.body.task.custom_due, true); assert.equal(e.body.task.done, true);
    const add = await paar('POST', `/api/w/${wid}/tasks`, { title: 'Brautstrauß bestellen', due: '2027-05-20', note: 'Pfingstrosen' });
    assert.equal(add.status, 201);
    assert.equal((await paar('DELETE', `/api/tasks/${tasks[1].id}`)).status, 200);
  });

  await step('Datum ändern: automatische Schritte wandern mit, eigene bleiben', async () => {
    const r = await paar('PATCH', `/api/w/${wid}`, { date: '2027-07-10' });
    assert.ok(r.body.moved > 20);
    const now = (await paar('GET', `/api/w/${wid}/tasks`)).body.tasks;
    assert.equal(now.find(t => t.title.includes('Standesamt')).due, '2027-01-09');
    assert.equal(now.find(t => t.title.startsWith('Budget mit')).due, '2026-07-01', 'von Hand gesetztes Datum bleibt');
    assert.equal(now.find(t => t.title.startsWith('Brautstrauß')).due, '2027-05-20');
    const reset = await paar('PATCH', `/api/tasks/${tasks[0].id}`, { reset_due: true });
    assert.equal(reset.body.task.due, '2026-07-10'); assert.equal(reset.body.task.custom_due, false);
  });

  await step('Trauzeug:in tritt bei und hat eigenen Zeitplan', async () => {
    await tz('POST', '/api/register', { name: 'Mia', email: 'mia@test.de', password: 'geheim123' });
    const j = await tz('POST', '/api/join', { code: codes.witness_code.toLowerCase() });
    assert.equal(j.body.role, 'trauzeuge');
    const tt = (await tz('GET', `/api/w/${wid}/tasks`)).body.tasks;
    assert.ok(tt.some(t => t.title.includes('Junggesell')));
    assert.equal((await paar('PATCH', `/api/tasks/${tt[0].id}`, { done: true })).status, 404, 'Paar sieht Trauzeugen-Aufgaben nicht');
    assert.equal((await tz('PATCH', `/api/tasks/${tasks[2].id}`, { done: true })).status, 404, 'Trauzeugin ändert keine Paar-Aufgaben');
    const w = (await tz('GET', `/api/w/${wid}`)).body.wedding;
    assert.equal(w.witness_code, undefined); assert.equal(w.partner_code, undefined);
    assert.equal((await tz('PATCH', `/api/w/${wid}`, { name1: 'X' })).status, 403);
  });

  await step('Gast sagt zu und schreibt für die Zeitung', async () => {
    await gast('POST', '/api/register', { name: 'Tante Hilde', email: 'hilde@test.de', password: 'geheim123' });
    assert.equal((await gast('POST', '/api/join', { code: codes.guest_code })).body.role, 'gast');
    assert.equal((await gast('GET', `/api/w/${wid}/tasks`)).status, 403);
    assert.equal((await gast('GET', `/api/w/${wid}/guests`)).status, 403);
    assert.equal((await gast('PUT', `/api/w/${wid}/rsvp`, { status: 'zusage', persons: 2, menu: 'vegetarisch', allergies: 'Nüsse', song: 'Marmor, Stein und Eisen bricht' })).status, 200);
    assert.equal((await gast('POST', `/api/w/${wid}/contributions`, { kind: 'geschichte', text: 'Wie Lena als Kind …' })).status, 201);
    const w = (await gast('GET', `/api/w/${wid}`)).body.wedding;
    assert.equal(w.guest_code, undefined);
  });

  await step('Paar und Trauzeugin sehen Zusagen, nur Trauzeugin sieht Beiträge', async () => {
    const g = (await paar('GET', `/api/w/${wid}/guests`)).body;
    assert.equal(g.stats.zusage, 1); assert.equal(g.stats.personen, 2); assert.equal(g.stats.menus.vegetarisch, 2);
    assert.equal((await tz('GET', `/api/w/${wid}/guests`)).status, 200);
    assert.equal((await paar('GET', `/api/w/${wid}/contributions`)).status, 403, 'Überraschung bleibt geheim');
    assert.equal((await tz('GET', `/api/w/${wid}/contributions`)).body.items.length, 1);
  });

  await step('Ablauf: Paar bearbeitet, alle lesen', async () => {
    assert.equal((await paar('POST', `/api/w/${wid}/schedule`, { time: '17:30', title: 'Gruppenfoto' })).status, 201);
    assert.equal((await gast('POST', `/api/w/${wid}/schedule`, { time: '17:30', title: 'X' })).status, 403);
    assert.ok((await gast('GET', `/api/w/${wid}/schedule`)).body.items.some(s => s.title === 'Gruppenfoto'));
  });

  await step('Kalender-Abo liefert gültige ICS-Datei', async () => {
    const url = (await paar('GET', `/api/w/${wid}`)).body.calendar_url.replace(BASE, '');
    const r = await fetch(BASE + url); const ics = await r.text();
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/calendar/);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /BEGIN:VALARM/); assert.match(ics, /DTSTART:20270710T140000/);
    assert.ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
    assert.equal((await fetch(BASE + '/cal/falsch.ics')).status, 404);
  });

  await step('Sitzplan: speichern, Rechte, Grundriss, eigener Platz', async () => {
    const g = (await paar('GET', `/api/w/${wid}/guests`)).body.guests[0];
    const plan = { v: 1, room: { pts: [[0, 0], [1200, 0], [1200, 1600], [0, 1600]] }, extra: [], nextId: 3,
      items: [{ id: 'i1', type: 'rund180', kind: 'table', shape: 'round', d: 180, seats: 10, x: 300, y: 300, rot: 0, name: 'Tisch 3', guests: [null, `u${g.id}`, null, null, null, null, null, null, null, null] }] };
    assert.equal((await paar('PUT', `/api/w/${wid}/seating`, { data: plan })).status, 200);
    assert.equal((await tz('PUT', `/api/w/${wid}/seating`, { data: plan })).status, 403);
    assert.equal((await gast('GET', `/api/w/${wid}/seating`)).status, 403, 'Gäste sehen nicht den ganzen Plan');
    assert.equal((await tz('GET', `/api/w/${wid}/seating`)).body.data.items[0].name, 'Tisch 3');
    const seat = (await gast('GET', `/api/w/${wid}/my-seat`)).body;
    assert.equal(seat.table, 'Tisch 3'); assert.equal(seat.seat, 2);
    // Bild-Upload: nur echte Bilder
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = (type, body) => fetch(`${BASE}/api/w/${wid}/floorplan`, { method: 'PUT', headers: { 'Content-Type': type, Cookie: paar.cookie() }, body });
    assert.equal((await up('image/png', png)).status, 200);
    assert.equal((await up('image/png', Buffer.from('nicht ein bild'))).status, 415);
    assert.equal((await up('text/html', Buffer.from('<script>'))).status, 415);
    const img = await fetch(`${BASE}/api/w/${wid}/floorplan`, { headers: { Cookie: paar.cookie() } });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await gast('GET', `/api/w/${wid}/floorplan`)).status, 403);
    assert.ok((await paar('GET', `/api/w/${wid}/seating`)).body.has_floorplan);
  });

  await step('Sitzplan-Logik: Raumerkennung und Abstandsprüfung', async () => {
    const { detectRoom, checkPlan, seatsOf } = await import('../public/seating.js');
    // 100×80 Bild mit Rahmen (Wände) bei x=10..90, y=10..70
    const w = 100, h = 80, d = new Uint8ClampedArray(w * h * 4).fill(255);
    const px = (x, y) => { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; };
    for (let x = 10; x <= 90; x++) { px(x, 10); px(x, 70); } for (let y = 10; y <= 70; y++) { px(10, y); px(90, y); }
    const r = detectRoom(d, w, h);
    assert.deepEqual([r.x0, r.y0, r.x1, r.y1, r.found], [10, 10, 90, 70, true]);
    // Dicke Wände plus dünne Maßlinie darunter: die Maßlinie darf nicht als Wand zählen
    const W2 = 340, H2 = 300, d2 = new Uint8ClampedArray(W2 * H2 * 4).fill(255);
    const px2 = (x, y) => { const i = (y * W2 + x) * 4; d2[i] = d2[i + 1] = d2[i + 2] = 0; };
    for (let t = 0; t < 4; t++) { for (let x = 20; x <= 320; x++) { px2(x, 20 + t); px2(x, 240 - t); } for (let y = 20; y <= 240; y++) { px2(20 + t, y); px2(320 - t, y); } }
    for (let x = 20; x <= 320; x++) px2(x, 262);
    const r2 = detectRoom(d2, W2, H2);
    assert.deepEqual([r2.x0, r2.y0, r2.x1, r2.y1], [20, 20, 320, 240], 'Maßlinie wird ignoriert');
    const room = { pts: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] };
    const t = (id, x, y) => ({ id, name: id, kind: 'table', shape: 'round', d: 180, seats: 10, x, y, rot: 0, guests: [] });
    assert.equal(checkPlan({ room, items: [t('A', 200, 200), t('B', 600, 200)] }).size, 0, '220 cm Abstand ist ok');
    assert.equal(checkPlan({ room, items: [t('A', 200, 200), t('B', 450, 200)] }).get('A').level, 2, '70 cm ist zu eng');
    assert.equal(checkPlan({ room, items: [t('A', 200, 200), t('B', 510, 200)] }).get('A').level, 1, '130 cm ist knapp');
    assert.equal(checkPlan({ room, items: [t('A', 50, 500)] }).get('A').level, 2, 'außerhalb des Raums');
    assert.equal(seatsOf({ kind: 'table', shape: 'rect', w: 200, h: 80, seats: 8, ends: true, sides: 'both' }).length, 8);
    assert.ok(seatsOf({ kind: 'table', shape: 'rect', w: 240, h: 80, seats: 4, sides: 'one' }).every(([, y]) => y < 0), 'Brauttisch nur einseitig');
  });

  await step('Viele Gäste im selben WLAN können sich registrieren', async () => {
    for (let i = 0; i < 25; i++) { const c = client(); const r = await c('POST', '/api/register', { name: 'G' + i, email: `wlan${i}@test.de`, password: 'geheim123' }); assert.equal(r.status, 201); assert.equal((await c('POST', '/api/join', { code: codes.guest_code })).status, 201); }
  });

  await step('Fremde sehen nichts', async () => {
    await fremd('POST', '/api/register', { name: 'Fremd', email: 'x@test.de', password: 'geheim123' });
    assert.equal((await fremd('GET', `/api/w/${wid}`)).status, 404);
    assert.equal((await fremd('PATCH', `/api/tasks/${tasks[2].id}`, { done: true })).status, 404);
    assert.equal((await fremd('POST', '/api/join', { code: 'G-FALSCH' })).status, 404);
  });

  await step('Zeitplan neu erstellen', async () => {
    assert.equal((await paar('POST', `/api/w/${wid}/tasks/regenerate`)).status, 200);
    const t = (await paar('GET', `/api/w/${wid}/tasks`)).body.tasks;
    assert.ok(!t.some(x => x.title.startsWith('Brautstrauß')));
  });

  console.log(`\n${passed} Prüfungen bestanden.`);
} catch (e) {
  console.error('\n✗ Fehler:', e.message); process.exitCode = 1;
} finally {
  srv.kill(); rmSync(dataDir, { recursive: true, force: true });
}
