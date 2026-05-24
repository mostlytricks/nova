#!/usr/bin/env node
/**
 * docs-import — tiny CLI for the producing agent.
 *
 * Subcommands:
 *   probe <url>             Detect source type + return JSON plan
 *   fetch-clean <url>       Fetch a single URL and print clean markdown to stdout
 *   openapi <spec-url>      Parse an OpenAPI/Swagger spec into structured JSON grouped by tag
 *
 * Output is always JSON or markdown on stdout. Errors go to stderr; exit codes are
 * 0 (ok), 1 (failed sanity / not found), 2 (bad usage).
 */

import { JSDOM } from 'jsdom';
import SwaggerParser from '@apidevtools/swagger-parser';
import { fetchMarkdown } from '../fetcher/fetch.js';

/* ---------- shared helpers ---------- */

function die(msg: string, code = 2): never {
  process.stderr.write(`docs-import: ${msg}\n`);
  process.exit(code);
}

function canonicalize(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const url = new URL(u);
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(k) || /^(ref|fbclid|gclid)$/i.test(k)) url.searchParams.delete(k);
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function samePrefix(root: string, u: string): boolean {
  try {
    const r = new URL(root);
    const t = new URL(u);
    if (r.origin !== t.origin) return false;
    return t.pathname.startsWith(r.pathname === '/' ? '/' : r.pathname);
  } catch { return false; }
}

function joinUrl(base: string, path: string): string {
  return new URL(path, base).toString();
}

function suggestNamespace(input: string): string {
  try {
    const host = new URL(input).hostname.toLowerCase();
    const stripped = host.replace(/^(docs|developers?|api|www|help)\./, '');
    const parts = stripped.split('.');
    const slug = parts[0] || 'docs';
    return slug.replace(/[^a-z0-9_-]/g, '-');
  } catch { return 'docs'; }
}

const UA = 'docs-import/0.1 (+local agent)';

async function tryFetchText(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const ctl = AbortSignal.timeout(timeoutMs);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function tryFetchJson<T = unknown>(url: string): Promise<T | null> {
  const text = await tryFetchText(url);
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/* ---------- probe ---------- */

interface ProbeResult {
  kind: 'openapi' | 'llmstxt' | 'sitemap' | 'nav' | 'single';
  rootUrl: string;
  title: string | null;
  summary: string | null;
  suggestedNamespace: string;
  seedUrls: string[];
  openapiSpecUrl: string | null;
  warnings: string[];
}

const OPENAPI_CANDIDATES = [
  '/openapi.json',
  '/openapi.yaml',
  '/swagger.json',
  '/v3/api-docs',
  '/.well-known/openapi.json',
];

async function findOpenApi(root: string): Promise<string | null> {
  for (const path of OPENAPI_CANDIDATES) {
    const url = joinUrl(root + '/', path);
    const spec = await tryFetchJson<any>(url);
    if (spec && (spec.openapi || spec.swagger)) return url;
  }
  // Check HTML for <link rel="alternate" type="application/openapi+json">
  const html = await tryFetchText(root);
  if (html) {
    const m = html.match(/<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(?:vnd\.oai\.)?openapi\+(?:json|yaml)["'][^>]+href=["']([^"']+)["']/i);
    if (m) return new URL(m[1], root).toString();
  }
  return null;
}

function parseLlmsLinks(text: string, root: string): { title: string | null; summary: string | null; urls: string[] } {
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const summaryLines: string[] = [];
  for (const line of text.split('\n').slice(0, 30)) {
    if (line.startsWith('>')) summaryLines.push(line.replace(/^>\s?/, ''));
    else if (summaryLines.length) break;
  }
  const summary = summaryLines.length ? summaryLines.join(' ').trim() : null;
  const urls: string[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const u = new URL(m[2], root).toString();
      urls.push(canonicalize(u));
    } catch { /* skip */ }
  }
  return { title, summary, urls: [...new Set(urls)] };
}

async function parseSitemap(url: string, depth = 0): Promise<string[]> {
  if (depth > 1) return [];
  const text = await tryFetchText(url);
  if (!text) return [];
  // Sitemap index?
  if (/<sitemapindex/i.test(text)) {
    const sublocs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    const out: string[] = [];
    for (const sub of sublocs.slice(0, 10)) {
      out.push(...await parseSitemap(sub, depth + 1));
    }
    return out;
  }
  return [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

function extractMeta(html: string): { title: string | null; description: string | null } {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
  const desc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    null;
  return { title, description: desc?.trim() ?? null };
}

function extractNavLinks(html: string, root: string): string[] {
  let dom: JSDOM;
  try { dom = new JSDOM(html, { url: root }); } catch { return []; }
  const doc = dom.window.document;
  const selectors = [
    'nav a[href]',
    'aside a[href]',
    '[role="navigation"] a[href]',
    '[class*="sidebar" i] a[href]',
    '[class*="navigation" i] a[href]',
    '[class*="menu" i] a[href]',
    '[id*="sidebar" i] a[href]',
  ];
  const urls = new Set<string>();
  for (const sel of selectors) {
    doc.querySelectorAll(sel).forEach((el) => {
      const href = (el as Element).getAttribute('href');
      if (!href) return;
      try {
        const abs = new URL(href, root).toString();
        if (samePrefix(root, abs)) urls.add(canonicalize(abs));
      } catch { /* skip */ }
    });
  }
  urls.delete(canonicalize(root));
  return [...urls];
}

async function runProbe(rawUrl: string): Promise<ProbeResult> {
  if (!rawUrl) die('probe requires a URL');
  const root = canonicalize(rawUrl);
  const warnings: string[] = [];

  // 1. OpenAPI
  const openapiSpecUrl = await findOpenApi(root);
  if (openapiSpecUrl) {
    return {
      kind: 'openapi',
      rootUrl: root,
      title: null,
      summary: null,
      suggestedNamespace: suggestNamespace(root),
      seedUrls: [],
      openapiSpecUrl,
      warnings,
    };
  }

  // 2. llms.txt
  const llmsTxtUrl = joinUrl(root + '/', 'llms.txt');
  const llmsText = await tryFetchText(llmsTxtUrl);
  if (llmsText && /^#\s+/m.test(llmsText)) {
    const parsed = parseLlmsLinks(llmsText, root);
    return {
      kind: 'llmstxt',
      rootUrl: root,
      title: parsed.title,
      summary: parsed.summary,
      suggestedNamespace: suggestNamespace(root),
      seedUrls: parsed.urls.slice(0, 200),
      openapiSpecUrl: null,
      warnings,
    };
  }

  // 3. sitemap
  for (const candidate of ['/sitemap.xml', '/sitemap_index.xml']) {
    const sm = await parseSitemap(joinUrl(root + '/', candidate));
    const filtered = sm.filter((u) => samePrefix(root, u)).map(canonicalize);
    const deduped = [...new Set(filtered)];
    if (deduped.length > 1) {
      const html = await tryFetchText(root);
      const meta = html ? extractMeta(html) : { title: null, description: null };
      return {
        kind: 'sitemap',
        rootUrl: root,
        title: meta.title,
        summary: meta.description,
        suggestedNamespace: suggestNamespace(root),
        seedUrls: deduped.slice(0, 200),
        openapiSpecUrl: null,
        warnings,
      };
    }
  }

  // 4. nav extraction
  const html = await tryFetchText(root);
  if (!html) {
    warnings.push('could not fetch root URL');
    return {
      kind: 'single',
      rootUrl: root,
      title: null,
      summary: null,
      suggestedNamespace: suggestNamespace(root),
      seedUrls: [root],
      openapiSpecUrl: null,
      warnings,
    };
  }
  const meta = extractMeta(html);
  const navLinks = extractNavLinks(html, root);
  if (navLinks.length > 1) {
    return {
      kind: 'nav',
      rootUrl: root,
      title: meta.title,
      summary: meta.description,
      suggestedNamespace: suggestNamespace(root),
      seedUrls: navLinks.slice(0, 200),
      openapiSpecUrl: null,
      warnings,
    };
  }

  return {
    kind: 'single',
    rootUrl: root,
    title: meta.title,
    summary: meta.description,
    suggestedNamespace: suggestNamespace(root),
    seedUrls: [root],
    openapiSpecUrl: null,
    warnings,
  };
}

/* ---------- fetch-clean ---------- */

function passesSanity(md: string): { ok: boolean; reason?: string } {
  if (!md || md.length < 200) return { ok: false, reason: 'too short' };
  if (/<\/?(html|body|div|span|script|style)\b/i.test(md)) return { ok: false, reason: 'html tags leaked' };
  const hasHeading = /^#{1,6}\s/m.test(md);
  const hasCode = /```/.test(md);
  const hasTable = /^\|.+\|$/m.test(md);
  if (!hasHeading && !hasCode && !hasTable && md.length < 500) {
    return { ok: false, reason: 'no heading/code/table and very short' };
  }
  return { ok: true };
}

async function runFetchClean(rawUrl: string): Promise<void> {
  if (!rawUrl) die('fetch-clean requires a URL');
  const url = canonicalize(rawUrl);
  const res = await fetchMarkdown(url, { userAgent: UA });
  if (res.error || !res.markdown) {
    process.stderr.write(`fetch failed: ${res.error ?? 'no markdown'}\n`);
    process.exit(1);
  }
  const check = passesSanity(res.markdown);
  if (!check.ok) {
    process.stderr.write(`sanity check failed: ${check.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(res.markdown);
}

/* ---------- openapi ---------- */

function schemaType(schema: any): string {
  if (!schema) return 'unknown';
  if (schema.enum) return `enum(${schema.enum.slice(0, 5).map(JSON.stringify).join('|')}${schema.enum.length > 5 ? '|…' : ''})`;
  if (schema.type === 'array') return `array<${schemaType(schema.items)}>`;
  if (schema.type) return schema.type;
  if (schema.oneOf || schema.anyOf) return 'oneOf';
  return 'object';
}

function firstContent(body: any): { contentType: string; example: any; schemaType: string } | null {
  if (!body?.content) return null;
  const entries = Object.entries(body.content) as [string, any][];
  if (!entries.length) return null;
  const [contentType, def] = entries.find(([t]) => t.includes('json')) ?? entries[0];
  return {
    contentType,
    example: def.example ?? def.examples?.[Object.keys(def.examples ?? {})[0]]?.value ?? null,
    schemaType: schemaType(def.schema),
  };
}

async function runOpenapi(rawUrl: string): Promise<unknown> {
  if (!rawUrl) die('openapi requires a spec URL');
  let api: any;
  try {
    api = await SwaggerParser.dereference(rawUrl);
  } catch (e) {
    die(`failed to parse spec: ${e instanceof Error ? e.message : String(e)}`, 1);
  }

  const tagMap = new Map<string, { name: string; description: string; endpoints: any[] }>();
  for (const t of api.tags ?? []) {
    tagMap.set(t.name, { name: t.name, description: t.description ?? '', endpoints: [] });
  }

  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
  for (const [pathStr, ops] of Object.entries(api.paths ?? {})) {
    const pathLevelParams = (ops as any).parameters ?? [];
    for (const method of METHODS) {
      const op = (ops as any)[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? 'default';
      if (!tagMap.has(tag)) tagMap.set(tag, { name: tag, description: '', endpoints: [] });
      const parameters = [...pathLevelParams, ...(op.parameters ?? [])].map((p: any) => ({
        name: p.name,
        in: p.in,
        required: !!p.required,
        type: schemaType(p.schema),
        description: p.description ?? '',
      }));
      const responses: Record<string, any> = {};
      for (const [code, r] of Object.entries((op.responses ?? {}) as Record<string, any>)) {
        responses[code] = {
          description: r.description ?? '',
          ...(firstContent(r) ?? {}),
        };
      }
      tagMap.get(tag)!.endpoints.push({
        method: method.toUpperCase(),
        path: pathStr,
        summary: op.summary ?? '',
        description: op.description ?? '',
        deprecated: !!op.deprecated,
        parameters,
        requestBody: firstContent(op.requestBody),
        responses,
        security: op.security ?? null,
      });
    }
  }

  return {
    info: {
      title: api.info?.title ?? '',
      version: api.info?.version ?? '',
      description: api.info?.description ?? '',
    },
    servers: api.servers ?? [],
    securitySchemes: api.components?.securitySchemes ?? {},
    globalSecurity: api.security ?? [],
    tags: [...tagMap.values()].filter((t) => t.endpoints.length > 0),
  };
}

/* ---------- entry point ---------- */

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    process.stdout.write(
      [
        'Usage: docs-import <command> <args>',
        '',
        'Commands:',
        '  probe <url>           Detect source kind + return JSON plan',
        '  fetch-clean <url>     Fetch + clean to markdown on stdout (exit 1 on sanity failure)',
        '  openapi <spec-url>    Parse OpenAPI/Swagger spec into JSON grouped by tag',
        '',
      ].join('\n'),
    );
    process.exit(cmd ? 0 : 2);
  }

  switch (cmd) {
    case 'probe': {
      const out = await runProbe(args[0]);
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    case 'fetch-clean': {
      await runFetchClean(args[0]);
      return;
    }
    case 'openapi': {
      const out = await runOpenapi(args[0]);
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    default:
      die(`unknown command: ${cmd}`);
  }
}

main().catch((e) => {
  process.stderr.write(`docs-import: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
