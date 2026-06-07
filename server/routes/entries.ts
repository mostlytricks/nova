import type { FastifyInstance } from 'fastify';
import {
  listOwnEntries,
  readOwnEntry,
  writeOwnEntry,
  deleteOwnEntry,
} from '../own.js';
import { requireWriteAccess } from '../write-protect.js';

export async function registerEntriesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/entries', async () => {
    return { entries: listOwnEntries() };
  });

  app.get<{ Querystring: { name?: string } }>('/api/entries/get', async (req, reply) => {
    const name = req.query.name;
    if (!name) return reply.code(400).send({ error: 'name required' });
    try {
      return { name, content: readOwnEntry(name) };
    } catch (e) {
      return reply.code(404).send({ error: e instanceof Error ? e.message : 'not found' });
    }
  });

  app.put<{ Body: { name: string; content: string } }>('/api/entries', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    const { name, content } = req.body ?? ({} as any);
    if (!name || content === undefined) return reply.code(400).send({ error: 'name + content required' });
    try {
      writeOwnEntry(name, content);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
    }
  });

  app.delete<{ Querystring: { name?: string } }>('/api/entries', async (req, reply) => {
    if (!requireWriteAccess(req, reply)) return;
    const name = req.query.name;
    if (!name) return reply.code(400).send({ error: 'name required' });
    try {
      deleteOwnEntry(name);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed' });
    }
  });
}
