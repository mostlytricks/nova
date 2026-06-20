import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db, type LinkRow, type SourceRow } from '../db.js';
import { OWN_DIR } from '../config.js';
import { parseLlmsTxt, serializeLlmsTxt, type LlmsDoc } from '../parser.js';
import {
  readOwnLlms,
  mergeOwnWithSources,
  readOwnRaw,
  writeOwnRaw,
  generateMasterRaw,
  listNamespaces,
  readNamespaceRaw,
  readNamespaceLlms,
  writeNamespaceRaw,
  createNamespace,
  deleteNamespace,
} from '../own.js';
import {
  appendNamespaceHistory,
  readNamespaceHistory,
  readNamespaceMeta,
  writeNamespaceMeta,
  type NamespaceMeta,
} from '../namespace-meta.js';
import { requireWriteAccess } from '../write-protect.js';

export async function registerLlmsRoutes(app: FastifyInstance): Promise<void> {
  /* -------- master llms.txt -------- */

  app.get('/llms.txt', async (req, reply) => {
    const merge = (req.query as any)?.merge === 'true' || (req.query as any)?.merge === '1';
    const tag = (req.query as any)?.tag as string | undefined;

    if (!merge) {
      reply.header('content-type', 'text/markdown; charset=utf-8');
      return readOwnRaw();
    }

    const merged = mergedAgentDoc(tag);
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return serializeLlmsTxt(merged);
  });

  /* -------- explicit agent-facing manifests -------- */

  app.get('/agent/llms.txt', async (req, reply) => {
    const tag = (req.query as any)?.tag as string | undefined;
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return serializeLlmsTxt(mergedAgentDoc(tag));
  });

  app.get('/agent/namespaces', async () => {
    return {
      namespaces: listNamespaces().map((name) => {
        const doc = readNamespaceLlms(name);
        return {
          name,
          title: doc.title || name,
          summary: doc.summary ?? null,
          url: `/${name}/llms.txt`,
          meta: readNamespaceMeta(name),
        };
      }),
    };
  });

  app.get('/agent/sources', async () => {
    const sources = activeSources();
    return {
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title ?? source.url,
        url: source.url,
        llmsUrl: `/agent/sources/${source.id}/llms.txt`,
        tags: parseTags(source.tags),
        owner: source.owner,
        trustNote: source.trust_note,
        intendedUse: source.intended_use,
        warning: source.warning,
        lastReviewedAt: source.last_reviewed_at,
        lastFetched: source.last_fetched,
        lastError: source.last_error,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/agent/sources/:id/llms.txt', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid source id' });

    const source = db.prepare('SELECT * FROM sources WHERE id = ? AND state = ?').get(id, 'active') as SourceRow | undefined;
    if (!source) return reply.code(404).send({ error: 'active source not found' });

    reply.header('content-type', 'text/markdown; charset=utf-8');
    return serializeLlmsTxt(sourceDoc(source));
  });

  /* -------- namespace llms.txt (public, agent-facing) -------- */

  app.get<{ Params: { namespace: string } }>('/:namespace/llms.txt', async (req, reply) => {
    try {
      const raw = readNamespaceRaw(req.params.namespace);
      reply.header('content-type', 'text/markdown; charset=utf-8');
      return raw;
    } catch {
      return reply.code(404).send({ error: 'namespace not found' });
    }
  });

  /* -------- master llms.txt management -------- */

  app.get('/api/llms/own', async () => {
    return { raw: readOwnRaw(), parsed: readOwnLlms(), exists: existsOnDisk() };
  });

  app.put<{ Body: { raw: string } }>('/api/llms/own', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    const raw = req.body?.raw ?? '';
    const parsed = parseLlmsTxt(raw);
    writeOwnRaw(serializeLlmsTxt(parsed));
    return { ok: true };
  });

  app.post('/api/llms/own/regenerate', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    const raw = generateMasterRaw();
    writeOwnRaw(raw);
    return { raw };
  });

  /* -------- namespace management -------- */

  app.get('/api/namespaces', async () => {
    const names = listNamespaces();
    return {
      namespaces: names.map((n) => {
        const doc = readNamespaceLlms(n);
        const entries = doc.sections.reduce((acc, s) => acc + s.links.length, 0);
        const meta = readNamespaceMeta(n);
        return {
          name: n,
          title: doc.title,
          summary: doc.summary ?? null,
          note: doc.note ?? null,
          entryCount: entries,
          state: meta.state,
          doc_type: meta.doc_type,
          origin_url: meta.origin_url,
          base_url: meta.base_url,
          auth_summary: meta.auth_summary,
          version: meta.version,
          known_gaps: meta.known_gaps,
          tags: meta.tags,
          notes: meta.notes,
          owner: meta.owner,
          trust_note: meta.trust_note,
          intended_use: meta.intended_use,
          warning: meta.warning,
          last_reviewed_at: meta.last_reviewed_at,
          promotion_reason: meta.promotion_reason,
          created_at: meta.created_at,
          updated_at: meta.updated_at,
        };
      }),
    };
  });

  app.get<{ Params: { name: string } }>('/api/namespaces/:name/meta', async (req, reply) => {
    try {
      readNamespaceRaw(req.params.name);
      return readNamespaceMeta(req.params.name);
    } catch {
      return reply.code(404).send({ error: 'namespace not found' });
    }
  });

  app.patch<{
    Params: { name: string };
    Body: Partial<NamespaceMeta>;
  }>('/api/namespaces/:name/meta', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    try {
      readNamespaceRaw(req.params.name);
      const meta = writeNamespaceMeta(req.params.name, req.body ?? {});
      appendNamespaceHistory(req.params.name, 'meta_updated', 'Namespace metadata updated');
      return meta;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
    }
  });

  app.get<{ Params: { name: string } }>('/api/namespaces/:name/history', async (req, reply) => {
    try {
      readNamespaceRaw(req.params.name);
      return { namespace: req.params.name, events: readNamespaceHistory(req.params.name) };
    } catch {
      return reply.code(404).send({ error: 'namespace not found' });
    }
  });

  app.put<{ Params: { name: string }; Body: { note: string } }>(
    '/api/namespaces/:name/note',
    async (req, reply) => {
      if (!requireWriteAccess(req, reply)) return;
      try {
        const doc = readNamespaceLlms(req.params.name);
        const trimmed = (req.body?.note ?? '').trim();
        doc.note = trimmed || undefined;
        writeNamespaceRaw(req.params.name, serializeLlmsTxt(doc));
        appendNamespaceHistory(req.params.name, 'note_updated', trimmed ? 'Namespace note updated' : 'Namespace note cleared');
        return { ok: true, note: doc.note ?? null };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
      }
    },
  );

  app.post<{ Body: { name: string; title?: string; summary?: string; doc_type?: NamespaceMeta['doc_type'] } }>(
    '/api/namespaces',
    async (req, reply) => {
      if (!requireWriteAccess(req, reply)) return;
      const { name, title, summary, doc_type } = req.body ?? ({} as any);
      if (!name) return reply.code(400).send({ error: 'name required' });
      try {
        createNamespace(name, { title, summary, doc_type });
        writeNamespaceMeta(name, { state: 'draft', doc_type: doc_type ?? 'notes', notes: 'Draft scaffold. Replace placeholders with sourced facts before promotion.' });
        appendNamespaceHistory(name, 'namespace_created', `Local Docs created (${doc_type ?? 'notes'} profile)`);
        return { ok: true, name };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
      }
    },
  );

  app.delete<{ Params: { name: string } }>('/api/namespaces/:name', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    try {
      deleteNamespace(req.params.name);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
    }
  });

  app.get<{ Params: { name: string } }>('/api/namespaces/:name/llms', async (req, reply) => {
    try {
      return { raw: readNamespaceRaw(req.params.name), parsed: readNamespaceLlms(req.params.name) };
    } catch {
      return reply.code(404).send({ error: 'namespace not found' });
    }
  });

  app.put<{ Params: { name: string }; Body: { raw: string } }>(
    '/api/namespaces/:name/llms',
    async (req, reply) => {
      if (!requireWriteAccess(req, reply)) return;
      try {
        const parsed = parseLlmsTxt(req.body?.raw ?? '');
        writeNamespaceRaw(req.params.name, serializeLlmsTxt(parsed));
        appendNamespaceHistory(req.params.name, 'llms_saved', 'Namespace llms.txt saved');
        return { ok: true };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
      }
    },
  );
}

function existsOnDisk(): boolean {
  return fs.existsSync(path.join(OWN_DIR, 'llms.txt'));
}

function mergedAgentDoc(tag?: string): LlmsDoc {
  const sourceDocs = activeSources()
    .filter((source) => !tag || parseTags(source.tags).includes(tag))
    .map((source) => ({ title: source.title ?? source.url, doc: sourceDoc(source) }));
  return mergeOwnWithSources(readOwnLlms(), sourceDocs);
}

function activeSources(): SourceRow[] {
  return db.prepare(`SELECT * FROM sources WHERE state = 'active' ORDER BY created_at`).all() as SourceRow[];
}

function sourceDoc(source: SourceRow): LlmsDoc {
  const links = db.prepare('SELECT * FROM links WHERE source_id = ? ORDER BY position').all(source.id) as LinkRow[];
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
        url: link.url,
        description: link.description ?? undefined,
      })),
    })),
  };
}

function parseTags(raw: string): string[] {
  try {
    const tags = JSON.parse(raw);
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}
