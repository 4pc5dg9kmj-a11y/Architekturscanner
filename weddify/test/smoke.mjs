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
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
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
    const ev = w.body.events; assert.ok(ev.some(e => e.key === 'standesamt' && e.date === '2027-06-11'), 'Standesamt am Vortag');
    assert.ok(ev.some(e => e.key === 'freie_trauung') && ev.some(e => e.key === 'feier'));
    const anm = tasks.find(t => t.title === 'Eheschließung beim Standesamt anmelden');
    assert.equal(anm.due, addDays('2027-06-11', -180), '180 Tage vor dem Standesamt');
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(tasks.every(t => t.done || t.due >= today), 'keine Aufgabe startet überfällig');
    assert.equal(w.body.wedding.time, w.body.events.find(e => e.key === 'feier').time, 'Uhrzeit folgt der Hauptfeier');
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
    assert.equal(now.find(t => t.title === 'Eheschließung beim Standesamt anmelden').due, addDays('2027-07-09', -180));
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
      items: [{ id: 'i1', type: 'rund180', kind: 'table', shape: 'round', d: 180, seats: 10, x: 300, y: 300, rot: 0, name: 'Tisch 3', guests: [null, `g${g.id}`, null, null, null, null, null, null, null, null] }] };
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

  await step('Automatische Tischverteilung', async () => {
    const { autoLayout, checkPlan } = await import('../public/seating.js');
    const room = { pts: [[0, 0], [1800, 0], [1800, 1200], [0, 1200]] };
    const base = { shape: 'auto', size: 'auto', head: true, dance: true, reserve: 2, headSeats: 4 };
    const r = autoLayout({ room, items: [], nextId: 1 }, { ...base, persons: 80 });
    assert.equal(r.missing, 0, r.info);
    assert.ok(r.seats >= 80);
    assert.ok(r.items.some(i => i.type === 'braut') && r.items.some(i => i.type === 'tanz'));
    const warn = checkPlan({ room, items: r.items });
    assert.equal([...warn.values()].filter(w => w.level === 2).length, 0, 'keine roten Warnungen: ' + JSON.stringify([...warn.values()].map(w => w.msgs)));
    assert.equal([...warn.values()].filter(w => w.level === 1).length, 0, 'keine gelben Warnungen');
    const r60 = autoLayout({ room, items: [], nextId: 1 }, { ...base, persons: 60 });
    assert.ok(r60.items.filter(i => i.kind === 'table' && i.type !== 'braut').every(t => t.d === 180), 'Standard: Ø 180, wenn genug Platz');
    assert.ok(r.items.filter(i => i.kind === 'table' && i.type !== 'braut').every(t => t.d === 150), 'Wird es eng, kleinere runde Tische');
    // Zu voll: meldet fehlende Plätze
    const full = autoLayout({ room, items: [], nextId: 1 }, { ...base, persons: 250 });
    assert.ok(full.missing > 0); assert.match(full.info, /fehlen/);
    // Lange Tafeln, ohne Tanzfläche: passt mehr Menschen in denselben Raum
    const taf = autoLayout({ room, items: [], nextId: 1 }, { ...base, shape: 'tafel', dance: false, persons: 140 });
    assert.equal(taf.missing, 0, taf.info);
    assert.equal([...checkPlan({ room, items: taf.items }).values()].filter(w => w.level === 2).length, 0);
    // Feste Größe wird respektiert, vorhandene Bar bleibt stehen
    const bar = { id: 'b', type: 'bar', kind: 'zone', shape: 'rect', w: 250, h: 80, x: 200, y: 1100, rot: 0, name: 'Bar', guests: [] };
    const fix = autoLayout({ room, items: [bar], nextId: 1 }, { ...base, shape: 'rund', size: '0', persons: 50 });
    assert.ok(fix.items.some(i => i.id === 'b'));
    assert.ok(fix.items.filter(i => i.kind === 'table' && i.type !== 'braut').every(t => t.d === 150));
  });

  await step('Viele Gäste im selben WLAN können sich registrieren', async () => {
    for (let i = 0; i < 25; i++) { const c = client(); const r = await c('POST', '/api/register', { name: 'G' + i, email: `wlan${i}@test.de`, password: 'geheim123' }); assert.equal(r.status, 201); assert.equal((await c('POST', '/api/join', { code: codes.guest_code })).status, 201); }
  });

  await step('Deutsch-türkisch-islamische Hochzeit: Plan aus wenigen Angaben', async () => {
    const r = await paar('POST', '/api/weddings', { name1: 'Ayşe', name2: 'Deniz', date: '2027-02-20', location: 'Festsaal Köln', profile: { traditions: ['standesamt', 'tuerkisch', 'islamisch'], guests: 250, options: { noAlcohol: true, separated: true, bismillah: true }, langs: ['de', 'tr'] } });
    assert.equal(r.status, 201);
    assert.ok(r.body.warnings.some(x => /Ramadan/.test(x)), 'Ramadan-Hinweis für Februar 2027');
    const w2 = r.body.id;
    const info = (await paar('GET', `/api/w/${w2}`)).body;
    const keys = info.events.map(e => e.key);
    for (const k of ['standesamt', 'nikah', 'henna', 'kina', 'feier']) assert.ok(keys.includes(k), 'Feier ' + k);
    assert.equal(info.events.find(e => e.key === 'feier').title, 'Düğün');
    assert.equal(info.events.find(e => e.key === 'henna').scope, 'frauen');
    const t = (await paar('GET', `/api/w/${w2}/tasks`)).body.tasks;
    for (const title of ['Mahr (Brautgabe) zwischen den Familien vereinbaren', 'Takı-Zeremonie vorbereiten', 'Halal-Catering prüfen', 'Alkoholfreies Getränkekonzept planen', 'Getrennte Bereiche für Damen und Herren planen']) assert.ok(t.some(x => x.title === title), title);
    assert.equal(t.filter(x => x.vendor_cat === 'location' && /buchen/.test(x.title)).length, 1, 'Location nur einmal buchen');
    // Budget aus Gästezahl geschätzt, inkl. traditioneller Posten
    const b = (await paar('GET', `/api/w/${w2}/budget`)).body;
    assert.equal(b.total, Math.round((250 * 170 + 3500) / 500) * 500);
    assert.ok(b.items.some(i => i.cat === 'davul') && b.items.some(i => i.cat === 'henna'));
    assert.ok(Math.abs(b.planned - b.total) < 200, 'Posten summieren sich zum Budget');
    // Dienstleister buchen → Aufgabe erledigt, Zahlungen im Zeitplan und Kalender
    const vs = (await paar('GET', `/api/w/${w2}/vendors`)).body.vendors;
    const loc = vs.find(v => v.cat === 'location');
    await paar('PATCH', `/api/vendors/${loc.id}`, { name: 'Festsaal Rhein', status: 'gebucht', price: 9000, deposit: 3000, deposit_due: '2026-11-01', rest_due: '2027-02-06' });
    const t2 = (await paar('GET', `/api/w/${w2}/tasks`)).body;
    assert.ok(t2.tasks.find(x => x.vendor_cat === 'location' && /buchen/.test(x.title)).done, 'Buchungsaufgabe automatisch erledigt');
    assert.equal(t2.payments.length, 2); assert.equal(t2.payments[1].amount, 6000);
    const b2 = (await paar('GET', `/api/w/${w2}/budget`)).body;
    assert.equal(b2.items.find(i => i.cat === 'location').actual, 9000);
    await paar('PATCH', `/api/vendors/${loc.id}`, { deposit_paid: true });
    assert.equal((await paar('GET', `/api/w/${w2}/budget`)).body.paid, 3000);
    const ics = await (await fetch(info.calendar_url)).text();
    assert.match(ics, /Restzahlung Festsaal Rhein/); assert.doesNotMatch(ics, /Anzahlung Festsaal Rhein/, 'bezahlte Rate nicht mehr im Kalender');
    assert.match(ics, /Kına-Abend/);
    // Gästeliste per Schnellerfassung, Einladungen nach Gästekreis
    const imp = await paar('POST', `/api/w/${w2}/guests/import`, { text: 'Fatma Yılmaz\t2\tFamilie Braut\tfatma@test.de\t"Ringstr. 1\n50667 Köln"\nAhmet Kaya; 4; Freunde\nOma Emine' });
    assert.equal(imp.body.imported, 3);
    const gl = (await paar('GET', `/api/w/${w2}/guests`)).body;
    const fatma = gl.guests.find(g => g.name === 'Fatma Yılmaz');
    assert.equal(fatma.adults, 2); assert.equal(fatma.address, 'Ringstr. 1, 50667 Köln');
    const evId = k => info.events.find(e => e.key === k).id;
    assert.ok(fatma.invites.some(i => i.event_id === evId('nikah')), 'Familie zur Nikah eingeladen');
    assert.ok(!gl.guests.find(g => g.name === 'Ahmet Kaya').invites.some(i => i.event_id === evId('nikah')), 'Freunde nicht zur Nikah');
    await paar('PATCH', `/api/guests/${fatma.id}`, { gender: 'w', invites: { [evId('henna')]: true } });
    // Zusage ohne Konto über persönlichen Link, je Feier
    const anon = client();
    const rs = (await anon('GET', `/api/rsvp/${fatma.token}`)).body;
    assert.equal(rs.guest.name, 'Fatma Yılmaz'); assert.ok(rs.invites.length >= 3);
    assert.equal((await anon('PUT', `/api/rsvp/${fatma.token}`, { answers: rs.invites.map(i => ({ event_id: i.event_id, status: i.key === 'henna' ? 'absage' : 'zusage', persons: 2 })), allergies: 'Nüsse' })).status, 200);
    const gl2 = (await paar('GET', `/api/w/${w2}/guests`)).body;
    assert.equal(gl2.perEvent.find(x => x.event_id === evId('feier')).personen, 2);
    assert.equal(gl2.perEvent.find(x => x.event_id === evId('henna')).absage, 1);
    assert.equal((await anon('GET', '/api/rsvp/falscher-token-123')).status, 404);
    assert.equal((await anon('GET', `/api/w/${w2}/guests`)).status, 401);
    // Geschenk → Danksagung; Cockpit verknüpft alles
    await paar('POST', `/api/w/${w2}/gifts`, { guest_id: fatma.id, kind: 'gold', description: 'Goldarmband (Takı)' });
    const ov = (await paar('GET', `/api/w/${w2}/overview`)).body;
    assert.equal(ov.guests.entries, 3); assert.equal(ov.guests.persons, 7); assert.equal(ov.vendors.booked, 1); assert.equal(ov.gifts.total, 1);
    assert.equal(ov.budget.nextPayments[0].title, 'Restzahlung Festsaal Rhein');
    // Datum verschieben: alle Feiern wandern mit
    await paar('PATCH', `/api/w/${w2}`, { date: '2027-05-15' });
    const ev2 = (await paar('GET', `/api/w/${w2}`)).body.events;
    assert.equal(ev2.find(e => e.key === 'kina').date, '2027-05-14'); assert.equal(ev2.find(e => e.key === 'henna').date, '2027-05-13');
    // Tradition nachträglich ergänzen: Polterabend kommt dazu, bestehende Daten bleiben
    const pr = await paar('PATCH', `/api/w/${w2}/profile`, { traditions: ['standesamt', 'tuerkisch', 'islamisch', 'polterabend'] });
    assert.equal(pr.status, 200);
    const ev3 = (await paar('GET', `/api/w/${w2}`)).body.events;
    assert.ok(ev3.some(e => e.key === 'polterabend')); assert.equal(ev3.length, ev2.length + 1);
    assert.equal((await paar('GET', `/api/w/${w2}/guests`)).body.guests.length, 3);
  });

  await step('Kostenrechner, Belege & Budget-Verknüpfung', async () => {
    const r = await paar('POST', '/api/weddings', { name1: 'Lea', name2: 'Tom', date: '2027-09-11', profile: { traditions: ['standesamt', 'frei', 'polterabend'], guests: 100 } });
    const w3 = r.body.id;
    const m = (await paar('GET', `/api/w/${w3}/cost-model`)).body;
    assert.ok(m.items.some(i => i.cat === 'trauredner') && m.items.some(i => i.cat === 'polterabend' && i.type === 'guest'));
    assert.ok(!m.items.some(i => i.cat === 'davul'), 'keine fremden Traditionen');
    const ap = (await paar('POST', `/api/w/${w3}/budget/apply`, { items: [{ cat: 'catering', label: 'Essen & Catering', planned: 7500 }, { cat: 'trauredner', label: 'Trauredner:in', planned: 1100 }], total: 25000 })).body;
    assert.equal(ap.total, 25000); assert.equal(ap.items.find(i => i.cat === 'catering').planned, 7500);
    // Beleg ohne Dienstleister erhöht Kosten und Bezahltes
    const e1 = (await paar('POST', `/api/w/${w3}/expenses`, { amount: 130, date: '2027-05-12', merchant: 'Blumen Rosenhof', cat: 'florist', paid_by: 'Lea' })).body.id;
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
    const up = await fetch(`${BASE}/api/expenses/${e1}/receipt`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Cookie: paar.cookie() }, body: jpg });
    assert.equal(up.status, 200);
    assert.equal((await fetch(`${BASE}/api/expenses/${e1}/receipt`, { method: 'PUT', headers: { 'Content-Type': 'text/html', Cookie: paar.cookie() }, body: '<b>' })).status, 415);
    const get = await fetch(`${BASE}/api/expenses/${e1}/receipt`, { headers: { Cookie: paar.cookie() } });
    assert.equal(get.status, 200); assert.match(get.headers.get('content-security-policy'), /sandbox/);
    let b = (await paar('GET', `/api/w/${w3}/budget`)).body;
    assert.equal(b.items.find(i => i.cat === 'florist').actual, 130); assert.equal(b.items.find(i => i.cat === 'florist').paid, 130);
    // Beleg als Zahlung an gebuchten Dienstleister: kein doppeltes Zählen
    const vs = (await paar('GET', `/api/w/${w3}/vendors`)).body.vendors; const loc = vs.find(v => v.cat === 'location');
    await paar('PATCH', `/api/vendors/${loc.id}`, { status: 'gebucht', price: 5000 });
    await paar('POST', `/api/w/${w3}/expenses`, { amount: 2000, merchant: 'Gut Sonnenhof', cat: 'location', vendor_id: loc.id });
    b = (await paar('GET', `/api/w/${w3}/budget`)).body;
    assert.equal(b.items.find(i => i.cat === 'location').actual, 5000, 'Preis bleibt 5000'); assert.equal(b.items.find(i => i.cat === 'location').paid, 2000);
    assert.equal((await paar('POST', `/api/w/${w3}/expenses`, { amount: 0 })).status, 400);
    assert.equal((await tz('GET', `/api/w/${w3}/expenses`)).status, 404, 'Fremde Hochzeit');
    assert.equal((await paar('GET', `/api/w/${w3}/overview`)).body.expenses.n, 2);
    assert.equal((await paar('DELETE', `/api/expenses/${e1}`)).status, 200);
    // Beleg-Parser
    const { parseReceipt } = await import('../public/receipt-parse.js');
    const p1 = parseReceipt('Blumen Rosenhof GmbH\n12.05.2027\nBrautstrauß 89,00\nZwischensumme 137,00\nSUMME EUR 130,00\nMwSt 7% 8,50\nBar 150,00\nRückgeld 20,00', ['florist']);
    assert.deepEqual([p1.amount, p1.date, p1.cat, p1.sure], [130, '2027-05-12', 'florist', true]);
    const p2 = parseReceipt('METRO\nGesamtbetrag\n1.234,56\n03.06.27');
    assert.deepEqual([p2.amount, p2.date], [1234.56, '2027-06-03']);
  });

  await step('Weitere Kulturen: jüdisch, indisch, orthodox', async () => {
    const j = await paar('POST', '/api/weddings', { name1: 'Mira', name2: 'Ben', date: '2027-06-12', profile: { traditions: ['standesamt', 'juedisch'] } });
    assert.ok(j.body.warnings.some(x => /Schabbat/.test(x)), 'Samstag-Warnung');
    const i = await paar('POST', '/api/weddings', { name1: 'Priya', name2: 'Arjun', date: '2027-11-20', profile: { traditions: ['indisch'], guests: 300 } });
    assert.ok(i.body.warnings.some(x => /Standesamt/.test(x)), 'Hinweis auf fehlendes Standesamt');
    const ie = (await paar('GET', `/api/w/${i.body.id}`)).body.events;
    assert.deepEqual(['haldi', 'mehndi', 'pheras', 'sangeet', 'feier'].every(k => ie.some(e => e.key === k)), true);
    assert.equal(ie.find(e => e.key === 'feier').title, 'Reception');
    const o = await paar('POST', '/api/weddings', { name1: 'Eleni', name2: 'Nikos', date: '2027-08-07', profile: { traditions: ['standesamt', 'orthodox'] } });
    assert.ok(o.body.warnings.some(x => /Fastenzeit/.test(x)));
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
