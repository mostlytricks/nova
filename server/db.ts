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
`);

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

export const cachePath = (hash: string) => path.join(CACHE_DIR, `${hash}.md`);
