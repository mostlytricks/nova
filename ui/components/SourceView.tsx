import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Link, type LinkRefreshRecord, type Source, type SourceRefreshRecord } from '../api';
import type { Selection } from '../App';

export function SourceView({
  id,
  onSelect,
  onChanged,
  onDeleted,
}: {
  id: number;
  onSelect?: (selection: Selection) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [selected, setSelected] = useState<Link | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentErr, setContentErr] = useState<string | null>(null);
  const [sourceHistory, setSourceHistory] = useState<SourceRefreshRecord[]>([]);
  const [linkHistory, setLinkHistory] = useState<LinkRefreshRecord[]>([]);
  const [tab, setTab] = useState<'llms' | 'pages' | 'history'>('llms');
  const [sourceLlms, setSourceLlms] = useState<string | null>(null);
  const [sourceLlmsErr, setSourceLlmsErr] = useState<string | null>(null);

  const load = async () => {
    const [r, history] = await Promise.all([api.getSource(id), api.getSourceHistory(id)]);
    setSource(r.source);
    setLinks(r.links);
    setSourceHistory(history.refreshes);
  };

  useEffect(() => {
    setSelected(null);
    setContent(null);
    setSourceLlms(null);
    setSourceLlmsErr(null);
    load();
  }, [id]);

  useEffect(() => {
    if (tab !== 'llms') return;
    setSourceLlms(null);
    setSourceLlmsErr(null);
    api
      .getSourceLlms(id)
      .then(setSourceLlms)
      .catch((e) => setSourceLlmsErr(String(e)));
  }, [id, tab]);

  useEffect(() => {
    if (!selected || !selected.cache_hash) { setContent(null); return; }
    setContentErr(null);
    api
      .linkContent(selected.id)
      .then(setContent)
      .catch((e) => setContentErr(String(e)));
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setLinkHistory([]);
      return;
    }
    api.getLinkHistory(selected.id).then((r) => setLinkHistory(r.refreshes)).catch(() => setLinkHistory([]));
  }, [selected?.id]);

  if (!source) return <div className="meta">Loading…</div>;

  const sourceLlmsUrl = `/agent/sources/${source.id}/llms.txt`;

  const refresh = async () => {
    await api.refreshSource(id);
    await load();
  };

  const setState = async (state: Source['state']) => {
    if (state === 'active' && source.state !== 'active') {
      const promotion_reason = prompt('Promotion reason for trusting this imported doc set:');
      if (promotion_reason === null) return;
      await api.patchSource(id, {
        state,
        promotion_reason,
        last_reviewed_at: Date.now(),
      });
    } else {
      await api.patchSource(id, { state });
    }
    await load();
    onChanged();
  };

  const patchSource = async (body: Partial<Source>) => {
    await api.patchSource(id, body);
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
        {source.state === 'active' && source.slug && onSelect && (
          <button onClick={() => onSelect({ kind: 'reader', doc: source.slug! })}>Reader</button>
        )}
        <a href={sourceLlmsUrl} target="_blank" rel="noreferrer">
          <button disabled={source.state !== 'active'}>Raw</button>
        </a>
        {source.state !== 'active' && <button onClick={() => setState('active')}>Promote → active</button>}
        {source.state !== 'archived' && <button onClick={() => setState('archived')}>Archive</button>}
        {source.state === 'archived' && <button onClick={() => setState('trial')}>Restore → trial</button>}
        <button onClick={refresh}>Refresh now</button>
        <button className="danger" onClick={del}>Remove</button>
      </div>

      <div className="kv" style={{ marginBottom: 12 }}>
        <span className="k">URL</span>
        <span><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></span>
        <span className="k">Endpoint</span>
        <span>
          <span className="endpoint-row">
            <code>{sourceLlmsUrl}</code>
            <a href={sourceLlmsUrl} target="_blank" rel="noreferrer">
              <button disabled={source.state !== 'active'}>Open</button>
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(sourceLlmsUrl)}
            >
              Copy
            </button>
          </span>
          {source.state !== 'active' && (
            <span className="meta">Promote this imported doc set to active before agents can fetch this endpoint.</span>
          )}
        </span>
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
        <span className="k">Owner</span>
        <span>
          <input
            defaultValue={source.owner ?? ''}
            placeholder="Team or person responsible"
            onBlur={(e) => patchSource({ owner: e.target.value })}
            style={{ width: '100%' }}
          />
        </span>
        <span className="k">Intended use</span>
        <span>
          <textarea
            defaultValue={source.intended_use ?? ''}
            placeholder="When agents should use this imported doc set"
            onBlur={(e) => patchSource({ intended_use: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Trust note</span>
        <span>
          <textarea
            defaultValue={source.trust_note ?? ''}
            placeholder="Why this imported doc set is trusted"
            onBlur={(e) => patchSource({ trust_note: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Warning</span>
        <span>
          <textarea
            defaultValue={source.warning ?? ''}
            placeholder="Caveats agents should see before relying on it"
            onBlur={(e) => patchSource({ warning: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Last reviewed</span>
        <span>
          {source.last_reviewed_at ? new Date(source.last_reviewed_at).toLocaleString() : 'never'}
          {' '}
          <button
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => patchSource({ last_reviewed_at: Date.now() })}
          >
            Mark reviewed
          </button>
        </span>
        <span className="k">Promotion reason</span>
        <span>
          <textarea
            defaultValue={source.promotion_reason ?? ''}
            placeholder="Why this imported doc set was promoted to active"
            onBlur={(e) => patchSource({ promotion_reason: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        {source.last_error && (
          <>
            <span className="k">Last error</span>
            <span className="error">{source.last_error}</span>
          </>
        )}
      </div>

      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={tab === 'llms' ? 'active' : ''} onClick={() => setTab('llms')}>
          llms.txt
        </button>
        <button className={tab === 'pages' ? 'active' : ''} onClick={() => setTab('pages')}>
          Pages <span className="button-count">{links.length}</span>
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {tab === 'llms' && (
        <div className="editor source-llms-editor">
          <textarea value={sourceLlms ?? ''} readOnly spellCheck={false} placeholder="Loading imported llms.txt..." />
          <div className="preview">
            {sourceLlmsErr && (
              <div className="error">
                {sourceLlmsErr}
              </div>
            )}
            {!sourceLlms && !sourceLlmsErr && <div className="meta">Loading imported llms.txt...</div>}
            {sourceLlms && <Markdown remarkPlugins={[remarkGfm]}>{sourceLlms}</Markdown>}
          </div>
        </div>
      )}

      {tab === 'pages' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)', gap: 16, minHeight: 420 }}>
          <div style={{ overflowY: 'auto', border: '1px solid #1f2430', borderRadius: 6, maxHeight: '70vh' }}>
            {links.length === 0 && <div className="meta" style={{ padding: 12 }}>No links yet — refresh the imported doc set.</div>}
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
          <div className="preview" style={{ overflowY: 'auto', maxHeight: '70vh' }}>
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
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
      <div>
        <h2 className="section-title">Refresh history</h2>
        <div className="history-grid">
          <div className="history-panel">
            <div className="history-heading">Imported doc refreshes</div>
            {sourceHistory.length === 0 ? (
              <div className="meta" style={{ padding: '8px 0' }}>No imported doc refresh history yet.</div>
            ) : (
              sourceHistory.map((item) => (
                <HistoryRow
                  key={item.id}
                  status={item.status}
                  title={item.next_title || item.previous_title || source.title || source.url}
                  time={item.finished_at ?? item.started_at}
                  detail={sourceHistoryDetail(item)}
                  error={item.error}
                />
              ))
            )}
          </div>
          <div className="history-panel">
            <div className="history-heading">Selected link refreshes</div>
            {!selected && <div className="meta" style={{ padding: '8px 0' }}>Select a link to inspect its history.</div>}
            {selected && linkHistory.length === 0 && (
              <div className="meta" style={{ padding: '8px 0' }}>No link refresh history yet.</div>
            )}
            {selected && linkHistory.map((item) => (
              <HistoryRow
                key={item.id}
                status={item.status}
                title={selected.title || selected.url}
                time={item.finished_at ?? item.started_at}
                detail={linkHistoryDetail(item)}
                error={item.error}
              />
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function HistoryRow({
  status,
  title,
  time,
  detail,
  error,
}: {
  status: 'pending' | 'ok' | 'not_modified' | 'error';
  title: string;
  time: number;
  detail: string;
  error: string | null;
}) {
  return (
    <div className="history-row">
      <div className="history-row-top">
        <span className={`history-pill ${status}`}>{status}</span>
        <span className="history-row-title">{title}</span>
        <span className="history-row-time">{new Date(time).toLocaleString()}</span>
      </div>
      <div className="history-row-detail">{detail}</div>
      {error && <div className="error" style={{ fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function sourceHistoryDetail(item: SourceRefreshRecord): string {
  const parts = [
    item.http_status ? `HTTP ${item.http_status}` : 'HTTP -',
    item.previous_link_count !== null && item.next_link_count !== null
      ? `${item.previous_link_count} -> ${item.next_link_count} links`
      : '',
    item.added_link_count !== null ? `+${item.added_link_count}` : '',
    item.removed_link_count !== null ? `-${item.removed_link_count}` : '',
    item.changed_link_count !== null ? `~${item.changed_link_count}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function linkHistoryDetail(item: LinkRefreshRecord): string {
  const parts = [
    item.http_status ? `HTTP ${item.http_status}` : 'HTTP -',
    item.changed ? 'changed' : 'unchanged',
    item.content_type ? item.content_type : '',
    item.bytes !== null ? `${item.bytes} bytes` : '',
    item.previous_cache_hash && item.cache_hash ? `${item.previous_cache_hash.slice(0, 8)} → ${item.cache_hash.slice(0, 8)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
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
