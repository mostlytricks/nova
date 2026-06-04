import React, { useState } from 'react';
import { api, type Source } from '../api';
import type { Namespace, Selection } from '../App';

interface Props {
  sources: Source[];
  entries: string[];
  namespaces: Namespace[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onAddSource: () => void;
  onReload: () => void;
}

export function Sidebar({
  sources,
  entries,
  namespaces,
  selection,
  onSelect,
  onAddSource,
  onReload,
}: Props) {
  const [filter, setFilter] = useState<'all' | 'trial' | 'active' | 'archived'>('all');
  const filtered = sources.filter((s) => filter === 'all' || s.state === filter);

  // Group entries by namespace prefix.
  const nsNames = new Set(namespaces.map((n) => n.name));
  const grouped = new Map<string, string[]>();
  const loose: string[] = [];
  for (const e of entries) {
    const top = e.split('/')[0];
    if (nsNames.has(top) && e.split('/').length > 1) {
      const list = grouped.get(top) ?? [];
      list.push(e);
      grouped.set(top, list);
    } else if (!nsNames.has(top)) {
      loose.push(e);
    }
    // entries that ARE the namespace's llms.txt aren't here (entries are *.md only)
  }

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
        <span>Namespaces</span>
        <NewNamespaceButton onCreated={async (name) => { await onReload(); onSelect({ kind: 'namespace-llms', namespace: name }); }} />
      </h2>
      {namespaces.length === 0 && (
        <div className="meta" style={{ padding: '4px 8px' }}>No namespaces yet</div>
      )}
      {namespaces.map((ns) => (
        <NamespaceGroup
          key={ns.name}
          ns={ns}
          entries={grouped.get(ns.name) ?? []}
          selection={selection}
          onSelect={onSelect}
          onReload={onReload}
        />
      ))}

      {loose.length > 0 && (
        <>
          <h2>Loose entries</h2>
          {loose.map((name) => (
            <div
              key={name}
              className={`item ${selection.kind === 'own-entry' && selection.name === name ? 'active' : ''}`}
              onClick={() => onSelect({ kind: 'own-entry', name })}
            >
              {name}
            </div>
          ))}
        </>
      )}
      <NewEntryButton onCreated={async (n) => { await onReload(); onSelect({ kind: 'own-entry', name: n }); }} />

      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Sources</span>
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
      {filtered.length === 0 && <div className="meta" style={{ padding: '4px 8px' }}>No sources</div>}
      {filtered.map((s) => (
        <div
          key={s.id}
          className={`item ${selection.kind === 'source' && selection.id === s.id ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'source', id: s.id })}
          title={s.url}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.title || s.url}
          </span>
          {typeof s.linkCount === 'number' && (
            <span className="badge" style={{ marginLeft: 'auto' }} title="links">
              {s.linkCount}
            </span>
          )}
          <span className={`badge ${s.state}`} style={typeof s.linkCount === 'number' ? undefined : { marginLeft: 'auto' }}>{s.state}</span>
        </div>
      ))}
    </div>
  );
}

function NamespaceGroup({
  ns,
  entries,
  selection,
  onSelect,
  onReload,
}: {
  ns: Namespace;
  entries: string[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(true);

  const del = async () => {
    if (!confirm(`Delete namespace "${ns.name}" and ALL its files?`)) return;
    await api.deleteNamespace(ns.name);
    await onReload();
    onSelect({ kind: 'own-llms' });
  };

  return (
    <div style={{ marginBottom: 6 }}>
      <div className="item" style={{ fontWeight: 600, color: '#9aa3b2' }}>
        <span style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {ns.name}/
        </span>
        {typeof ns.entryCount === 'number' && (
          <span className="badge" style={{ marginLeft: 'auto' }} title="links in llms.txt">
            {ns.entryCount}
          </span>
        )}
        {ns.health && ns.health.status !== 'healthy' && (
          <span
            className={`badge health-dot ${ns.health.status}`}
            title={`${ns.health.status}: ${ns.health.errors.length} errors, ${ns.health.warnings.length} warnings`}
          >
            {ns.health.status === 'error' ? '!' : '?'}
          </span>
        )}
        <span
          className="badge"
          style={{ marginLeft: typeof ns.entryCount === 'number' ? undefined : 'auto', cursor: 'pointer' }}
          onClick={del}
          title="Delete namespace"
        >
          ×
        </span>
      </div>
      {open && (
        <>
          <div
            className={`item ${selection.kind === 'namespace-llms' && selection.namespace === ns.name ? 'active' : ''}`}
            style={{ paddingLeft: 24 }}
            onClick={() => onSelect({ kind: 'namespace-llms', namespace: ns.name })}
          >
            llms.txt
          </div>
          {entries.map((e) => (
            <div
              key={e}
              className={`item ${selection.kind === 'own-entry' && selection.name === e ? 'active' : ''}`}
              style={{ paddingLeft: 24 }}
              onClick={() => onSelect({ kind: 'own-entry', name: e })}
            >
              {e.slice(ns.name.length + 1)}
            </div>
          ))}
          <NewEntryButton
            label="+ entry"
            prefix={`${ns.name}/`}
            onCreated={async (n) => { await onReload(); onSelect({ kind: 'own-entry', name: n }); }}
          />
        </>
      )}
    </div>
  );
}

function NewEntryButton({
  onCreated,
  prefix = '',
  label = '+ New entry',
}: {
  onCreated: (name: string) => void;
  prefix?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) {
    return (
      <div
        className="item"
        onClick={() => setOpen(true)}
        style={{ color: '#7c8493', paddingLeft: prefix ? 24 : undefined }}
      >
        {label}
      </div>
    );
  }
  return (
    <div style={{ padding: '4px 8px', paddingLeft: prefix ? 24 : 8, display: 'flex', gap: 4 }}>
      <input
        autoFocus
        placeholder={prefix ? 'overview.md' : 'apis/my-api.md'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && name.trim()) {
            const base = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`;
            const finalName = `${prefix}${base}`;
            await api.putEntry(finalName, `# ${base.replace(/\.md$/, '')}\n\n`);
            setOpen(false);
            setName('');
            onCreated(finalName);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setName('');
          }
        }}
        style={{ flex: 1 }}
      />
    </div>
  );
}

function NewNamespaceButton({ onCreated }: { onCreated: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  return (
    <span style={{ marginLeft: 'auto' }}>
      {!open && (
        <button style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setOpen(true)}>
          + Add
        </button>
      )}
      {open && (
        <input
          autoFocus
          placeholder="auth-system"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { setOpen(false); setName(''); }}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && name.trim()) {
              try {
                await api.createNamespace({ name: name.trim() });
                setOpen(false);
                onCreated(name.trim());
                setName('');
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err));
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
              setName('');
            }
          }}
          style={{ width: 110, fontSize: 11, padding: '2px 6px' }}
        />
      )}
    </span>
  );
}
