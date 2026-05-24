import fs from 'node:fs';
import path from 'node:path';
import { OWN_DIR } from './config.js';
import { parseLlmsTxt, serializeLlmsTxt, type LlmsDoc, type LlmsSection } from './parser.js';

const OWN_LLMS = path.join(OWN_DIR, 'llms.txt');

// Names reserved at the URL root — namespaces can't shadow these.
const RESERVED_NAMESPACES = new Set(['api', 'llms.txt', 'assets', 'static']);
const NAMESPACE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/* ---------- master llms.txt ---------- */

export function readOwnLlms(): LlmsDoc {
  return parseLlmsTxt(readOwnRaw());
}

export function readOwnRaw(): string {
  if (!fs.existsSync(OWN_LLMS)) return generateMasterRaw();
  return fs.readFileSync(OWN_LLMS, 'utf8');
}

export function writeOwnRaw(text: string): void {
  fs.mkdirSync(path.dirname(OWN_LLMS), { recursive: true });
  fs.writeFileSync(OWN_LLMS, text, 'utf8');
}

export function writeOwnLlms(doc: LlmsDoc): void {
  writeOwnRaw(serializeLlmsTxt(doc));
}

/** Build a master llms.txt from the current namespaces (used as seed / regen). */
export function generateMasterDoc(): LlmsDoc {
  const namespaces = listNamespaces();
  const sections: LlmsSection[] = [];
  if (namespaces.length) {
    sections.push({
      name: 'Namespaces',
      links: namespaces.map((ns) => {
        const doc = readNamespaceLlms(ns);
        const summary = doc.summary?.split('\n')[0]?.trim();
        const note = doc.note?.split('\n')[0]?.trim();
        const description = [summary, note].filter(Boolean).join(' — ') || undefined;
        return {
          title: doc.title || ns,
          url: `/${ns}/llms.txt`,
          description,
        };
      }),
    });
  }
  return {
    title: 'My Library Index',
    summary: 'Personal libraries and APIs to guide agents. Each namespace below has its own llms.txt + docs.',
    sections,
  };
}

export function generateMasterRaw(): string {
  return serializeLlmsTxt(generateMasterDoc());
}

/* ---------- namespaces ---------- */

function validateNamespace(name: string): void {
  if (!NAMESPACE_RE.test(name)) throw new Error('invalid namespace name (use a-z, 0-9, _ , -)');
  if (RESERVED_NAMESPACES.has(name)) throw new Error(`'${name}' is reserved`);
}

export function namespaceDir(name: string): string {
  validateNamespace(name);
  return path.join(OWN_DIR, name);
}

function namespaceLlmsPath(name: string): string {
  return path.join(namespaceDir(name), 'llms.txt');
}

export function listNamespaces(): string[] {
  if (!fs.existsSync(OWN_DIR)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(OWN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!NAMESPACE_RE.test(entry.name) || RESERVED_NAMESPACES.has(entry.name)) continue;
    if (fs.existsSync(path.join(OWN_DIR, entry.name, 'llms.txt'))) out.push(entry.name);
  }
  return out.sort();
}

export function readNamespaceRaw(name: string): string {
  return fs.readFileSync(namespaceLlmsPath(name), 'utf8');
}

export function readNamespaceLlms(name: string): LlmsDoc {
  return parseLlmsTxt(readNamespaceRaw(name));
}

export function writeNamespaceRaw(name: string, text: string): void {
  const p = namespaceLlmsPath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

export function createNamespace(name: string, opts: { title?: string; summary?: string } = {}): void {
  const dir = namespaceDir(name);
  if (fs.existsSync(dir)) throw new Error('namespace already exists');
  fs.mkdirSync(dir, { recursive: true });
  const doc: LlmsDoc = {
    title: opts.title ?? name,
    summary: opts.summary ?? `Docs for ${name}.`,
    sections: [{ name: 'Docs', links: [] }],
  };
  writeNamespaceRaw(name, serializeLlmsTxt(doc));
}

export function deleteNamespace(name: string): void {
  const dir = namespaceDir(name);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- entries (flat, namespace-agnostic) ---------- */

export interface OwnEntry {
  name: string; // relative path from OWN_DIR, e.g. "demos/example.md"
  content: string;
}

const SAFE_NAME = /^[a-zA-Z0-9_\-./]+$/;

export function listOwnEntries(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel);
    }
  };
  if (fs.existsSync(OWN_DIR)) walk(OWN_DIR, '');
  return out.sort();
}

export function resolveOwnPath(name: string): string {
  if (!SAFE_NAME.test(name) || name.includes('..')) {
    throw new Error('invalid entry name');
  }
  return path.join(OWN_DIR, name);
}

export function readOwnEntry(name: string): string {
  return fs.readFileSync(resolveOwnPath(name), 'utf8');
}

export function writeOwnEntry(name: string, content: string): void {
  const p = resolveOwnPath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

export function deleteOwnEntry(name: string): void {
  fs.unlinkSync(resolveOwnPath(name));
}

/* ---------- merge ---------- */

export function mergeOwnWithSources(own: LlmsDoc, sourceDocs: { title: string; doc: LlmsDoc }[]): LlmsDoc {
  const merged: LlmsDoc = {
    title: own.title,
    summary: own.summary,
    note: own.note,
    intro: own.intro,
    sections: [...own.sections],
  };
  for (const s of sourceDocs) {
    const groupName = `From: ${s.title}`;
    const flat: LlmsSection = { name: groupName, links: [] };
    for (const sec of s.doc.sections) {
      for (const link of sec.links) {
        flat.links.push({
          title: sec.name ? `[${sec.name}] ${link.title}` : link.title,
          url: link.url,
          description: link.description,
        });
      }
    }
    if (flat.links.length) merged.sections.push(flat);
  }
  return merged;
}
