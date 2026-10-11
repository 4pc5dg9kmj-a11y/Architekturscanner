import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.DATA_DIR || './data';
mkdirSync(dir, { recursive: true });

export const DATA_DIR = dir;
export const db = new DatabaseSync(path.join(dir, 'weddify.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  pass_hash   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weddings (
  id            TEXT PRIMARY KEY,
  name1         TEXT NOT NULL,
  name2         TEXT NOT NULL,
  date          TEXT NOT NULL,             -- YYYY-MM-DD
  time          TEXT NOT NULL DEFAULT '14:00',
  location      TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  dresscode     TEXT NOT NULL DEFAULT '',
  info          TEXT NOT NULL DEFAULT '',
  engaged_on    TEXT NOT NULL DEFAULT '',
  rsvp_until    TEXT NOT NULL DEFAULT '',
  partner_code  TEXT NOT NULL UNIQUE,
  witness_code  TEXT NOT NULL UNIQUE,
  guest_code    TEXT NOT NULL UNIQUE,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('paar','trauzeuge','gast')),
  cal_token   TEXT NOT NULL UNIQUE,
  joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (wedding_id, user_id)
);

-- audience: für wen der Zeitstrahl ist ('paar' oder 'trauzeuge')
-- offset: Tage relativ zum Hochzeitsdatum, nur bei automatisch erzeugten Schritten
-- custom_due: 1 = Datum wurde von Hand geändert und wandert nicht mehr mit
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  audience    TEXT NOT NULL CHECK (audience IN ('paar','trauzeuge')),
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  due         TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  offset_days INTEGER,
  custom_due  INTEGER NOT NULL DEFAULT 0,
  product     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tasks_w ON tasks(wedding_id, audience, due);

CREATE TABLE IF NOT EXISTS rsvps (
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','zusage','absage')),
  persons     INTEGER NOT NULL DEFAULT 1,
  menu        TEXT NOT NULL DEFAULT '',
  allergies   TEXT NOT NULL DEFAULT '',
  song        TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (wedding_id, user_id)
);

CREATE TABLE IF NOT EXISTS schedule (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  time        TEXT NOT NULL,
  title       TEXT NOT NULL,
  place       TEXT NOT NULL DEFAULT ''
);

-- Sitzplan: Raum, Tische und Platzbelegung als JSON; Grundriss-Bild liegt als Datei in DATA_DIR/floorplans
CREATE TABLE IF NOT EXISTS seating (
  wedding_id  TEXT PRIMARY KEY REFERENCES weddings(id) ON DELETE CASCADE,
  data        TEXT NOT NULL DEFAULT '{}',
  floor_mime  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Beiträge der Gäste für die Hochzeitszeitung: sehen nur Trauzeug:innen (Überraschung!)
CREATE TABLE IF NOT EXISTS contributions (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'geschichte',
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

db.exec(`
-- Feiern: Standesamt, Henna-Abend, Nikah, Kirche, Hauptfeier … (offset relativ zur Hauptfeier, custom_date = von Hand verschoben)
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  key         TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,
  time        TEXT NOT NULL DEFAULT '14:00',
  location    TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  offset_days INTEGER,
  custom_date INTEGER NOT NULL DEFAULT 0,
  scope       TEXT NOT NULL DEFAULT 'alle',
  kind        TEXT NOT NULL DEFAULT 'party',
  note        TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_w ON events(wedding_id, date);

-- Gästeliste des Paares (auch ohne App-Konto). token = persönlicher Zusage-Link
CREATE TABLE IF NOT EXISTS guests (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  salutation  TEXT NOT NULL DEFAULT '',
  grp         TEXT NOT NULL DEFAULT '',
  side        TEXT NOT NULL DEFAULT '',
  gender      TEXT NOT NULL DEFAULT '',
  adults      INTEGER NOT NULL DEFAULT 1,
  kids        INTEGER NOT NULL DEFAULT 0,
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  lang        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS guests_w ON guests(wedding_id);
CREATE UNIQUE INDEX IF NOT EXISTS guests_user ON guests(wedding_id, user_id) WHERE user_id IS NOT NULL;

-- Einladung je Gast und Feier, inklusive Antwort
CREATE TABLE IF NOT EXISTS invites (
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','zusage','absage')),
  persons     INTEGER NOT NULL DEFAULT 1,
  menu        TEXT NOT NULL DEFAULT '',
  allergies   TEXT NOT NULL DEFAULT '',
  song        TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guest_id, event_id)
);

CREATE TABLE IF NOT EXISTS budget (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  cat         TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL,
  planned     REAL NOT NULL DEFAULT 0,
  actual      REAL,
  paid        REAL NOT NULL DEFAULT 0,
  per_guest   INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Dienstleister: Status „gebucht“ hakt verknüpfte Aufgaben ab, Zahlungsfristen erscheinen im Zeitplan und Kalender
CREATE TABLE IF NOT EXISTS vendors (
  id           INTEGER PRIMARY KEY,
  wedding_id   TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  cat          TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  contact      TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  website      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','angefragt','angebot','gebucht','abgesagt')),
  price        REAL NOT NULL DEFAULT 0,
  deposit      REAL NOT NULL DEFAULT 0,
  deposit_due  TEXT NOT NULL DEFAULT '',
  deposit_paid INTEGER NOT NULL DEFAULT 0,
  rest_due     TEXT NOT NULL DEFAULT '',
  rest_paid    INTEGER NOT NULL DEFAULT 0,
  event_id     INTEGER REFERENCES events(id) ON DELETE SET NULL,
  notes        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS gifts (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  guest_id    INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  from_name   TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'sache',
  description TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL DEFAULT 0,
  thanked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

db.exec(`
-- Ausgaben & Belege (Kassenzettel, Rechnungen). vendor_id gesetzt = Zahlung an einen gebuchten Dienstleister
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY,
  wedding_id  TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  date        TEXT NOT NULL DEFAULT '',
  merchant    TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL DEFAULT 0,
  cat         TEXT NOT NULL DEFAULT '',
  vendor_id   INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  paid_by     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  receipt_mime TEXT NOT NULL DEFAULT '',
  ocr_text    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS expenses_w ON expenses(wedding_id);
`);

// Spalten nachrüsten (bestehende Datenbanken)
function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('weddings', 'profile', "TEXT NOT NULL DEFAULT '{}'");
addColumn('tasks', 'event_id', 'INTEGER REFERENCES events(id) ON DELETE SET NULL');
addColumn('tasks', 'tkey', "TEXT NOT NULL DEFAULT ''");
addColumn('tasks', 'vendor_cat', "TEXT NOT NULL DEFAULT ''");
addColumn('tasks', 'book', 'INTEGER NOT NULL DEFAULT 0');
addColumn('schedule', 'event_id', 'INTEGER REFERENCES events(id) ON DELETE CASCADE');

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
