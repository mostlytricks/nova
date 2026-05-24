import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { cachePath, db, type LinkRow } from '../db.js';

export async function registerContentRoutes(app: FastifyInstance): Promise<void> {
  // By cache hash
  app.get<{ Params: { hash: string } }>('/api/content/:hash', async (req, reply) => {
    const hash = req.params.hash;
    if (!/^[a-f0-9]{8,64}$/.test(hash)) return reply.code(400).send({ error: 'bad hash' });
    try {
      const md = await fs.readFile(cachePath(hash), 'utf8');
      reply.header('content-type', 'text/markdown; charset=utf-8');
      return md;
    } catch {
      return reply.code(404).send({ error: 'not cached' });
    }
  });

  // By link id (resolves to cache_hash; convenience)
  app.get<{ Params: { id: string } }>('/api/links/:id/content', async (req, reply) => {
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(Number(req.params.id)) as
      | LinkRow
      | undefined;
    if (!link) return reply.code(404).send({ error: 'link not found' });
    if (!link.cache_hash) return reply.code(404).send({ error: 'not yet cached' });
    try {
      const md = await fs.readFile(cachePath(link.cache_hash), 'utf8');
      reply.header('content-type', 'text/markdown; charset=utf-8');
      return md;
    } catch {
      return reply.code(404).send({ error: 'cache file missing' });
    }
  });
}
