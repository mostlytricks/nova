#!/usr/bin/env node
/**
 * docs-import — tiny CLI for the producing agent.
 *
 * Subcommands:
 *   probe <url>             Detect source type + return JSON plan
 *   discover <url>          Discover docs framework + candidate page graph
 *   fetch-clean <url>       Fetch a single URL and print clean markdown to stdout
 *   openapi <spec-url>      Parse an OpenAPI/Swagger spec into structured JSON grouped by tag
 *   check <namespace>       Check namespace health
 *   split <namespace>       Split a namespace into focused sibling namespaces
 *
 * Output goes to stdout in the command-specific format. Errors go to stderr;
 * exit codes are 0 (ok), 1 (failed sanity / not found), 2 (bad usage).
 */

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import SwaggerParser from '@apidevtools/swagger-parser';
import { fetchMarkdown, htmlToMarkdown } from '../fetcher/fetch.js';
import { OWN_DIR } from '../config.js';
import { checkAllNamespaces, checkNamespaceHealth, type NamespaceHealthReport } from '../health.js';
import { parseLlmsTxt, serializeLlmsTxt, type LlmsDoc, type LlmsLink } from '../parser.js';

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
  /** 'csr' means the page renders client-side; static fetch likely yields an empty shell. */
  rendering: 'ssr' | 'csr';
  /** A pre-rendered markdown twin of the root page, if one exists (sidesteps rendering). */
  mdTwin: string | null;
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

/** Hydration/data markers that betray a JS-framework page (corroborating, not decisive). */
const CSR_MARKERS = [
  '__NEXT_DATA__',
  'window.__NUXT__',
  '__remixContext',
  'window.__sveltekit',
  'window.__INITIAL_STATE__',
];

/**
 * Decide whether a page is client-side rendered, i.e. its real content is absent
 * from the static HTML. The decisive signals are an empty mount container or very
 * little rendered text alongside several scripts; framework markers only corroborate.
 */
function detectCsr(html: string): { csr: boolean; signals: string[] } {
  const signals: string[] = [];
  for (const m of CSR_MARKERS) {
    if (html.includes(m)) signals.push(`marker:${m}`);
  }
  const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (gen && /(next\.js|nuxt|gatsby|docusaurus|vitepress|astro|remix|svelte)/i.test(gen)) {
    signals.push(`generator:${gen.trim()}`);
  }

  let emptyRoot = false;
  let lowText = false;
  try {
    const doc = new JSDOM(html).window.document;
    const root = doc.querySelector('#root, #app, #__next, [data-reactroot]');
    emptyRoot = root != null && (root.textContent ?? '').trim().length < 50;
    if (emptyRoot) signals.push('empty-mount-container');
    const bodyText = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const scripts = doc.querySelectorAll('script[src]').length;
    if (bodyText.length < 400 && scripts >= 3) {
      lowText = true;
      signals.push(`low-text(${bodyText.length}chars)/scripts(${scripts})`);
    }
  } catch { /* malformed HTML — fall back to marker-only signals */ }

  // Decisive: content is actually missing from the HTML. Markers alone (e.g. a Next.js
  // SSG page that DOES embed its content) must not trip this — they'd be false positives.
  return { csr: emptyRoot || lowText, signals };
}

/** Look for a pre-rendered markdown twin of the root page (e.g. `/page.md`, `/page/index.md`). */
async function findMdTwin(root: string): Promise<string | null> {
  const looksLikeMarkdown = (t: string) => /^#{1,6}\s/m.test(t) && !/<\/?(html|body|div|script)\b/i.test(t);
  const candidates = root.endsWith('.md')
    ? []
    : [root + '.md', joinUrl(root + '/', 'index.md')];
  for (const c of candidates) {
    const text = await tryFetchText(c);
    if (text && looksLikeMarkdown(text)) return canonicalize(c);
  }
  return null;
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
      rendering: 'ssr',
      mdTwin: null,
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
      rendering: 'ssr',
      mdTwin: null,
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
        rendering: 'ssr',
        mdTwin: null,
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
      rendering: 'ssr',
      mdTwin: null,
      warnings,
    };
  }
  const meta = extractMeta(html);

  // Detect client-side rendering: if the real content isn't in the static HTML,
  // downstream static extraction will be incomplete. Surface the route to take.
  const { csr, signals } = detectCsr(html);
  const rendering: 'ssr' | 'csr' = csr ? 'csr' : 'ssr';
  let mdTwin: string | null = null;
  if (csr) {
    mdTwin = await findMdTwin(root);
    warnings.push(`CSR/SPA detected (${signals.join(', ') || 'sparse static content'}); static extraction may be incomplete`);
    warnings.push(
      mdTwin
        ? `pre-rendered markdown twin found: ${mdTwin} — prefer it over rendering`
        : 'no markdown twin; use `fetch-clean --render` or operator reader-mode paste -> llms-compose',
    );
  }

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
      rendering,
      mdTwin,
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
    rendering,
    mdTwin,
    warnings,
  };
}

/* ---------- discover ---------- */

type DocsFramework = 'docusaurus' | 'mkdocs' | 'vitepress' | 'unknown';
type DiscoverSource = 'llms.txt' | 'openapi' | 'sitemap' | 'search-index' | 'nav' | 'markdown-twin';

interface DiscoverPage {
  url: string;
  title: string | null;
  section: string;
  sources: DiscoverSource[];
}

interface DiscoverResult {
  rootUrl: string;
  scopeUrl: string;
  framework: DocsFramework;
  confidence: 'high' | 'medium' | 'low';
  title: string | null;
  summary: string | null;
  suggestedNamespace: string;
  suggestedProfile: 'api' | 'website' | 'library' | 'notes';
  recommendedMode: 'llmstxt' | 'openapi' | 'local-docs' | 'single-page';
  sources: {
    llmsTxtUrl: string | null;
    openapiSpecUrl: string | null;
    sitemapUrls: string[];
    searchIndexUrls: string[];
    navLinks: number;
    markdownTwin: string | null;
  };
  pages: DiscoverPage[];
  sections: { name: string; count: number; sampleUrls: string[] }[];
  warnings: string[];
  nextSteps: string[];
}

interface SearchIndexPage {
  url: string;
  title: string | null;
}

function docsScopeUrl(root: string): string {
  const u = new URL(root);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length > 1) {
    const first = parts[0].toLowerCase();
    if (/^(docs|guide|guides|learn|reference|api|manual|tutorial|tutorials|handbook)$/.test(first)) {
      u.pathname = `/${parts[0]}/`;
      u.search = '';
      u.hash = '';
      return u.toString();
    }
  }
  u.pathname = '/';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function sameScope(scope: string, url: string): boolean {
  try {
    const s = new URL(scope);
    const u = new URL(url);
    if (s.origin !== u.origin) return false;
    return u.pathname.startsWith(s.pathname);
  } catch {
    return false;
  }
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function detectDocsFramework(html: string): { framework: DocsFramework; confidence: 'high' | 'medium' | 'low'; signals: string[] } {
  const signals: string[] = [];
  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
  if (generator) signals.push(`generator:${generator}`);
  const lower = html.toLowerCase();

  if (/docusaurus/i.test(generator ?? '') || lower.includes('__docusaurus') || lower.includes('docusaurus')) {
    return { framework: 'docusaurus', confidence: generator || lower.includes('__docusaurus') ? 'high' : 'medium', signals };
  }
  if (/mkdocs/i.test(generator ?? '') || lower.includes('mkdocs') || lower.includes('material for mkdocs')) {
    return { framework: 'mkdocs', confidence: generator ? 'high' : 'medium', signals };
  }
  if (/vitepress/i.test(generator ?? '') || lower.includes('vitepress') || lower.includes('__vitepress') || lower.includes('vp-')) {
    return { framework: 'vitepress', confidence: generator || lower.includes('vitepress') ? 'high' : 'medium', signals };
  }
  return { framework: 'unknown', confidence: 'low', signals };
}

function searchIndexCandidates(root: string, scope: string): string[] {
  const candidates = new Set<string>();
  for (const base of [new URL(root).origin + '/', scope]) {
    candidates.add(joinUrl(base, 'search/search_index.json'));
    candidates.add(joinUrl(base, 'search_index.json'));
    candidates.add(joinUrl(base, 'assets/search.json'));
  }
  return [...candidates];
}

function parseSearchIndex(raw: unknown, indexUrl: string): SearchIndexPage[] {
  const docs = Array.isArray((raw as any)?.docs)
    ? (raw as any).docs
    : Array.isArray((raw as any)?.pages)
      ? (raw as any).pages
      : Array.isArray(raw)
        ? raw
        : [];

  const pages: SearchIndexPage[] = [];
  for (const doc of docs) {
    const location = doc?.location ?? doc?.url ?? doc?.path;
    if (!location || typeof location !== 'string') continue;
    const title = typeof doc?.title === 'string'
      ? stripHtml(doc.title)
      : typeof doc?.text === 'string'
        ? stripHtml(doc.text).slice(0, 80)
        : null;
    try {
      pages.push({ url: canonicalize(new URL(location, indexUrl).toString()), title: title || null });
    } catch { /* skip */ }
  }
  return pages;
}

async function findSearchIndexPages(root: string, scope: string): Promise<{ urls: string[]; pages: SearchIndexPage[] }> {
  const urls: string[] = [];
  const pages: SearchIndexPage[] = [];
  for (const candidate of searchIndexCandidates(root, scope)) {
    const index = await tryFetchJson<unknown>(candidate);
    const parsed = index ? parseSearchIndex(index, candidate) : [];
    if (!parsed.length) continue;
    urls.push(candidate);
    pages.push(...parsed);
  }
  return { urls, pages };
}

function inferSection(scope: string, pageUrl: string): string {
  try {
    const s = new URL(scope);
    const u = new URL(pageUrl);
    const relative = u.pathname.slice(s.pathname.length).replace(/^\/+/, '');
    const first = relative.split('/').filter(Boolean)[0] ?? 'overview';
    return first.replace(/\.(html?|mdx?)$/i, '') || 'overview';
  } catch {
    return 'overview';
  }
}

function pageIdentity(url: string): string {
  const u = new URL(url);
  u.hash = '';
  u.search = '';
  u.pathname = u.pathname
    .replace(/\/index\.(html?|mdx?)$/i, '')
    .replace(/\.(html?|mdx?)$/i, '')
    .replace(/\/+$/g, '');
  return `${u.origin}${u.pathname || '/'}`;
}

function shouldPreferPageUrl(current: string, next: string): boolean {
  const currentPath = new URL(current).pathname;
  const nextPath = new URL(next).pathname;
  if (/\.(md|mdx)$/i.test(nextPath) && !/\.(md|mdx)$/i.test(currentPath)) return true;
  if (!/\.(html?)$/i.test(nextPath) && /\.(html?)$/i.test(currentPath)) return true;
  return false;
}

function addPage(map: Map<string, DiscoverPage>, scope: string, url: string, title: string | null, source: DiscoverSource): void {
  if (!sameScope(scope, url)) return;
  if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|tgz|gz|css|js)$/i.test(new URL(url).pathname)) return;
  const normalizedUrl = canonicalize(url);
  const key = pageIdentity(normalizedUrl);
  const current = map.get(key);
  if (current) {
    if (!current.title && title) current.title = title;
    if (shouldPreferPageUrl(current.url, normalizedUrl)) current.url = normalizedUrl;
    if (!current.sources.includes(source)) current.sources.push(source);
    return;
  }
  map.set(key, { url: normalizedUrl, title, section: inferSection(scope, normalizedUrl), sources: [source] });
}

function summarizeSections(pages: DiscoverPage[]): { name: string; count: number; sampleUrls: string[] }[] {
  const groups = new Map<string, DiscoverPage[]>();
  for (const page of pages) groups.set(page.section, [...(groups.get(page.section) ?? []), page]);
  return [...groups.entries()]
    .map(([name, group]) => ({ name, count: group.length, sampleUrls: group.slice(0, 5).map((page) => page.url) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function runDiscover(rawUrl: string): Promise<DiscoverResult> {
  if (!rawUrl) die('discover requires a URL');
  const root = canonicalize(rawUrl);
  const scope = docsScopeUrl(root);
  const warnings: string[] = [];
  const pages = new Map<string, DiscoverPage>();

  const html = await tryFetchText(root);
  const meta = html ? extractMeta(html) : { title: null, description: null };
  const framework = html
    ? detectDocsFramework(html)
    : { framework: 'unknown' as DocsFramework, confidence: 'low' as const, signals: [] };

  const openapiSpecUrl = await findOpenApi(root);
  const llmsTxtUrl = joinUrl(new URL(root).origin + '/', 'llms.txt');
  const llmsText = await tryFetchText(llmsTxtUrl);
  let usableLlmsTxtUrl: string | null = null;
  if (llmsText && /^#\s+/m.test(llmsText)) {
    usableLlmsTxtUrl = llmsTxtUrl;
    for (const url of parseLlmsLinks(llmsText, root).urls) addPage(pages, scope, url, null, 'llms.txt');
  }

  const sitemapUrls: string[] = [];
  for (const candidate of ['/sitemap.xml', '/sitemap_index.xml']) {
    const sitemapUrl = joinUrl(new URL(root).origin + '/', candidate);
    const found = await parseSitemap(sitemapUrl);
    const scoped = found.filter((url) => sameScope(scope, url));
    if (!scoped.length) continue;
    sitemapUrls.push(sitemapUrl);
    for (const url of scoped) addPage(pages, scope, url, null, 'sitemap');
  }

  const search = await findSearchIndexPages(root, scope);
  for (const page of search.pages) addPage(pages, scope, page.url, page.title, 'search-index');

  let navLinks: string[] = [];
  if (html) {
    navLinks = extractNavLinks(html, scope).filter((url) => sameScope(scope, url));
    for (const url of navLinks) addPage(pages, scope, url, null, 'nav');
  } else {
    warnings.push('could not fetch root URL for framework/nav detection');
  }

  const markdownTwin = await findMdTwin(root);
  if (markdownTwin) addPage(pages, scope, markdownTwin, meta.title, 'markdown-twin');
  addPage(pages, scope, root, meta.title, 'nav');

  const sortedPages = [...pages.values()].sort((a, b) => a.url.localeCompare(b.url)).slice(0, 300);
  if (pages.size > sortedPages.length) warnings.push(`candidate pages capped at ${sortedPages.length} of ${pages.size}`);
  if (framework.framework === 'unknown') warnings.push('docs framework was not confidently detected; rely on sitemap/search/nav evidence');
  if (sortedPages.length <= 1 && !usableLlmsTxtUrl && !openapiSpecUrl) warnings.push('only one scoped page discovered; narrow/deep URLs may need a broader docs root');

  const recommendedMode = openapiSpecUrl
    ? 'openapi'
    : usableLlmsTxtUrl
      ? 'llmstxt'
      : sortedPages.length > 1
        ? 'local-docs'
        : 'single-page';

  const nextSteps = recommendedMode === 'openapi'
    ? [`pnpm docs-import openapi ${openapiSpecUrl}`]
    : recommendedMode === 'llmstxt'
      ? [`Add Imported Docs from ${usableLlmsTxtUrl}, or use discovered pages to compose a focused Local Docs namespace.`]
      : [
          `Review sections and choose scope before fetching ${sortedPages.length} pages.`,
          `Fetch selected pages with pnpm docs-import fetch-clean <url>; prefer source markdown when available.`,
          `Compose a draft Local Docs namespace using profile library and namespace ${suggestNamespace(root)}.`,
        ];

  return {
    rootUrl: root,
    scopeUrl: scope,
    framework: framework.framework,
    confidence: framework.confidence,
    title: meta.title,
    summary: meta.description,
    suggestedNamespace: suggestNamespace(root),
    suggestedProfile: 'library',
    recommendedMode,
    sources: {
      llmsTxtUrl: usableLlmsTxtUrl,
      openapiSpecUrl,
      sitemapUrls,
      searchIndexUrls: search.urls,
      navLinks: navLinks.length,
      markdownTwin,
    },
    pages: sortedPages,
    sections: summarizeSections(sortedPages),
    warnings,
    nextSteps,
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

interface FetchCleanOptions {
  render: boolean;
  waitFor?: string;
}

function parseFetchCleanArgs(args: string[]): { url: string | undefined; options: FetchCleanOptions } {
  let url: string | undefined;
  const options: FetchCleanOptions = { render: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--render') {
      options.render = true;
    } else if (arg === '--wait-for') {
      const selector = args[i + 1];
      if (!selector) die('--wait-for requires a CSS selector');
      options.waitFor = selector;
      i += 1;
    } else if (arg.startsWith('--wait-for=')) {
      options.waitFor = arg.slice('--wait-for='.length);
    } else if (arg.startsWith('-')) {
      die(`unknown fetch-clean option: ${arg}`);
    } else if (!url) {
      url = arg;
    } else {
      die(`unexpected fetch-clean argument: ${arg}`);
    }
  }
  return { url, options };
}

async function renderMarkdown(url: string, options: FetchCleanOptions): Promise<string> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    die(
      [
        'fetch-clean --render requires Playwright, but it is not installed or could not be loaded.',
        'Install it with `pnpm install`, then install the browser with `pnpm exec playwright install chromium`.',
        'If rendering is unavailable, use the operator paste rung with llms-compose.',
        `Underlying error: ${e instanceof Error ? e.message : String(e)}`,
      ].join('\n'),
      1,
    );
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 15_000 });
    }
    const html = await page.content();
    return htmlToMarkdown(html, url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/Executable doesn't exist|browserType\.launch|install/i.test(message)) {
      die(
        [
          'fetch-clean --render could not start Chromium.',
          'Install it with `pnpm exec playwright install chromium`.',
          'If rendering is unavailable, use the operator paste rung with llms-compose.',
          `Underlying error: ${message}`,
        ].join('\n'),
        1,
      );
    }
    die(`render failed: ${message}`, 1);
  } finally {
    await browser?.close().catch(() => undefined);
  }
  throw new Error('unreachable');
}

async function runFetchClean(args: string[]): Promise<void> {
  const { url: rawUrl, options } = parseFetchCleanArgs(args);
  if (!rawUrl) die('fetch-clean requires a URL');
  const url = canonicalize(rawUrl);
  const res = options.render
    ? { markdown: await renderMarkdown(url, options), error: undefined }
    : await fetchMarkdown(url, { userAgent: UA });
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

/* ---------- check ---------- */

interface CheckOptions {
  namespace: string | null;
  all: boolean;
  json: boolean;
}

function parseCheckOptions(args: string[]): CheckOptions {
  const options: CheckOptions = { namespace: null, all: false, json: false };
  for (const arg of args) {
    if (arg === '--all') {
      options.all = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--')) {
      die(`unknown check option: ${arg}`);
    } else if (!options.namespace) {
      options.namespace = arg;
    } else {
      die(`unexpected check argument: ${arg}`);
    }
  }
  if (options.all && options.namespace) die('check accepts either <namespace> or --all, not both');
  if (!options.all && !options.namespace) die('check requires a namespace or --all');
  return options;
}

function printHealthReport(report: NamespaceHealthReport): void {
  const lines = [
    `${report.namespace}: ${report.status}`,
    `  links: ${report.stats.links}`,
    `  entries: ${report.stats.entries}`,
    `  warnings: ${report.warnings.length}`,
  ];
  if (report.errors.length) lines.push(`  errors: ${report.errors.length}`);
  if (report.stats.orphans) lines.push(`  orphans: ${report.stats.orphans}`);
  if (report.recommendation) lines.push(`  recommendation: ${report.recommendation.command}`);
  for (const issue of [...report.errors, ...report.warnings].slice(0, 12)) {
    lines.push(`  - ${issue.severity}: ${issue.code}: ${issue.message}`);
  }
  const hidden = report.errors.length + report.warnings.length - 12;
  if (hidden > 0) lines.push(`  - ... ${hidden} more issues`);
  process.stdout.write(lines.join('\n') + '\n');
}

function printHealthReports(reports: NamespaceHealthReport[]): void {
  reports.forEach((report, i) => {
    if (i) process.stdout.write('\n');
    printHealthReport(report);
  });
}

async function runCheck(args: string[]): Promise<void> {
  const options = parseCheckOptions(args);
  const reports = options.all ? checkAllNamespaces() : [checkNamespaceHealth(options.namespace!)];
  if (options.json) {
    const payload = options.all
      ? {
          status: reports.some((report) => report.status === 'error')
            ? 'error'
            : reports.some((report) => report.status === 'warn')
              ? 'warn'
              : 'healthy',
          namespaces: reports,
        }
      : reports[0];
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    printHealthReports(reports);
  }
  if (reports.some((report) => report.status === 'error')) process.exit(1);
}

/* ---------- split ---------- */

type SplitStrategy = 'sections' | 'path' | 'manual';

interface SplitOptions {
  by: SplitStrategy;
  dryRun: boolean;
  planPath: string | null;
}

interface SplitLink {
  link: LlmsLink;
  sourceEntry: string | null;
}

interface SplitGroup {
  slug: string;
  title: string;
  links: SplitLink[];
}

interface ManualPlan {
  namespace?: string;
  strategy?: string;
  groups?: {
    slug: string;
    title: string;
    linkUrls: string[];
  }[];
}

const RESERVED_SPLIT_SLUGS = new Set(['api', 'agent', 'docs', 'static', 'assets', 'llms.txt']);
const NAMESPACE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function parseSplitOptions(args: string[]): { namespace: string; options: SplitOptions } {
  const namespace = args[0];
  if (!namespace) die('split requires a namespace');
  const options: SplitOptions = { by: 'sections', dryRun: false, planPath: null };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--by') {
      const by = args[++i];
      if (by !== 'sections' && by !== 'path' && by !== 'manual') {
        die('--by must be one of: sections, path, manual');
      }
      options.by = by;
    } else if (arg === '--plan') {
      const planPath = args[++i];
      if (!planPath) die('--plan requires a file path');
      options.planPath = planPath;
      options.by = 'manual';
    } else {
      die(`unknown split option: ${arg}`);
    }
  }
  if (options.planPath && options.dryRun) {
    die('split does not support --plan with --dry-run');
  }
  return { namespace, options };
}

function validateExistingNamespace(name: string): void {
  if (!NAMESPACE_NAME_RE.test(name)) die(`invalid namespace: ${name}`);
  if (name.includes('--')) die('split-of-a-split is not supported');
  const dir = path.join(OWN_DIR, name);
  const llmsPath = path.join(dir, 'llms.txt');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    die(`namespace not found: ${name}`, 1);
  }
  if (!fs.existsSync(llmsPath)) {
    die(`namespace is missing llms.txt: ${name}`, 1);
  }
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'docs';
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = slugify(base);
  if (RESERVED_SPLIT_SLUGS.has(slug)) slug = `${slug}-1`;
  let candidate = slug;
  let n = 2;
  while (used.has(candidate) || RESERVED_SPLIT_SLUGS.has(candidate)) {
    candidate = `${slug}-${n++}`;
  }
  used.add(candidate);
  return candidate;
}

function ownEntryFromUrl(namespace: string, url: string): string | null {
  let raw = url;
  try {
    const parsed = new URL(url, 'http://local');
    if (parsed.pathname !== '/api/entries/get') return null;
    raw = parsed.searchParams.get('name') ?? '';
  } catch {
    return null;
  }
  if (!raw.startsWith(`${namespace}/`) || !raw.endsWith('.md') || raw.includes('..')) return null;
  if (!/^[a-zA-Z0-9_\-./]+$/.test(raw)) return null;
  return raw;
}

function rewriteOwnEntryUrl(namespace: string, splitNamespace: string, url: string): string {
  const entry = ownEntryFromUrl(namespace, url);
  if (!entry) return url;
  return `/api/entries/get?name=${splitNamespace}/${entry.slice(namespace.length + 1)}`;
}

function pathGroupKey(namespace: string, link: LlmsLink): string {
  const entry = ownEntryFromUrl(namespace, link.url);
  if (entry) {
    const rest = entry.slice(namespace.length + 1);
    const parts = rest.split('/').filter(Boolean);
    if (parts.length > 1) return parts[0];
    const fileBase = parts[0]?.replace(/\.md$/i, '') ?? 'docs';
    return fileBase.split(/[-_]/)[0] || fileBase || 'docs';
  }
  try {
    const url = new URL(link.url, 'http://local');
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[0] || 'external';
  } catch {
    return 'external';
  }
}

function linkToSplitLink(namespace: string, link: LlmsLink): SplitLink {
  return { link, sourceEntry: ownEntryFromUrl(namespace, link.url) };
}

function groupsBySections(namespace: string, doc: LlmsDoc): SplitGroup[] {
  const used = new Set<string>();
  return doc.sections
    .filter((section) => section.links.length > 0)
    .map((section) => ({
      slug: uniqueSlug(section.name, used),
      title: section.name,
      links: section.links.map((link) => linkToSplitLink(namespace, link)),
    }));
}

function groupsByPath(namespace: string, doc: LlmsDoc): SplitGroup[] {
  const bucket = new Map<string, LlmsLink[]>();
  for (const section of doc.sections) {
    for (const link of section.links) {
      const key = pathGroupKey(namespace, link);
      bucket.set(key, [...(bucket.get(key) ?? []), link]);
    }
  }
  const used = new Set<string>();
  return [...bucket.entries()].map(([title, links]) => ({
    slug: uniqueSlug(title, used),
    title,
    links: links.map((link) => linkToSplitLink(namespace, link)),
  }));
}

function applyManualPlan(namespace: string, doc: LlmsDoc, planPath: string): SplitGroup[] {
  let plan: ManualPlan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as ManualPlan;
  } catch (e) {
    die(`failed to read manual plan: ${e instanceof Error ? e.message : String(e)}`, 1);
  }
  if (plan.namespace && plan.namespace !== namespace) {
    die(`manual plan namespace mismatch: expected ${namespace}, got ${plan.namespace}`);
  }
  if (!Array.isArray(plan.groups) || plan.groups.length === 0) {
    die('manual plan must include at least one group');
  }
  const linksByUrl = new Map<string, LlmsLink>();
  for (const section of doc.sections) {
    for (const link of section.links) linksByUrl.set(link.url, link);
  }
  const used = new Set<string>();
  return plan.groups.map((group) => {
    if (!group.title || !Array.isArray(group.linkUrls)) die('manual plan group requires title and linkUrls');
    const slug = uniqueSlug(group.slug || group.title, used);
    const links = group.linkUrls.map((url) => {
      const link = linksByUrl.get(url);
      if (!link) die(`manual plan references unknown link URL: ${url}`);
      return linkToSplitLink(namespace, link);
    });
    return { slug, title: group.title, links };
  });
}

function emitManualPlan(namespace: string, groups: SplitGroup[]): void {
  process.stdout.write(JSON.stringify({
    namespace,
    strategy: 'manual',
    groups: groups.map((group) => ({
      slug: group.slug,
      title: group.title,
      linkUrls: group.links.map((item) => item.link.url),
    })),
  }, null, 2) + '\n');
}

function generatedToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildSplitDoc(namespace: string, doc: LlmsDoc, group: SplitGroup, strategy: SplitStrategy): LlmsDoc {
  const splitNamespace = `${namespace}--${group.slug}`;
  return {
    title: `${doc.title || namespace} - ${group.title}`,
    summary: doc.summary,
    note: `derived from \`${namespace}\` (full). Split by ${strategy}. Generated ${generatedToday()}.`,
    sections: [{
      name: group.title,
      links: group.links.map((item) => ({
        title: item.link.title,
        url: rewriteOwnEntryUrl(namespace, splitNamespace, item.link.url),
        description: item.link.description,
      })),
    }],
  };
}

function buildSplitIndexDoc(namespace: string, doc: LlmsDoc, groups: SplitGroup[], strategy: SplitStrategy): LlmsDoc {
  return {
    title: `${doc.title || namespace} (split)`,
    summary: `Split slices of \`${namespace}\`, grouped by ${strategy}. Each link below is a self-contained namespace.`,
    note: `derived from \`${namespace}\` (full). Generated ${generatedToday()}.`,
    sections: [{
      name: 'Slices',
      links: groups.map((group) => ({
        title: `${doc.title || namespace} - ${group.title}`,
        url: `/${namespace}--${group.slug}/llms.txt`,
        description: `${group.links.length} links`,
      })),
    }],
  };
}

function safeGeneratedDir(namespace: string, outputNamespace: string): string {
  if (!outputNamespace.startsWith(`${namespace}--`)) die(`refusing unexpected split namespace: ${outputNamespace}`);
  const ownRoot = path.resolve(OWN_DIR);
  const outDir = path.resolve(OWN_DIR, outputNamespace);
  const relative = path.relative(ownRoot, outDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    die(`refusing to write outside data/own: ${outputNamespace}`);
  }
  return outDir;
}

function copyReferencedEntries(namespace: string, splitNamespace: string, group: SplitGroup): string[] {
  const copied: string[] = [];
  for (const item of group.links) {
    if (!item.sourceEntry) continue;
    const source = path.resolve(OWN_DIR, item.sourceEntry);
    const relativeEntry = item.sourceEntry.slice(namespace.length + 1);
    const dest = path.resolve(OWN_DIR, splitNamespace, relativeEntry);
    const sourceRelative = path.relative(path.resolve(OWN_DIR, namespace), source);
    const destRelative = path.relative(path.resolve(OWN_DIR, splitNamespace), dest);
    if (sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative)) {
      die(`refusing to copy source outside namespace: ${item.sourceEntry}`);
    }
    if (destRelative.startsWith('..') || path.isAbsolute(destRelative)) {
      die(`refusing to copy destination outside split namespace: ${relativeEntry}`);
    }
    if (!fs.existsSync(source)) {
      die(`referenced entry is missing: ${item.sourceEntry}`, 1);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    copied.push(item.sourceEntry);
  }
  return copied;
}

function findOrphanEntries(namespace: string, groups: SplitGroup[]): string[] {
  const namespaceRoot = path.join(OWN_DIR, namespace);
  const referenced = new Set(groups.flatMap((group) => group.links.map((item) => item.sourceEntry).filter((entry): entry is string => !!entry)));
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = path.relative(OWN_DIR, abs).replace(/\\/g, '/');
        if (!referenced.has(rel)) out.push(rel);
      }
    }
  };
  if (fs.existsSync(namespaceRoot)) walk(namespaceRoot);
  return out.sort();
}

function printSplitSummary(namespace: string, groups: SplitGroup[], orphans: string[], dryRun: boolean): void {
  const lines = [
    `${dryRun ? 'Dry run' : 'Split'}: ${namespace}`,
    `  groups: ${groups.length}`,
    ...groups.map((group) => `  - ${namespace}--${group.slug}: ${group.title} (${group.links.length} links, ${group.links.filter((item) => item.sourceEntry).length} own entries)`),
  ];
  if (orphans.length) {
    lines.push(`  orphans left in original: ${orphans.length}`);
    for (const orphan of orphans.slice(0, 20)) lines.push(`    - ${orphan}`);
    if (orphans.length > 20) lines.push(`    - ... ${orphans.length - 20} more`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

async function runSplit(args: string[]): Promise<void> {
  const { namespace, options } = parseSplitOptions(args);
  validateExistingNamespace(namespace);
  const raw = fs.readFileSync(path.join(OWN_DIR, namespace, 'llms.txt'), 'utf8');
  const doc = parseLlmsTxt(raw);
  if (!doc.title || doc.sections.length === 0) die(`invalid llms.txt for namespace: ${namespace}`, 1);

  let groups: SplitGroup[];
  if (options.by === 'sections') groups = groupsBySections(namespace, doc);
  else if (options.by === 'path') groups = groupsByPath(namespace, doc);
  else if (options.planPath) groups = applyManualPlan(namespace, doc, options.planPath);
  else {
    emitManualPlan(namespace, groupsBySections(namespace, doc));
    return;
  }
  if (!groups.length) die(`no split groups produced for namespace: ${namespace}`, 1);

  const orphans = findOrphanEntries(namespace, groups);
  if (options.dryRun) {
    printSplitSummary(namespace, groups, orphans, true);
    return;
  }

  for (const group of groups) {
    const splitNamespace = `${namespace}--${group.slug}`;
    const outDir = safeGeneratedDir(namespace, splitNamespace);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    copyReferencedEntries(namespace, splitNamespace, group);
    fs.writeFileSync(path.join(outDir, 'llms.txt'), serializeLlmsTxt(buildSplitDoc(namespace, doc, group, options.by)), 'utf8');
  }

  const indexNamespace = `${namespace}--split`;
  const indexDir = safeGeneratedDir(namespace, indexNamespace);
  fs.rmSync(indexDir, { recursive: true, force: true });
  fs.mkdirSync(indexDir, { recursive: true });
  fs.writeFileSync(path.join(indexDir, 'llms.txt'), serializeLlmsTxt(buildSplitIndexDoc(namespace, doc, groups, options.by)), 'utf8');

  printSplitSummary(namespace, groups, orphans, false);
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
        '  discover <url>        Discover docs framework + candidate page graph',
        '  fetch-clean <url>     Fetch + clean to markdown on stdout (use --render for CSR/SPAs)',
        '  openapi <spec-url>    Parse OpenAPI/Swagger spec into JSON grouped by tag',
        '  check <namespace>     Check namespace health (or use --all, --json)',
        '  split <namespace>     Split a namespace into focused sibling namespaces',
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
    case 'discover': {
      const out = await runDiscover(args[0]);
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    case 'fetch-clean': {
      await runFetchClean(args);
      return;
    }
    case 'openapi': {
      const out = await runOpenapi(args[0]);
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    case 'check': {
      await runCheck(args);
      return;
    }
    case 'split': {
      await runSplit(args);
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
