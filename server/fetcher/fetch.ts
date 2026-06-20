import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { cachePath } from '../db.js';

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export interface FetchResult {
  status: number;
  notModified: boolean;
  contentType: 'markdown' | 'html' | 'unknown';
  markdown?: string;
  hash?: string;
  etag?: string;
  lastModified?: string;
  error?: string;
}

const MD_CONTENT_TYPES = ['text/markdown', 'text/x-markdown'];
const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

function looksLikeMarkdown(url: string, body: string): boolean {
  if (/\.md($|\?|#)/i.test(url)) return true;
  const trimmed = body.trimStart().slice(0, 1024);
  if (/<html|<body|<head/i.test(trimmed)) return false;
  if (/^#{1,6}\s|^---\n/m.test(trimmed)) return true;
  return false;
}

/**
 * Fetch a URL and convert to clean markdown.
 * Does NOT write to disk. Used by the CLI and as the inner step of fetchAndNormalize.
 */
export async function fetchMarkdown(
  url: string,
  hints: { etag?: string | null; lastModified?: string | null; userAgent?: string } = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    'User-Agent': hints.userAgent ?? 'local-llmstxt-server/0.1 (+internal)',
    Accept: 'text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5',
  };
  if (hints.etag) headers['If-None-Match'] = hints.etag;
  if (hints.lastModified) headers['If-Modified-Since'] = hints.lastModified;

  let res: Response;
  try {
    res = await fetch(url, { headers, redirect: 'follow' });
  } catch (e) {
    return {
      status: 0,
      notModified: false,
      contentType: 'unknown',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (res.status === 304) {
    return { status: 304, notModified: true, contentType: 'unknown' };
  }
  if (!res.ok) {
    return {
      status: res.status,
      notModified: false,
      contentType: 'unknown',
      error: `HTTP ${res.status}`,
    };
  }

  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  const etag = res.headers.get('etag') ?? undefined;
  const lastModified = res.headers.get('last-modified') ?? undefined;
  const body = await res.text();

  let kind: 'markdown' | 'html' | 'unknown' = 'unknown';
  if (MD_CONTENT_TYPES.some((t) => ct.includes(t))) kind = 'markdown';
  else if (HTML_CONTENT_TYPES.some((t) => ct.includes(t))) kind = 'html';
  else if (looksLikeMarkdown(url, body)) kind = 'markdown';
  else if (/<html|<body/i.test(body.slice(0, 1024))) kind = 'html';

  let markdown: string;
  if (kind === 'markdown') {
    markdown = body;
  } else if (kind === 'html') {
    markdown = htmlToMarkdown(body, url);
  } else {
    markdown = body;
  }

  return {
    status: res.status,
    notModified: false,
    contentType: kind,
    markdown,
    etag,
    lastModified,
  };
}

/**
 * Like fetchMarkdown, but also writes the markdown to data/cache/<hash>.md.
 * Used by the running server to populate the cache for external sources.
 */
export async function fetchAndNormalize(
  url: string,
  hints: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchResult> {
  const result = await fetchMarkdown(url, hints);
  if (!result.markdown) return result;

  const hash = crypto.createHash('sha256').update(result.markdown).digest('hex').slice(0, 32);
  await fs.writeFile(cachePath(hash), result.markdown, 'utf8');
  return { ...result, hash };
}

export function htmlToMarkdown(html: string, url: string): string {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const content = article?.content ?? dom.window.document.body?.innerHTML ?? html;
    const title = article?.title;
    const md = td.turndown(content);
    return title ? `# ${title}\n\n${md}` : md;
  } catch {
    return td.turndown(html);
  }
}
