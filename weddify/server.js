import http from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { db, tx, DATA_DIR } from './db.js';
import { buildPlan, normalizeProfile, estimateBudget } from './generator.js';
import { catalog, dateWarnings, VENDOR_CATS, costItems, REGIONS } from './traditions.js';

const PORT = Number(process.env.PORT || 3000);
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const SESSION_DAYS = 30;
const scrypt = promisify(crypto.scrypt);

/* ---------------- Hilfsfunktionen ---------------- */

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return {};
  const type = req.headers['content-type'] || '';
  // Nur JSON annehmen: Formulare fremder Seiten können kein JSON ohne CORS-Vorabprüfung senden (CSRF-Schutz).
  if (!type.startsWith('application/json')) fail(415, 'Bitte als JSON senden.');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 600_000) fail(413, 'Anfrage zu groß.'); chunks.push(c); }
  if (!size) return {};
  try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); return v && typeof v === 'object' ? v : {}; }
  catch { fail(400, 'Ungültiges JSON.'); }
}

const parseCookies = h => Object.fromEntries((h || '').split(';').map(p => p.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rid = (n = 9) => crypto.randomBytes(n).toString('base64url');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = prefix => prefix + '-' + Array.from(crypto.randomBytes(6), b => CODE_CHARS[b % CODE_CHARS.length]).join('');

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function str(v, max, field, { required = false } = {}) {
  if (v === undefined || v === null) { if (required) fail(400, `${field} fehlt.`); return undefined; }
  if (typeof v !== 'string') fail(400, `${field} ist ungültig.`);
  const s = v.trim();
  if (required && !s) fail(400, `${field} fehlt.`);
  if (s.length > max) fail(400, `${field} ist zu lang (max. ${max} Zeichen).`);
  return s;
}

async function hashPassword(pw) { const salt = rid(16); const h = await scrypt(pw, salt, 64); return `scrypt$${salt}$${h.toString('base64url')}`; }
async function checkPassword(pw, stored) {
  const [, salt, hash] = stored.split('$');
  const h = await scrypt(pw, salt, 64); const b = Buffer.from(hash, 'base64url');
  return b.length === h.length && crypto.timingSafeEqual(b, h);
}

function createSession(res, userId) {
  const token = rid(32);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', `wfy=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}`);
}
function currentUser(req) {
  const token = parseCookies(req.headers.cookie).wfy;
  if (!token) return null;
  const row = db.prepare('SELECT u.id, u.name, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(token));
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, name: row.name, email: row.email };
}
const needUser = req => currentUser(req) || fail(401, 'Bitte meldet euch an.');
function membership(user, wid, roles) {
  const m = db.prepare('SELECT role, cal_token FROM members WHERE wedding_id = ? AND user_id = ?').get(wid, user.id);
  if (!m) fail(404, 'Diese Hochzeit gibt es nicht oder ihr seid nicht eingeladen.');
  if (roles && !roles.includes(m.role)) fail(403, 'Dieser Bereich ist für eure Rolle nicht freigegeben.');
  return m;
}

// Begrenzung pro IP: gezählt werden nur Fehlversuche (falsches Passwort, falscher Code),
// damit viele Gäste im selben WLAN sich problemlos registrieren können. Registrierungen haben ein eigenes, großzügiges Limit.
const attempts = new Map();
const ipOf = req => (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
function bucket(req, kind) {
  const key = kind + ':' + ipOf(req); const now = Date.now();
  let a = attempts.get(key); if (!a || now > a.reset) { a = { n: 0, reset: now + 15 * 6e4 }; attempts.set(key, a); }
  return a;
}
function rateLimit(req, kind = 'fail', max = 20) { if (bucket(req, kind).n >= max) fail(429, 'Zu viele Versuche. Bitte wartet 15 Minuten.'); }
const countAttempt = (req, kind = 'fail') => { bucket(req, kind).n++; };
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (now > a.reset) attempts.delete(k); }, 15 * 6e4).unref();

/* ---------------- Plan: Feiern, Aufgaben, Budget, Dienstleister ---------------- */

const profileOf = w => { try { return normalizeProfile(JSON.parse(w.profile || '{}')); } catch { return normalizeProfile({}); } };
const eventsOf = wid => db.prepare('SELECT * FROM events WHERE wedding_id = ? ORDER BY date, time, sort, id').all(wid);
const mainEvent = wid => db.prepare("SELECT * FROM events WHERE wedding_id = ? AND key = 'feier' ORDER BY id LIMIT 1").get(wid);

// Alte Hochzeiten ohne Feiern bekommen die Hauptfeier nachträglich
function ensureBaseEvent(wid) {
  if (mainEvent(wid)) return;
  const w = weddingRow(wid); if (!w) return;
  const r = db.prepare("INSERT INTO events (wedding_id, key, title, date, time, location, address, offset_days, scope, kind) VALUES (?,?,?,?,?,?,?,0,'alle','party')").run(wid, 'feier', 'Hochzeitsfeier', w.date, w.time, w.location, w.address);
  db.prepare('UPDATE schedule SET event_id = ? WHERE wedding_id = ? AND event_id IS NULL').run(r.lastInsertRowid, wid);
  // Bisherige Gäste-Zusagen übernehmen
  for (const m of db.prepare("SELECT mb.user_id, u.name FROM members mb JOIN users u ON u.id = mb.user_id WHERE mb.wedding_id = ? AND mb.role = 'gast'").all(wid)) linkGuest(wid, m.user_id, m.name, '');
}

// Wendet den Plan an. Bestehende Einträge bleiben, fehlende werden ergänzt (Schlüssel: event.key, task.tkey, vendor.cat, budget.cat)
function applyPlan(wid, profileIn, { audience = null } = {}) {
  const w = weddingRow(wid); const plan = buildPlan(profileIn);
  const evIds = new Map(eventsOf(wid).map(e => [e.key, e.id]));
  plan.events.forEach((e, i) => {
    if (evIds.has(e.key)) return;
    const loc = e.key === 'feier' ? w.location : '';
    const r = db.prepare('INSERT INTO events (wedding_id, key, title, date, time, location, address, offset_days, scope, kind, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(wid, e.key, e.title, addDays(w.date, e.offset), e.key === 'feier' ? (w.time && w.time !== '14:00' ? w.time : e.time) : e.time, loc, e.key === 'feier' ? w.address : '', e.offset, e.scope, e.kind, i);
    const id = Number(r.lastInsertRowid); evIds.set(e.key, id);
    if (e.key === 'feier') db.prepare('UPDATE weddings SET time = (SELECT time FROM events WHERE id = ?) WHERE id = ?').run(id, wid);
    const ins = db.prepare('INSERT INTO schedule (wedding_id, time, title, place, event_id) VALUES (?,?,?,?,?)');
    for (const [tm, tt] of e.schedule) ins.run(wid, tm, tt, loc, id);
    // Bereits vorhandene Gäste zur neuen Feier einladen, falls der Gästekreis passt
    for (const g of db.prepare('SELECT * FROM guests WHERE wedding_id = ?').all(wid)) if (inScope(g, e.scope)) db.prepare('INSERT OR IGNORE INTO invites (guest_id, event_id, persons) VALUES (?,?,?)').run(g.id, id, g.adults + g.kids);
  });
  const evDate = new Map(eventsOf(wid).map(e => [e.id, e.date]));
  const have = new Set(db.prepare('SELECT tkey FROM tasks WHERE wedding_id = ?').all(wid).map(t => t.tkey));
  const insT = db.prepare('INSERT INTO tasks (wedding_id, audience, title, note, due, offset_days, product, event_id, tkey, vendor_cat, book) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const t of plan.tasks) {
    if (have.has(t.k) || (audience && t.aud !== audience)) continue;
    const ev = evIds.get(t.ev) || evIds.get('feier');
    insT.run(wid, t.aud, t.t, t.n, addDays(evDate.get(ev) || w.date, t.o), t.o, t.p, ev, t.k, t.v, t.book ? 1 : 0);
  }
  if (!audience) {
    const cats = new Set(db.prepare('SELECT cat FROM vendors WHERE wedding_id = ?').all(wid).map(v => v.cat));
    for (const c of plan.vendors) if (!cats.has(c)) db.prepare('INSERT INTO vendors (wedding_id, cat) VALUES (?,?)').run(wid, c);
    const bcats = new Set(db.prepare('SELECT cat FROM budget WHERE wedding_id = ?').all(wid).map(b => b.cat));
    const fresh = bcats.size === 0;
    for (const b of plan.budget) if (!bcats.has(b.cat)) db.prepare('INSERT INTO budget (wedding_id, cat, label, planned, per_guest, sort) VALUES (?,?,?,?,?,?)').run(wid, b.cat, b.label, fresh ? b.planned : 0, b.perGuest ? 1 : 0, b.sort);
    db.prepare('UPDATE weddings SET profile = ? WHERE id = ?').run(JSON.stringify({ ...plan.profile, budget: plan.profile.budget || plan.total }), wid);
  }
  catchUp(wid);
  return plan;
}

// Wer spät mit der Planung beginnt: Aufgaben, deren idealer Termin schon vorbei ist, werden auf die
// nächsten Wochen verteilt (alle 2 Tage eine), statt sofort als „überfällig“ dazustehen.
function catchUp(wid) {
  const today = new Date().toISOString().slice(0, 10);
  const evDate = new Map(eventsOf(wid).map(e => [e.id, e.date]));
  const late = db.prepare('SELECT id, due, event_id FROM tasks WHERE wedding_id = ? AND done = 0 AND custom_due = 0 AND offset_days IS NOT NULL AND due < ? ORDER BY due, id').all(wid, today);
  late.forEach((t, i) => {
    const limit = addDays(evDate.get(t.event_id) || weddingRow(wid).date, -1);
    let due = addDays(today, 3 + i * 2); if (due > limit) due = limit < today ? today : limit;
    db.prepare('UPDATE tasks SET due = ? WHERE id = ?').run(due, t.id);
  });
  return late.length;
}

// Verschiebt Feiern und Aufgaben nach einer Datumsänderung. Von Hand gesetzte Termine bleiben stehen.
function recomputeDates(wid) {
  const w = weddingRow(wid);
  for (const e of eventsOf(wid)) if (!e.custom_date && e.offset_days !== null) db.prepare('UPDATE events SET date = ? WHERE id = ?').run(addDays(w.date, e.offset_days), e.id);
  const evDate = new Map(eventsOf(wid).map(e => [e.id, e.date]));
  let moved = 0;
  for (const t of db.prepare('SELECT id, offset_days, event_id, due FROM tasks WHERE wedding_id = ? AND offset_days IS NOT NULL AND custom_due = 0').all(wid)) {
    const due = addDays(evDate.get(t.event_id) || w.date, t.offset_days);
    if (due !== t.due) { db.prepare('UPDATE tasks SET due = ? WHERE id = ?').run(due, t.id); moved++; }
  }
  catchUp(wid);
  return moved;
}

// Gästekreis einer Feier: alle, Familie, Frauen, kleiner Kreis (nur von Hand)
function inScope(g, scope) {
  if (scope === 'alle') return true;
  if (scope === 'familie') return /famil/i.test(g.grp);
  if (scope === 'frauen') return g.gender === 'w';
  return false;
}
function inviteByScope(guestId) {
  const g = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
  for (const e of eventsOf(g.wedding_id)) if (inScope(g, e.scope) || e.key === 'feier') db.prepare('INSERT OR IGNORE INTO invites (guest_id, event_id, persons) VALUES (?,?,?)').run(g.id, e.id, g.adults + g.kids);
}
// App-Nutzer:in mit Gast-Code → vorhandenen Eintrag (gleiche E-Mail) verknüpfen oder neu anlegen
function linkGuest(wid, userId, name, email) {
  const existing = db.prepare('SELECT id FROM guests WHERE wedding_id = ? AND user_id = ?').get(wid, userId);
  if (existing) return existing.id;
  const byMail = email && db.prepare("SELECT id FROM guests WHERE wedding_id = ? AND user_id IS NULL AND email != '' AND lower(email) = lower(?)").get(wid, email);
  if (byMail) { db.prepare('UPDATE guests SET user_id = ? WHERE id = ?').run(userId, byMail.id); return byMail.id; }
  const r = db.prepare('INSERT INTO guests (wedding_id, name, email, user_id, token) VALUES (?,?,?,?,?)').run(wid, name, email || '', userId, rid(12));
  inviteByScope(Number(r.lastInsertRowid));
  return Number(r.lastInsertRowid);
}

const weddingRow = wid => db.prepare('SELECT * FROM weddings WHERE id = ?').get(wid);
function publicWedding(w, role) {
  const out = { id: w.id, name1: w.name1, name2: w.name2, date: w.date, time: w.time, location: w.location, address: w.address, dresscode: w.dresscode, info: w.info, engaged_on: w.engaged_on, rsvp_until: w.rsvp_until };
  const pr = profileOf(w);
  out.profile = { traditions: pr.traditions, langs: pr.langs, options: pr.options, print: pr.print, guests: pr.guests, budget: role === 'paar' ? pr.budget : undefined };
  if (role === 'paar') Object.assign(out, { partner_code: w.partner_code, witness_code: w.witness_code, guest_code: w.guest_code });
  if (role === 'trauzeuge') out.guest_code = w.guest_code;
  return out;
}
const taskOut = t => ({ id: t.id, title: t.title, note: t.note, due: t.due, offset_days: t.offset_days, done: !!t.done, auto: t.offset_days !== null, custom_due: !!t.custom_due, product: t.product, event_id: t.event_id, vendor_cat: t.vendor_cat });
const audienceOf = role => role === 'paar' ? 'paar' : role === 'trauzeuge' ? 'trauzeuge' : fail(403, 'Gäste haben keinen Zeitplan.');

/* ---------------- Routen ---------------- */

const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

// Konto
route('POST', '/api/register', async (req, res, body) => {
  rateLimit(req, 'reg', 60); countAttempt(req, 'reg');
  const name = str(body.name, 60, 'Name', { required: true });
  const email = str(body.email, 120, 'E-Mail', { required: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  if (typeof body.password !== 'string' || body.password.length < 8) fail(400, 'Das Passwort braucht mindestens 8 Zeichen.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'Mit dieser E-Mail gibt es schon ein Konto. Meldet euch an.');
  const r = db.prepare('INSERT INTO users (email, name, pass_hash) VALUES (?,?,?)').run(email, name, await hashPassword(body.password));
  createSession(res, Number(r.lastInsertRowid));
  send(res, 201, { ok: true });
});

route('POST', '/api/login', async (req, res, body) => {
  rateLimit(req);
  const email = str(body.email, 120, 'E-Mail', { required: true }).toLowerCase();
  const u = db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email);
  if (!u || typeof body.password !== 'string' || !(await checkPassword(body.password, u.pass_hash))) { countAttempt(req); fail(401, 'E-Mail oder Passwort stimmt nicht.'); }
  createSession(res, u.id);
  send(res, 200, { ok: true });
});

route('POST', '/api/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie).wfy;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  send(res, 200, { ok: true }, { 'Set-Cookie': `wfy=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}` });
});

route('GET', '/api/me', async (req, res) => {
  const user = needUser(req);
  const weddings = db.prepare(`SELECT w.id, w.name1, w.name2, w.date, m.role FROM members m JOIN weddings w ON w.id = m.wedding_id WHERE m.user_id = ? ORDER BY w.date`).all(user.id);
  send(res, 200, { user, weddings });
});

// Hochzeit anlegen (als Paar) oder per Code beitreten
route('POST', '/api/weddings', async (req, res, body) => {
  const user = needUser(req);
  const name1 = str(body.name1, 40, 'Name 1', { required: true });
  const name2 = str(body.name2, 40, 'Name 2', { required: true });
  if (!isDate(body.date)) fail(400, 'Bitte ein gültiges Hochzeitsdatum wählen.');
  const time = isTime(body.time) ? body.time : '14:00';
  const location = str(body.location, 120, 'Ort') || '';
  const id = rid(8);
  let plan;
  tx(() => {
    db.prepare('INSERT INTO weddings (id, name1, name2, date, time, location, partner_code, witness_code, guest_code, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, name1, name2, body.date, time, location, code('P'), code('T'), code('G'), user.id);
    db.prepare('INSERT INTO members (wedding_id, user_id, role, cal_token) VALUES (?,?,?,?)').run(id, user.id, 'paar', rid(18));
    plan = applyPlan(id, body.profile || {});
  });
  send(res, 201, { id, role: 'paar', warnings: [...plan.warnings, ...dateWarnings(body.date, plan.profile.traditions)], events: eventsOf(id).length, tasks: plan.tasks.length });
});

route('POST', '/api/join', async (req, res, body) => {
  const user = needUser(req);
  rateLimit(req);
  const c = str(body.code, 20, 'Code', { required: true }).toUpperCase();
  const w = db.prepare('SELECT id, partner_code, witness_code, guest_code FROM weddings WHERE partner_code = ? OR witness_code = ? OR guest_code = ?').get(c, c, c);
  if (!w) { countAttempt(req); fail(404, 'Diesen Code kennen wir nicht. Bitte prüft die Schreibweise.'); }
  const role = c === w.partner_code ? 'paar' : c === w.witness_code ? 'trauzeuge' : 'gast';
  const existing = db.prepare('SELECT role FROM members WHERE wedding_id = ? AND user_id = ?').get(w.id, user.id);
  if (existing) return send(res, 200, { id: w.id, role: existing.role, already: true });
  tx(() => {
    db.prepare('INSERT INTO members (wedding_id, user_id, role, cal_token) VALUES (?,?,?,?)').run(w.id, user.id, role, rid(18));
    if (role === 'gast') { ensureBaseEvent(w.id); linkGuest(w.id, user.id, user.name, user.email); }
  });
  send(res, 201, { id: w.id, role });
});

route('GET', '/api/w/:wid', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid);
  ensureBaseEvent(p.wid);
  const w = weddingRow(p.wid);
  const counts = db.prepare(`SELECT role, COUNT(*) n FROM members WHERE wedding_id = ? GROUP BY role`).all(p.wid);
  let events = eventsOf(p.wid);
  if (m.role === 'gast') { const g = db.prepare('SELECT id FROM guests WHERE wedding_id = ? AND user_id = ?').get(p.wid, user.id); const inv = new Set(g ? db.prepare('SELECT event_id FROM invites WHERE guest_id = ?').all(g.id).map(i => i.event_id) : []); events = events.filter(e => inv.has(e.id)); }
  const pr = profileOf(w);
  send(res, 200, { wedding: publicWedding(w, m.role), role: m.role, events: events.map(eventOut), calendar_url: `${PUBLIC_URL}/cal/${m.cal_token}.ics`, public_url: PUBLIC_URL, counts: Object.fromEntries(counts.map(c => [c.role, c.n])),
    warnings: m.role === 'paar' ? [...buildPlan(pr).warnings, ...dateWarnings(w.date, pr.traditions)] : [] });
});

route('PATCH', '/api/w/:wid', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const w = weddingRow(p.wid);
  const upd = {};
  for (const [k, max] of [['name1', 40], ['name2', 40], ['location', 120], ['address', 200], ['dresscode', 120], ['info', 2000]]) {
    const v = str(body[k], max, k); if (v !== undefined) upd[k] = v;
  }
  if ((upd.name1 !== undefined && !upd.name1) || (upd.name2 !== undefined && !upd.name2)) fail(400, 'Beide Namen werden gebraucht.');
  for (const k of ['engaged_on', 'rsvp_until']) if (body[k] !== undefined) { if (body[k] !== '' && !isDate(body[k])) fail(400, 'Ungültiges Datum.'); upd[k] = body[k]; }
  if (body.time !== undefined) { if (!isTime(body.time)) fail(400, 'Ungültige Uhrzeit.'); upd.time = body.time; }
  let moved = 0;
  tx(() => {
    if (body.date !== undefined && body.date !== w.date) {
      if (!isDate(body.date)) fail(400, 'Ungültiges Hochzeitsdatum.');
      upd.date = body.date;
    }
    const keys = Object.keys(upd);
    if (keys.length) db.prepare(`UPDATE weddings SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => upd[k]), p.wid);
    ensureBaseEvent(p.wid);
    // Hauptfeier spiegelt Zeit und Ort der Hochzeit
    const me = mainEvent(p.wid);
    for (const k of ['time', 'location', 'address']) if (upd[k] !== undefined) db.prepare(`UPDATE events SET ${k} = ? WHERE id = ?`).run(upd[k], me.id);
    // Feiern und automatisch erzeugte Schritte wandern mit, von Hand geänderte Termine bleiben stehen.
    if (upd.date) moved = recomputeDates(p.wid);
  });
  send(res, 200, { wedding: publicWedding(weddingRow(p.wid), 'paar'), moved });
});

// Zeitstrahl
route('GET', '/api/w/:wid/tasks', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid, ['paar', 'trauzeuge']);
  ensureBaseEvent(p.wid);
  const rows = db.prepare('SELECT * FROM tasks WHERE wedding_id = ? AND audience = ? ORDER BY due, id').all(p.wid, audienceOf(m.role));
  send(res, 200, { tasks: rows.map(taskOut), payments: m.role === 'paar' ? paymentsOf(p.wid) : [], events: eventsOf(p.wid).map(eventOut) });
});

route('POST', '/api/w/:wid/tasks', async (req, res, body, p) => {
  const user = needUser(req); const m = membership(user, p.wid, ['paar', 'trauzeuge']);
  const title = str(body.title, 140, 'Titel', { required: true });
  const note = str(body.note, 1000, 'Notiz') || '';
  if (!isDate(body.due)) fail(400, 'Bitte ein Datum wählen.');
  const r = db.prepare('INSERT INTO tasks (wedding_id, audience, title, note, due, custom_due) VALUES (?,?,?,?,?,1)').run(p.wid, audienceOf(m.role), title, note, body.due);
  send(res, 201, { task: taskOut(db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid)) });
});

function ownTask(req, id) {
  const user = needUser(req);
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id)) || fail(404, 'Aufgabe nicht gefunden.');
  const m = membership(user, t.wedding_id, ['paar', 'trauzeuge']);
  if (audienceOf(m.role) !== t.audience) fail(404, 'Aufgabe nicht gefunden.');
  return t;
}

route('PATCH', '/api/tasks/:id', async (req, res, body, p) => {
  const t = ownTask(req, p.id);
  const upd = {};
  const title = str(body.title, 140, 'Titel'); if (title !== undefined) { if (!title) fail(400, 'Der Titel darf nicht leer sein.'); upd.title = title; }
  const note = str(body.note, 1000, 'Notiz'); if (note !== undefined) upd.note = note;
  if (body.done !== undefined) upd.done = body.done ? 1 : 0;
  if (body.due !== undefined) { if (!isDate(body.due)) fail(400, 'Ungültiges Datum.'); if (body.due !== t.due) { upd.due = body.due; upd.custom_due = 1; } }
  if (body.reset_due && t.offset_days !== null) { upd.due = addDays(weddingRow(t.wedding_id).date, t.offset_days); upd.custom_due = 0; }
  const keys = Object.keys(upd);
  if (keys.length) db.prepare(`UPDATE tasks SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => upd[k]), t.id);
  send(res, 200, { task: taskOut(db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id)) });
});

route('DELETE', '/api/tasks/:id', async (req, res, _b, p) => {
  const t = ownTask(req, p.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  send(res, 200, { ok: true });
});

route('POST', '/api/w/:wid/tasks/regenerate', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid, ['paar', 'trauzeuge']);
  const aud = audienceOf(m.role); const w = weddingRow(p.wid);
  tx(() => { db.prepare('DELETE FROM tasks WHERE wedding_id = ? AND audience = ?').run(p.wid, aud); applyPlan(p.wid, profileOf(w), { audience: aud }); });
  send(res, 200, { ok: true });
});

// Zusagen & Gästeliste
const MENUS = ['', 'fleisch', 'fisch', 'vegetarisch', 'vegan', 'kind'];
const eventOut = e => ({ id: e.id, key: e.key, title: e.title, date: e.date, time: e.time, location: e.location, address: e.address, scope: e.scope, kind: e.kind, note: e.note, custom_date: !!e.custom_date, offset: e.offset_days });
const invitesOf = gid => db.prepare('SELECT i.*, e.title, e.date, e.time, e.location, e.address, e.key FROM invites i JOIN events e ON e.id = i.event_id WHERE i.guest_id = ? ORDER BY e.date, e.time').all(gid);
const inviteOut = i => ({ event_id: i.event_id, key: i.key, title: i.title, date: i.date, time: i.time, location: i.location, address: i.address, status: i.status, persons: i.persons, menu: i.menu, allergies: i.allergies, song: i.song, message: i.message, updated_at: i.updated_at });

// Antworten speichern: entweder answers[] je Feier oder (älteres Format) eine Antwort für alle Einladungen
function saveAnswers(guest, body) {
  const inv = invitesOf(guest.id); if (!inv.length) fail(400, 'Ihr seid zu keiner Feier eingeladen.');
  const max = Math.max(1, guest.adults + guest.kids);
  const common = { allergies: str(body.allergies, 300, 'Allergien'), song: str(body.song, 150, 'Musikwunsch'), message: str(body.message, 1000, 'Nachricht'), menu: MENUS.includes(body.menu) ? body.menu : undefined };
  const answers = Array.isArray(body.answers) ? body.answers : inv.map(i => ({ event_id: i.event_id, status: body.status, persons: body.persons }));
  let n = 0;
  for (const a of answers) {
    const i = inv.find(x => x.event_id === Number(a.event_id)); if (!i) continue;
    if (!['zusage', 'absage'].includes(a.status)) fail(400, 'Bitte zu- oder absagen.');
    const persons = Number.isInteger(a.persons) && a.persons >= 1 ? Math.min(a.persons, Math.max(max, 10)) : i.persons || 1;
    db.prepare(`UPDATE invites SET status = ?, persons = ?, menu = COALESCE(?, menu), allergies = COALESCE(?, allergies), song = COALESCE(?, song), message = COALESCE(?, message), updated_at = datetime('now') WHERE guest_id = ? AND event_id = ?`)
      .run(a.status, persons, MENUS.includes(a.menu) ? a.menu : common.menu ?? null, common.allergies ?? null, common.song ?? null, common.message ?? null, guest.id, i.event_id);
    n++;
  }
  if (!n) fail(400, 'Keine passende Einladung gefunden.');
}
function myGuest(user, wid) {
  ensureBaseEvent(wid);
  const id = linkGuest(wid, user.id, user.name, user.email);
  return db.prepare('SELECT * FROM guests WHERE id = ?').get(id);
}
route('GET', '/api/w/:wid/rsvp', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['gast']);
  const g = myGuest(user, p.wid); const inv = invitesOf(g.id).map(inviteOut);
  const main = inv.find(i => i.key === 'feier') || inv[0] || {};
  send(res, 200, { rsvp: { status: main.status || 'offen', persons: main.persons || 1, menu: main.menu || '', allergies: main.allergies || '', song: main.song || '', message: main.message || '', updated_at: main.updated_at }, invites: inv, guest: { name: g.name, adults: g.adults, kids: g.kids }, token: g.token });
});
route('PUT', '/api/w/:wid/rsvp', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['gast']);
  saveAnswers(myGuest(user, p.wid), body);
  send(res, 200, { ok: true });
});

// Persönlicher Zusage-Link ohne Konto
function guestByToken(req, token) {
  rateLimit(req);
  const g = typeof token === 'string' && /^[\w-]{8,40}$/.test(token) && db.prepare('SELECT * FROM guests WHERE token = ?').get(token);
  if (!g) { countAttempt(req); fail(404, 'Dieser Link ist ungültig. Bitte fragt beim Brautpaar nach.'); }
  return g;
}
route('GET', '/api/rsvp/:token', async (req, res, _b, p) => {
  const g = guestByToken(req, p.token); const w = weddingRow(g.wedding_id); const pr = profileOf(w);
  const seat = seatOf(g.wedding_id, `g${g.id}`);
  send(res, 200, { wedding: { name1: w.name1, name2: w.name2, date: w.date, rsvp_until: w.rsvp_until, dresscode: w.dresscode, info: w.info, options: pr.options, langs: pr.langs }, guest: { name: g.name, salutation: g.salutation, adults: g.adults, kids: g.kids }, invites: invitesOf(g.id).map(inviteOut), seat });
});
route('PUT', '/api/rsvp/:token', async (req, res, body, p) => {
  const g = guestByToken(req, p.token); saveAnswers(g, body); send(res, 200, { ok: true });
});

const guestOut = (g, inv, role) => {
  const main = inv.find(i => i.key === 'feier') || inv[0];
  return { id: g.id, name: g.name, salutation: g.salutation, grp: g.grp, side: g.side, gender: g.gender, adults: g.adults, kids: g.kids,
    email: role === 'paar' ? g.email : '', phone: role === 'paar' ? g.phone : '', address: role === 'paar' ? g.address : '', lang: g.lang, notes: role === 'paar' ? g.notes : '', has_app: !!g.user_id,
    token: role === 'paar' ? g.token : undefined,
    status: main?.status || 'offen', persons: main?.status === 'zusage' ? main.persons : g.adults + g.kids, menu: main?.menu || '', allergies: main?.allergies || '', song: main?.song || '', message: role === 'paar' ? main?.message || '' : '', updated_at: main?.updated_at,
    invites: inv.map(i => ({ event_id: i.event_id, status: i.status, persons: i.persons })) };
};
route('GET', '/api/w/:wid/guests', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid, ['paar', 'trauzeuge']);
  ensureBaseEvent(p.wid);
  const events = eventsOf(p.wid);
  const allInv = db.prepare('SELECT i.*, e.key FROM invites i JOIN events e ON e.id = i.event_id JOIN guests g ON g.id = i.guest_id WHERE g.wedding_id = ?').all(p.wid);
  const byGuest = new Map(); for (const i of allInv) { if (!byGuest.has(i.guest_id)) byGuest.set(i.guest_id, []); byGuest.get(i.guest_id).push(i); }
  const guests = db.prepare('SELECT * FROM guests WHERE wedding_id = ? ORDER BY name COLLATE NOCASE').all(p.wid).map(g => guestOut(g, byGuest.get(g.id) || [], m.role));
  const perEvent = events.map(e => {
    const inv = allInv.filter(i => i.event_id === e.id); const yes = inv.filter(i => i.status === 'zusage');
    return { event_id: e.id, title: e.title, eingeladen: inv.length, zusage: yes.length, absage: inv.filter(i => i.status === 'absage').length, offen: inv.filter(i => i.status === 'offen').length, personen: yes.reduce((s, i) => s + i.persons, 0),
      menus: yes.reduce((o, i) => { if (i.menu) o[i.menu] = (o[i.menu] || 0) + i.persons; return o; }, {}) };
  });
  const main = perEvent.find(x => x.event_id === mainEvent(p.wid)?.id) || perEvent[0] || { eingeladen: 0, zusage: 0, absage: 0, offen: 0, personen: 0, menus: {} };
  const team = db.prepare(`SELECT u.id, u.name, mb.role FROM members mb JOIN users u ON u.id = mb.user_id WHERE mb.wedding_id = ? AND mb.role != 'gast' ORDER BY mb.role, u.name`).all(p.wid);
  send(res, 200, { guests, stats: main, perEvent, events: events.map(eventOut), team });
});

const GUEST_FIELDS = [['name', 80], ['salutation', 120], ['grp', 40], ['side', 20], ['gender', 2], ['email', 120], ['phone', 40], ['address', 300], ['lang', 3], ['notes', 500]];
function guestData(body, partial) {
  const d = {};
  for (const [k, max] of GUEST_FIELDS) { const v = str(body[k], max, k); if (v !== undefined) d[k] = v; }
  if (!partial && !d.name) fail(400, 'Bitte einen Namen eingeben.');
  if (d.name !== undefined && !d.name) fail(400, 'Der Name darf nicht leer sein.');
  if (d.gender !== undefined && !['', 'w', 'm'].includes(d.gender)) d.gender = '';
  for (const k of ['adults', 'kids']) if (body[k] !== undefined) { const n = parseInt(body[k]); if (!(n >= 0 && n <= 30)) fail(400, 'Ungültige Personenzahl.'); d[k] = n; }
  if (!partial && d.adults === undefined) d.adults = 1;
  if (d.adults === 0 && !(d.kids > 0)) d.adults = 1;
  return d;
}
function insertGuest(wid, d) {
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO guests (wedding_id, token, ${keys.join(', ')}) VALUES (?, ?, ${keys.map(() => '?').join(', ')})`).run(wid, rid(12), ...keys.map(k => d[k]));
  inviteByScope(Number(r.lastInsertRowid)); return Number(r.lastInsertRowid);
}
route('POST', '/api/w/:wid/guests', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']); ensureBaseEvent(p.wid);
  const id = tx(() => insertGuest(p.wid, guestData(body, false)));
  send(res, 201, { id });
});
// Schnellerfassung: eine Zeile pro Gast. „Name; Personen; Gruppe; E-Mail; Adresse“ (Trenner ; , oder Tab)
route('POST', '/api/w/:wid/guests/import', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']); ensureBaseEvent(p.wid);
  const text = str(body.text, 100_000, 'Liste', { required: true });
  const grpDefault = str(body.grp, 40, 'Gruppe') || '';
  let n = 0;
  tx(() => {
    for (const parts0 of parseRows(text)) {
      const line = parts0.join(';').trim(); if (!line.replace(/;/g, '')) continue;
      const parts = parts0.length > 1 ? parts0.map(x => x.trim()) : line.split(/\t|;/).map(x => x.trim());
      const cols = parts.length > 1 ? parts : line.split(/,(?=\s*\d|\s*[^,]*@)/).map(x => x.trim());
      const [name, pers, grp, email, ...addr] = cols;
      if (!name || /^name$/i.test(name)) continue;
      const total = parseInt(pers) || 1;
      insertGuest(p.wid, guestData({ name, adults: Math.max(1, total), grp: grp || grpDefault, email: /@/.test(email || '') ? email : '', address: addr.join(', ') }, false));
      if (++n > 1500) fail(400, 'Bitte höchstens 1.500 Gäste auf einmal.');
    }
  });
  send(res, 201, { imported: n });
});
// Zeilen aus Excel/Google Tabellen: Tab oder Semikolon, Zellen in "…" dürfen Zeilenumbrüche enthalten
function parseRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"' && cell === '') q = true;
    else if (c === '\t' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.map(r => r.map(x => x.replace(/\s*\n\s*/g, ', ').trim())).filter(r => r.some(Boolean));
}
function ownGuest(req, id) {
  const user = needUser(req);
  const g = db.prepare('SELECT * FROM guests WHERE id = ?').get(Number(id)) || fail(404, 'Gast nicht gefunden.');
  membership(user, g.wedding_id, ['paar']); return g;
}
route('PATCH', '/api/guests/:id', async (req, res, body, p) => {
  const g = ownGuest(req, p.id); const d = guestData(body, true); const keys = Object.keys(d);
  tx(() => {
    if (keys.length) db.prepare(`UPDATE guests SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => d[k]), g.id);
    if (body.invites && typeof body.invites === 'object') for (const [eid, on] of Object.entries(body.invites)) {
      const e = db.prepare('SELECT id FROM events WHERE id = ? AND wedding_id = ?').get(Number(eid), g.wedding_id); if (!e) continue;
      if (on) db.prepare('INSERT OR IGNORE INTO invites (guest_id, event_id, persons) VALUES (?,?,?)').run(g.id, e.id, (d.adults ?? g.adults) + (d.kids ?? g.kids));
      else db.prepare('DELETE FROM invites WHERE guest_id = ? AND event_id = ?').run(g.id, e.id);
    }
    if (body.status && ['offen', 'zusage', 'absage'].includes(body.status)) db.prepare("UPDATE invites SET status = ?, updated_at = datetime('now') WHERE guest_id = ? AND event_id = COALESCE(?, event_id)").run(body.status, g.id, body.event_id ? Number(body.event_id) : null);
  });
  send(res, 200, { ok: true });
});
route('DELETE', '/api/guests/:id', async (req, res, _b, p) => {
  const g = ownGuest(req, p.id);
  db.prepare('DELETE FROM guests WHERE id = ?').run(g.id);
  send(res, 200, { ok: true });
});

// Feiern
route('POST', '/api/w/:wid/events', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  if (!isDate(body.date)) fail(400, 'Bitte ein Datum wählen.');
  const r = db.prepare('INSERT INTO events (wedding_id, key, title, date, time, location, address, custom_date, scope, kind) VALUES (?,?,?,?,?,?,?,1,?,?)')
    .run(p.wid, 'eigene_' + rid(4), str(body.title, 80, 'Titel', { required: true }), body.date, isTime(body.time) ? body.time : '18:00', str(body.location, 120, 'Ort') || '', str(body.address, 200, 'Adresse') || '', ['alle', 'familie', 'frauen', 'klein'].includes(body.scope) ? body.scope : 'alle', 'party');
  const id = Number(r.lastInsertRowid);
  for (const g of db.prepare('SELECT * FROM guests WHERE wedding_id = ?').all(p.wid)) if (inScope(g, body.scope || 'alle')) db.prepare('INSERT OR IGNORE INTO invites (guest_id, event_id, persons) VALUES (?,?,?)').run(g.id, id, g.adults + g.kids);
  send(res, 201, { id });
});
function ownEvent(req, id) {
  const user = needUser(req);
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id)) || fail(404, 'Feier nicht gefunden.');
  membership(user, e.wedding_id, ['paar']); return e;
}
route('PATCH', '/api/events/:id', async (req, res, body, p) => {
  const e = ownEvent(req, p.id); const upd = {};
  for (const [k, max] of [['title', 80], ['location', 120], ['address', 200], ['note', 1000]]) { const v = str(body[k], max, k); if (v !== undefined) upd[k] = v; }
  if (upd.title === '') fail(400, 'Der Titel darf nicht leer sein.');
  if (body.time !== undefined) { if (!isTime(body.time)) fail(400, 'Ungültige Uhrzeit.'); upd.time = body.time; }
  if (body.scope !== undefined && ['alle', 'familie', 'frauen', 'klein'].includes(body.scope)) upd.scope = body.scope;
  let moved = 0;
  tx(() => {
    if (body.date !== undefined && body.date !== e.date) {
      if (!isDate(body.date)) fail(400, 'Ungültiges Datum.');
      if (e.key === 'feier') { db.prepare('UPDATE weddings SET date = ? WHERE id = ?').run(body.date, e.wedding_id); }
      else { upd.date = body.date; upd.custom_date = 1; }
    }
    const keys = Object.keys(upd);
    if (keys.length) db.prepare(`UPDATE events SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => upd[k]), e.id);
    if (e.key === 'feier') for (const k of ['time', 'location', 'address']) if (upd[k] !== undefined) db.prepare(`UPDATE weddings SET ${k} = ? WHERE id = ?`).run(upd[k], e.wedding_id);
    moved = recomputeDates(e.wedding_id);
  });
  send(res, 200, { ok: true, moved });
});
route('DELETE', '/api/events/:id', async (req, res, _b, p) => {
  const e = ownEvent(req, p.id);
  if (e.key === 'feier') fail(400, 'Die Hauptfeier kann nicht gelöscht werden.');
  tx(() => { db.prepare('UPDATE tasks SET event_id = NULL, offset_days = NULL, custom_due = 1 WHERE event_id = ? AND done = 0').run(e.id); db.prepare('DELETE FROM events WHERE id = ?').run(e.id); });
  send(res, 200, { ok: true });
});

// Profil (Traditionen, Optionen, Sprachen) ändern: fehlende Feiern, Aufgaben, Posten werden ergänzt
route('PATCH', '/api/w/:wid/profile', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const w = weddingRow(p.wid); const cur = profileOf(w);
  const next = normalizeProfile({ ...cur, ...body, options: { ...cur.options, ...(body.options || {}) }, print: { ...cur.print, ...(body.print || {}) } });
  if (JSON.stringify(next.print).length > 20_000) fail(413, 'Zu viel Text für die Drucksachen.');
  let plan; tx(() => { plan = applyPlan(p.wid, next); });
  send(res, 200, { ok: true, warnings: [...plan.warnings, ...dateWarnings(w.date, next.traditions)] });
});
route('GET', '/api/catalog', async (req, res) => send(res, 200, catalog()));
route('POST', '/api/plan-preview', async (req, res, body) => {
  needUser(req);
  const plan = buildPlan(body.profile || {});
  const date = isDate(body.date) ? body.date : null;
  send(res, 200, { events: plan.events.map(e => ({ key: e.key, title: e.title, date: date ? addDays(date, e.offset) : null, time: e.time, scope: e.scope })).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.time.localeCompare(b.time)),
    tasks: plan.tasks.filter(t => t.aud === 'paar').length, witnessTasks: plan.tasks.filter(t => t.aud === 'trauzeuge').length, vendors: plan.vendors.length, budget: plan.total, estimate: estimateBudget(plan.profile.guests),
    warnings: [...plan.warnings, ...(date ? dateWarnings(date, plan.profile.traditions) : [])] });
});

// Budget & Dienstleister
const vendorOut = v => ({ ...v, label: VENDOR_CATS[v.cat] || v.cat, deposit_paid: !!v.deposit_paid, rest_paid: !!v.rest_paid });
function paymentsOf(wid) {
  const out = [];
  for (const v of db.prepare("SELECT * FROM vendors WHERE wedding_id = ? AND status = 'gebucht'").all(wid)) {
    const name = v.name || VENDOR_CATS[v.cat] || v.cat;
    if (v.deposit > 0 && v.deposit_due) out.push({ vendor_id: v.id, kind: 'deposit', title: `Anzahlung ${name}`, amount: v.deposit, due: v.deposit_due, paid: !!v.deposit_paid });
    const rest = Math.max(0, v.price - v.deposit);
    if (rest > 0 && v.rest_due) out.push({ vendor_id: v.id, kind: 'rest', title: `Restzahlung ${name}`, amount: rest, due: v.rest_due, paid: !!v.rest_paid });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
function budgetOf(wid) {
  const vendors = db.prepare('SELECT * FROM vendors WHERE wedding_id = ?').all(wid);
  const exps = db.prepare('SELECT * FROM expenses WHERE wedding_id = ?').all(wid);
  // Ausgaben ohne Dienstleister erhöhen die Kosten; Ausgaben an einen gebuchten Dienstleister sind Zahlungen auf dessen Preis
  const expFree = cat => exps.filter(e => e.cat === cat && !e.vendor_id).reduce((s, e) => s + e.amount, 0);
  const expVendor = cat => exps.filter(e => e.vendor_id && vendors.find(v => v.id === e.vendor_id)?.cat === cat).reduce((s, e) => s + e.amount, 0);
  const items = db.prepare('SELECT * FROM budget WHERE wedding_id = ? ORDER BY sort, id').all(wid).map(b => {
    const vs = vendors.filter(v => v.cat === b.cat && v.status === 'gebucht');
    const vActual = vs.reduce((s, v) => s + v.price, 0), vPaid = vs.reduce((s, v) => s + (v.deposit_paid ? v.deposit : 0) + (v.rest_paid ? Math.max(0, v.price - v.deposit) : 0), 0);
    const ef = expFree(b.cat), ev = expVendor(b.cat), n = exps.filter(e => e.cat === b.cat).length;
    const auto = vs.length || ef ? vActual + ef : null;
    return { id: b.id, cat: b.cat, label: b.label, planned: b.planned, actual: b.actual ?? auto, manual_actual: b.actual, paid: b.paid + Math.min(vPaid + ev, vActual || Infinity) + ef, per_guest: !!b.per_guest, vendors: vs.length, receipts: n };
  });
  // Gebuchte Dienstleister ohne passenden Budgetposten trotzdem zählen
  const known = new Set(items.map(i => i.cat));
  const loose = exps.filter(e => !known.has(e.cat) && !e.vendor_id);
  if (loose.length) items.push({ id: null, cat: '', label: 'Ausgaben ohne Kategorie', planned: 0, actual: loose.reduce((s, e) => s + e.amount, 0), paid: loose.reduce((s, e) => s + e.amount, 0), receipts: loose.length });
  for (const v of vendors.filter(v => v.status === 'gebucht' && !known.has(v.cat))) items.push({ id: null, cat: v.cat, label: VENDOR_CATS[v.cat] || v.cat, planned: 0, actual: v.price, paid: (v.deposit_paid ? v.deposit : 0) + (v.rest_paid ? Math.max(0, v.price - v.deposit) : 0), vendors: 1 });
  const sum = k => items.reduce((s, i) => s + (i[k] || 0), 0);
  return { total: profileOf(weddingRow(wid)).budget, planned: sum('planned'), actual: items.reduce((s, i) => s + (i.actual ?? i.planned), 0), paid: sum('paid'), items, payments: paymentsOf(wid) };
}
// Kostenrechner: Positionen nach Profil; übernehmen schreibt geplante Beträge ins Budget
route('GET', '/api/w/:wid/cost-model', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const pr = profileOf(weddingRow(p.wid));
  const confirmed = db.prepare("SELECT SUM(i.persons) n FROM invites i JOIN events e ON e.id = i.event_id WHERE e.wedding_id = ? AND e.key = 'feier' AND i.status = 'zusage'").get(p.wid).n || 0;
  const invited = db.prepare('SELECT SUM(adults + kids) n FROM guests WHERE wedding_id = ?').get(p.wid).n || 0;
  send(res, 200, { items: costItems(pr), regions: REGIONS, guests: { planned: pr.guests, invited, confirmed }, budget: pr.budget });
});
route('POST', '/api/w/:wid/budget/apply', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  if (!Array.isArray(body.items) || body.items.length > 80) fail(400, 'Ungültige Positionen.');
  tx(() => {
    const max = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM budget WHERE wedding_id = ?').get(p.wid).m;
    body.items.forEach((it, i) => {
      const cat = str(it.cat, 40, 'Kategorie', { required: true }); const label = str(it.label, 80, 'Posten') || cat; const planned = money(it.planned || 0);
      const row = db.prepare('SELECT id FROM budget WHERE wedding_id = ? AND cat = ?').get(p.wid, cat);
      if (row) db.prepare('UPDATE budget SET planned = ?, label = ? WHERE id = ?').run(planned, label, row.id);
      else db.prepare('INSERT INTO budget (wedding_id, cat, label, planned, sort) VALUES (?,?,?,?,?)').run(p.wid, cat, label, planned, max + i + 1);
    });
    if (body.total) { const w = weddingRow(p.wid); db.prepare('UPDATE weddings SET profile = ? WHERE id = ?').run(JSON.stringify({ ...profileOf(w), budget: money(body.total) }), p.wid); }
  });
  send(res, 200, budgetOf(p.wid));
});

// Ausgaben & Belege
const RECEIPT_DIR = path.join(DATA_DIR, 'receipts');
const RECEIPT_TYPES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46], 'application/pdf': [0x25, 0x50, 0x44, 0x46] };
const receiptFile = e => path.join(RECEIPT_DIR, String(e.wedding_id).replace(/[^\w-]/g, ''), String(e.id));
const expenseOut = e => ({ id: e.id, date: e.date, merchant: e.merchant, amount: e.amount, cat: e.cat, vendor_id: e.vendor_id, paid_by: e.paid_by, note: e.note, has_receipt: !!e.receipt_mime, receipt_mime: e.receipt_mime, ocr_text: e.ocr_text, created_at: e.created_at });
function expenseData(body, wid) {
  const d = {};
  if (body.date !== undefined) { if (body.date !== '' && !isDate(body.date)) fail(400, 'Ungültiges Datum.'); d.date = body.date; }
  for (const [k, max] of [['merchant', 120], ['cat', 40], ['paid_by', 60], ['note', 500], ['ocr_text', 8000]]) { const v = str(body[k], max, k); if (v !== undefined) d[k] = v; }
  if (body.amount !== undefined) d.amount = money(body.amount || 0);
  if (body.vendor_id !== undefined) { const vid = body.vendor_id ? Number(body.vendor_id) : null; if (vid && !db.prepare('SELECT 1 FROM vendors WHERE id = ? AND wedding_id = ?').get(vid, wid)) fail(400, 'Dienstleister nicht gefunden.'); d.vendor_id = vid; }
  return d;
}
route('GET', '/api/w/:wid/expenses', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  send(res, 200, { expenses: db.prepare('SELECT * FROM expenses WHERE wedding_id = ? ORDER BY date DESC, id DESC').all(p.wid).map(expenseOut), cats: db.prepare('SELECT cat, label FROM budget WHERE wedding_id = ? ORDER BY sort, id').all(p.wid), vendors: db.prepare("SELECT id, cat, name FROM vendors WHERE wedding_id = ? AND status = 'gebucht'").all(p.wid).map(v => ({ ...v, label: v.name || VENDOR_CATS[v.cat] || v.cat })) });
});
route('POST', '/api/w/:wid/expenses', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const d = expenseData(body, p.wid); if (!(d.amount > 0)) fail(400, 'Bitte einen Betrag eingeben.');
  if (!d.date) d.date = new Date().toISOString().slice(0, 10);
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO expenses (wedding_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).run(p.wid, ...keys.map(k => d[k]));
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PATCH', '/api/expenses/:id', async (req, res, body, p) => {
  const e = ownRow(req, 'expenses', p.id); const d = expenseData(body, e.wedding_id); const keys = Object.keys(d);
  if (keys.length) db.prepare(`UPDATE expenses SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => d[k]), e.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/expenses/:id', async (req, res, _b, p) => {
  const e = ownRow(req, 'expenses', p.id);
  await unlink(receiptFile(e)).catch(() => {});
  db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
  send(res, 200, { ok: true });
});
route('PUT', '/api/expenses/:id/receipt', async (req, res, _b, p) => {
  const e = ownRow(req, 'expenses', p.id);
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (!RECEIPT_TYPES[type]) fail(415, 'Bitte ein Foto (JPG, PNG, WebP) oder eine PDF-Rechnung hochladen.');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 10_000_000) fail(413, 'Die Datei ist zu groß (max. 10 MB).'); chunks.push(c); }
  const buf = Buffer.concat(chunks);
  if (!RECEIPT_TYPES[type].every((b, i) => buf[i] === b)) fail(415, 'Die Datei passt nicht zum angegebenen Format.');
  await mkdir(path.dirname(receiptFile(e)), { recursive: true });
  await writeFile(receiptFile(e), buf);
  db.prepare('UPDATE expenses SET receipt_mime = ? WHERE id = ?').run(type, e.id);
  send(res, 200, { ok: true });
}, { raw: true });
route('GET', '/api/expenses/:id/receipt', async (req, res, _b, p) => {
  const e = ownRow(req, 'expenses', p.id);
  if (!e.receipt_mime) fail(404, 'Kein Beleg gespeichert.');
  const buf = await readFile(receiptFile(e)).catch(() => fail(404, 'Kein Beleg gespeichert.'));
  res.writeHead(200, { 'Content-Type': e.receipt_mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="beleg-${e.id}${e.receipt_mime === 'application/pdf' ? '.pdf' : ''}"`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
  res.end(buf);
});

route('GET', '/api/w/:wid/budget', async (req, res, _b, p) => { const user = needUser(req); membership(user, p.wid, ['paar']); send(res, 200, budgetOf(p.wid)); });
route('POST', '/api/w/:wid/budget', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const r = db.prepare('INSERT INTO budget (wedding_id, cat, label, planned, sort) VALUES (?,?,?,?,999)').run(p.wid, 'eigen_' + rid(3), str(body.label, 80, 'Posten', { required: true }), Math.max(0, Number(body.planned) || 0));
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PATCH', '/api/w/:wid/budget-total', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const total = Math.max(0, Math.min(10_000_000, Number(body.total) || 0)); if (!total) fail(400, 'Bitte ein Budget eingeben.');
  const w = weddingRow(p.wid); const pr = profileOf(w); const cur = db.prepare('SELECT SUM(planned) s FROM budget WHERE wedding_id = ?').get(p.wid).s || 0;
  tx(() => {
    if (body.rescale && cur > 0) for (const b of db.prepare('SELECT id, planned FROM budget WHERE wedding_id = ?').all(p.wid)) db.prepare('UPDATE budget SET planned = ? WHERE id = ?').run(Math.round(b.planned * total / cur / 10) * 10, b.id);
    db.prepare('UPDATE weddings SET profile = ? WHERE id = ?').run(JSON.stringify({ ...pr, budget: total }), p.wid);
  });
  send(res, 200, budgetOf(p.wid));
});
function ownRow(req, table, id) {
  const user = needUser(req);
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)) || fail(404, 'Eintrag nicht gefunden.');
  membership(user, r.wedding_id, ['paar']); return r;
}
const money = v => { const n = Number(v); if (!(n >= 0 && n <= 10_000_000)) fail(400, 'Ungültiger Betrag.'); return Math.round(n * 100) / 100; };
route('PATCH', '/api/budget/:id', async (req, res, body, p) => {
  const b = ownRow(req, 'budget', p.id); const upd = {};
  if (body.label !== undefined) upd.label = str(body.label, 80, 'Posten') || b.label;
  if (body.planned !== undefined) upd.planned = money(body.planned);
  if (body.actual !== undefined) upd.actual = body.actual === null || body.actual === '' ? null : money(body.actual);
  if (body.paid !== undefined) upd.paid = money(body.paid);
  const keys = Object.keys(upd); if (keys.length) db.prepare(`UPDATE budget SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => upd[k]), b.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/budget/:id', async (req, res, _b, p) => { const b = ownRow(req, 'budget', p.id); db.prepare('DELETE FROM budget WHERE id = ?').run(b.id); send(res, 200, { ok: true }); });

route('GET', '/api/w/:wid/vendors', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  send(res, 200, { vendors: db.prepare('SELECT * FROM vendors WHERE wedding_id = ? ORDER BY id').all(p.wid).map(vendorOut), cats: VENDOR_CATS });
});
route('POST', '/api/w/:wid/vendors', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const cat = VENDOR_CATS[body.cat] ? body.cat : fail(400, 'Bitte eine Kategorie wählen.');
  const r = db.prepare('INSERT INTO vendors (wedding_id, cat, name) VALUES (?,?,?)').run(p.wid, cat, str(body.name, 100, 'Name') || '');
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PATCH', '/api/vendors/:id', async (req, res, body, p) => {
  const v = ownRow(req, 'vendors', p.id); const upd = {};
  for (const [k, max] of [['name', 100], ['contact', 100], ['phone', 40], ['email', 120], ['website', 200], ['notes', 2000]]) { const x = str(body[k], max, k); if (x !== undefined) upd[k] = x; }
  if (body.status !== undefined) { if (!['offen', 'angefragt', 'angebot', 'gebucht', 'abgesagt'].includes(body.status)) fail(400, 'Ungültiger Status.'); upd.status = body.status; }
  for (const k of ['price', 'deposit']) if (body[k] !== undefined) upd[k] = money(body[k]);
  for (const k of ['deposit_due', 'rest_due']) if (body[k] !== undefined) { if (body[k] !== '' && !isDate(body[k])) fail(400, 'Ungültiges Datum.'); upd[k] = body[k]; }
  for (const k of ['deposit_paid', 'rest_paid']) if (body[k] !== undefined) upd[k] = body[k] ? 1 : 0;
  tx(() => {
    const keys = Object.keys(upd); if (keys.length) db.prepare(`UPDATE vendors SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => upd[k]), v.id);
    // Verknüpfung: gebucht → „Buchen“-Aufgaben dieser Kategorie erledigt
    if (upd.status === 'gebucht') db.prepare("UPDATE tasks SET done = 1 WHERE wedding_id = ? AND audience = 'paar' AND vendor_cat = ? AND book = 1").run(v.wedding_id, v.cat);
  });
  send(res, 200, { vendor: vendorOut(db.prepare('SELECT * FROM vendors WHERE id = ?').get(v.id)) });
});
route('DELETE', '/api/vendors/:id', async (req, res, _b, p) => { const v = ownRow(req, 'vendors', p.id); db.prepare('DELETE FROM vendors WHERE id = ?').run(v.id); send(res, 200, { ok: true }); });

// Geschenke → Danksagungen
const GIFT_KINDS = ['geld', 'gold', 'sache', 'gutschein', 'erlebnis'];
route('GET', '/api/w/:wid/gifts', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  send(res, 200, { gifts: db.prepare('SELECT gi.*, g.name AS guest_name, g.salutation, g.address FROM gifts gi LEFT JOIN guests g ON g.id = gi.guest_id WHERE gi.wedding_id = ? ORDER BY gi.id DESC').all(p.wid).map(x => ({ ...x, thanked: !!x.thanked })) });
});
function giftData(body, wid) {
  const d = {};
  if (body.guest_id !== undefined) { const gid = body.guest_id ? Number(body.guest_id) : null; if (gid && !db.prepare('SELECT 1 FROM guests WHERE id = ? AND wedding_id = ?').get(gid, wid)) fail(400, 'Gast nicht gefunden.'); d.guest_id = gid; }
  for (const [k, max] of [['from_name', 100], ['description', 300]]) { const v = str(body[k], max, k); if (v !== undefined) d[k] = v; }
  if (body.kind !== undefined) d.kind = GIFT_KINDS.includes(body.kind) ? body.kind : 'sache';
  if (body.amount !== undefined) d.amount = money(body.amount || 0);
  if (body.thanked !== undefined) d.thanked = body.thanked ? 1 : 0;
  return d;
}
route('POST', '/api/w/:wid/gifts', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const d = giftData(body, p.wid); if (!d.guest_id && !d.from_name) fail(400, 'Von wem ist das Geschenk?');
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO gifts (wedding_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).run(p.wid, ...keys.map(k => d[k]));
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PATCH', '/api/gifts/:id', async (req, res, body, p) => {
  const g = ownRow(req, 'gifts', p.id); const d = giftData(body, g.wedding_id); const keys = Object.keys(d);
  if (keys.length) db.prepare(`UPDATE gifts SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => d[k]), g.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/gifts/:id', async (req, res, _b, p) => { const g = ownRow(req, 'gifts', p.id); db.prepare('DELETE FROM gifts WHERE id = ?').run(g.id); send(res, 200, { ok: true }); });

// Spiele (nur Trauzeug:innen; das Paar soll überrascht werden)
route('GET', '/api/w/:wid/games', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['trauzeuge']);
  const row = db.prepare('SELECT data, updated_at FROM games WHERE wedding_id = ?').get(p.wid);
  send(res, 200, { data: row ? JSON.parse(row.data) : {}, updated_at: row?.updated_at || null });
});
route('PUT', '/api/w/:wid/games', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['trauzeuge']);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) fail(400, 'Ungültige Daten.');
  const json = JSON.stringify(body.data); if (json.length > 400_000) fail(413, 'Zu viele Inhalte.');
  db.prepare(`INSERT INTO games (wedding_id, data, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(wedding_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(p.wid, json);
  send(res, 200, { ok: true });
});

// Cockpit: alles Wichtige auf einen Blick, verknüpft über alle Bereiche
route('GET', '/api/w/:wid/overview', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']); ensureBaseEvent(p.wid);
  const tasks = db.prepare("SELECT * FROM tasks WHERE wedding_id = ? AND audience = 'paar' ORDER BY due, id").all(p.wid);
  const vendors = db.prepare('SELECT status FROM vendors WHERE wedding_id = ?').all(p.wid);
  const guests = db.prepare('SELECT adults, kids, address, email FROM guests WHERE wedding_id = ?').all(p.wid);
  const gifts = db.prepare('SELECT thanked FROM gifts WHERE wedding_id = ?').all(p.wid);
  const seating = seatingRow(p.wid); const sd = seating ? JSON.parse(seating.data) : null;
  const seats = (sd?.items || []).filter(i => i.kind === 'table');
  const b = budgetOf(p.wid);
  send(res, 200, {
    tasks: { total: tasks.length, done: tasks.filter(t => t.done).length, next: tasks.filter(t => !t.done).slice(0, 5).map(taskOut) },
    vendors: { total: vendors.filter(v => v.status !== 'abgesagt').length, booked: vendors.filter(v => v.status === 'gebucht').length },
    guests: { entries: guests.length, persons: guests.reduce((s, g) => s + g.adults + g.kids, 0), withAddress: guests.filter(g => g.address).length },
    budget: { total: b.total, planned: b.planned, actual: b.actual, paid: b.paid, nextPayments: b.payments.filter(x => !x.paid).slice(0, 3) },
    seating: { tables: seats.length, seats: seats.reduce((s, t) => s + (t.seats || 0), 0), assigned: seats.reduce((s, t) => s + (t.guests || []).filter(Boolean).length, 0) },
    gifts: { total: gifts.length, thanked: gifts.filter(g => g.thanked).length },
    expenses: db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount), 0) s FROM expenses WHERE wedding_id = ?').get(p.wid),
  });
});

// Tagesablauf
route('GET', '/api/w/:wid/schedule', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid); ensureBaseEvent(p.wid);
  let items = db.prepare('SELECT id, time, title, place, event_id FROM schedule WHERE wedding_id = ? ORDER BY time, id').all(p.wid);
  const main = mainEvent(p.wid); items.forEach(i => { if (!i.event_id) i.event_id = main.id; });
  if (m.role === 'gast') { const g = myGuest(user, p.wid); const inv = new Set(db.prepare('SELECT event_id FROM invites WHERE guest_id = ?').all(g.id).map(i => i.event_id)); items = items.filter(i => inv.has(i.event_id)); }
  send(res, 200, { items });
});
route('POST', '/api/w/:wid/schedule', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  if (!isTime(body.time)) fail(400, 'Bitte eine Uhrzeit wählen.');
  ensureBaseEvent(p.wid);
  const ev = body.event_id ? db.prepare('SELECT id FROM events WHERE id = ? AND wedding_id = ?').get(Number(body.event_id), p.wid) : mainEvent(p.wid);
  if (!ev) fail(400, 'Feier nicht gefunden.');
  const r = db.prepare('INSERT INTO schedule (wedding_id, time, title, place, event_id) VALUES (?,?,?,?,?)').run(p.wid, body.time, str(body.title, 100, 'Programmpunkt', { required: true }), str(body.place, 120, 'Ort') || '', ev.id);
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
function ownScheduleItem(req, id) {
  const user = needUser(req);
  const s = db.prepare('SELECT * FROM schedule WHERE id = ?').get(Number(id)) || fail(404, 'Programmpunkt nicht gefunden.');
  membership(user, s.wedding_id, ['paar']); return s;
}
route('PATCH', '/api/schedule/:id', async (req, res, body, p) => {
  const s = ownScheduleItem(req, p.id);
  if (body.time !== undefined && !isTime(body.time)) fail(400, 'Ungültige Uhrzeit.');
  db.prepare('UPDATE schedule SET time = ?, title = ?, place = ? WHERE id = ?').run(body.time ?? s.time, str(body.title, 100, 'Programmpunkt') || s.title, str(body.place, 120, 'Ort') ?? s.place, s.id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/schedule/:id', async (req, res, _b, p) => {
  const s = ownScheduleItem(req, p.id);
  db.prepare('DELETE FROM schedule WHERE id = ?').run(s.id);
  send(res, 200, { ok: true });
});

// Beiträge für die Hochzeitszeitung (das Paar sieht sie nicht)
const KINDS = ['geschichte', 'gruss', 'foto-idee', 'raetsel'];
route('GET', '/api/w/:wid/contributions', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid, ['trauzeuge', 'gast']);
  const rows = m.role === 'trauzeuge'
    ? db.prepare('SELECT c.id, c.kind, c.text, c.created_at, u.name FROM contributions c JOIN users u ON u.id = c.user_id WHERE c.wedding_id = ? ORDER BY c.id DESC').all(p.wid)
    : db.prepare('SELECT c.id, c.kind, c.text, c.created_at, u.name FROM contributions c JOIN users u ON u.id = c.user_id WHERE c.wedding_id = ? AND c.user_id = ? ORDER BY c.id DESC').all(p.wid, user.id);
  send(res, 200, { items: rows });
});
route('POST', '/api/w/:wid/contributions', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['trauzeuge', 'gast']);
  const text = str(body.text, 3000, 'Text', { required: true });
  const kind = KINDS.includes(body.kind) ? body.kind : 'geschichte';
  db.prepare('INSERT INTO contributions (wedding_id, user_id, kind, text) VALUES (?,?,?,?)').run(p.wid, user.id, kind, text);
  send(res, 201, { ok: true });
});
route('DELETE', '/api/contributions/:id', async (req, res, _b, p) => {
  const user = needUser(req);
  const c = db.prepare('SELECT * FROM contributions WHERE id = ?').get(Number(p.id)) || fail(404, 'Beitrag nicht gefunden.');
  const m = membership(user, c.wedding_id, ['trauzeuge', 'gast']);
  if (m.role !== 'trauzeuge' && c.user_id !== user.id) fail(403, 'Nur eigene Beiträge können gelöscht werden.');
  db.prepare('DELETE FROM contributions WHERE id = ?').run(c.id);
  send(res, 200, { ok: true });
});

/* ---------------- Sitzplan ---------------- */

const FLOOR_DIR = path.join(DATA_DIR, 'floorplans');
const IMAGE_TYPES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const floorFile = wid => path.join(FLOOR_DIR, wid.replace(/[^\w-]/g, ''));
const seatingRow = wid => db.prepare('SELECT data, floor_mime, updated_at FROM seating WHERE wedding_id = ?').get(wid);

route('GET', '/api/w/:wid/seating', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar', 'trauzeuge']);
  const row = seatingRow(p.wid);
  send(res, 200, { data: row ? JSON.parse(row.data) : null, has_floorplan: !!row?.floor_mime, updated_at: row?.updated_at || null });
});

route('PUT', '/api/w/:wid/seating', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) fail(400, 'Ungültiger Sitzplan.');
  const json = JSON.stringify(body.data);
  if (json.length > 500_000) fail(413, 'Der Sitzplan ist zu groß.');
  db.prepare(`INSERT INTO seating (wedding_id, data, updated_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(wedding_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(p.wid, json);
  send(res, 200, { ok: true });
});

route('PUT', '/api/w/:wid/floorplan', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (!IMAGE_TYPES[type]) fail(415, 'Bitte ein Bild als PNG, JPG oder WebP hochladen.');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 8_000_000) fail(413, 'Das Bild ist zu groß (max. 8 MB).'); chunks.push(c); }
  const buf = Buffer.concat(chunks);
  if (!IMAGE_TYPES[type].every((b, i) => buf[i] === b)) fail(415, 'Die Datei ist kein gültiges Bild.');
  await mkdir(FLOOR_DIR, { recursive: true });
  await writeFile(floorFile(p.wid), buf);
  db.prepare(`INSERT INTO seating (wedding_id, floor_mime) VALUES (?,?) ON CONFLICT(wedding_id) DO UPDATE SET floor_mime = excluded.floor_mime`).run(p.wid, type);
  send(res, 200, { ok: true });
}, { raw: true });

route('DELETE', '/api/w/:wid/floorplan', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  await unlink(floorFile(p.wid)).catch(() => {});
  db.prepare(`UPDATE seating SET floor_mime = '' WHERE wedding_id = ?`).run(p.wid);
  send(res, 200, { ok: true });
});

route('GET', '/api/w/:wid/floorplan', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar', 'trauzeuge']);
  const row = seatingRow(p.wid);
  if (!row?.floor_mime) fail(404, 'Kein Grundriss hochgeladen.');
  const buf = await readFile(floorFile(p.wid)).catch(() => fail(404, 'Kein Grundriss hochgeladen.'));
  res.writeHead(200, { 'Content-Type': row.floor_mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
});

// Gäste sehen nur ihren eigenen Tisch
function seatOf(wid, key) {
  const row = seatingRow(wid); const data = row ? JSON.parse(row.data) : null;
  for (const it of data?.items || []) {
    const i = (it.guests || []).findIndex(g => g === key);
    if (i >= 0) return { table: String(it.name || 'Tisch').slice(0, 60), seat: i + 1, neighbours: (it.guests || []).filter(Boolean).length - 1 };
  }
  return { table: null };
}
route('GET', '/api/w/:wid/my-seat', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid);
  const key = m.role === 'gast' ? `g${myGuest(user, p.wid).id}` : `u${user.id}`;
  send(res, 200, seatOf(p.wid, key));
});

/* ---------------- Kalender-Abo (ICS) ---------------- */

const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const ymd = d => d.replace(/-/g, '');
function fold(line) { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let i = 74; while (Buffer.byteLength(s.slice(0, i)) > 74) i--; out.push(s.slice(0, i)); s = ' ' + s.slice(i); } out.push(s); return out.join('\r\n'); }

async function calendar(req, res, token) {
  const m = db.prepare('SELECT * FROM members WHERE cal_token = ?').get(token);
  if (!m) { res.writeHead(404); return res.end('Nicht gefunden'); }
  const w = weddingRow(m.wedding_id);
  const couple = `${w.name1} & ${w.name2}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//weddify//Hochzeitsplaner//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(m.role === 'gast' ? `Hochzeit ${couple}` : `weddify · ${couple}`)}`, 'X-PUBLISHED-TTL:PT6H', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
  if (m.role !== 'gast') {
    const tasks = db.prepare('SELECT * FROM tasks WHERE wedding_id = ? AND audience = ? AND done = 0').all(w.id, audienceOf(m.role));
    for (const t of tasks) {
      L.push('BEGIN:VEVENT', `UID:task-${t.id}@weddify`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(t.due)}`, `DTEND;VALUE=DATE:${ymd(addDays(t.due, 1))}`,
        `SUMMARY:${icsEsc('💍 ' + t.title)}`, `DESCRIPTION:${icsEsc((t.note ? t.note + '\n\n' : '') + `Aus eurem weddify-Zeitplan: ${PUBLIC_URL}/app`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(t.title)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
    }
  }
  if (m.role === 'paar') for (const pay of paymentsOf(w.id).filter(x => !x.paid)) {
    L.push('BEGIN:VEVENT', `UID:pay-${pay.vendor_id}-${pay.kind}@weddify`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(pay.due)}`, `DTEND;VALUE=DATE:${ymd(addDays(pay.due, 1))}`,
      `SUMMARY:${icsEsc(`€ ${pay.title}: ${pay.amount.toLocaleString('de-DE')} €`)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(pay.title)}`, 'TRIGGER:-P3D', 'END:VALARM', 'END:VEVENT');
  }
  ensureBaseEvent(w.id);
  let evs = eventsOf(w.id);
  if (m.role === 'gast') { const g = db.prepare('SELECT id FROM guests WHERE wedding_id = ? AND user_id = ?').get(w.id, m.user_id); const inv = new Set(g ? db.prepare('SELECT event_id FROM invites WHERE guest_id = ?').all(g.id).map(i => i.event_id) : []); evs = evs.filter(e => inv.has(e.id)); }
  for (const e of evs) {
    const start = `${ymd(e.date)}T${e.time.replace(':', '')}00`;
    const endD = new Date(`${e.date}T${e.time}:00Z`); endD.setUTCHours(endD.getUTCHours() + (e.key === 'feier' ? 10 : 3));
    const end = endD.toISOString().slice(0, 19).replace(/[-:]/g, '');
    L.push('BEGIN:VEVENT', `UID:event-${e.id}@weddify`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${icsEsc(`${e.title} · ${couple}`)}`,
      `LOCATION:${icsEsc([e.location, e.address].filter(Boolean).join(', '))}`, `DESCRIPTION:${icsEsc(w.dresscode && e.key === 'feier' ? 'Dresscode: ' + w.dresscode : '')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('Morgen: ' + e.title)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="hochzeit.ics"', 'Cache-Control': 'no-cache' });
  res.end(L.map(fold).join('\r\n') + '\r\n');
}

/* ---------------- Statische Dateien ---------------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

async function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? '/index.html' : pathname === '/app' || pathname === '/app/' ? '/app.html' : pathname;
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': path.extname(full) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Seite nicht gefunden'); }
}

/* ---------------- Server ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const cal = url.pathname.match(/^\/cal\/([\w-]+)\.ics$/);
    if (cal && req.method === 'GET') return await calendar(req, res, cal[1]);
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (m) { const body = r.raw ? null : await readJson(req); return await r.handler(req, res, body, m.groups || {}); }
      }
      fail(404, 'Unbekannte Adresse.');
    }
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, url.pathname);
    fail(405, 'Nicht erlaubt.');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Da ist etwas schiefgelaufen. Bitte versucht es noch einmal.' });
  }
});

// Abgelaufene Sitzungen regelmäßig aufräumen
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 6 * 36e5).unref();

server.listen(PORT, () => console.log(`weddify läuft auf ${PUBLIC_URL} (Port ${PORT})`));
