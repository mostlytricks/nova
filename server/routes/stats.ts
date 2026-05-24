import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { listNamespaces, listOwnEntries, readNamespaceLlms } from '../own.js';

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats', async () => {
    const namespaces = listNamespaces();
    const entries = listOwnEntries();

    const byState = db
      .prepare(`SELECT state, COUNT(*) AS n FROM sources GROUP BY state`)
      .all() as { state: string; n: number }[];
    const sourceCounts = { trial: 0, active: 0, archived: 0, total: 0 };
    for (const row of byState) {
      if (row.state in sourceCounts) (sourceCounts as any)[row.state] = row.n;
      sourceCounts.total += row.n;
    }

    const linkAgg = db
      .prepare(`SELECT COUNT(*) AS total, COUNT(cache_hash) AS cached FROM links`)
      .get() as { total: number; cached: number };

    const errors = db
      .prepare(`SELECT COUNT(*) AS n FROM sources WHERE last_error IS NOT NULL`)
      .get() as { n: number };

    const oldest = db
      .prepare(`SELECT MIN(last_fetched) AS t FROM sources WHERE last_fetched IS NOT NULL`)
      .get() as { t: number | null };

    const perNamespace = namespaces.map((n) => {
      const doc = readNamespaceLlms(n);
      const linkCount = doc.sections.reduce((acc, s) => acc + s.links.length, 0);
      return { name: n, title: doc.title, linkCount };
    });

    return {
      namespaces: {
        count: namespaces.length,
        items: perNamespace,
      },
      ownEntries: {
        count: entries.length,
      },
      sources: sourceCounts,
      links: linkAgg,
      errors: errors.n,
      oldestFetch: oldest.t,
      generatedAt: Date.now(),
    };
  });
}
