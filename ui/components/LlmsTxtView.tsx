import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from '../api';

type Props =
  | { kind: 'own' }
  | { kind: 'namespace'; namespace: string };

export function LlmsTxtView(props: Props) {
  const [raw, setRaw] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const r =
      props.kind === 'own'
        ? await api.getOwnLlms()
        : await api.getNamespaceLlms(props.namespace);
    setRaw(r.raw);
    setDirty(false);
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
    if (!confirm('Overwrite master llms.txt with auto-generated content from your namespaces? Local edits will be lost.')) return;
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
              {regenerating ? 'Regenerating…' : 'Regenerate from namespaces'}
            </button>
          </>
        )}
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="editor">
        <textarea
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setDirty(true); }}
          spellCheck={false}
        />
        <div className="preview">
          <Markdown>{raw}</Markdown>
        </div>
      </div>
    </div>
  );
}
