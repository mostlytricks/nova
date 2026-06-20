import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { api, type ManagedDocState, type NamespaceHistoryEvent, type NamespaceMeta } from '../api';
import type { Selection } from '../App';

type Props =
  | { kind: 'own' }
  | {
      kind: 'namespace';
      namespace: string;
      entries: string[];
      onSelect: (selection: Selection) => void;
      onReload: () => void;
    };

export function LlmsTxtView(props: Props) {
  const [raw, setRaw] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'llms' | 'pages' | 'metadata' | 'history'>('llms');
  const [meta, setMeta] = useState<NamespaceMeta | null>(null);
  const [history, setHistory] = useState<NamespaceHistoryEvent[]>([]);

  const load = async () => {
    const r =
      props.kind === 'own'
        ? await api.getOwnLlms()
        : await api.getNamespaceLlms(props.namespace);
    setRaw(r.raw);
    setDirty(false);
    if (props.kind === 'namespace') {
      const [nextMeta, nextHistory] = await Promise.all([
        api.getNamespaceMeta(props.namespace),
        api.getNamespaceHistory(props.namespace),
      ]);
      setMeta(nextMeta);
      setHistory(nextHistory.events);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [props.kind, props.kind === 'namespace' ? props.namespace : '']);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      if (props.kind === 'own') await api.putOwnLlms(raw);
      else await api.putNamespaceLlms(props.namespace, raw);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    if (!confirm('Overwrite master llms.txt with auto-generated content from your local docs? Local edits will be lost.')) return;
    setRegenerating(true);
    try {
      await api.regenerateOwnLlms();
      await load();
    } finally {
      setRegenerating(false);
    }
  };

  const title =
    props.kind === 'own'
      ? 'Master llms.txt (origin)'
      : `${props.namespace}/llms.txt`;

  const rawUrl = props.kind === 'own' ? '/llms.txt' : `/${props.namespace}/llms.txt`;
  const namespaceEntries = props.kind === 'namespace' ? props.entries : [];

  const patchMeta = async (body: Partial<NamespaceMeta>) => {
    if (props.kind !== 'namespace') return;
    const next = await api.patchNamespaceMeta(props.namespace, body);
    setMeta(next);
    const nextHistory = await api.getNamespaceHistory(props.namespace);
    setHistory(nextHistory.events);
  };

  return (
    <div>
      <div className="toolbar">
        <h1>{title}</h1>
        <span className="meta">{dirty ? 'unsaved' : 'saved'}</span>
        <a href={rawUrl} target="_blank" rel="noreferrer">
          <button>Raw</button>
        </a>
        {props.kind === 'own' && (
          <>
            <a href="/llms.txt?merge=true" target="_blank" rel="noreferrer">
              <button>Merged</button>
            </a>
            <button onClick={regenerate} disabled={regenerating}>
              {regenerating ? 'Regenerating…' : 'Regenerate from Local Docs'}
            </button>
          </>
        )}
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {props.kind === 'namespace' && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button className={tab === 'llms' ? 'active' : ''} onClick={() => setTab('llms')}>
            llms.txt
          </button>
          <button className={tab === 'pages' ? 'active' : ''} onClick={() => setTab('pages')}>
            Pages <span className="button-count">{namespaceEntries.length}</span>
          </button>
          <button className={tab === 'metadata' ? 'active' : ''} onClick={() => setTab('metadata')}>
            Metadata
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History
          </button>
        </div>
      )}
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {(props.kind === 'own' || tab === 'llms') && (
        <div className="editor">
          <textarea
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setDirty(true); }}
            spellCheck={false}
          />
          <div className="preview">
            <Markdown components={props.kind === 'namespace' ? markdownLinkComponents(props.onSelect) : undefined}>
              {raw}
            </Markdown>
          </div>
        </div>
      )}
      {props.kind === 'namespace' && tab === 'pages' && (
        <NamespaceEntries
          namespace={props.namespace}
          entries={namespaceEntries}
          onSelect={props.onSelect}
          onReload={props.onReload}
        />
      )}
      {props.kind === 'namespace' && tab === 'metadata' && meta && (
        <NamespaceMetadata
          namespace={props.namespace}
          meta={meta}
          onPatch={patchMeta}
          endpoint={rawUrl}
          onDeleted={async () => {
            await api.deleteNamespace(props.namespace);
            await props.onReload();
            props.onSelect({ kind: 'own-llms' });
          }}
        />
      )}
      {props.kind === 'namespace' && tab === 'history' && (
        <NamespaceHistory events={history} />
      )}
    </div>
  );
}

function NamespaceMetadata({
  namespace,
  meta,
  endpoint,
  onPatch,
  onDeleted,
}: {
  namespace: string;
  meta: NamespaceMeta;
  endpoint: string;
  onPatch: (body: Partial<NamespaceMeta>) => void;
  onDeleted: () => void;
}) {
  const setState = async (state: ManagedDocState) => {
    if (state === 'active' && meta.state !== 'active') {
      const promotion_reason = prompt('Promotion reason for activating this local doc set:');
      if (promotion_reason === null) return;
      await onPatch({ state, promotion_reason, last_reviewed_at: Date.now() });
      return;
    }
    await onPatch({ state });
  };

  const remove = async () => {
    if (!confirm(`Remove local doc set "${namespace}" and all its files?`)) return;
    await onDeleted();
  };

  return (
    <div className="namespace-meta-panel">
      <div className="toolbar">
        <span className={`tag`}>{meta.state}</span>
        {meta.state !== 'active' && <button onClick={() => setState('active')}>Promote to active</button>}
        {meta.state !== 'archived' && <button onClick={() => setState('archived')}>Archive</button>}
        {meta.state === 'archived' && <button onClick={() => setState('draft')}>Restore to draft</button>}
        <button className="danger" onClick={remove}>Remove</button>
      </div>
      <div className="kv">
        <span className="k">Endpoint</span>
        <span>
          <span className="endpoint-row">
            <code>{endpoint}</code>
            <a href={endpoint} target="_blank" rel="noreferrer"><button>Open</button></a>
            <button onClick={() => navigator.clipboard.writeText(endpoint)}>Copy</button>
          </span>
        </span>
        <span className="k">Profile</span>
        <span>
          <select
            value={meta.doc_type}
            onChange={(e) => onPatch({ doc_type: e.target.value as NamespaceMeta['doc_type'] })}
          >
            <option value="api">API</option>
            <option value="website">Website</option>
            <option value="library">Library</option>
            <option value="notes">Notes</option>
          </select>
        </span>
        <span className="k">Origin URL</span>
        <span>
          <input
            defaultValue={meta.origin_url ?? ''}
            placeholder="Canonical website, API portal, OpenAPI URL, repo, or source page"
            onBlur={(e) => onPatch({ origin_url: e.target.value })}
            style={{ width: '100%' }}
          />
        </span>
        {(meta.doc_type === 'api' || meta.doc_type === 'website') && (
          <>
            <span className="k">{meta.doc_type === 'api' ? 'Base URL' : 'Site URL'}</span>
            <span>
              <input
                defaultValue={meta.base_url ?? ''}
                placeholder={meta.doc_type === 'api' ? 'https://api.example.com/v1' : 'https://app.example.com'}
                onBlur={(e) => onPatch({ base_url: e.target.value })}
                style={{ width: '100%' }}
              />
            </span>
          </>
        )}
        <span className="k">Version</span>
        <span>
          <input
            defaultValue={meta.version ?? ''}
            placeholder="API version, product release, package version, or environment"
            onBlur={(e) => onPatch({ version: e.target.value })}
            style={{ width: '100%' }}
          />
        </span>
        <span className="k">Auth summary</span>
        <span>
          <textarea
            defaultValue={meta.auth_summary ?? ''}
            placeholder="Bearer token, API key, SSO/session, mTLS, no auth, or unknown"
            onBlur={(e) => onPatch({ auth_summary: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Known gaps</span>
        <span>
          <textarea
            defaultValue={meta.known_gaps ?? ''}
            placeholder="Missing facts agents must not invent"
            onBlur={(e) => onPatch({ known_gaps: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Tags</span>
        <span>
          <TagEditor tags={meta.tags} onChange={(tags) => onPatch({ tags })} />
        </span>
        <span className="k">Notes</span>
        <span>
          <textarea
            defaultValue={meta.notes}
            placeholder="Why this local doc set exists, what agents should know..."
            onBlur={(e) => onPatch({ notes: e.target.value })}
            style={{ width: '100%', minHeight: 54 }}
          />
        </span>
        <span className="k">Owner</span>
        <span>
          <input
            defaultValue={meta.owner ?? ''}
            placeholder="Team or person responsible"
            onBlur={(e) => onPatch({ owner: e.target.value })}
            style={{ width: '100%' }}
          />
        </span>
        <span className="k">Intended use</span>
        <span>
          <textarea
            defaultValue={meta.intended_use ?? ''}
            placeholder="When agents should use this local doc set"
            onBlur={(e) => onPatch({ intended_use: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Trust note</span>
        <span>
          <textarea
            defaultValue={meta.trust_note ?? ''}
            placeholder="Why this local doc set is trusted"
            onBlur={(e) => onPatch({ trust_note: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Warning</span>
        <span>
          <textarea
            defaultValue={meta.warning ?? ''}
            placeholder="Caveats agents should see before relying on it"
            onBlur={(e) => onPatch({ warning: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
        <span className="k">Last reviewed</span>
        <span>
          {meta.last_reviewed_at ? new Date(meta.last_reviewed_at).toLocaleString() : 'never'}
          {' '}
          <button
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => onPatch({ last_reviewed_at: Date.now() })}
          >
            Mark reviewed
          </button>
        </span>
        <span className="k">Promotion reason</span>
        <span>
          <textarea
            defaultValue={meta.promotion_reason ?? ''}
            placeholder="Why this local doc set was promoted"
            onBlur={(e) => onPatch({ promotion_reason: e.target.value })}
            style={{ width: '100%', minHeight: 44 }}
          />
        </span>
      </div>
    </div>
  );
}

function NamespaceHistory({ events }: { events: NamespaceHistoryEvent[] }) {
  return (
    <div className="history-panel namespace-history-panel">
      <div className="history-heading">Local doc history</div>
      {events.length === 0 && <div className="meta" style={{ padding: '8px 0' }}>No local doc history yet.</div>}
      {events.map((event) => (
        <div className="history-row" key={event.id}>
          <div className="history-row-top">
            <span className="history-pill ok">{event.type}</span>
            <span className="history-row-title">{event.detail}</span>
            <span className="history-row-time">{new Date(event.at).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState('');
  return (
    <div>
      {tags.map((tag) => (
        <span key={tag} className="tag">
          {tag}{' '}
          <a style={{ cursor: 'pointer', color: '#fca5a5' }} onClick={() => onChange(tags.filter((x) => x !== tag))}>x</a>
        </span>
      ))}
      <input
        placeholder="add tag..."
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

function NamespaceEntries({
  namespace,
  entries,
  onSelect,
  onReload,
}: {
  namespace: string;
  entries: string[];
  onSelect: (selection: Selection) => void;
  onReload: () => void;
}) {
  const [newEntry, setNewEntry] = useState('');
  const [selected, setSelected] = useState<string | null>(entries[0] ?? null);
  const [content, setContent] = useState<string | null>(null);
  const [contentErr, setContentErr] = useState<string | null>(null);

  useEffect(() => {
    if (!entries.length) {
      setSelected(null);
      return;
    }
    if (!selected || !entries.includes(selected)) setSelected(entries[0]);
  }, [entries, selected]);

  useEffect(() => {
    if (!selected) {
      setContent(null);
      setContentErr(null);
      return;
    }
    setContent(null);
    setContentErr(null);
    api
      .getEntry(selected)
      .then((entry) => setContent(entry.content))
      .catch((e) => setContentErr(e instanceof Error ? e.message : String(e)));
  }, [selected]);

  const create = async () => {
    const value = newEntry.trim();
    if (!value) return;
    const fileName = value.endsWith('.md') ? value : `${value}.md`;
    const finalName = `${namespace}/${fileName}`;
    await api.putEntry(finalName, `# ${fileName.replace(/\.md$/, '')}\n\n`);
    setNewEntry('');
    await onReload();
    setSelected(finalName);
  };

  return (
    <div className="namespace-entry-panel">
      <div className="namespace-entry-toolbar">
        <input
          value={newEntry}
          placeholder="overview.md"
          onChange={(e) => setNewEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
            if (e.key === 'Escape') setNewEntry('');
          }}
        />
        <button onClick={create} disabled={!newEntry.trim()}>
          Add entry
        </button>
      </div>
      <div className="namespace-pages-grid">
        <div className="namespace-pages-list">
          {entries.length === 0 && <div className="meta" style={{ padding: 12 }}>No markdown pages in this local doc set.</div>}
          {entries.map((entry) => (
            <div
              key={entry}
              className="link-row"
              style={{ background: selected === entry ? '#25304a' : undefined }}
              onClick={() => setSelected(entry)}
            >
              <div className="t">{entry.slice(namespace.length + 1)}</div>
              <div className="u">{entry}</div>
            </div>
          ))}
        </div>
        <div className="preview namespace-page-preview">
          {!selected && <div className="meta">Select a page to preview its markdown.</div>}
          {selected && (
            <div className="meta" style={{ marginBottom: 8 }}>
              <code>{selected}</code>
              {' '}
              <button
                style={{ padding: '2px 6px', fontSize: 11 }}
                onClick={() => onSelect({ kind: 'own-entry', name: selected })}
              >
                Edit
              </button>
            </div>
          )}
          {contentErr && <div className="error">{contentErr}</div>}
          {selected && !content && !contentErr && <div className="meta">Loading page...</div>}
          {content && <Markdown components={markdownLinkComponents(onSelect)}>{content}</Markdown>}
        </div>
      </div>
    </div>
  );
}

function markdownLinkComponents(onSelect: (selection: Selection) => void) {
  return {
    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      const entryName = internalEntryName(href);
      if (!entryName) {
        return <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a>;
      }
      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onSelect({ kind: 'own-entry', name: entryName });
          }}
        >
          {children}
        </a>
      );
    },
  };
}

function internalEntryName(href?: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, window.location.origin);
    if (url.pathname !== '/api/entries/get') return null;
    const name = url.searchParams.get('name');
    return name || null;
  } catch {
    return null;
  }
}
