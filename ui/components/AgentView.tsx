import React, { useEffect, useState } from 'react';
import { api, type AgentIndex, type AgentNamespaceLink } from '../api';

export function AgentView() {
  const [index, setIndex] = useState<AgentIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAgentIndex().then(setIndex).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <div className="toolbar">
        <h1>Agent View</h1>
        <span className="meta">
          {index ? `Updated ${new Date(index.generatedAt).toLocaleTimeString()}` : 'Loading...'}
        </span>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {index && (
        <>
          <div className="agent-grid">
            <UrlPanel title="Agent" label={index.recommended.label} url={index.recommended.absoluteUrl} />
            <UrlPanel title="Local" label={index.master.label} url={index.master.absoluteUrl} />
            <UrlPanel
              title="Imported"
              label={`${index.catalogs.sources.label} (${index.mergedExternal.activeSourceCount} active)`}
              url={index.catalogs.sources.absoluteUrl}
            />
            {index.startHere && (
              <UrlPanel title="Start" label={index.startHere.title} url={index.startHere.absoluteUrl} />
            )}
          </div>

          <h2 className="section-title">Snippets</h2>
          <div className="card-list">
            {index.snippets.map((snippet) => (
              <div className="agent-snippet" key={snippet.title}>
                <div>
                  <div className="agent-snippet-title">{snippet.title}</div>
                  <code>{snippet.text}</code>
                </div>
                <CopyButton value={snippet.text} />
              </div>
            ))}
          </div>

          <h2 className="section-title">Local Docs</h2>
          <div className="card-list">
            {index.namespaces.map((namespace) => (
              <NamespaceRow key={namespace.name} namespace={namespace} />
            ))}
          </div>

          {index.splitIndexes.length > 0 && (
            <>
              <h2 className="section-title">Split Local Docs</h2>
              <div className="card-list">
                {index.splitIndexes.map((namespace) => (
                  <NamespaceRow key={namespace.name} namespace={namespace} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function UrlPanel({ title, label, url }: { title: string; label: string; url: string }) {
  return (
    <div className="stat agent-url-panel">
      <div className="stat-label">{title}</div>
      <div className="agent-url-label">{label}</div>
      <div className="agent-url-row">
        <code>{url}</code>
        <CopyButton value={url} />
      </div>
    </div>
  );
}

function NamespaceRow({ namespace }: { namespace: AgentNamespaceLink }) {
  return (
    <div className="agent-row">
      <div style={{ minWidth: 0 }}>
        <div className="agent-row-title">
          <span>{namespace.title}</span>
          <span className={`health-badge ${namespace.health}`}>{namespace.health}</span>
          {namespace.isSplitIndex && <span className="tag">split index</span>}
          {namespace.isSplit && !namespace.isSplitIndex && <span className="tag">split</span>}
        </div>
        <div className="card-sub">
          <code>{namespace.name}/</code> · {namespace.links} {namespace.links === 1 ? 'link' : 'links'}
          {namespace.sourceNamespace && <> · from <code>{namespace.sourceNamespace}</code></>}
        </div>
        {namespace.summary && <div className="card-summary">{namespace.summary}</div>}
        <div className="agent-url-row">
          <code>{namespace.absoluteUrl}</code>
          <CopyButton value={namespace.absoluteUrl} />
        </div>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
