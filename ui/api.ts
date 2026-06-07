export interface Source {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
  state: 'trial' | 'active' | 'archived';
  ttl_hours: number | null;
  tags: string[];
  notes: string;
  owner: string | null;
  trust_note: string | null;
  intended_use: string | null;
  warning: string | null;
  last_reviewed_at: number | null;
  promotion_reason: string | null;
  last_fetched: number | null;
  last_accessed: number | null;
  last_error: string | null;
  created_at: number;
  linkCount?: number;
}

export interface Link {
  id: number;
  source_id: number;
  section: string | null;
  title: string | null;
  url: string;
  description: string | null;
  cache_hash: string | null;
  content_type: string | null;
  last_fetched: number | null;
  last_error: string | null;
  position: number;
}

export interface SourceRefreshRecord {
  id: number;
  source_id: number;
  started_at: number;
  finished_at: number | null;
  status: 'pending' | 'ok' | 'not_modified' | 'error';
  http_status: number | null;
  error: string | null;
  previous_title: string | null;
  previous_summary: string | null;
  next_title: string | null;
  next_summary: string | null;
  previous_link_count: number | null;
  next_link_count: number | null;
  added_link_count: number | null;
  removed_link_count: number | null;
  changed_link_count: number | null;
}

export interface LinkRefreshRecord {
  id: number;
  link_id: number | null;
  source_id: number;
  url: string;
  started_at: number;
  finished_at: number | null;
  status: 'pending' | 'ok' | 'not_modified' | 'error';
  http_status: number | null;
  error: string | null;
  previous_cache_hash: string | null;
  cache_hash: string | null;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  bytes: number | null;
  changed: number;
}

export interface NamespaceHealthIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

export interface NamespaceHealthReport {
  namespace: string;
  status: 'healthy' | 'warn' | 'error';
  errors: NamespaceHealthIssue[];
  warnings: NamespaceHealthIssue[];
  stats: {
    sections: number;
    links: number;
    entries: number;
    externalLinks: number;
    orphans: number;
    bytes: number;
    tinyEntries: number;
    oversizedEntries: number;
    duplicateUrls: number;
  };
  recommendation: {
    strategy: 'sections' | 'path';
    reason: string;
    command: string;
  } | null;
}

export interface AgentIndexLink {
  label: string;
  url: string;
  absoluteUrl: string;
}

export interface AgentNamespaceLink extends AgentIndexLink {
  name: string;
  title: string;
  summary: string | null;
  health: NamespaceHealthReport['status'];
  links: number;
  isSplit: boolean;
  isSplitIndex: boolean;
  sourceNamespace: string | null;
}

export interface AgentIndex {
  generatedAt: number;
  master: AgentIndexLink;
  mergedExternal: AgentIndexLink & { activeSourceCount: number };
  startHere: AgentNamespaceLink | null;
  namespaces: AgentNamespaceLink[];
  splitIndexes: AgentNamespaceLink[];
  activeSources: {
    id: number;
    title: string;
    url: string;
    owner: string | null;
    trustNote: string | null;
    intendedUse: string | null;
    warning: string | null;
    lastReviewedAt: number | null;
    promotionReason: string | null;
    lastFetched: number | null;
    lastError: string | null;
  }[];
  snippets: {
    title: string;
    text: string;
  }[];
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listSources: () => json<Source[]>('/api/sources'),
  getSource: (id: number) => json<{ source: Source; links: Link[] }>(`/api/sources/${id}`),
  getSourceHistory: (id: number) =>
    json<{ source: Source; refreshes: SourceRefreshRecord[] }>(`/api/sources/${encodeURIComponent(id)}/history`),
  probe: (url: string) =>
    json<{ ok: boolean; doc: any; raw: string; error?: string }>('/api/sources/probe', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  addSource: (body: { url: string; tags?: string[]; notes?: string; ttl_hours?: number }) =>
    json<Source>('/api/sources', { method: 'POST', body: JSON.stringify(body) }),
  patchSource: (id: number, body: Partial<Source>) =>
    json<Source>(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSource: (id: number, reason?: string) =>
    json<{ ok: true }>(`/api/sources/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }),
  refreshSource: (id: number) =>
    json<{ ok: true }>(`/api/sources/${id}/refresh`, { method: 'POST' }),
  refreshLink: (id: number) =>
    json<{ ok: true }>(`/api/links/${id}/refresh`, { method: 'POST' }),
  linkContent: (id: number) =>
    fetch(`/api/links/${id}/content`).then((r) => (r.ok ? r.text() : Promise.reject(r.statusText))),
  getLinkHistory: (id: number) =>
    json<{ link: Link; refreshes: LinkRefreshRecord[] }>(`/api/links/${encodeURIComponent(id)}/history`),
  listEntries: () => json<{ entries: string[] }>('/api/entries'),
  getEntry: (name: string) =>
    json<{ name: string; content: string }>(`/api/entries/get?name=${encodeURIComponent(name)}`),
  putEntry: (name: string, content: string) =>
    json<{ ok: true }>('/api/entries', {
      method: 'PUT',
      body: JSON.stringify({ name, content }),
    }),
  deleteEntry: (name: string) =>
    json<{ ok: true }>(`/api/entries?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getOwnLlms: () => json<{ raw: string; parsed: any; exists: boolean }>('/api/llms/own'),
  putOwnLlms: (raw: string) =>
    json<{ ok: true }>('/api/llms/own', { method: 'PUT', body: JSON.stringify({ raw }) }),
  regenerateOwnLlms: () => json<{ raw: string }>('/api/llms/own/regenerate', { method: 'POST' }),

  listNamespaces: () =>
    json<{
      namespaces: {
        name: string;
        title: string;
        summary: string | null;
        note?: string | null;
        entryCount?: number;
      }[];
    }>('/api/namespaces'),
  listNamespaceHealth: () =>
    json<{ generatedAt: number; namespaces: NamespaceHealthReport[] }>('/api/health/namespaces'),
  getNamespaceHealth: (name: string) =>
    json<NamespaceHealthReport>(`/api/health/namespaces/${encodeURIComponent(name)}`),
  getAgentIndex: () => json<AgentIndex>('/api/agent/index'),
  putNamespaceNote: (name: string, note: string) =>
    json<{ ok: true; note: string | null }>(
      `/api/namespaces/${encodeURIComponent(name)}/note`,
      { method: 'PUT', body: JSON.stringify({ note }) },
    ),
  getStats: () =>
    json<{
      namespaces: { count: number; items: { name: string; title: string; linkCount: number }[] };
      ownEntries: { count: number };
      sources: { trial: number; active: number; archived: number; total: number };
      links: { total: number; cached: number };
      errors: number;
      oldestFetch: number | null;
      generatedAt: number;
    }>('/api/stats'),
  createNamespace: (body: { name: string; title?: string; summary?: string }) =>
    json<{ ok: true; name: string }>('/api/namespaces', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteNamespace: (name: string) =>
    json<{ ok: true }>(`/api/namespaces/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getNamespaceLlms: (name: string) =>
    json<{ raw: string; parsed: any }>(`/api/namespaces/${encodeURIComponent(name)}/llms`),
  putNamespaceLlms: (name: string, raw: string) =>
    json<{ ok: true }>(`/api/namespaces/${encodeURIComponent(name)}/llms`, {
      method: 'PUT',
      body: JSON.stringify({ raw }),
    }),
};
