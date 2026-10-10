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
  return async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) }, body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  };
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
