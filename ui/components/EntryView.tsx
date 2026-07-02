import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import type { Selection } from '../App';

export function EntryView({
  name,
  onSelect,
  onBack,
  onChanged,
  onDeleted,
}: {
  name: string;
  onSelect: (selection: Selection) => void;
  onBack: () => void;
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

  const parentNamespace = namespaceFromEntry(name);
  const goBack = () => {
    if (dirty && !confirm('Leave this page with unsaved changes?')) return;
    onBack();
  };

  return (
    <div>
      <div className="toolbar">
        <h1>{name}</h1>
        <span className="meta">{dirty ? 'unsaved' : 'saved'}</span>
        <button onClick={goBack}>
          {parentNamespace ? `Back to ${parentNamespace}/llms.txt` : 'Back to master'}
        </button>
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
          <Markdown remarkPlugins={[remarkGfm]} components={markdownLinkComponents(onSelect)}>{content}</Markdown>
        </div>
      </div>
    </div>
  );
}

function namespaceFromEntry(name: string): string | null {
  const [namespace] = name.split('/');
  return namespace && namespace !== name ? namespace : null;
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
