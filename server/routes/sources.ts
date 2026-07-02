import type { FastifyInstance } from 'fastify';
import { db, type SourceRow, type LinkRow, type SourceRefreshRow, type LinkRefreshRow } from '../db.js';
import { probeSource, refreshSource, refreshLink } from '../fetcher/source.js';
import { serializeLlmsTxt, type LlmsDoc } from '../parser.js';
import { listNamespaces } from '../own.js';
import { RESERVED_DOC_NAMES, SLUG_RE, slugify, uniqueSlug } from '../slug.js';
import { requireWriteAccess } from '../write-protect.js';

export async function registerSourcesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sources', async () => {
    const rows = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all() as SourceRow[];
    const counts = db
      .prepare('SELECT source_id, COUNT(*) AS n FROM links GROUP BY source_id')
      .all() as { source_id: number; n: number }[];
    const countMap = new Map(counts.map((c) => [c.source_id, c.n]));
    return rows.map((r) => ({ ...formatSource(r), linkCount: countMap.get(r.id) ?? 0 }));
  });

  app.get<{ Params: { id: string } }>('/api/sources/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
    if (!source) return reply.code(404).send({ error: 'not found' });
    const links = db
      .prepare('SELECT * FROM links WHERE source_id = ? ORDER BY position')
      .all(id) as LinkRow[];
    db.prepare('UPDATE sources SET last_accessed = ? WHERE id = ?').run(Date.now(), id);
    return { source: formatSource(source), links };
  });

  app.get<{ Params: { id: string } }>('/api/sources/:id/history', async (req, reply) => {
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
    if (!source) return reply.code(404).send({ error: 'not found' });
    const refreshes = db
      .prepare(
        `SELECT * FROM source_refreshes
         WHERE source_id = ?
         ORDER BY started_at DESC, id DESC`,
      )
      .all(id) as SourceRefreshRow[];
    return { source: formatSource(source), refreshes };
  });

  app.get<{ Params: { id: string } }>('/api/sources/:id/llms', async (req, reply) => {
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
    if (!source) return reply.code(404).send({ error: 'not found' });
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return serializeLlmsTxt(sourceManifest(source));
  });

  app.post<{ Body: { url: string } }>('/api/sources/probe', async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url) return reply.code(400).send({ error: 'url required' });
    const result = await probeSource(url);
    if (!result.ok) return reply.code(400).send({ error: result.error, raw: result.raw });
    return result;
  });

  app.post<{ Body: {
    url: string;
    tags?: string[];
    notes?: string;
    ttl_hours?: number;
    owner?: string | null;
    trust_note?: string | null;
    intended_use?: string | null;
    warning?: string | null;
  } }>(
    '/api/sources',
    async (req, reply) => {
      if (!requireWriteAccess(req, reply)) return;
      const {
        url,
        tags = [],
        notes = '',
        ttl_hours,
        owner = null,
        trust_note = null,
        intended_use = null,
        warning = null,
      } = req.body ?? ({} as any);
      if (!url) return reply.code(400).send({ error: 'url required' });
      const probe = await probeSource(url);
      if (!probe.ok || !probe.doc) {
        return reply.code(400).send({ error: probe.error ?? 'probe failed' });
      }
      const stmt = db.prepare(
        `INSERT INTO sources (url, slug, title, summary, state, ttl_hours, tags, notes, owner, trust_note, intended_use, warning)
         VALUES (?, ?, ?, ?, 'trial', ?, ?, ?, ?, ?, ?, ?)`,
      );
      let id: number;
      try {
        const r = stmt.run(
          url,
          newSourceSlug(probe.doc.title, url),
          probe.doc.title,
          probe.doc.summary ?? null,
          ttl_hours ?? null,
          JSON.stringify(tags),
          notes,
          nullableText(owner),
          nullableText(trust_note),
          nullableText(intended_use),
          nullableText(warning),
        );
        id = Number(r.lastInsertRowid);
      } catch (e) {
        return reply.code(409).send({ error: 'source already exists' });
      }
      await refreshSource(id);
      const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow;
      return formatSource(source);
    },
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<{
      state: 'trial' | 'active' | 'archived';
      tags: string[];
      notes: string;
      ttl_hours: number | null;
      title: string;
      slug: string;
      owner: string | null;
      trust_note: string | null;
      intended_use: string | null;
      warning: string | null;
      last_reviewed_at: number | null;
      promotion_reason: string | null;
    }>;
  }>('/api/sources/:id', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
    if (!source) return reply.code(404).send({ error: 'not found' });
    const body = req.body ?? {};
    const sets: string[] = [];
    const params: any[] = [];
    if (body.state) {
      sets.push('state = ?');
      params.push(body.state);
      if (body.state === 'active' && source.state !== 'active' && body.last_reviewed_at === undefined) {
        sets.push('last_reviewed_at = ?');
        params.push(Date.now());
      }
    }
    if (body.tags) { sets.push('tags = ?'); params.push(JSON.stringify(body.tags)); }
    if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
    if (body.ttl_hours !== undefined) { sets.push('ttl_hours = ?'); params.push(body.ttl_hours); }
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title); }
    if (body.slug !== undefined) {
      const slug = body.slug.trim().toLowerCase();
      if (!SLUG_RE.test(slug)) return reply.code(400).send({ error: 'invalid slug (use a-z, 0-9, -)' });
      if (RESERVED_DOC_NAMES.has(slug)) return reply.code(400).send({ error: `'${slug}' is reserved` });
      if (listNamespaces().includes(slug)) return reply.code(409).send({ error: `'${slug}' is taken by a local namespace` });
      const clash = db.prepare('SELECT id FROM sources WHERE slug = ? AND id != ?').get(slug, id);
      if (clash) return reply.code(409).send({ error: `'${slug}' is taken by another source` });
      sets.push('slug = ?');
      params.push(slug);
    }
    if (body.owner !== undefined) { sets.push('owner = ?'); params.push(nullableText(body.owner)); }
    if (body.trust_note !== undefined) { sets.push('trust_note = ?'); params.push(nullableText(body.trust_note)); }
    if (body.intended_use !== undefined) { sets.push('intended_use = ?'); params.push(nullableText(body.intended_use)); }
    if (body.warning !== undefined) { sets.push('warning = ?'); params.push(nullableText(body.warning)); }
    if (body.last_reviewed_at !== undefined) { sets.push('last_reviewed_at = ?'); params.push(body.last_reviewed_at); }
    if (body.promotion_reason !== undefined) { sets.push('promotion_reason = ?'); params.push(nullableText(body.promotion_reason)); }
    if (sets.length === 0) return formatSource(source);
    params.push(id);
    db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow;
    return formatSource(updated);
  });

  app.delete<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/sources/:id',
    async (req, reply) => {
      if (!requireWriteAccess(req, reply)) return;
      const id = Number(req.params.id);
      const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
      if (!source) return reply.code(404).send({ error: 'not found' });
      const reason = (req.body as any)?.reason ?? null;
      const tx = db.transaction(() => {
        db.prepare('INSERT INTO tombstones (url, title, reason) VALUES (?, ?, ?)').run(
          source.url,
          source.title,
          reason,
        );
        db.prepare('DELETE FROM sources WHERE id = ?').run(id);
      });
      tx();
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>('/api/sources/:id/refresh', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    const id = Number(req.params.id);
    const result = await refreshSource(id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/links/:id/refresh', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    const id = Number(req.params.id);
    await refreshLink(id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/links/:id/history', async (req, reply) => {
    const id = Number(req.params.id);
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(id) as LinkRow | undefined;
    if (!link) return reply.code(404).send({ error: 'not found' });
    const refreshes = db
      .prepare(
        `SELECT * FROM link_refreshes
         WHERE link_id = ?
         ORDER BY started_at DESC, id DESC`,
      )
      .all(id) as LinkRefreshRow[];
    return { link, refreshes };
  });

  app.get('/api/tombstones', async () => {
    return db.prepare('SELECT * FROM tombstones ORDER BY removed_at DESC').all();
  });
}

function newSourceSlug(title: string | null | undefined, url: string): string {
  let host = '';
  try { host = new URL(url).host; } catch { /* keep empty */ }
  const base = slugify(title ?? '') || slugify(host) || 'source';
  const namespaces = new Set(listNamespaces());
  const isTaken = (slug: string) =>
    namespaces.has(slug) || !!db.prepare('SELECT 1 FROM sources WHERE slug = ?').get(slug);
  return uniqueSlug(base, isTaken);
}

function formatSource(s: SourceRow) {
  return {
    id: s.id,
    url: s.url,
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    state: s.state,
    ttl_hours: s.ttl_hours,
    tags: safeJson<string[]>(s.tags, []),
    notes: s.notes,
    owner: s.owner,
    trust_note: s.trust_note,
    intended_use: s.intended_use,
    warning: s.warning,
    last_reviewed_at: s.last_reviewed_at,
    promotion_reason: s.promotion_reason,
    last_fetched: s.last_fetched,
    last_accessed: s.last_accessed,
    last_error: s.last_error,
    created_at: s.created_at,
  };
}

function sourceManifest(source: SourceRow): LlmsDoc {
  const links = db.prepare('SELECT * FROM links WHERE source_id = ? ORDER BY position').all(source.id) as LinkRow[];
  const sectionMap = new Map<string, LinkRow[]>();
  for (const link of links) {
    const section = link.section ?? 'Docs';
    if (!sectionMap.has(section)) sectionMap.set(section, []);
    sectionMap.get(section)!.push(link);
  }
  return {
    title: source.title ?? source.url,
    summary: source.summary ?? undefined,
    sections: [...sectionMap.entries()].map(([name, sectionLinks]) => ({
      name,
      links: sectionLinks.map((link) => ({
        title: link.title ?? link.url,
        url: link.url,
        description: link.description ?? undefined,
      })),
    })),
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
