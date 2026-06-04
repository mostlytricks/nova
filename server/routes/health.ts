import type { FastifyInstance } from 'fastify';
import { checkAllNamespaces, checkNamespaceHealth } from '../health.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health/namespaces', async () => {
    return {
      generatedAt: Date.now(),
      namespaces: checkAllNamespaces(),
    };
  });

  app.get<{ Params: { name: string } }>('/api/health/namespaces/:name', async (req, reply) => {
    const report = checkNamespaceHealth(req.params.name);
    if (report.errors.some((issue) => issue.code === 'namespace_missing')) {
      return reply.code(404).send(report);
    }
    return report;
  });
}
