import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from '../api';

export function EntryView({
  name,
  onChanged,
  onDeleted,
}: {
  name: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getEntry(name).then((r) => {
      setContent(r.content);
      setDirty(false);
    });
  }, [name]);

  const save = async () => {
    setSaving(true);
    await api.putEntry(name, content);
    setDirty(false);
    setSaving(false);
    onChanged();
  };

  const del = async () => {
    if (!confirm(`Delete ${name}?`)) return;
    await api.deleteEntry(name);
    onDeleted();
  };

  return (
    <div>
      <div className="toolbar">
        <h1>{name}</h1>
        <span className="meta">{dirty ? 'unsaved' : 'saved'}</span>
        <button className="danger" onClick={del}>Delete</button>
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="editor">
        <textarea
          value={content}
          onChange={(e) => { setContent(e.target.value); setDirty(true); }}
          spellCheck={false}
        />
        <div className="preview">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    </div>
  );
}
