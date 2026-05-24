import { db, type SourceRow, type LinkRow } from '../db.js';
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
      return { ok: true };
    }
    const err = (res as any)._err?.message ?? `HTTP ${(res as Response).status}`;
    db.prepare('UPDATE sources SET last_error = ? WHERE id = ?').run(err, sourceId);
    return { ok: false, error: err };
  }

  const r = res as Response;
  const text = await r.text();
  const doc = parseLlmsTxt(text);
  const etag = r.headers.get('etag');
  const lastModified = r.headers.get('last-modified');

  db.prepare(
    `UPDATE sources SET title = ?, summary = ?, etag = ?, last_modified = ?,
     last_fetched = ?, last_error = NULL WHERE id = ?`,
  ).run(doc.title || source.title, doc.summary ?? source.summary, etag, lastModified, now, sourceId);

  // Reconcile links — naive: clear + re-insert (cache_hash gets re-attached on link refresh).
  // Preserve cache_hash by url match.
  const existing = db.prepare('SELECT * FROM links WHERE source_id = ?').all(sourceId) as LinkRow[];
  const byUrl = new Map(existing.map((l) => [l.url, l]));

  const insertLink = db.prepare(
    `INSERT INTO links (source_id, section, title, url, description, cache_hash, content_type,
     etag, last_modified, last_fetched, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM links WHERE source_id = ?').run(sourceId);
    let pos = 0;
    for (const section of doc.sections) {
      for (const link of section.links) {
        const prev = byUrl.get(link.url);
        insertLink.run(
          sourceId,
          section.name,
          link.title,
          link.url,
          link.description ?? null,
          prev?.cache_hash ?? null,
          prev?.content_type ?? null,
          prev?.etag ?? null,
          prev?.last_modified ?? null,
          prev?.last_fetched ?? null,
          pos++,
        );
      }
    }
  });
  tx();

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
  const res = await fetchAndNormalize(link.url, {
    etag: link.etag,
    lastModified: link.last_modified,
  });
  const now = Date.now();
  if (res.notModified) {
    db.prepare('UPDATE links SET last_fetched = ?, last_error = NULL WHERE id = ?').run(now, linkId);
    return;
  }
  if (res.error) {
    db.prepare('UPDATE links SET last_error = ?, last_fetched = ? WHERE id = ?').run(res.error, now, linkId);
    return;
  }
  db.prepare(
    `UPDATE links SET cache_hash = ?, content_type = ?, etag = ?, last_modified = ?,
     last_fetched = ?, last_error = NULL WHERE id = ?`,
  ).run(res.hash ?? null, res.contentType, res.etag ?? null, res.lastModified ?? null, now, linkId);
}
