import { db, type SourceRow, type LinkRow, type SourceRefreshRow, type LinkRefreshRow } from '../db.js';
import { parseLlmsTxt, type LlmsDoc } from '../parser.js';
import { fetchAndNormalize } from './fetch.js';

export interface ProbeResult {
  ok: boolean;
  doc?: LlmsDoc;
  error?: string;
  raw?: string;
}

export async function probeSource(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'local-llmstxt-server/0.1 (+internal)',
        Accept: 'text/markdown, text/plain, */*',
      },
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const text = await res.text();
    const doc = parseLlmsTxt(text);
    if (!doc.title && doc.sections.length === 0) {
      return { ok: false, error: 'Not a valid llms.txt (no title or sections)', raw: text };
    }
    return { ok: true, doc, raw: text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function refreshSource(sourceId: number): Promise<{ ok: boolean; error?: string }> {
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined;
  if (!source) return { ok: false, error: 'source not found' };
  const startedAt = Date.now();
  const sourceRefreshId = createSourceRefreshEvent(sourceId, startedAt, source);
  const existingLinks = db.prepare('SELECT * FROM links WHERE source_id = ? ORDER BY position').all(sourceId) as LinkRow[];
  const existingByUrl = new Map(existingLinks.map((link) => [link.url, link]));

  const res = await fetch(source.url, {
    headers: {
      'User-Agent': 'local-llmstxt-server/0.1 (+internal)',
      Accept: 'text/markdown, text/plain, */*',
      ...(source.etag ? { 'If-None-Match': source.etag } : {}),
      ...(source.last_modified ? { 'If-Modified-Since': source.last_modified } : {}),
    },
    redirect: 'follow',
  }).catch((e) => ({ ok: false, status: 0, _err: e } as any));

  const now = Date.now();

  if ((res as any)._err || !(res as Response).ok) {
    if ((res as Response).status === 304) {
      db.prepare('UPDATE sources SET last_fetched = ?, last_error = NULL WHERE id = ?').run(now, sourceId);
      finishSourceRefreshEvent(sourceRefreshId, {
        status: 'not_modified',
        finished_at: now,
        http_status: 304,
        previous_title: source.title,
        previous_summary: source.summary,
        next_title: source.title,
        next_summary: source.summary,
        previous_link_count: existingLinks.length,
        next_link_count: existingLinks.length,
        added_link_count: 0,
        removed_link_count: 0,
        changed_link_count: 0,
      });
      return { ok: true };
    }
    const err = (res as any)._err?.message ?? `HTTP ${(res as Response).status}`;
    db.prepare('UPDATE sources SET last_error = ? WHERE id = ?').run(err, sourceId);
    finishSourceRefreshEvent(sourceRefreshId, {
      status: 'error',
      finished_at: now,
      http_status: (res as Response).status || 0,
      error: err,
      previous_title: source.title,
      previous_summary: source.summary,
      previous_link_count: existingLinks.length,
      next_link_count: existingLinks.length,
      added_link_count: 0,
      removed_link_count: 0,
      changed_link_count: 0,
    });
    return { ok: false, error: err };
  }

  const r = res as Response;
  const text = await r.text();
  const doc = parseLlmsTxt(text);
  const etag = r.headers.get('etag');
  const lastModified = r.headers.get('last-modified');
  const diff = diffManifest(existingLinks, doc);

  const updateLink = db.prepare(
    `UPDATE links SET section = ?, title = ?, url = ?, description = ?, position = ? WHERE id = ?`,
  );
  const insertLink = db.prepare(
    `INSERT INTO links (source_id, section, title, url, description, cache_hash, content_type,
     etag, last_modified, last_fetched, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE sources SET title = ?, summary = ?, etag = ?, last_modified = ?,
       last_fetched = ?, last_error = NULL WHERE id = ?`,
    ).run(doc.title || source.title, doc.summary ?? source.summary, etag, lastModified, now, sourceId);

    const keepUrls = new Set<string>();
    let pos = 0;
    for (const section of doc.sections) {
      for (const link of section.links) {
        const prev = existingByUrl.get(link.url);
        if (prev) {
          updateLink.run(section.name, link.title, link.url, link.description ?? null, pos++, prev.id);
        } else {
          insertLink.run(
            sourceId,
            section.name,
            link.title,
            link.url,
            link.description ?? null,
            null,
            null,
            null,
            null,
            null,
            pos++,
          );
        }
        keepUrls.add(link.url);
      }
    }
    for (const prev of existingLinks) {
      if (!keepUrls.has(prev.url)) {
        db.prepare('DELETE FROM links WHERE id = ?').run(prev.id);
      }
    }
  });
  tx();

  finishSourceRefreshEvent(sourceRefreshId, {
    status: 'ok',
    finished_at: now,
    http_status: r.status,
    previous_title: source.title,
    previous_summary: source.summary,
    next_title: doc.title || source.title,
    next_summary: doc.summary ?? source.summary,
    previous_link_count: diff.previousLinkCount,
    next_link_count: diff.nextLinkCount,
    added_link_count: diff.addedLinkCount,
    removed_link_count: diff.removedLinkCount,
    changed_link_count: diff.changedLinkCount,
  });

  // Fire-and-forget: refresh link contents (cap concurrency)
  refreshLinksForSource(sourceId).catch(() => {});
  return { ok: true };
}

export async function refreshLinksForSource(sourceId: number, concurrency = 4): Promise<void> {
  const links = db.prepare('SELECT * FROM links WHERE source_id = ?').all(sourceId) as LinkRow[];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, links.length) }, async () => {
    while (i < links.length) {
      const link = links[i++];
      await refreshLink(link.id);
    }
  });
  await Promise.all(workers);
}

export async function refreshLink(linkId: number): Promise<void> {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as LinkRow | undefined;
  if (!link) return;
  const startedAt = Date.now();
  const refreshId = createLinkRefreshEvent(link, startedAt);
  const res = await fetchAndNormalize(link.url, {
    etag: link.etag,
    lastModified: link.last_modified,
  });
  const now = Date.now();
  if (res.notModified) {
    db.prepare('UPDATE links SET last_fetched = ?, last_error = NULL WHERE id = ?').run(now, linkId);
    finishLinkRefreshEvent(refreshId, {
      status: 'not_modified',
      finished_at: now,
      http_status: 304,
      previous_cache_hash: link.cache_hash,
      cache_hash: link.cache_hash,
      content_type: link.content_type,
      etag: link.etag,
      last_modified: link.last_modified,
      bytes: null,
      changed: 0,
    });
    return;
  }
  if (res.error) {
    db.prepare('UPDATE links SET last_error = ?, last_fetched = ? WHERE id = ?').run(res.error, now, linkId);
    finishLinkRefreshEvent(refreshId, {
      status: 'error',
      finished_at: now,
      http_status: res.status || 0,
      error: res.error,
      previous_cache_hash: link.cache_hash,
      cache_hash: link.cache_hash,
      content_type: link.content_type,
      etag: link.etag,
      last_modified: link.last_modified,
      bytes: null,
      changed: 0,
    });
    return;
  }
  const changed = (link.cache_hash ?? null) !== (res.hash ?? null);
  const bytes = res.markdown ? Buffer.byteLength(res.markdown, 'utf8') : null;
  db.prepare(
    `UPDATE links SET cache_hash = ?, content_type = ?, etag = ?, last_modified = ?,
     last_fetched = ?, last_error = NULL WHERE id = ?`,
  ).run(res.hash ?? null, res.contentType, res.etag ?? null, res.lastModified ?? null, now, linkId);
  finishLinkRefreshEvent(refreshId, {
    status: 'ok',
    finished_at: now,
    http_status: res.status,
    previous_cache_hash: link.cache_hash,
    cache_hash: res.hash ?? link.cache_hash,
    content_type: res.contentType,
    etag: res.etag ?? null,
    last_modified: res.lastModified ?? null,
    bytes,
    changed: changed ? 1 : 0,
  });
}

function diffManifest(existingLinks: LinkRow[], doc: LlmsDoc): {
  previousLinkCount: number;
  nextLinkCount: number;
  addedLinkCount: number;
  removedLinkCount: number;
  changedLinkCount: number;
} {
  const nextLinks = doc.sections.flatMap((section) =>
    section.links.map((link) => ({
      section: section.name,
      title: link.title,
      url: link.url,
      description: link.description ?? null,
    })),
  );
  const existingByUrl = new Map(existingLinks.map((link) => [link.url, link]));
  const nextByUrl = new Map(nextLinks.map((link) => [link.url, link]));
  let changedLinkCount = 0;
  let addedLinkCount = 0;
  for (const next of nextLinks) {
    const prev = existingByUrl.get(next.url);
    if (!prev) {
      addedLinkCount++;
      continue;
    }
    if (
      prev.section !== next.section ||
      (prev.title ?? null) !== (next.title ?? null) ||
      (prev.description ?? null) !== next.description
    ) {
      changedLinkCount++;
    }
  }
  let removedLinkCount = 0;
  for (const prev of existingLinks) {
    if (!nextByUrl.has(prev.url)) removedLinkCount++;
  }
  return {
    previousLinkCount: existingLinks.length,
    nextLinkCount: nextLinks.length,
    addedLinkCount,
    removedLinkCount,
    changedLinkCount,
  };
}

function createSourceRefreshEvent(sourceId: number, startedAt: number, source: SourceRow): number {
  const result = db
    .prepare(
      `INSERT INTO source_refreshes (
        source_id, started_at, status, previous_title, previous_summary, previous_link_count
      ) VALUES (?, ?, 'pending', ?, ?, ?)`,
    )
    .run(sourceId, startedAt, source.title, source.summary, 0);
  return Number(result.lastInsertRowid);
}

function finishSourceRefreshEvent(
  id: number,
  patch: Partial<Omit<SourceRefreshRow, 'id' | 'source_id' | 'started_at'>>,
): void {
  const sets: string[] = [];
  const params: any[] = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE source_refreshes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function createLinkRefreshEvent(link: LinkRow, startedAt: number): number {
  const result = db
    .prepare(
      `INSERT INTO link_refreshes (
        link_id, source_id, url, started_at, status, previous_cache_hash, cache_hash,
        content_type, etag, last_modified, changed
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      link.id,
      link.source_id,
      link.url,
      startedAt,
      link.cache_hash,
      link.cache_hash,
      link.content_type,
      link.etag,
      link.last_modified,
      0,
    );
  return Number(result.lastInsertRowid);
}

function finishLinkRefreshEvent(
  id: number,
  patch: Partial<Omit<LinkRefreshRow, 'id' | 'link_id' | 'source_id' | 'url' | 'started_at'>>,
): void {
  const sets: string[] = [];
  const params: any[] = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE link_refreshes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}
