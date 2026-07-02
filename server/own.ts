import fs from 'node:fs';
import path from 'node:path';
import { OWN_DIR } from './config.js';
import { parseLlmsTxt, serializeLlmsTxt, type LlmsDoc, type LlmsSection } from './parser.js';
import type { NamespaceDocType } from './namespace-meta.js';

const OWN_LLMS = path.join(OWN_DIR, 'llms.txt');

import { RESERVED_DOC_NAMES } from './slug.js';

// Names reserved at the URL root — namespaces can't shadow these.
const RESERVED_NAMESPACES = RESERVED_DOC_NAMES;
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
      name: 'Local Docs',
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
    summary: 'Personal libraries and APIs to guide agents. Each Local Docs item below has its own llms.txt + docs.',
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

export function createNamespace(
  name: string,
  opts: { title?: string; summary?: string; doc_type?: NamespaceDocType } = {},
): void {
  const dir = namespaceDir(name);
  if (fs.existsSync(dir)) throw new Error('namespace already exists');
  fs.mkdirSync(dir, { recursive: true });
  const scaffold = namespaceScaffold(name, opts);
  for (const [file, content] of Object.entries(scaffold.entries)) {
    fs.writeFileSync(path.join(dir, file), content, 'utf8');
  }
  const doc = scaffold.doc;
  writeNamespaceRaw(name, serializeLlmsTxt(doc));
}

export function deleteNamespace(name: string): void {
  const dir = namespaceDir(name);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

interface NamespaceScaffold {
  doc: LlmsDoc;
  entries: Record<string, string>;
}

function namespaceScaffold(
  name: string,
  opts: { title?: string; summary?: string; doc_type?: NamespaceDocType },
): NamespaceScaffold {
  const title = opts.title?.trim() || titleFromSlug(name);
  const docType = opts.doc_type ?? 'notes';
  if (docType === 'api') return apiScaffold(name, title, opts.summary);
  if (docType === 'website') return websiteScaffold(name, title, opts.summary);
  if (docType === 'library') return libraryScaffold(name, title, opts.summary);
  return notesScaffold(name, title, opts.summary);
}

function apiScaffold(name: string, title: string, summary?: string): NamespaceScaffold {
  return {
    doc: {
      title,
      summary: summary || `${title} API docs for agents. Fill in source provenance, base URL, auth, resources, errors, and examples from real source material.`,
      note: 'Draft scaffold. Replace placeholders with sourced facts before promotion.',
      sections: [
        {
          name: 'Start Here',
          links: [
            link(name, 'overview.md', 'Overview', 'API scope, version, base URL, resource model, and usage guidance'),
            link(name, 'auth.md', 'Authentication', 'Auth scheme, token placement, scopes, lifetime, and safe handling rules'),
          ],
        },
        {
          name: 'Reference',
          links: [
            link(name, 'resources.md', 'Resources and endpoints', 'Resource groups, endpoint shapes, parameters, requests, and responses'),
            link(name, 'errors.md', 'Errors and limits', 'Error shape, HTTP status codes, idempotency, rate limits, and retry behavior'),
          ],
        },
      ],
    },
    entries: {
      'overview.md': `# Overview

${title} is an API Local Docs scaffold. Replace this paragraph with the sourced purpose of the API, who uses it, and what agents can safely do with it.

## API identity

| Field | Value |
|---|---|
| Product/API name | ${title} |
| Version | TODO: confirm version |
| Base URL | TODO: confirm server URL |
| Audience | TODO: confirm intended users or agents |
| Auth home | auth.md |
| Source | TODO: name source page, OpenAPI file, deck, or operator note |

## Resource model

Describe the primary resources and relationships. For example, explain whether orders belong to customers, deployments belong to projects, or jobs belong to runs. Keep this factual and sourced.

## Agent usage guidance

Tell agents which entries to fetch for common tasks. Do not ask agents to read every page by default. Call out known gaps and uncertain source material here until metadata is complete.
`,
      'auth.md': `# Authentication

Document authentication exactly once in this file. Do not repeat auth details on every endpoint page.

## Scheme

TODO: confirm whether this API uses bearer tokens, API keys, OAuth, mTLS, cookies, or another scheme.

## Credential placement

~~~http
Authorization: Bearer <access_token>
~~~

Replace this example if the source uses a different header, query parameter, cookie, or client certificate. Never invent credentials.

## Scopes and lifetime

| Scope or permission | Allows |
|---|---|
| TODO | TODO |

Record token lifetime, refresh behavior, and environment requirements when the source provides them. If missing, ask the operator.
`,
      'resources.md': `# Resources and endpoints

Group endpoints by meaningful resource or tag. Do not create one tiny file per endpoint unless each endpoint is large enough to stand alone.

## Resource: TODO

Describe the resource, identifiers, lifecycle, and relationship to other resources.

## \`GET /todo\` List TODO resources

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| TODO | query | string | no | Replace with sourced parameters |

### Responses

| Status | Meaning |
|---|---|
| 200 | Replace with sourced response behavior |

## \`POST /todo\` Create TODO resource

Add request body and response examples only when the source material provides real examples.
`,
      'errors.md': `# Errors and limits

Document common failure modes and retry behavior for ${title}.

## Error shape

~~~json
{
  "error": {
    "code": "TODO",
    "message": "TODO"
  }
}
~~~

Replace this with the real error shape from source material. If the source does not define one, say that explicitly.

## HTTP status codes

| Status | Meaning | Typical fix |
|---|---|---|
| 400 | Validation failed | Check required fields and enum values |
| 401 | Authentication failed | Check credential presence and expiry |
| 403 | Authorization failed | Check scopes or permissions |
| 404 | Resource not found | Check identifiers and environment |
| 429 | Rate limit exceeded | Back off according to source guidance |

## Idempotency and retries

Record whether create/update endpoints support idempotency keys. Do not recommend retries for non-idempotent operations unless the source says they are safe.
`,
    },
  };
}

function websiteScaffold(name: string, title: string, summary?: string): NamespaceScaffold {
  return {
    doc: {
      title,
      summary: summary || `${title} website or product docs for agents. Fill in source provenance, routes, workflows, concepts, and caveats from real source material.`,
      note: 'Draft scaffold. Replace placeholders with sourced facts before promotion.',
      sections: [
        {
          name: 'Start Here',
          links: [
            link(name, 'overview.md', 'Overview', 'Site purpose, audience, provenance, environments, and domain model'),
            link(name, 'navigation.md', 'Navigation', 'Important routes, pages, entry points, and where tasks happen'),
          ],
        },
        {
          name: 'Workflows',
          links: [
            link(name, 'workflows.md', 'Workflows', 'Common task flows in the order agents or users perform them'),
            link(name, 'concepts.md', 'Concepts', 'Domain objects, vocabulary, states, and relationships'),
            link(name, 'caveats.md', 'Caveats', 'Login, session, permissions, environment assumptions, and known gaps'),
          ],
        },
      ],
    },
    entries: {
      'overview.md': `# Overview

${title} is a website/product Local Docs scaffold. Replace this with the sourced purpose of the site, who uses it, and what agents can safely do with it.

## Identity

| Field | Value |
|---|---|
| Product/site name | ${title} |
| Origin URL | TODO: confirm canonical URL |
| Environment | TODO: production, staging, internal, or local |
| Audience | TODO: confirm intended users or agents |
| Source | TODO: name website, docs page, screenshots, deck, or operator note |

## Domain model

List the main domain objects and how they relate. For example: projects contain deployments, users belong to organizations, or orders belong to customers.

## Agent usage guidance

Tell agents where to start for common tasks and what not to assume. Keep unknowns visible until the operator confirms them.
`,
      'navigation.md': `# Navigation

Document important routes and pages for ${title}. This should help an agent decide where a workflow happens before fetching workflow details.

| Area | Route or page | Purpose | Notes |
|---|---|---|---|
| TODO | TODO | TODO | TODO |

## Entry points

Describe login, landing pages, dashboards, deep links, or environment-specific URLs. Include route parameters only when the source material defines them.

## Page relationships

Explain how users move between the important pages. Avoid visual-only descriptions unless they are needed for browser automation.
`,
      'workflows.md': `# Workflows

Document common workflows in task order. Each workflow should be specific enough for an agent to implement, test, or operate against the site.

## Workflow: TODO

### Goal

Describe the user goal and when this workflow applies.

### Steps

1. TODO: first sourced step.
2. TODO: next sourced step.
3. TODO: final sourced step.

### Expected result

Describe the visible result, persisted state, or API-side effect.

### Failure cases

List permission, validation, session, or environment failures that the source material names.
`,
      'concepts.md': `# Concepts

Define the domain vocabulary for ${title}. This page should prevent agents from confusing similar objects or states.

| Concept | Meaning | Related concepts |
|---|---|---|
| TODO | TODO | TODO |

## States

Document lifecycle states, status badges, or workflow phases. Include transitions only when the source material provides them.
`,
      'caveats.md': `# Caveats

Record constraints that agents should know before relying on ${title}.

## Login and session

TODO: document whether login is required, how sessions expire, and whether human-in-the-loop authentication is needed.

## Permissions

TODO: document roles, scopes, tenant boundaries, or admin requirements.

## Known gaps

List missing source details that need operator confirmation. Do not hide uncertainty in polished prose.
`,
    },
  };
}

function libraryScaffold(name: string, title: string, summary?: string): NamespaceScaffold {
  return {
    doc: {
      title,
      summary: summary || `${title} library docs for agents. Fill in installation, core concepts, usage patterns, and caveats from real source material.`,
      note: 'Draft scaffold. Replace placeholders with sourced facts before promotion.',
      sections: [{
        name: 'Reference',
        links: [
          link(name, 'overview.md', 'Overview', 'Library purpose, version, installation, and when agents should use it'),
          link(name, 'usage.md', 'Usage', 'Core APIs, common patterns, examples, and caveats'),
        ],
      }],
    },
    entries: {
      'overview.md': `# Overview

${title} is a library Local Docs scaffold. Replace this with sourced purpose, supported versions, installation requirements, and runtime assumptions.

## Identity

| Field | Value |
|---|---|
| Library name | ${title} |
| Version | TODO: confirm version |
| Package | TODO: confirm package name |
| Source | TODO: name docs, repository, package page, or operator note |

## When to use

Describe the tasks this library supports and any cases where agents should prefer another tool.
`,
      'usage.md': `# Usage

Document the core APIs and common patterns for ${title}.

## Setup

Add installation and initialization only when sourced.

## Common pattern: TODO

Describe one practical pattern with source-backed code examples. Use language hints on code blocks.

## Caveats

Record version differences, breaking changes, environment assumptions, and known gaps.
`,
    },
  };
}

function notesScaffold(name: string, title: string, summary?: string): NamespaceScaffold {
  return {
    doc: {
      title,
      summary: summary || `${title} notes for agents. Replace this scaffold with sourced local documentation.`,
      note: 'Draft scaffold. Replace placeholders with sourced facts before promotion.',
      sections: [{
        name: 'Docs',
        links: [
          link(name, 'overview.md', 'Overview', 'Purpose, provenance, intended use, and known gaps'),
        ],
      }],
    },
    entries: {
      'overview.md': `# Overview

${title} is a Local Docs notes scaffold. Replace this with sourced content and operator-confirmed metadata.

## Provenance

Record where this material came from, when it was imported or composed, who owns it, and what agents should use it for.

## Content

Add the actual notes here, then split into focused pages when this grows beyond one concept.

## Known gaps

List any missing facts that need operator confirmation.
`,
    },
  };
}

function link(namespace: string, file: string, title: string, description: string) {
  return {
    title,
    url: `/api/entries/get?name=${namespace}/${file}`,
    description,
  };
}

function titleFromSlug(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
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
