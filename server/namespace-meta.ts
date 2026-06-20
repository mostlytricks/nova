import fs from 'node:fs';
import path from 'node:path';
import { namespaceDir, listNamespaces } from './own.js';

export type NamespaceState = 'draft' | 'active' | 'archived';
export type NamespaceDocType = 'api' | 'website' | 'library' | 'notes';

export interface NamespaceMeta {
  state: NamespaceState;
  doc_type: NamespaceDocType;
  origin_url: string | null;
  base_url: string | null;
  auth_summary: string | null;
  version: string | null;
  known_gaps: string | null;
  tags: string[];
  notes: string;
  owner: string | null;
  trust_note: string | null;
  intended_use: string | null;
  warning: string | null;
  last_reviewed_at: number | null;
  promotion_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface NamespaceHistoryEvent {
  id: number;
  at: number;
  type:
    | 'namespace_created'
    | 'meta_updated'
    | 'llms_saved'
    | 'note_updated'
    | 'entry_saved'
    | 'entry_deleted';
  detail: string;
}

const DEFAULT_META: Omit<NamespaceMeta, 'created_at' | 'updated_at'> = {
  state: 'active',
  doc_type: 'notes',
  origin_url: null,
  base_url: null,
  auth_summary: null,
  version: null,
  known_gaps: null,
  tags: [],
  notes: '',
  owner: null,
  trust_note: null,
  intended_use: null,
  warning: null,
  last_reviewed_at: null,
  promotion_reason: null,
};

function metaPath(namespace: string): string {
  return path.join(namespaceDir(namespace), '.meta.json');
}

function historyPath(namespace: string): string {
  return path.join(namespaceDir(namespace), '.history.json');
}

export function namespaceExists(namespace: string): boolean {
  return listNamespaces().includes(namespace);
}

export function defaultNamespaceMeta(now = Date.now()): NamespaceMeta {
  return { ...DEFAULT_META, created_at: now, updated_at: now };
}

export function readNamespaceMeta(namespace: string): NamespaceMeta {
  const defaults = defaultMetaFromDirectory(namespace);
  const p = metaPath(namespace);
  if (!fs.existsSync(p)) return defaults;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<NamespaceMeta>;
    return normalizeMeta(raw, defaults);
  } catch {
    return defaults;
  }
}

function defaultMetaFromDirectory(namespace: string): NamespaceMeta {
  const now = Date.now();
  try {
    const stat = fs.statSync(namespaceDir(namespace));
    return {
      ...DEFAULT_META,
      created_at: Math.floor(stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs || now),
      updated_at: Math.floor(stat.mtimeMs || now),
    };
  } catch {
    return defaultNamespaceMeta(now);
  }
}

export function writeNamespaceMeta(namespace: string, patch: Partial<NamespaceMeta>): NamespaceMeta {
  const existing = readNamespaceMeta(namespace);
  const next = normalizeMeta({ ...existing, ...patch, updated_at: Date.now() }, existing);
  fs.writeFileSync(metaPath(namespace), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function readNamespaceHistory(namespace: string): NamespaceHistoryEvent[] {
  const p = historyPath(namespace);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw) ? raw.filter(isHistoryEvent) : [];
  } catch {
    return [];
  }
}

export function appendNamespaceHistory(
  namespace: string,
  type: NamespaceHistoryEvent['type'],
  detail: string,
): NamespaceHistoryEvent {
  const events = readNamespaceHistory(namespace);
  const lastId = events.reduce((max, event) => Math.max(max, event.id), 0);
  const event: NamespaceHistoryEvent = {
    id: lastId + 1,
    at: Date.now(),
    type,
    detail,
  };
  const next = [event, ...events].slice(0, 100);
  fs.writeFileSync(historyPath(namespace), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return event;
}

export function namespaceFromEntryName(name: string): string | null {
  const [namespace] = name.split('/');
  if (!namespace || namespace === name) return null;
  return namespaceExists(namespace) ? namespace : null;
}

function normalizeMeta(raw: Partial<NamespaceMeta>, fallback: NamespaceMeta): NamespaceMeta {
  const state = raw.state === 'draft' || raw.state === 'active' || raw.state === 'archived'
    ? raw.state
    : fallback.state;
  const doc_type = raw.doc_type === 'api' || raw.doc_type === 'website' || raw.doc_type === 'library' || raw.doc_type === 'notes'
    ? raw.doc_type
    : fallback.doc_type;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : fallback.tags;
  return {
    state,
    doc_type,
    origin_url: nullableText(raw.origin_url),
    base_url: nullableText(raw.base_url),
    auth_summary: nullableText(raw.auth_summary),
    version: nullableText(raw.version),
    known_gaps: nullableText(raw.known_gaps),
    tags,
    notes: typeof raw.notes === 'string' ? raw.notes : fallback.notes,
    owner: nullableText(raw.owner),
    trust_note: nullableText(raw.trust_note),
    intended_use: nullableText(raw.intended_use),
    warning: nullableText(raw.warning),
    last_reviewed_at: typeof raw.last_reviewed_at === 'number' ? raw.last_reviewed_at : fallback.last_reviewed_at,
    promotion_reason: nullableText(raw.promotion_reason),
    created_at: typeof raw.created_at === 'number' ? raw.created_at : fallback.created_at,
    updated_at: typeof raw.updated_at === 'number' ? raw.updated_at : fallback.updated_at,
  };
}

function nullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isHistoryEvent(value: unknown): value is NamespaceHistoryEvent {
  const event = value as NamespaceHistoryEvent;
  return Boolean(
    event
      && typeof event.id === 'number'
      && typeof event.at === 'number'
      && typeof event.type === 'string'
      && typeof event.detail === 'string',
  );
}
