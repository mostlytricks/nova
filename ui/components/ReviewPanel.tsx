import React, { useEffect, useState } from 'react';
import { api, type NamespaceHealthReport, type NamespaceMeta } from '../api';

/**
 * Human review surface for one local namespace: the health checker's issues
 * (the quality gate), trust metadata, and the review actions (mark reviewed,
 * promote to active). Renders nothing for docs that are not local namespaces.
 * `compact` renders a collapsible lint strip instead of the full panel.
 */
export function ReviewPanel({
  namespace,
  compact = false,
  onChanged,
}: {
  namespace: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [health, setHealth] = useState<NamespaceHealthReport | null>(null);
  const [meta, setMeta] = useState<NamespaceMeta | null>(null);
  const [missing, setMissing] = useState(false);

  const load = () => {
    Promise.all([api.getNamespaceHealth(namespace), api.getNamespaceMeta(namespace)])
      .then(([nextHealth, nextMeta]) => {
        setHealth(nextHealth);
        setMeta(nextMeta);
      })
      .catch(() => setMissing(true));
  };

  useEffect(() => {
    setHealth(null);
    setMeta(null);
    setMissing(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace]);

  if (missing || !health || !meta) return null;

  const issues = [...health.errors, ...health.warnings];

  const patch = async (body: Partial<NamespaceMeta>) => {
    await api.patchNamespaceMeta(namespace, body);
    load();
    onChanged?.();
  };

  const markReviewed = () => patch({ last_reviewed_at: Date.now() });

  const promote = async () => {
    const promotion_reason = prompt('Promotion reason for activating this local doc set:');
    if (promotion_reason === null) return;
    await patch({ state: 'active', promotion_reason, last_reviewed_at: Date.now() });
  };

  if (compact) {
    return (
      <details className="lint-strip">
        <summary>
          <span className={`health-badge ${health.status}`}>{health.status}</span>
          <span className="meta">
            {health.errors.length} errors · {health.warnings.length} warnings · {health.stats.links} links · {health.stats.orphans} orphans
          </span>
        </summary>
        <IssueList issues={issues} />
      </details>
    );
  }

  return (
    <aside className="review-panel">
      <div className="review-panel-head">
        <span className="review-panel-title">Review</span>
        <span className={`health-badge ${health.status}`}>{health.status}</span>
        <span className={`tag`}>{meta.state}</span>
      </div>
      <div className="meta">
        {health.stats.links} links · {health.stats.entries} entries · {health.stats.externalLinks} external · {health.stats.orphans} orphans
      </div>
      <IssueList issues={issues} />
      <div className="review-meta">
        <div>
          <span className="k">Last reviewed</span>{' '}
          {meta.last_reviewed_at ? new Date(meta.last_reviewed_at).toLocaleString() : 'never'}
        </div>
        {meta.warning && (
          <div className="review-warning">⚠ {meta.warning}</div>
        )}
        {meta.known_gaps && (
          <div>
            <span className="k">Known gaps</span> {meta.known_gaps}
          </div>
        )}
        {meta.intended_use && (
          <div>
            <span className="k">Intended use</span> {meta.intended_use}
          </div>
        )}
      </div>
      <div className="review-actions">
        <button onClick={markReviewed}>Mark reviewed</button>
        {meta.state !== 'active' && (
          <button className="primary" onClick={promote}>Promote to active</button>
        )}
      </div>
    </aside>
  );
}

function IssueList({ issues }: { issues: NamespaceHealthReport['errors'] }) {
  if (!issues.length) {
    return <div className="meta review-clean">No issues — quality gate is clean.</div>;
  }
  return (
    <div className="review-issues">
      {issues.map((issue, i) => (
        <div key={`${issue.code}-${i}`} className="review-issue">
          <span className={`history-pill ${issue.severity === 'error' ? 'error' : 'pending'}`}>
            {issue.severity === 'error' ? 'error' : 'warn'}
          </span>
          <span className="review-issue-text">
            {issue.message}
            {issue.path && <span className="review-issue-path"> — {issue.path}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
