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

interface AgentExternalSourceLink {
  id: number;
  slug: string | null;
  title: string;
  url: string;
  llmsUrl: string;
  absoluteLlmsUrl: string;
  llmsLocalUrl: string;
  absoluteLlmsLocalUrl: string;
  docsUrl: string | null;
  absoluteDocsUrl: string | null;
  owner: string | null;
  trustNote: string | null;
  intendedUse: string | null;
  warning: string | null;
  lastReviewedAt: number | null;
  promotionReason: string | null;
  lastFetched: number | null;
  lastError: string | null;
}

interface AgentNamespaceLink extends AgentIndexLink {
  name: string;
  title: string;
  summary: string | null;
  docsUrl: string;
  absoluteDocsUrl: string;
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
      const docsUrl = `/docs/${name}/llms.txt`;
      const sourceNamespace = splitSourceNamespace(name);
      return {
        name,
        title: doc.title || name,
        summary: doc.summary ?? null,
        label: doc.title || name,
        url,
        absoluteUrl: absoluteUrl(origin, url),
        docsUrl,
        absoluteDocsUrl: absoluteUrl(origin, docsUrl),
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
    const agentUrl = '/agent/llms.txt';
    const namespacesUrl = '/agent/namespaces';
    const sourcesUrl = '/agent/sources';
    const startHere = healthyNamespaces[0] ?? namespaces.find((namespace) => !namespace.isSplit) ?? namespaces[0] ?? null;

    return {
      generatedAt: Date.now(),
      recommended: {
        label: 'Recommended agent manifest',
        url: agentUrl,
        absoluteUrl: absoluteUrl(origin, agentUrl),
      } satisfies AgentIndexLink,
      master: {
        label: 'Local master llms.txt',
        url: masterUrl,
        absoluteUrl: absoluteUrl(origin, masterUrl),
      } satisfies AgentIndexLink,
      mergedExternal: {
        label: 'Recommended agent manifest',
        url: agentUrl,
        absoluteUrl: absoluteUrl(origin, agentUrl),
        activeSourceCount: activeSources.length,
      },
      catalogs: {
        namespaces: {
          label: 'Local docs catalog',
          url: namespacesUrl,
          absoluteUrl: absoluteUrl(origin, namespacesUrl),
        } satisfies AgentIndexLink,
        sources: {
          label: 'Active imported docs catalog',
          url: sourcesUrl,
          absoluteUrl: absoluteUrl(origin, sourcesUrl),
        } satisfies AgentIndexLink,
      },
      startHere,
      namespaces,
      splitIndexes,
      activeSources: activeSources.map((source): AgentExternalSourceLink => {
        const llmsUrl = `/agent/sources/${source.id}/llms.txt`;
        const llmsLocalUrl = `${llmsUrl}?resolve=local`;
        const docsUrl = source.slug ? `/docs/${source.slug}/llms.txt` : null;
        return {
          id: source.id,
          slug: source.slug,
          title: source.title ?? source.url,
          url: source.url,
          llmsUrl,
          absoluteLlmsUrl: absoluteUrl(origin, llmsUrl),
          llmsLocalUrl,
          absoluteLlmsLocalUrl: absoluteUrl(origin, llmsLocalUrl),
          docsUrl,
          absoluteDocsUrl: docsUrl ? absoluteUrl(origin, docsUrl) : null,
          owner: source.owner,
          trustNote: source.trust_note,
          intendedUse: source.intended_use,
          warning: source.warning,
          lastReviewedAt: source.last_reviewed_at,
          promotionReason: source.promotion_reason,
          lastFetched: source.last_fetched,
          lastError: source.last_error,
        };
      }),
      snippets: buildSnippets(origin, masterUrl, agentUrl, startHere, splitIndexes[0] ?? null, activeSources.length),
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
  agentUrl: string,
  startHere: AgentNamespaceLink | null,
  splitIndex: AgentNamespaceLink | null,
  activeSourceCount: number,
) {
  const snippets = [
    {
      title: 'Start here',
      text: `Read ${absoluteUrl(origin, agentUrl)} first. Choose relevant links by description, then fetch only those entries.`,
    },
    {
      title: 'Local only',
      text: `Use ${absoluteUrl(origin, masterUrl)} when the task should ignore cached imported docs.`,
    },
  ];
  if (startHere) {
    snippets.push({
      title: 'Use this local doc',
      text: `Use ${startHere.absoluteDocsUrl} for ${startHere.title}. Everything for this doc set lives under that /docs/ prefix. Prefer its linked entries over broad web search.`,
    });
  }
  if (splitIndex) {
    snippets.push({
      title: 'Use split index',
      text: `For smaller context windows, start with ${splitIndex.absoluteUrl} and then read only the matching split local doc set.`,
    });
  }
  if (activeSourceCount > 0) {
    snippets.push({
      title: 'Include imported docs',
      text: `Use ${absoluteUrl(origin, agentUrl)} when the task needs approved active imported docs merged with local docs.`,
    });
    snippets.push({
      title: 'Intranet / offline',
      text: `Use ${absoluteUrl(origin, `${agentUrl}?resolve=local`)} when agents cannot reach the internet: cached external links are rewritten to this server's local cache.`,
    });
  }
  return snippets;
}
