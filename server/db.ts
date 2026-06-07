import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_PATH, CACHE_DIR, OWN_DIR } from './config.js';

for (const dir of [DATA_DIR, CACHE_DIR, OWN_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL UNIQUE,
  title         TEXT,
  summary       TEXT,
  state         TEXT NOT NULL DEFAULT 'trial', -- trial | active | archived
  ttl_hours     INTEGER,                       -- null = use default
  tags          TEXT NOT NULL DEFAULT '[]',    -- JSON array
  notes         TEXT NOT NULL DEFAULT '',
  owner         TEXT,
  trust_note    TEXT,
  intended_use  TEXT,
  warning       TEXT,
  last_reviewed_at INTEGER,
  promotion_reason TEXT,
  etag          TEXT,
  last_modified TEXT,
  last_fetched  INTEGER,                       -- epoch ms
  last_accessed INTEGER,
  last_error    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);

CREATE TABLE IF NOT EXISTS links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  section       TEXT,
  title         TEXT,
  url           TEXT NOT NULL,
  description   TEXT,
  cache_hash    TEXT,                          -- sha256 of normalized markdown file
  content_type  TEXT,                          -- markdown | html | unknown
  etag          TEXT,
  last_modified TEXT,
  last_fetched  INTEGER,
  last_error    TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_id, url)
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);

CREATE TABLE IF NOT EXISTS tombstones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL,
  title       TEXT,
  reason      TEXT,
  removed_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);

CREATE TABLE IF NOT EXISTS source_refreshes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id          INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at         INTEGER NOT NULL,
  finished_at        INTEGER,
  status             TEXT NOT NULL,               -- pending | ok | not_modified | error
  http_status        INTEGER,
  error              TEXT,
  previous_title     TEXT,
  previous_summary   TEXT,
  next_title         TEXT,
  next_summary       TEXT,
  previous_link_count INTEGER,
  next_link_count    INTEGER,
  added_link_count    INTEGER,
  removed_link_count  INTEGER,
  changed_link_count  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_source_refreshes_source_started
  ON source_refreshes(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS link_refreshes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id            INTEGER REFERENCES links(id) ON DELETE SET NULL,
  source_id          INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url                TEXT NOT NULL,
  started_at         INTEGER NOT NULL,
  finished_at        INTEGER,
  status             TEXT NOT NULL,               -- pending | ok | not_modified | error
  http_status        INTEGER,
  error              TEXT,
  previous_cache_hash TEXT,
  cache_hash         TEXT,
  content_type       TEXT,
  etag               TEXT,
  last_modified      TEXT,
  bytes              INTEGER,
  changed            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_link_refreshes_link_started
  ON link_refreshes(link_id, started_at DESC);
`);

ensureColumn('sources', 'owner', 'TEXT');
ensureColumn('sources', 'trust_note', 'TEXT');
ensureColumn('sources', 'intended_use', 'TEXT');
ensureColumn('sources', 'warning', 'TEXT');
ensureColumn('sources', 'last_reviewed_at', 'INTEGER');
ensureColumn('sources', 'promotion_reason', 'TEXT');

function ensureColumn(table: string, column: string, type: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.some((row) => row.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
}

export type SourceState = 'trial' | 'active' | 'archived';

export interface SourceRow {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
  state: SourceState;
  ttl_hours: number | null;
  tags: string;
  notes: string;
  owner: string | null;
  trust_note: string | null;
  intended_use: string | null;
  warning: string | null;
  last_reviewed_at: number | null;
  promotion_reason: string | null;
  etag: string | null;
  last_modified: string | null;
  last_fetched: number | null;
  last_accessed: number | null;
  last_error: string | null;
  created_at: number;
}

export interface LinkRow {
  id: number;
  source_id: number;
  section: string | null;
  title: string | null;
  url: string;
  description: string | null;
  cache_hash: string | null;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  last_fetched: number | null;
  last_error: string | null;
  position: number;
}

export interface SourceRefreshRow {
  id: number;
  source_id: number;
  started_at: number;
  finished_at: number | null;
  status: 'pending' | 'ok' | 'not_modified' | 'error';
  http_status: number | null;
  error: string | null;
  previous_title: string | null;
  previous_summary: string | null;
  next_title: string | null;
  next_summary: string | null;
  previous_link_count: number | null;
  next_link_count: number | null;
  added_link_count: number | null;
  removed_link_count: number | null;
  changed_link_count: number | null;
}

export interface LinkRefreshRow {
  id: number;
  link_id: number | null;
  source_id: number;
  url: string;
  started_at: number;
  finished_at: number | null;
  status: 'pending' | 'ok' | 'not_modified' | 'error';
  http_status: number | null;
  error: string | null;
  previous_cache_hash: string | null;
  cache_hash: string | null;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  bytes: number | null;
  changed: number;
}

export const cachePath = (hash: string) => path.join(CACHE_DIR, `${hash}.md`);
