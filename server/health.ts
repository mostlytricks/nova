import fs from 'node:fs';
import path from 'node:path';
import { OWN_DIR } from './config.js';
import { listNamespaces, namespaceDir } from './own.js';
import { parseLlmsTxt, type LlmsDoc, type LlmsLink } from './parser.js';

export type NamespaceHealthStatus = 'healthy' | 'warn' | 'error';
export type NamespaceHealthSeverity = 'error' | 'warning';
export type SplitRecommendationStrategy = 'sections' | 'path';

export interface NamespaceHealthIssue {
  severity: NamespaceHealthSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface NamespaceHealthStats {
  sections: number;
  links: number;
  entries: number;
  externalLinks: number;
  orphans: number;
  bytes: number;
  tinyEntries: number;
  oversizedEntries: number;
  duplicateUrls: number;
}

export interface NamespaceHealthRecommendation {
  strategy: SplitRecommendationStrategy;
  reason: string;
  command: string;
}

export interface NamespaceHealthReport {
  namespace: string;
  status: NamespaceHealthStatus;
  errors: NamespaceHealthIssue[];
  warnings: NamespaceHealthIssue[];
  stats: NamespaceHealthStats;
  recommendation: NamespaceHealthRecommendation | null;
}

export interface NamespaceHealthOptions {
  tinyEntryChars?: number;
  oversizedEntryChars?: number;
  manifestLinkWarnThreshold?: number;
  sectionLinkWarnThreshold?: number;
}

const DEFAULT_HEALTH_OPTIONS: Required<NamespaceHealthOptions> = {
  tinyEntryChars: 300,
  oversizedEntryChars: 40_000,
  manifestLinkWarnThreshold: 100,
  sectionLinkWarnThreshold: 50,
};

const SAFE_ENTRY_NAME = /^[a-zA-Z0-9_\-./]+$/;
const HTML_LEAK_RE = /<\/?(html|body|div|span|script|style)\b/i;

interface OwnLinkTarget {
  entryName: string;
  unsafe: boolean;
}

export function checkAllNamespaces(options: NamespaceHealthOptions = {}): NamespaceHealthReport[] {
  return listNamespaces().map((namespace) => checkNamespaceHealth(namespace, options));
}

export function checkNamespaceHealth(namespace: string, options: NamespaceHealthOptions = {}): NamespaceHealthReport {
  const opts = { ...DEFAULT_HEALTH_OPTIONS, ...options };
  const issues: NamespaceHealthIssue[] = [];
  let doc: LlmsDoc | null = null;
  let raw = '';
  let dir = '';

  try {
    dir = namespaceDir(namespace);
  } catch (e) {
    issues.push(error('invalid_namespace', e instanceof Error ? e.message : 'invalid namespace name'));
  }

  const llmsPath = dir ? path.join(dir, 'llms.txt') : '';
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    issues.push(error('namespace_missing', `namespace not found: ${namespace}`));
  } else if (!fs.existsSync(llmsPath)) {
    issues.push(error('manifest_missing', `llms.txt not found for namespace: ${namespace}`));
  } else {
    raw = fs.readFileSync(llmsPath, 'utf8');
    try {
      doc = parseLlmsTxt(raw);
      validateManifest(doc, issues);
    } catch (e) {
      issues.push(error('manifest_parse_failed', e instanceof Error ? e.message : String(e), `${namespace}/llms.txt`));
    }
  }

  const entryFiles = dir && fs.existsSync(dir) ? listNamespaceMarkdownFiles(namespace, dir) : [];
  const referencedEntries = new Set<string>();
  const allLinks = doc ? doc.sections.flatMap((section) => section.links) : [];
  let externalLinks = 0;

  if (doc) {
    warnOnManifestShape(namespace, doc, allLinks, issues, opts);
    for (const link of allLinks) {
      const target = ownEntryFromLink(link);
      if (!target) {
        externalLinks++;
        continue;
      }
      if (target.unsafe) {
        issues.push(error('unsafe_own_entry_link', `own-entry link is not a safe data/own path: ${link.url}`, `${namespace}/llms.txt`));
        continue;
      }
      if (!target.entryName.startsWith(`${namespace}/`)) {
        issues.push(error('own_entry_outside_namespace', `own-entry link points outside namespace: ${target.entryName}`, `${namespace}/llms.txt`));
        continue;
      }
      referencedEntries.add(target.entryName);
      const abs = safeOwnEntryPath(target.entryName);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        issues.push(error('own_entry_missing', `referenced entry is missing: ${target.entryName}`, target.entryName));
      }
    }
  }

  const orphans = entryFiles.filter((entry) => !referencedEntries.has(entry));
  for (const orphan of orphans) {
    issues.push(warning('orphan_entry', `entry is not linked from llms.txt: ${orphan}`, orphan));
  }

  const entryStats = checkEntryFiles(namespace, entryFiles, issues, opts);
  const recommendation = doc ? recommendSplit(namespace, doc, allLinks, opts) : null;
  if (recommendation) {
    issues.push(warning('split_recommended', recommendation.reason));
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const status: NamespaceHealthStatus = errors.length ? 'error' : warnings.length ? 'warn' : 'healthy';

  return {
    namespace,
    status,
    errors,
    warnings,
    stats: {
      sections: doc?.sections.length ?? 0,
      links: allLinks.length,
      entries: entryFiles.length,
      externalLinks,
      orphans: orphans.length,
      bytes: entryStats.bytes,
      tinyEntries: entryStats.tinyEntries,
      oversizedEntries: entryStats.oversizedEntries,
      duplicateUrls: duplicateUrlCount(allLinks),
    },
    recommendation,
  };
}

function validateManifest(doc: LlmsDoc, issues: NamespaceHealthIssue[]): void {
  if (!doc.title) issues.push(error('manifest_missing_title', 'llms.txt is missing an H1 title'));
  if (!doc.summary) issues.push(warning('manifest_missing_summary', 'llms.txt is missing a summary blockquote'));
  if (!doc.sections.length) {
    issues.push(error('manifest_missing_sections', 'llms.txt has no H2 sections'));
    return;
  }
  const linkCount = doc.sections.reduce((acc, section) => acc + section.links.length, 0);
  if (linkCount === 0) issues.push(error('manifest_missing_links', 'llms.txt has no links'));
}

function warnOnManifestShape(
  namespace: string,
  doc: LlmsDoc,
  links: LlmsLink[],
  issues: NamespaceHealthIssue[],
  opts: Required<NamespaceHealthOptions>,
): void {
  if (links.length > opts.manifestLinkWarnThreshold) {
    issues.push(warning('manifest_many_links', `llms.txt has ${links.length} links; consider splitting ${namespace}`));
  }
  for (const section of doc.sections) {
    if (section.links.length > opts.sectionLinkWarnThreshold) {
      issues.push(warning('section_many_links', `section "${section.name}" has ${section.links.length} links`, `${namespace}/llms.txt`));
    }
  }

  const seen = new Map<string, number>();
  for (const link of links) seen.set(link.url, (seen.get(link.url) ?? 0) + 1);
  for (const [url, count] of seen.entries()) {
    if (count > 1) issues.push(warning('duplicate_link_url', `duplicate link URL appears ${count} times: ${url}`, `${namespace}/llms.txt`));
  }

  // Descriptions are how agents select without fetching — required by namespace/SPEC.md.
  for (const link of links) {
    if (!link.description?.trim()) {
      issues.push(warning('link_missing_description', `link has no description: ${link.title || link.url}`, `${namespace}/llms.txt`));
    }
  }
}

function checkEntryFiles(
  namespace: string,
  entries: string[],
  issues: NamespaceHealthIssue[],
  opts: Required<NamespaceHealthOptions>,
): { bytes: number; tinyEntries: number; oversizedEntries: number } {
  let bytes = 0;
  let tinyEntries = 0;
  let oversizedEntries = 0;

  for (const entry of entries) {
    const abs = safeOwnEntryPath(entry);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const text = fs.readFileSync(abs, 'utf8');
    bytes += Buffer.byteLength(text, 'utf8');
    if (text.trim().length < opts.tinyEntryChars) {
      tinyEntries++;
      issues.push(warning('entry_tiny', `entry is under ${opts.tinyEntryChars} chars: ${entry}`, entry));
    }
    if (text.length > opts.oversizedEntryChars) {
      oversizedEntries++;
      issues.push(warning('entry_oversized', `entry is over ${opts.oversizedEntryChars} chars: ${entry}`, entry));
    }
    if (HTML_LEAK_RE.test(text)) {
      issues.push(warning('entry_html_leak', `entry appears to contain raw HTML: ${entry}`, entry));
    }
    if (!entry.startsWith(`${namespace}/`)) {
      issues.push(error('entry_outside_namespace', `entry file is outside namespace scan: ${entry}`, entry));
    }
  }

  return { bytes, tinyEntries, oversizedEntries };
}

function recommendSplit(
  namespace: string,
  doc: LlmsDoc,
  links: LlmsLink[],
  opts: Required<NamespaceHealthOptions>,
): NamespaceHealthRecommendation | null {
  if (links.length <= opts.manifestLinkWarnThreshold) return null;
  const nonEmptySections = doc.sections.filter((section) => section.links.length > 0);
  if (nonEmptySections.length > 1) {
    return {
      strategy: 'sections',
      reason: `${namespace} has ${links.length} links across ${nonEmptySections.length} sections; split by sections`,
      command: `pnpm docs-import split ${namespace} --by sections --dry-run`,
    };
  }

  const variedPathGroups = new Set(links.map((link) => pathGroupKey(namespace, link))).size;
  if (variedPathGroups > 1) {
    return {
      strategy: 'path',
      reason: `${namespace} has ${links.length} links in one section across ${variedPathGroups} path groups; split by path`,
      command: `pnpm docs-import split ${namespace} --by path --dry-run`,
    };
  }
  return null;
}

function listNamespaceMarkdownFiles(namespace: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(path.relative(OWN_DIR, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(dir);
  return out.filter((entry) => entry.startsWith(`${namespace}/`)).sort();
}

function ownEntryFromLink(link: LlmsLink): OwnLinkTarget | null {
  let url: URL;
  try {
    url = new URL(link.url, 'http://local');
  } catch {
    return null;
  }
  if (url.pathname !== '/api/entries/get') return null;
  if (url.origin !== 'http://local' && !isLocalhost(url.hostname)) return null;
  const entryName = url.searchParams.get('name') ?? '';
  const unsafe = !entryName || !SAFE_ENTRY_NAME.test(entryName) || entryName.includes('..') || !safeOwnEntryPath(entryName);
  return { entryName, unsafe };
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function safeOwnEntryPath(entryName: string): string | null {
  if (!SAFE_ENTRY_NAME.test(entryName) || entryName.includes('..')) return null;
  const ownRoot = path.resolve(OWN_DIR);
  const abs = path.resolve(OWN_DIR, entryName);
  const relative = path.relative(ownRoot, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return abs;
}

function pathGroupKey(namespace: string, link: LlmsLink): string {
  const target = ownEntryFromLink(link);
  if (target && !target.unsafe && target.entryName.startsWith(`${namespace}/`)) {
    const rest = target.entryName.slice(namespace.length + 1);
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

function duplicateUrlCount(links: LlmsLink[]): number {
  const seen = new Map<string, number>();
  for (const link of links) seen.set(link.url, (seen.get(link.url) ?? 0) + 1);
  return [...seen.values()].filter((count) => count > 1).length;
}

function error(code: string, message: string, issuePath?: string): NamespaceHealthIssue {
  return issuePath ? { severity: 'error', code, message, path: issuePath } : { severity: 'error', code, message };
}

function warning(code: string, message: string, issuePath?: string): NamespaceHealthIssue {
  return issuePath ? { severity: 'warning', code, message, path: issuePath } : { severity: 'warning', code, message };
}
