import React, { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';

interface ReaderLink {
  title: string;
  url: string;
  description?: string;
}
interface ReaderSection {
  name: string;
  links: ReaderLink[];
}
interface ReaderManifest {
  title: string;
  summary: string | null;
  sections: ReaderSection[];
}

/**
 * Read-only doc-site view over one /docs/<doc>/ prefix (local namespace or
 * mirrored source): manifest as a table of contents on the left, the rendered
 * entry on the right, prev/next across the doc set's internal pages.
 */
export function ReaderView({
  doc,
  onBack,
}: {
  doc: string;
  onBack: () => void;
}) {
  const [manifest, setManifest] = useState<ReaderManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const pages = useMemo(
    () => (manifest ? manifest.sections.flatMap((s) => s.links).filter((l) => isInternal(l.url)) : []),
    [manifest],
  );
  const pageIndex = pages.findIndex((p) => p.url === pageUrl);

  useEffect(() => {
    setManifest(null);
    setPageUrl(null);
    setErr(null);
    api
      .docsText(`/docs/${doc}/llms.txt`)
      .then((raw) => {
        const parsed = parseManifest(raw);
        setManifest(parsed);
        const first = parsed.sections.flatMap((s) => s.links).find((l) => isInternal(l.url));
        if (first) setPageUrl(first.url);
      })
      .catch((e) => setErr(String(e)));
  }, [doc]);

  useEffect(() => {
    if (!pageUrl) {
      setContent('');
      return;
    }
    setLoading(true);
    api
      .docsText(pageUrl)
      .then(setContent)
      .catch((e) => setContent(`**Failed to load this page.**\n\n\`${e}\``))
      .finally(() => setLoading(false));
  }, [pageUrl]);

  const openInternal = (href?: string): boolean => {
    const target = resolveInternal(doc, href);
    if (!target) return false;
    setPageUrl(target);
    return true;
  };

  return (
    <div>
      <div className="toolbar">
        <h1>{manifest?.title ?? doc}</h1>
        <span className="meta">reader · /docs/{doc}/</span>
        <a href={`/docs/${doc}/llms.txt`} target="_blank" rel="noreferrer">
          <button>Raw</button>
        </a>
        <button onClick={onBack}>Back</button>
      </div>
      {manifest?.summary && (
        <div className="meta" style={{ marginBottom: 12 }}>{manifest.summary}</div>
      )}
      {err && <div className="error">{err}</div>}
      {manifest && (
        <div className="reader">
          <nav className="reader-toc">
            {manifest.sections.map((section) => (
              <div key={section.name}>
                <div className="reader-toc-section">{section.name}</div>
                {section.links.map((link) =>
                  isInternal(link.url) ? (
                    <div
                      key={link.url}
                      className={`item ${link.url === pageUrl ? 'active' : ''}`}
                      onClick={() => setPageUrl(link.url)}
                      title={link.description}
                    >
                      {link.title}
                    </div>
                  ) : (
                    <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="item reader-external" title={link.description}>
                      {link.title} ↗
                    </a>
                  ),
                )}
              </div>
            ))}
          </nav>
          <div className="preview reader-page">
            {loading && <div className="meta">Loading…</div>}
            {!loading && !pageUrl && <div className="meta">This doc set has no locally served pages — all manifest links are external.</div>}
            {!loading && content && (
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents(openInternal)}>{content}</Markdown>
            )}
            {pageIndex !== -1 && pages.length > 1 && (
              <div className="reader-pagenav">
                <button disabled={pageIndex <= 0} onClick={() => setPageUrl(pages[pageIndex - 1].url)}>
                  ← {pageIndex > 0 ? pages[pageIndex - 1].title : ''}
                </button>
                <span className="meta">{pageIndex + 1} / {pages.length}</span>
                <button
                  disabled={pageIndex >= pages.length - 1}
                  onClick={() => setPageUrl(pages[pageIndex + 1].url)}
                >
                  {pageIndex < pages.length - 1 ? pages[pageIndex + 1].title : ''} →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isInternal(url: string): boolean {
  return url.startsWith('/docs/');
}

/** Map any in-content link back into this reader when it points at served docs. */
function resolveInternal(doc: string, href?: string): string | null {
  if (!href) return null;
  const clean = href.split('#')[0];
  if (clean.startsWith('/docs/')) return clean;
  const entry = clean.match(/^\/api\/entries\/get\?name=([a-zA-Z0-9_\-./]+)$/);
  if (entry) return `/docs/${entry[1]}`;
  if (/^[a-zA-Z0-9_-][a-zA-Z0-9_\-./]*\.md$/.test(clean) && !clean.includes('..')) {
    return `/docs/${doc}/${clean}`;
  }
  return null;
}

function markdownComponents(openInternal: (href?: string) => boolean) {
  return {
    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      return (
        <a
          href={href}
          target={href?.startsWith('http') ? '_blank' : undefined}
          rel="noreferrer"
          onClick={(event) => {
            if (openInternal(href)) event.preventDefault();
          }}
        >
          {children}
        </a>
      );
    },
  };
}

/** Minimal llms.txt parser — mirrors the shape server/parser.ts produces. */
function parseManifest(raw: string): ReaderManifest {
  let title = '';
  let summary: string | null = null;
  const sections: ReaderSection[] = [];
  let current: ReaderSection | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!title && line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }
    if (summary === null && sections.length === 0 && line.startsWith('> ')) {
      summary = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('## ')) {
      current = { name: line.slice(3).trim(), links: [] };
      sections.push(current);
      continue;
    }
    const link = line.match(/^-\s+\[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?$/);
    if (link) {
      if (!current) {
        current = { name: 'Docs', links: [] };
        sections.push(current);
      }
      current.links.push({ title: link[1], url: link[2], description: link[3] || undefined });
    }
  }
  return { title, summary, sections };
}
