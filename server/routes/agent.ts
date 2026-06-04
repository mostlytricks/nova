import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { UI_DIST } from '../config.js';
import { db, type SourceRow } from '../db.js';
import { checkAllNamespaces, type NamespaceHealthReport } from '../health.js';
import { listNamespaces, readNamespaceLlms } from '../own.js';

interface AgentIndexLink {
  label: string;
  url: string;
  absoluteUrl: string;
}

interface AgentNamespaceLink extends AgentIndexLink {
  name: string;
  title: string;
  summary: string | null;
  health: NamespaceHealthReport['status'];
  links: number;
  isSplit: boolean;
  isSplitIndex: boolean;
  sourceNamespace: string | null;
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agent/index', async (req) => {
    const origin = requestOrigin(req);
    const healthByName = new Map(checkAllNamespaces().map((report) => [report.namespace, report]));
    const namespaces = listNamespaces().map((name): AgentNamespaceLink => {
      const doc = readNamespaceLlms(name);
      const health = healthByName.get(name);
      const url = `/${name}/llms.txt`;
      const sourceNamespace = splitSourceNamespace(name);
      return {
        name,
        title: doc.title || name,
        summary: doc.summary ?? null,
        label: doc.title || name,
        url,
        absoluteUrl: absoluteUrl(origin, url),
        health: health?.status ?? 'error',
        links: health?.stats.links ?? doc.sections.reduce((acc, section) => acc + section.links.length, 0),
        isSplit: name.includes('--'),
        isSplitIndex: name.endsWith('--split'),
        sourceNamespace,
      };
    });
    const splitIndexes = namespaces.filter((namespace) => namespace.isSplitIndex);
    const healthyNamespaces = namespaces.filter((namespace) => namespace.health === 'healthy' && !namespace.isSplit);
    const activeSources = db
      .prepare('SELECT * FROM sources WHERE state = ? ORDER BY created_at DESC')
      .all('active') as SourceRow[];

    const masterUrl = '/llms.txt';
    const mergedUrl = '/llms.txt?merge=true';
    const startHere = healthyNamespaces[0] ?? namespaces.find((namespace) => !namespace.isSplit) ?? namespaces[0] ?? null;

    return {
      generatedAt: Date.now(),
      master: {
        label: 'Master llms.txt',
        url: masterUrl,
        absoluteUrl: absoluteUrl(origin, masterUrl),
      } satisfies AgentIndexLink,
      mergedExternal: {
        label: 'Master + active external sources',
        url: mergedUrl,
        absoluteUrl: absoluteUrl(origin, mergedUrl),
        activeSourceCount: activeSources.length,
      },
      startHere,
      namespaces,
      splitIndexes,
      activeSources: activeSources.map((source) => ({
        id: source.id,
        title: source.title ?? source.url,
        url: source.url,
        lastFetched: source.last_fetched,
        lastError: source.last_error,
      })),
      snippets: buildSnippets(origin, masterUrl, mergedUrl, startHere, splitIndexes[0] ?? null, activeSources.length),
    };
  });

  app.get('/agent', async (_req, reply) => {
    const indexPath = path.join(UI_DIST, 'index.html');
    if (fs.existsSync(indexPath)) return reply.type('text/html').send(fs.readFileSync(indexPath, 'utf8'));
    return reply.redirect('/?view=agent');
  });
}

function requestOrigin(req: FastifyRequest): string {
  const host = req.headers.host ?? 'localhost';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = proto ?? (req as any).protocol ?? 'http';
  return `${protocol}://${host}`;
}

function absoluteUrl(origin: string, url: string): string {
  return new URL(url, origin).toString();
}

function splitSourceNamespace(name: string): string | null {
  const marker = name.indexOf('--');
  return marker === -1 ? null : name.slice(0, marker);
}

function buildSnippets(
  origin: string,
  masterUrl: string,
  mergedUrl: string,
  startHere: AgentNamespaceLink | null,
  splitIndex: AgentNamespaceLink | null,
  activeSourceCount: number,
) {
  const snippets = [
    {
      title: 'Start here',
      text: `Read ${absoluteUrl(origin, masterUrl)} first, then choose the most relevant namespace manifest.`,
    },
  ];
  if (startHere) {
    snippets.push({
      title: 'Use this namespace',
      text: `Use ${startHere.absoluteUrl} for ${startHere.title}. Prefer its linked entries over broad web search.`,
    });
  }
  if (splitIndex) {
    snippets.push({
      title: 'Use split index',
      text: `For smaller context windows, start with ${splitIndex.absoluteUrl} and then read only the matching split namespace.`,
    });
  }
  if (activeSourceCount > 0) {
    snippets.push({
      title: 'Include trusted external docs',
      text: `Use ${absoluteUrl(origin, mergedUrl)} when the task needs approved active external sources merged with local docs.`,
    });
  }
  return snippets;
}
