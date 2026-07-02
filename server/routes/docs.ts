import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { cachePath, db, type LinkRow, type SourceRow } from '../db.js';
import { parseLlmsTxt, serializeLlmsTxt, type LlmsDoc } from '../parser.js';
import { listNamespaces, readNamespaceRaw, readOwnEntry } from '../own.js';
import { slugify } from '../slug.js';

/**
 * /docs/<name>/ — one clean URL prefix per doc set ("one doc, one domain").
 *
 * - Local namespace:   /docs/<ns>/llms.txt + /docs/<ns>/<file>.md
 *   (own-entry links in the manifest are rewritten from the canonical
 *   /api/entries/get?name=… form to the clean relative form on the fly)
 * - Active source:     /docs/<slug>/llms.txt + /docs/<slug>/<page>.md
 *   (cache-resolved: cached pages serve local markdown; uncached links
 *   keep their upstream URL)
 *
 * Local namespaces win on a name collision with a source slug; slug
 * generation avoids taken names, so collisions only arise from renames.
 */
export async function registerDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/docs', async (req) => {
    const namespaces = listNamespaces().map((name) => {
      const doc = parseLlmsTxt(readNamespaceRaw(name));
      return {
        kind: 'namespace' as const,
        name,
        title: doc.title || name,
        summary: doc.summary ?? null,
        url: `/docs/${name}/llms.txt`,
      };
    });
    const sources = activeSources()
      .filter((source) => source.slug)
      .map((source) => ({
        kind: 'source' as const,
        name: source.slug!,
        title: source.title ?? source.url,
        summary: source.summary ?? null,
        url: `/docs/${source.slug}/llms.txt`,
        originUrl: source.url,
      }));
    return { docs: [...namespaces, ...sources] };
  });

  app.get<{ Params: { name: string } }>('/docs/:name/llms.txt', async (req, reply) => {
    const name = req.params.name;

    const namespaceRaw = tryReadNamespaceRaw(name);
    if (namespaceRaw !== null) {
      reply.header('content-type', 'text/markdown; charset=utf-8');
      return serializeLlmsTxt(rewriteDocLinks(parseLlmsTxt(namespaceRaw)));
    }

    const source = activeSourceBySlug(name);
    if (source) {
      reply.header('content-type', 'text/markdown; charset=utf-8');
      return serializeLlmsTxt(sourceDocsManifest(source));
    }

    return reply.code(404).send({ error: 'doc set not found' });
  });

  app.get<{ Params: { name: string; '*': string } }>('/docs/:name/*', async (req, reply) => {
    const name = req.params.name;
    const file = req.params['*'];
    if (!file || !file.endsWith('.md')) return reply.code(404).send({ error: 'not found' });

    if (tryReadNamespaceRaw(name) !== null) {
      try {
        const md = readOwnEntry(`${name}/${file}`);
        reply.header('content-type', 'text/markdown; charset=utf-8');
        return md;
      } catch {
        return reply.code(404).send({ error: 'entry not found' });
      }
    }

    const source = activeSourceBySlug(name);
    if (source) {
      const links = sourceLinks(source.id);
      const pageNames = sourcePageNames(links);
      const link = links.find((l) => `${pageNames.get(l.id)}.md` === file);
      if (!link || !link.cache_hash) return reply.code(404).send({ error: 'page not cached' });
      try {
        const md = fs.readFileSync(cachePath(link.cache_hash), 'utf8');
        reply.header('content-type', 'text/markdown; charset=utf-8');
        return md;
      } catch {
        return reply.code(404).send({ error: 'cache file missing' });
      }
    }

    return reply.code(404).send({ error: 'doc set not found' });
  });
}

/* ---------- local namespaces ---------- */

function tryReadNamespaceRaw(name: string): string | null {
  try {
    return readNamespaceRaw(name);
  } catch {
    return null;
  }
}

/** Rewrite manifest links into the /docs/ URL space; leave external URLs alone. */
export function rewriteDocLinks(doc: LlmsDoc): LlmsDoc {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      links: section.links.map((link) => ({ ...link, url: toDocsUrl(link.url) })),
    })),
  };
}

function toDocsUrl(url: string): string {
  const entry = url.match(/^\/api\/entries\/get\?name=([a-zA-Z0-9_\-./]+)$/);
  if (entry) return `/docs/${entry[1]}`;
  const manifest = url.match(/^\/([a-z0-9][a-z0-9_-]*)\/llms\.txt$/i);
  if (manifest) return `/docs/${manifest[1]}/llms.txt`;
  return url;
}

/* ---------- mirrored sources ---------- */

function activeSources(): SourceRow[] {
  return db.prepare(`SELECT * FROM sources WHERE state = 'active' ORDER BY created_at`).all() as SourceRow[];
}

function activeSourceBySlug(slug: string): SourceRow | undefined {
  return db.prepare(`SELECT * FROM sources WHERE slug = ? AND state = 'active'`).get(slug) as
    | SourceRow
    | undefined;
}

function sourceLinks(sourceId: number): LinkRow[] {
  return db
    .prepare('SELECT * FROM links WHERE source_id = ? ORDER BY position, id')
    .all(sourceId) as LinkRow[];
}

function sourceDocsManifest(source: SourceRow): LlmsDoc {
  const links = sourceLinks(source.id);
  const pageNames = sourcePageNames(links);
  const sectionMap = new Map<string, LinkRow[]>();
  for (const link of links) {
    const key = link.section ?? 'Docs';
    if (!sectionMap.has(key)) sectionMap.set(key, []);
    sectionMap.get(key)!.push(link);
  }
  return {
    title: source.title ?? source.url,
    summary: source.summary ?? undefined,
    sections: [...sectionMap.entries()].map(([name, sectionLinks]) => ({
      name,
      links: sectionLinks.map((link) => ({
        title: link.title ?? link.url,
        url: link.cache_hash ? `/docs/${source.slug}/${pageNames.get(link.id)}.md` : link.url,
        description: link.description ?? undefined,
      })),
    })),
  };
}

/**
 * Stable, human-readable page name per link, derived from the link URL's last
 * path segment (falling back to the title). Deterministic over the
 * position-ordered link list, so manifest generation and request resolution
 * always agree.
 */
export function sourcePageNames(links: LinkRow[]): Map<number, string> {
  const used = new Map<string, number>();
  const names = new Map<number, string>();
  for (const link of links) {
    const base = pageBaseName(link);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    names.set(link.id, seen === 0 ? base : `${base}-${seen + 1}`);
  }
  return names;
}

function pageBaseName(link: LinkRow): string {
  let segment = '';
  try {
    const segments = new URL(link.url).pathname.split('/').filter(Boolean);
    segment = segments[segments.length - 1] ?? '';
  } catch {
    /* non-URL link — fall through to title */
  }
  segment = segment.replace(/\.(md|markdown|html?|txt)$/i, '');
  return slugify(segment) || slugify(link.title ?? '') || 'page';
}
