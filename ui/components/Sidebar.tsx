import React, { useState } from 'react';
import { api, type LocalDocType, type Source } from '../api';
import type { Namespace, Selection } from '../App';

interface Props {
  sources: Source[];
  namespaces: Namespace[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onAddSource: () => void;
  onReload: () => void;
}

export function Sidebar({
  sources,
  namespaces,
  selection,
  onSelect,
  onAddSource,
  onReload,
}: Props) {
  const [filter, setFilter] = useState<'all' | 'trial' | 'active' | 'archived'>('all');
  const filtered = sources.filter((s) => filter === 'all' || s.state === filter);

  return (
    <div className="sidebar">
      <h2>Overview</h2>
      <div
        className={`item ${selection.kind === 'dashboard' ? 'active' : ''}`}
        onClick={() => onSelect({ kind: 'dashboard' })}
      >
        Dashboard
      </div>
      <div
        className={`item ${selection.kind === 'agent' ? 'active' : ''}`}
        onClick={() => onSelect({ kind: 'agent' })}
      >
        Agent view
      </div>

      <h2>Master</h2>
      <div
        className={`item ${selection.kind === 'own-llms' ? 'active' : ''}`}
        onClick={() => onSelect({ kind: 'own-llms' })}
      >
        llms.txt <span className="badge">origin</span>
      </div>

      <h2 style={{ display: 'flex', alignItems: 'center' }}>
        <span>Local Docs</span>
        <NewNamespaceButton onCreated={async (name) => { await onReload(); onSelect({ kind: 'namespace-llms', namespace: name }); }} />
      </h2>
      {namespaces.length === 0 && (
        <div className="meta" style={{ padding: '4px 8px' }}>No local docs yet</div>
      )}
      {namespaces.map((ns) => (
        <NamespaceRow
          key={ns.name}
          ns={ns}
          selection={selection}
          onSelect={onSelect}
        />
      ))}

      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Imported Docs</span>
        <button style={{ padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }} onClick={onAddSource}>+ Add</button>
      </h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['all', 'trial', 'active', 'archived'] as const).map((f) => (
          <button
            key={f}
            style={{ padding: '2px 6px', fontSize: 10, background: filter === f ? '#3b82f6' : undefined }}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {filtered.length === 0 && <div className="meta" style={{ padding: '4px 8px' }}>No imported docs</div>}
      {filtered.map((s) => (
        <SourceRow
          key={s.id}
          source={s}
          selection={selection}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SourceRow({
  source,
  selection,
  onSelect,
}: {
  source: Source;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const endpoint = `/agent/sources/${source.id}/llms.txt`;

  return (
    <div
      className={`item source-nav-row ${selection.kind === 'source' && selection.id === source.id ? 'active' : ''}`}
      onClick={() => onSelect({ kind: 'source', id: source.id })}
      title={`${source.url}\n${endpoint}`}
    >
      <span className="source-nav-title">
        {source.title || source.url}
        <span className="source-nav-endpoint">{endpoint}</span>
      </span>
      {typeof source.linkCount === 'number' && (
        <span className="badge" title="links">
          {source.linkCount}
        </span>
      )}
      <span className={`badge ${source.state}`}>{source.state}</span>
    </div>
  );
}

function NamespaceRow({
  ns,
  selection,
  onSelect,
}: {
  ns: Namespace;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  return (
    <div
      className={`item namespace-nav-row ${selection.kind === 'namespace-llms' && selection.namespace === ns.name ? 'active' : ''}`}
      onClick={() => onSelect({ kind: 'namespace-llms', namespace: ns.name })}
      title={ns.summary ?? ns.title}
    >
        <span className="namespace-nav-title">
          {ns.title || ns.name}
          <span className="namespace-nav-name">{ns.name}/</span>
        </span>
        {typeof ns.entryCount === 'number' && (
          <span className="badge" title="links in llms.txt">
            {ns.entryCount}
          </span>
        )}
        <span className="badge" title="Local Docs profile">
          {ns.doc_type}
        </span>
        {ns.health && ns.health.status !== 'healthy' && (
          <span
            className={`badge health-dot ${ns.health.status}`}
            title={`${ns.health.status}: ${ns.health.errors.length} errors, ${ns.health.warnings.length} warnings`}
          >
            {ns.health.status === 'error' ? '!' : '?'}
          </span>
        )}
    </div>
  );
}

function NewNamespaceButton({ onCreated }: { onCreated: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [docType, setDocType] = useState<LocalDocType>('api');
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await api.createNamespace({ name: trimmed, doc_type: docType });
      setOpen(false);
      onCreated(trimmed);
      setName('');
      setDocType('api');
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <span style={{ marginLeft: 'auto' }}>
      {!open && (
        <button style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setOpen(true)}>
          + Add
        </button>
      )}
      {open && (
        <span style={{ display: 'grid', gap: 4, marginLeft: 8, width: 150 }}>
          <input
            autoFocus
            placeholder="orders-api"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') await create();
              if (e.key === 'Escape') {
                setOpen(false);
                setName('');
              }
            }}
            style={{ width: '100%', fontSize: 11, padding: '2px 6px' }}
          />
          <span style={{ display: 'flex', gap: 4 }}>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as LocalDocType)}
              style={{ minWidth: 0, flex: 1, fontSize: 11, padding: '2px 4px' }}
            >
              <option value="api">API</option>
              <option value="website">Website</option>
              <option value="library">Library</option>
              <option value="notes">Notes</option>
            </select>
            <button style={{ padding: '2px 6px', fontSize: 11 }} onClick={create} disabled={!name.trim()}>
              Create
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
