import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.DATA_DIR || './data';
mkdirSync(dir, { recursive: true });

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

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
