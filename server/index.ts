import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { HOST, PORT, UI_DIST } from './config.js';
import './db.js';
import { registerLlmsRoutes } from './routes/llms.js';
import { registerSourcesRoutes } from './routes/sources.js';
import { registerEntriesRoutes } from './routes/entries.js';
import { registerContentRoutes } from './routes/content.js';
import { registerStatsRoutes } from './routes/stats.js';
import { startScheduler } from './fetcher/scheduler.js';

const app = Fastify({ logger: true });

await registerLlmsRoutes(app);
await registerSourcesRoutes(app);
await registerEntriesRoutes(app);
await registerContentRoutes(app);
await registerStatsRoutes(app);

if (fs.existsSync(UI_DIST)) {
  await app.register(fastifyStatic, { root: UI_DIST, prefix: '/' });
}

startScheduler();

app.listen({ host: HOST, port: PORT }).then((addr) => {
  app.log.info(`local-llmstxt-server listening at ${addr}`);
});
