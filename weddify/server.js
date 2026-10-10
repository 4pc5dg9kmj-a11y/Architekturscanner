import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { db, tx } from './db.js';
import { COUPLE_TEMPLATE, WITNESS_TEMPLATE, DEFAULT_SCHEDULE } from './templates.js';

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
  for await (const c of req) { size += c.length; if (size > 100_000) fail(413, 'Anfrage zu groß.'); chunks.push(c); }
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

// Einfache Begrenzung für Anmeldeversuche pro IP
const attempts = new Map();
function rateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now(); const a = attempts.get(ip) || { n: 0, reset: now + 15 * 6e4 };
  if (now > a.reset) { a.n = 0; a.reset = now + 15 * 6e4; }
  a.n++; attempts.set(ip, a);
  if (a.n > 20) fail(429, 'Zu viele Versuche. Bitte wartet 15 Minuten.');
}

function seedTasks(wid, audience, date) {
  const tpl = audience === 'paar' ? COUPLE_TEMPLATE : WITNESS_TEMPLATE;
  const ins = db.prepare('INSERT INTO tasks (wedding_id, audience, title, note, due, offset_days, product) VALUES (?,?,?,?,?,?,?)');
  for (const t of tpl) ins.run(wid, audience, t.title, t.note, addDays(date, t.offset), t.offset, t.product || '');
}

const weddingRow = wid => db.prepare('SELECT * FROM weddings WHERE id = ?').get(wid);
function publicWedding(w, role) {
  const out = { id: w.id, name1: w.name1, name2: w.name2, date: w.date, time: w.time, location: w.location, address: w.address, dresscode: w.dresscode, info: w.info, engaged_on: w.engaged_on, rsvp_until: w.rsvp_until };
  if (role === 'paar') Object.assign(out, { partner_code: w.partner_code, witness_code: w.witness_code, guest_code: w.guest_code });
  if (role === 'trauzeuge') out.guest_code = w.guest_code;
  return out;
}
const taskOut = t => ({ id: t.id, title: t.title, note: t.note, due: t.due, done: !!t.done, auto: t.offset_days !== null, custom_due: !!t.custom_due, product: t.product });
const audienceOf = role => role === 'paar' ? 'paar' : role === 'trauzeuge' ? 'trauzeuge' : fail(403, 'Gäste haben keinen Zeitplan.');

/* ---------------- Routen ---------------- */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

// Konto
route('POST', '/api/register', async (req, res, body) => {
  rateLimit(req);
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
  if (!u || typeof body.password !== 'string' || !(await checkPassword(body.password, u.pass_hash))) fail(401, 'E-Mail oder Passwort stimmt nicht.');
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
  tx(() => {
    db.prepare('INSERT INTO weddings (id, name1, name2, date, time, location, partner_code, witness_code, guest_code, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, name1, name2, body.date, time, location, code('P'), code('T'), code('G'), user.id);
    db.prepare('INSERT INTO members (wedding_id, user_id, role, cal_token) VALUES (?,?,?,?)').run(id, user.id, 'paar', rid(18));
    seedTasks(id, 'paar', body.date);
    seedTasks(id, 'trauzeuge', body.date);
    const ins = db.prepare('INSERT INTO schedule (wedding_id, time, title, place) VALUES (?,?,?,?)');
    for (const s of DEFAULT_SCHEDULE) ins.run(id, s.time, s.title, s.place || location);
  });
  send(res, 201, { id, role: 'paar' });
});

route('POST', '/api/join', async (req, res, body) => {
  const user = needUser(req);
  rateLimit(req);
  const c = str(body.code, 20, 'Code', { required: true }).toUpperCase();
  const w = db.prepare('SELECT id, partner_code, witness_code, guest_code FROM weddings WHERE partner_code = ? OR witness_code = ? OR guest_code = ?').get(c, c, c);
  if (!w) fail(404, 'Diesen Code kennen wir nicht. Bitte prüft die Schreibweise.');
  const role = c === w.partner_code ? 'paar' : c === w.witness_code ? 'trauzeuge' : 'gast';
  const existing = db.prepare('SELECT role FROM members WHERE wedding_id = ? AND user_id = ?').get(w.id, user.id);
  if (existing) return send(res, 200, { id: w.id, role: existing.role, already: true });
  tx(() => {
    db.prepare('INSERT INTO members (wedding_id, user_id, role, cal_token) VALUES (?,?,?,?)').run(w.id, user.id, role, rid(18));
    if (role === 'gast') db.prepare('INSERT OR IGNORE INTO rsvps (wedding_id, user_id) VALUES (?,?)').run(w.id, user.id);
  });
  send(res, 201, { id: w.id, role });
});

route('GET', '/api/w/:wid', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid);
  const w = weddingRow(p.wid);
  const counts = db.prepare(`SELECT role, COUNT(*) n FROM members WHERE wedding_id = ? GROUP BY role`).all(p.wid);
  send(res, 200, { wedding: publicWedding(w, m.role), role: m.role, calendar_url: `${PUBLIC_URL}/cal/${m.cal_token}.ics`, public_url: PUBLIC_URL, counts: Object.fromEntries(counts.map(c => [c.role, c.n])) });
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
      // Automatisch erzeugte Schritte wandern mit, von Hand geänderte Termine bleiben stehen.
      const auto = db.prepare('SELECT id, offset_days FROM tasks WHERE wedding_id = ? AND offset_days IS NOT NULL AND custom_due = 0').all(p.wid);
      const u = db.prepare('UPDATE tasks SET due = ? WHERE id = ?');
      for (const t of auto) { u.run(addDays(body.date, t.offset_days), t.id); moved++; }
    }
    const keys = Object.keys(upd);
    if (keys.length) db.prepare(`UPDATE weddings SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => upd[k]), p.wid);
  });
  send(res, 200, { wedding: publicWedding(weddingRow(p.wid), 'paar'), moved });
});

// Zeitstrahl
route('GET', '/api/w/:wid/tasks', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid, ['paar', 'trauzeuge']);
  const rows = db.prepare('SELECT * FROM tasks WHERE wedding_id = ? AND audience = ? ORDER BY due, id').all(p.wid, audienceOf(m.role));
  send(res, 200, { tasks: rows.map(taskOut) });
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
  tx(() => { db.prepare('DELETE FROM tasks WHERE wedding_id = ? AND audience = ?').run(p.wid, aud); seedTasks(p.wid, aud, w.date); });
  send(res, 200, { ok: true });
});

// Zusagen
const MENUS = ['', 'fleisch', 'fisch', 'vegetarisch', 'vegan', 'kind'];
route('GET', '/api/w/:wid/rsvp', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid, ['gast']);
  db.prepare('INSERT OR IGNORE INTO rsvps (wedding_id, user_id) VALUES (?,?)').run(p.wid, user.id);
  const r = db.prepare('SELECT status, persons, menu, allergies, song, message, updated_at FROM rsvps WHERE wedding_id = ? AND user_id = ?').get(p.wid, user.id);
  send(res, 200, { rsvp: r });
});

route('PUT', '/api/w/:wid/rsvp', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['gast']);
  if (!['zusage', 'absage'].includes(body.status)) fail(400, 'Bitte zu- oder absagen.');
  const persons = Number.isInteger(body.persons) && body.persons >= 1 && body.persons <= 10 ? body.persons : 1;
  const menu = MENUS.includes(body.menu) ? body.menu : '';
  const vals = [body.status, persons, menu, str(body.allergies, 300, 'Allergien') || '', str(body.song, 150, 'Musikwunsch') || '', str(body.message, 1000, 'Nachricht') || ''];
  db.prepare(`INSERT INTO rsvps (wedding_id, user_id, status, persons, menu, allergies, song, message, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(wedding_id, user_id) DO UPDATE SET status=excluded.status, persons=excluded.persons, menu=excluded.menu, allergies=excluded.allergies, song=excluded.song, message=excluded.message, updated_at=excluded.updated_at`)
    .run(p.wid, user.id, ...vals);
  send(res, 200, { ok: true });
});

route('GET', '/api/w/:wid/guests', async (req, res, _b, p) => {
  const user = needUser(req); const m = membership(user, p.wid, ['paar', 'trauzeuge']);
  const rows = db.prepare(`SELECT u.name, r.status, r.persons, r.menu, r.allergies, r.song, r.message, r.updated_at
    FROM members mb JOIN users u ON u.id = mb.user_id LEFT JOIN rsvps r ON r.wedding_id = mb.wedding_id AND r.user_id = mb.user_id
    WHERE mb.wedding_id = ? AND mb.role = 'gast' ORDER BY u.name COLLATE NOCASE`).all(p.wid);
  const guests = rows.map(r => ({ ...r, status: r.status || 'offen', persons: r.persons || 1, message: m.role === 'paar' ? r.message : '' }));
  const yes = guests.filter(g => g.status === 'zusage');
  const stats = {
    eingeladen: guests.length, zusage: yes.length, absage: guests.filter(g => g.status === 'absage').length, offen: guests.filter(g => g.status === 'offen').length,
    personen: yes.reduce((s, g) => s + g.persons, 0),
    menus: yes.reduce((o, g) => { if (g.menu) o[g.menu] = (o[g.menu] || 0) + g.persons; return o; }, {}),
  };
  const team = db.prepare(`SELECT u.name, mb.role FROM members mb JOIN users u ON u.id = mb.user_id WHERE mb.wedding_id = ? AND mb.role != 'gast' ORDER BY mb.role, u.name`).all(p.wid);
  send(res, 200, { guests, stats, team });
});

// Tagesablauf
route('GET', '/api/w/:wid/schedule', async (req, res, _b, p) => {
  const user = needUser(req); membership(user, p.wid);
  send(res, 200, { items: db.prepare('SELECT id, time, title, place FROM schedule WHERE wedding_id = ? ORDER BY time, id').all(p.wid) });
});
route('POST', '/api/w/:wid/schedule', async (req, res, body, p) => {
  const user = needUser(req); membership(user, p.wid, ['paar']);
  if (!isTime(body.time)) fail(400, 'Bitte eine Uhrzeit wählen.');
  const r = db.prepare('INSERT INTO schedule (wedding_id, time, title, place) VALUES (?,?,?,?)').run(p.wid, body.time, str(body.title, 100, 'Programmpunkt', { required: true }), str(body.place, 120, 'Ort') || '');
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
  const start = `${ymd(w.date)}T${w.time.replace(':', '')}00`;
  const endD = new Date(`${w.date}T${w.time}:00Z`); endD.setUTCHours(endD.getUTCHours() + 10);
  const end = endD.toISOString().slice(0, 19).replace(/[-:]/g, '');
  L.push('BEGIN:VEVENT', `UID:wedding-${w.id}@weddify`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${icsEsc(`Hochzeit ${couple}`)}`,
    `LOCATION:${icsEsc([w.location, w.address].filter(Boolean).join(', '))}`, `DESCRIPTION:${icsEsc(w.dresscode ? 'Dresscode: ' + w.dresscode : '')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Morgen ist der große Tag', 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="hochzeit.ics"', 'Cache-Control': 'no-cache' });
  res.end(L.map(fold).join('\r\n') + '\r\n');
}

/* ---------------- Statische Dateien ---------------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

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
        if (m) { const body = await readJson(req); return await r.handler(req, res, body, m.groups || {}); }
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
