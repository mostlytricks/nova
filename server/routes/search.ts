import type { FastifyInstance } from 'fastify';
import { search } from '../search.js';

/**
 * GET /api/search?q=<query>&limit=<n>
 *
 * Read-only retrieval across local namespaces, own entries, and cached active
 * external docs. Helps humans and agents pick the right doc set before fetching
 * too much. Shares ranking with the `docs-import search` CLI via server/search.ts.
 */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    if (!q) return { query: '', count: 0, results: [] };
    const limit = req.query.limit
      ? Math.max(1, Math.min(100, Number(req.query.limit) || DEFAULT_LIMIT))
      : undefined;
    const results = search(q, { limit });
    return { query: q, count: results.length, results };
  });
}

const DEFAULT_LIMIT = 20;
