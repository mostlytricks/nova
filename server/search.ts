/**
 * search — Phase 8 basic retrieval over everything this server hosts.
 *
 * One shared module, two callers: `GET /api/search` (routes/search.ts) and
 * `docs-import search` (bin/docs-import.ts) — same corpus, same ranking, like
 * health.ts feeds both the route and the CLI.
 *
 * Corpus (per IMPLEMENTATION_PLAN Phase 8):
 *   - own entry files      data/own/ ** /*.md
 *   - namespace manifests  data/own/<ns>/llms.txt (title, summary, link text)
 *   - cached external docs  active sources' links (metadata + cached markdown)
 *
 * Ranking is deliberately simple: case-insensitive AND-term substring matching
 * with per-field weights. No FTS/index yet — the plan says add heavy search
 * infrastructure only once this basic behavior proves useful.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cachePath, db, type LinkRow, type SourceRow } from './db.js';
import { listNamespaces, listOwnEntries, readNamespaceLlms, readOwnEntry } from './own.js';
// Reused so search result URLs match exactly what /docs/ serves (drift here = 404s).
import { sourcePageNames } from './routes/docs.js';

export type SearchKind = 'entry' | 'namespace' | 'source';

export interface SearchResult {
  kind: SearchKind;
  title: string;
  scope: string; // namespace name, or the external source's title
  url: string; // a servable URL on this server (or the upstream URL if uncached)
  snippet: string;
  score: number;
}

export interface SearchOptions {
  limit?: number;
}

const DEFAULT_LIMIT = 20;

interface Field {
  text: string;
  weight: number;
}

interface Candidate {
  kind: SearchKind;
  title: string;
  scope: string;
  url: string;
  fields: Field[]; // weighted haystacks for scoring
  body: string; // source text for the snippet
}

export function search(query: string, options: SearchOptions = {}): SearchResult[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const limit = options.limit ?? DEFAULT_LIMIT;

  const results: SearchResult[] = [];
  for (const candidate of buildCorpus()) {
    const score = scoreCandidate(candidate, terms);
    if (score <= 0) continue;
    results.push({
      kind: candidate.kind,
      title: candidate.title,
      scope: candidate.scope,
      url: candidate.url,
      snippet: makeSnippet(candidate.body, terms),
      score,
    });
  }
  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return results.slice(0, limit);
}

/* ---------- corpus ---------- */

function buildCorpus(): Candidate[] {
  const candidates: Candidate[] = [];
  const namespaces = new Set(listNamespaces());

  // 1. Own entry files.
  for (const name of listOwnEntries()) {
    let content: string;
    try {
      content = readOwnEntry(name);
    } catch {
      continue;
    }
    const slash = name.indexOf('/');
    const scope = slash === -1 ? '(root)' : name.slice(0, slash);
    const rest = slash === -1 ? name : name.slice(slash + 1);
    const title = firstHeading(content) ?? path.basename(name, '.md');
    // Clean /docs/ URL only when it maps to a real namespace + flat file;
    // otherwise the always-servable canonical entry URL.
    const url =
      namespaces.has(scope) && !rest.includes('/')
        ? `/docs/${scope}/${rest}`
        : `/api/entries/get?name=${encodeURIComponent(name)}`;
    candidates.push({
      kind: 'entry',
      title,
      scope,
      url,
      fields: [
        { text: title, weight: 5 },
        { text: content, weight: 1 },
      ],
      body: content,
    });
  }

  // 2. Namespace manifests.
  for (const ns of namespaces) {
    let doc;
    try {
      doc = readNamespaceLlms(ns);
    } catch {
      continue;
    }
    const meta = [doc.summary, doc.note].filter(Boolean).join(' ');
    const linkText = doc.sections
      .flatMap((section) => section.links.map((link) => `${link.title} ${link.description ?? ''}`))
      .join('\n');
    candidates.push({
      kind: 'namespace',
      title: doc.title || ns,
      scope: ns,
      url: `/docs/${ns}/llms.txt`,
      fields: [
        { text: doc.title || ns, weight: 5 },
        { text: meta, weight: 3 },
        { text: linkText, weight: 2 },
      ],
      body: meta || linkText,
    });
  }

  // 3. Cached external docs — one candidate per link of every active source.
  const activeSources = db
    .prepare(`SELECT * FROM sources WHERE state = 'active' ORDER BY created_at`)
    .all() as SourceRow[];
  for (const source of activeSources) {
    const links = db
      .prepare('SELECT * FROM links WHERE source_id = ? ORDER BY position, id')
      .all(source.id) as LinkRow[];
    const pageNames = sourcePageNames(links);
    const scope = source.title ?? source.url;
    for (const link of links) {
      let body = '';
      if (link.cache_hash) {
        try {
          body = fs.readFileSync(cachePath(link.cache_hash), 'utf8');
        } catch {
          /* cache file missing — fall back to metadata only */
        }
      }
      const url =
        link.cache_hash && source.slug
          ? `/docs/${source.slug}/${pageNames.get(link.id)}.md`
          : link.url;
      candidates.push({
        kind: 'source',
        title: link.title ?? link.url,
        scope,
        url,
        fields: [
          { text: link.title ?? '', weight: 5 },
          { text: link.description ?? '', weight: 3 },
          { text: body, weight: 1 },
        ],
        body: body || [link.title, link.description].filter(Boolean).join(' — '),
      });
    }
  }

  return candidates;
}

/* ---------- scoring ---------- */

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** Weighted term-frequency score. Returns 0 unless every term appears somewhere (AND). */
function scoreCandidate(candidate: Candidate, terms: string[]): number {
  let score = 0;
  const seen = new Set<string>();
  for (const field of candidate.fields) {
    const hay = field.text.toLowerCase();
    if (!hay) continue;
    for (const term of terms) {
      const n = countOccurrences(hay, term);
      if (n > 0) {
        score += field.weight * n;
        seen.add(term);
      }
    }
  }
  if (terms.some((term) => !seen.has(term))) return 0;
  return score;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    count++;
    from = i + needle.length;
  }
  return count;
}

function makeSnippet(body: string, terms: string[], radius = 80): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return flat.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(flat.length, idx + radius);
  return `${start > 0 ? '… ' : ''}${flat.slice(start, end).trim()}${end < flat.length ? ' …' : ''}`;
}

function firstHeading(md: string): string | null {
  for (const line of md.split('\n')) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}
