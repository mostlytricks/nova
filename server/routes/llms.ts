import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db, type SourceRow } from '../db.js';
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

export async function registerLlmsRoutes(app: FastifyInstance): Promise<void> {
  /* -------- master llms.txt -------- */

  app.get('/llms.txt', async (req, reply) => {
    const merge = (req.query as any)?.merge === 'true' || (req.query as any)?.merge === '1';
    const tag = (req.query as any)?.tag as string | undefined;

    if (!merge) {
      reply.header('content-type', 'text/markdown; charset=utf-8');
      return readOwnRaw();
    }

    const own = readOwnLlms();
    const sources = db
      .prepare(`SELECT * FROM sources WHERE state = 'active' ORDER BY created_at`)
      .all() as SourceRow[];
    const sourceDocs = sources
      .filter((s) => {
        if (!tag) return true;
        try {
          const tags = JSON.parse(s.tags) as string[];
          return tags.includes(tag);
        } catch {
          return false;
        }
      })
      .map((s) => {
        const links = db.prepare('SELECT * FROM links WHERE source_id = ? ORDER BY position').all(s.id) as any[];
        const sectionMap = new Map<string, any[]>();
        for (const l of links) {
          const key = l.section ?? '';
          if (!sectionMap.has(key)) sectionMap.set(key, []);
          sectionMap.get(key)!.push({ title: l.title, url: l.url, description: l.description });
        }
        const doc: LlmsDoc = {
          title: s.title ?? s.url,
          sections: [...sectionMap.entries()].map(([name, ll]) => ({ name, links: ll })),
        };
        return { title: s.title ?? s.url, doc };
      });

    const merged = mergeOwnWithSources(own, sourceDocs);
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return serializeLlmsTxt(merged);
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

  app.put<{ Body: { raw: string } }>('/api/llms/own', async (req) => {
    const raw = req.body?.raw ?? '';
    const parsed = parseLlmsTxt(raw);
    writeOwnRaw(serializeLlmsTxt(parsed));
    return { ok: true };
  });

  app.post('/api/llms/own/regenerate', async () => {
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
        return {
          name: n,
          title: doc.title,
          summary: doc.summary ?? null,
          note: doc.note ?? null,
          entryCount: entries,
        };
      }),
    };
  });

  app.put<{ Params: { name: string }; Body: { note: string } }>(
    '/api/namespaces/:name/note',
    async (req, reply) => {
      try {
        const doc = readNamespaceLlms(req.params.name);
        const trimmed = (req.body?.note ?? '').trim();
        doc.note = trimmed || undefined;
        writeNamespaceRaw(req.params.name, serializeLlmsTxt(doc));
        return { ok: true, note: doc.note ?? null };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
      }
    },
  );

  app.post<{ Body: { name: string; title?: string; summary?: string } }>(
    '/api/namespaces',
    async (req, reply) => {
      const { name, title, summary } = req.body ?? ({} as any);
      if (!name) return reply.code(400).send({ error: 'name required' });
      try {
        createNamespace(name, { title, summary });
        return { ok: true, name };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
      }
    },
  );

  app.delete<{ Params: { name: string } }>('/api/namespaces/:name', async (req, reply) => {
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
      try {
        const parsed = parseLlmsTxt(req.body?.raw ?? '');
        writeNamespaceRaw(req.params.name, serializeLlmsTxt(parsed));
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
