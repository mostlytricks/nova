import type { FastifyInstance } from 'fastify';
import { db, type SourceRow, type LinkRow } from '../db.js';
import { probeSource, refreshSource, refreshLink } from '../fetcher/source.js';

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

  app.post<{ Body: { url: string } }>('/api/sources/probe', async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url) return reply.code(400).send({ error: 'url required' });
    const result = await probeSource(url);
    if (!result.ok) return reply.code(400).send({ error: result.error, raw: result.raw });
    return result;
  });

  app.post<{ Body: { url: string; tags?: string[]; notes?: string; ttl_hours?: number } }>(
    '/api/sources',
    async (req, reply) => {
      const { url, tags = [], notes = '', ttl_hours } = req.body ?? ({} as any);
      if (!url) return reply.code(400).send({ error: 'url required' });
      const probe = await probeSource(url);
      if (!probe.ok || !probe.doc) {
        return reply.code(400).send({ error: probe.error ?? 'probe failed' });
      }
      const stmt = db.prepare(
        `INSERT INTO sources (url, title, summary, state, ttl_hours, tags, notes)
         VALUES (?, ?, ?, 'trial', ?, ?, ?)`,
      );
      let id: number;
      try {
        const r = stmt.run(
          url,
          probe.doc.title,
          probe.doc.summary ?? null,
          ttl_hours ?? null,
          JSON.stringify(tags),
          notes,
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
    }>;
  }>('/api/sources/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
    if (!source) return reply.code(404).send({ error: 'not found' });
    const body = req.body ?? {};
    const sets: string[] = [];
    const params: any[] = [];
    if (body.state) { sets.push('state = ?'); params.push(body.state); }
    if (body.tags) { sets.push('tags = ?'); params.push(JSON.stringify(body.tags)); }
    if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
    if (body.ttl_hours !== undefined) { sets.push('ttl_hours = ?'); params.push(body.ttl_hours); }
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title); }
    if (sets.length === 0) return formatSource(source);
    params.push(id);
    db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow;
    return formatSource(updated);
  });

  app.delete<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/sources/:id',
    async (req, reply) => {
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
    const id = Number(req.params.id);
    const result = await refreshSource(id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/links/:id/refresh', async (req, reply) => {
    const id = Number(req.params.id);
    await refreshLink(id);
    return { ok: true };
  });

  app.get('/api/tombstones', async () => {
    return db.prepare('SELECT * FROM tombstones ORDER BY removed_at DESC').all();
  });
}

function formatSource(s: SourceRow) {
  return {
    id: s.id,
    url: s.url,
    title: s.title,
    summary: s.summary,
    state: s.state,
    ttl_hours: s.ttl_hours,
    tags: safeJson<string[]>(s.tags, []),
    notes: s.notes,
    last_fetched: s.last_fetched,
    last_accessed: s.last_accessed,
    last_error: s.last_error,
    created_at: s.created_at,
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
