import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { api, type Source } from '../api';

export function ProbeDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (s: Source) => void;
}) {
  const [url, setUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ raw: string; doc: any } | null>(null);

  const probe = async () => {
    setProbing(true);
    setError(null);
    setPreview(null);
    try {
      let u = url.trim();
      if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
      if (!/\/llms\.txt$/i.test(u)) u = u.replace(/\/?$/, '/llms.txt');
      const r = await api.probe(u);
      if (!r.ok) {
        setError(r.error ?? 'probe failed');
      } else {
        setPreview({ raw: r.raw, doc: r.doc });
        setUrl(u);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const add = async () => {
    setAdding(true);
    try {
      const s = await api.addSource({ url });
      onAdded(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAdding(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add llms.txt source</h3>
        <div className="row">
          <input
            autoFocus
            placeholder="https://example.com/llms.txt or example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') probe(); }}
          />
          <button onClick={probe} disabled={!url.trim() || probing}>
            {probing ? 'Probing…' : 'Probe'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {preview && (
          <>
            <div className="meta">
              <strong>{preview.doc.title}</strong>
              {preview.doc.summary && ` — ${preview.doc.summary}`}
            </div>
            <div className="meta">
              {preview.doc.sections.length} section(s),{' '}
              {preview.doc.sections.reduce((n: number, s: any) => n + s.links.length, 0)} link(s)
            </div>
            <div className="preview-scroll">
              <Markdown>{preview.raw}</Markdown>
            </div>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!preview || adding} onClick={add}>
            {adding ? 'Adding…' : 'Add as trial'}
          </button>
        </div>
      </div>
    </div>
  );
}
