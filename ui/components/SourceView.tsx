import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { api, type Link, type Source } from '../api';

export function SourceView({
  id,
  onChanged,
  onDeleted,
}: {
  id: number;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [selected, setSelected] = useState<Link | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentErr, setContentErr] = useState<string | null>(null);

  const load = async () => {
    const r = await api.getSource(id);
    setSource(r.source);
    setLinks(r.links);
  };

  useEffect(() => {
    setSelected(null);
    setContent(null);
    load();
  }, [id]);

  useEffect(() => {
    if (!selected || !selected.cache_hash) { setContent(null); return; }
    setContentErr(null);
    api
      .linkContent(selected.id)
      .then(setContent)
      .catch((e) => setContentErr(String(e)));
  }, [selected]);

  if (!source) return <div className="meta">Loading…</div>;

  const refresh = async () => {
    await api.refreshSource(id);
    await load();
  };

  const setState = async (state: Source['state']) => {
    await api.patchSource(id, { state });
    await load();
    onChanged();
  };

  const del = async () => {
    const reason = prompt('Reason for removal (optional, kept in tombstone log):') ?? undefined;
    if (!confirm(`Remove ${source.title || source.url}?`)) return;
    await api.deleteSource(id, reason);
    onDeleted();
  };

  return (
    <div>
      <div className="toolbar">
        <h1>{source.title || source.url}</h1>
        <span className={`tag`}>{source.state}</span>
        {source.state !== 'active' && <button onClick={() => setState('active')}>Promote → active</button>}
        {source.state !== 'archived' && <button onClick={() => setState('archived')}>Archive</button>}
        {source.state === 'archived' && <button onClick={() => setState('trial')}>Restore → trial</button>}
        <button onClick={refresh}>Refresh now</button>
        <button className="danger" onClick={del}>Remove</button>
      </div>

      <div className="kv" style={{ marginBottom: 12 }}>
        <span className="k">URL</span>
        <span><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></span>
        <span className="k">Last fetched</span>
        <span>{source.last_fetched ? new Date(source.last_fetched).toLocaleString() : 'never'}</span>
        <span className="k">TTL (hours)</span>
        <span>
          <input
            type="number"
            defaultValue={source.ttl_hours ?? ''}
            placeholder="24 (default)"
            onBlur={async (e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              await api.patchSource(id, { ttl_hours: v as any });
              await load();
            }}
            style={{ width: 100 }}
          />
        </span>
        <span className="k">Tags</span>
        <span>
          <TagEditor
            tags={source.tags}
            onChange={async (tags) => {
              await api.patchSource(id, { tags } as any);
              await load();
              onChanged();
            }}
          />
        </span>
        <span className="k">Notes</span>
        <span>
          <textarea
            defaultValue={source.notes}
            placeholder="Why you added this, what to use it for…"
            onBlur={async (e) => {
              await api.patchSource(id, { notes: e.target.value } as any);
              await load();
            }}
            style={{ width: '100%', minHeight: 50 }}
          />
        </span>
        {source.last_error && (
          <>
            <span className="k">Last error</span>
            <span className="error">{source.last_error}</span>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, height: 'calc(100vh - 380px)' }}>
        <div style={{ overflowY: 'auto', border: '1px solid #1f2430', borderRadius: 6 }}>
          {links.length === 0 && <div className="meta" style={{ padding: 12 }}>No links yet — refresh the source.</div>}
          {groupLinks(links).map(([section, ll]) => (
            <div key={section}>
              <div style={{ padding: '6px 12px', background: '#1a1f29', fontSize: 11, textTransform: 'uppercase', color: '#7c8493', letterSpacing: 1 }}>
                {section || '(no section)'}
              </div>
              {ll.map((l) => (
                <div
                  key={l.id}
                  className="link-row"
                  style={{ background: selected?.id === l.id ? '#25304a' : undefined }}
                  onClick={() => setSelected(l)}
                >
                  <div className="t">{l.title || l.url}</div>
                  <div className="u">{l.url}</div>
                  {l.description && <div className="d">{l.description}</div>}
                  {l.last_error && <div className="error" style={{ fontSize: 11 }}>{l.last_error}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="preview" style={{ overflowY: 'auto' }}>
          {!selected && <div className="meta">Select a link to preview its normalized markdown.</div>}
          {selected && !selected.cache_hash && (
            <div>
              <div className="meta">Not cached yet.</div>
              <button onClick={async () => { await api.refreshLink(selected.id); await load(); }}>Fetch now</button>
            </div>
          )}
          {selected && contentErr && <div className="error">{contentErr}</div>}
          {selected && content && (
            <>
              <div className="meta" style={{ marginBottom: 8 }}>
                <a href={selected.url} target="_blank" rel="noreferrer">Open original</a>
                {' · '}
                <button style={{ padding: '2px 6px', fontSize: 11 }} onClick={async () => { await api.refreshLink(selected.id); await load(); const c = await api.linkContent(selected.id); setContent(c); }}>
                  Refresh
                </button>
              </div>
              <Markdown>{content}</Markdown>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function groupLinks(links: Link[]): [string, Link[]][] {
  const map = new Map<string, Link[]>();
  for (const l of links) {
    const k = l.section ?? '';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(l);
  }
  return [...map.entries()];
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState('');
  return (
    <div>
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}{' '}
          <a style={{ cursor: 'pointer', color: '#fca5a5' }} onClick={() => onChange(tags.filter((x) => x !== t))}>×</a>
        </span>
      ))}
      <input
        placeholder="add tag…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) {
            onChange([...new Set([...tags, input.trim()])]);
            setInput('');
          }
        }}
        style={{ width: 120 }}
      />
    </div>
  );
}
