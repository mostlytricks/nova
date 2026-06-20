import React, { useEffect, useState } from 'react';
import { api, type Source } from '../api';
import type { Namespace, Selection } from '../App';

type Stats = Awaited<ReturnType<typeof api.getStats>>;

interface Props {
  namespaces: Namespace[];
  sources: Source[];
  onSelect: (s: Selection) => void;
  onReload: () => void;
}

export function Dashboard({ namespaces, sources, onSelect, onReload }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getStats().then(setStats).catch((e) => setError(String(e)));
  }, [namespaces.length, sources.length]);

  return (
    <div>
      <div className="toolbar">
        <h1>Dashboard</h1>
        <span className="meta">
          {stats ? `Updated ${new Date(stats.generatedAt).toLocaleTimeString()}` : 'Loading…'}
        </span>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {stats && (
        <div className="stat-strip">
          <Stat label="Local docs" value={stats.namespaces.count} />
          <Stat
            label="Local health"
            value={healthSummary(namespaces)}
            tone={namespaces.some((ns) => ns.health?.status === 'error') ? 'warn' : undefined}
          />
          <Stat label="Own entries" value={stats.ownEntries.count} />
          <Stat
            label="Imported docs"
            value={stats.sources.total}
            sub={`${stats.sources.active} active · ${stats.sources.trial} trial · ${stats.sources.archived} archived`}
          />
          <Stat
            label="Cached pages"
            value={stats.links.cached}
            sub={`of ${stats.links.total} linked`}
          />
          <Stat
            label="Oldest fetch"
            value={stats.oldestFetch ? ago(stats.oldestFetch) : '—'}
          />
          <Stat label="Errors" value={stats.errors} tone={stats.errors > 0 ? 'warn' : undefined} />
        </div>
      )}

      <h2 className="section-title">Local Docs</h2>
      {namespaces.length === 0 && (
        <div className="meta">No local docs yet. Create one from the sidebar.</div>
      )}
      <div className="card-grid">
        {namespaces.map((ns) => {
          const linkCount =
            stats?.namespaces.items.find((i) => i.name === ns.name)?.linkCount ?? ns.entryCount ?? 0;
          return (
            <NamespaceCard
              key={ns.name}
              ns={ns}
              linkCount={linkCount}
              onOpen={() => onSelect({ kind: 'namespace-llms', namespace: ns.name })}
              onNoteSaved={onReload}
            />
          );
        })}
      </div>

      <h2 className="section-title">Imported Docs</h2>
      {sources.length === 0 && (
        <div className="meta">No imported docs tracked. Use "+ Add" in the sidebar.</div>
      )}
      <div className="card-list">
        {sources.map((s) => (
          <SourceCard
            key={s.id}
            source={s}
            onOpen={() => onSelect({ kind: 'source', id: s.id })}
            onNoteSaved={onReload}
          />
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: 'warn';
}) {
  return (
    <div className={`stat ${tone === 'warn' ? 'stat-warn' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function NamespaceCard({
  ns,
  linkCount,
  onOpen,
  onNoteSaved,
}: {
  ns: Namespace;
  linkCount: number;
  onOpen: () => void;
  onNoteSaved: () => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title" onClick={onOpen}>
            {ns.title || ns.name}
          </div>
          <div className="card-sub">
            <code>{ns.name}/</code> · {linkCount} {linkCount === 1 ? 'link' : 'links'}
          </div>
        </div>
        <div className="card-actions">
          {ns.health && <HealthBadge status={ns.health.status} />}
          <a
            className="card-link"
            href={`/${ns.name}/llms.txt`}
            target="_blank"
            rel="noreferrer"
            title="Open raw llms.txt"
          >
            llms.txt ↗
          </a>
        </div>
      </div>
      {ns.health && ns.health.status !== 'healthy' && (
        <div className={`health-summary ${ns.health.status}`}>
          <strong>{ns.health.errors.length} errors</strong>
          {' · '}
          <span>{ns.health.warnings.length} warnings</span>
          {ns.health.recommendation && (
            <>
              {' · '}
              <span>{ns.health.recommendation.strategy} split suggested</span>
            </>
          )}
          <div className="health-issue">
            {(ns.health.errors[0] ?? ns.health.warnings[0])?.message}
          </div>
        </div>
      )}
      {ns.summary && <div className="card-summary">{ns.summary}</div>}
      <NoteEditor
        value={ns.note ?? ''}
        placeholder="Add an operator note for this local doc set (appears in master llms.txt)…"
        save={async (v) => {
          await api.putNamespaceNote(ns.name, v);
          onNoteSaved();
        }}
      />
    </div>
  );
}

function HealthBadge({ status }: { status: 'healthy' | 'warn' | 'error' }) {
  return <span className={`health-badge ${status}`}>{status}</span>;
}

function healthSummary(namespaces: Namespace[]): string {
  const errors = namespaces.filter((ns) => ns.health?.status === 'error').length;
  const warnings = namespaces.filter((ns) => ns.health?.status === 'warn').length;
  if (errors || warnings) return `${errors} error · ${warnings} warn`;
  return namespaces.length ? 'healthy' : '—';
}

function SourceCard({
  source,
  onOpen,
  onNoteSaved,
}: {
  source: Source;
  onOpen: () => void;
  onNoteSaved: () => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="card-title" onClick={onOpen}>
            {source.title || source.url}
          </div>
          <div className="card-sub" style={{ wordBreak: 'break-all' }}>
            <span className={`badge ${source.state}`}>{source.state}</span>
            {' '}
            <span>{source.url}</span>
            {typeof source.linkCount === 'number' && (
              <> · {source.linkCount} {source.linkCount === 1 ? 'link' : 'links'}</>
            )}
            {source.last_fetched && <> · fetched {ago(source.last_fetched)}</>}
            {source.last_reviewed_at && <> · reviewed {ago(source.last_reviewed_at)}</>}
            {source.last_error && <span className="error"> · error</span>}
          </div>
        </div>
      </div>
      {(source.owner || source.intended_use || source.trust_note || source.warning) && (
        <div className={`trust-summary ${source.warning ? 'warn' : ''}`}>
          {source.owner && <div><strong>Owner:</strong> {source.owner}</div>}
          {source.intended_use && <div><strong>Use:</strong> {source.intended_use}</div>}
          {source.trust_note && <div><strong>Trust:</strong> {source.trust_note}</div>}
          {source.warning && <div className="error"><strong>Warning:</strong> {source.warning}</div>}
        </div>
      )}
      {source.summary && <div className="card-summary">{source.summary}</div>}
      <NoteEditor
        value={source.notes ?? ''}
        placeholder="Add an operator note for this imported doc set…"
        save={async (v) => {
          await api.patchSource(source.id, { notes: v } as any);
          onNoteSaved();
        }}
      />
    </div>
  );
}

function NoteEditor({
  value,
  placeholder,
  save,
}: {
  value: string;
  placeholder: string;
  save: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <div className="note-display" onClick={() => setEditing(true)}>
        {value ? (
          <>
            <span className="note-prefix">Note:</span> {value}
          </>
        ) : (
          <span className="note-empty">+ add note</span>
        )}
      </div>
    );
  }

  return (
    <div className="note-editor">
      <textarea
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
      />
      <div className="note-actions">
        <button
          className="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await save(draft.trim());
              setEditing(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button>
      </div>
    </div>
  );
}

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
