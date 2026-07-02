import React, { useEffect, useState } from 'react';
import { api, type LocalDocType, type ManagedDocState, type NamespaceHealthReport, type Source } from './api';
import { Sidebar } from './components/Sidebar';
import { LlmsTxtView } from './components/LlmsTxtView';
import { EntryView } from './components/EntryView';
import { SourceView } from './components/SourceView';
import { ProbeDialog } from './components/ProbeDialog';
import { Dashboard } from './components/Dashboard';
import { AgentView } from './components/AgentView';
import { ReaderView } from './components/ReaderView';

export type Selection =
  | { kind: 'dashboard' }
  | { kind: 'agent' }
  | { kind: 'own-llms' }
  | { kind: 'namespace-llms'; namespace: string }
  | { kind: 'own-entry'; name: string }
  | { kind: 'source'; id: number }
  | { kind: 'reader'; doc: string };

export interface Namespace {
  name: string;
  title: string;
  summary: string | null;
  note?: string | null;
  entryCount?: number;
  state: ManagedDocState;
  doc_type: LocalDocType;
  origin_url: string | null;
  base_url: string | null;
  auth_summary: string | null;
  version: string | null;
  known_gaps: string | null;
  tags: string[];
  notes: string;
  owner: string | null;
  trust_note: string | null;
  intended_use: string | null;
  warning: string | null;
  last_reviewed_at: number | null;
  promotion_reason: string | null;
  created_at: number;
  updated_at: number;
  health?: NamespaceHealthReport;
}

export function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [entries, setEntries] = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: 'dashboard' });
  const [probeOpen, setProbeOpen] = useState(false);

  const reload = async () => {
    const [s, e, ns, health] = await Promise.all([
      api.listSources(),
      api.listEntries(),
      api.listNamespaces(),
      api.listNamespaceHealth(),
    ]);
    const healthByName = new Map(health.namespaces.map((report) => [report.namespace, report]));
    setSources(s);
    setEntries(e.entries);
    setNamespaces(ns.namespaces.map((namespace) => ({
      ...namespace,
      health: healthByName.get(namespace.name),
    })));
  };

  useEffect(() => { reload(); }, []);

  return (
    <div className="layout">
      <Sidebar
        sources={sources}
        namespaces={namespaces}
        selection={selection}
        onSelect={setSelection}
        onAddSource={() => setProbeOpen(true)}
        onReload={reload}
      />
      <div className="main">
        {selection.kind === 'dashboard' && (
          <Dashboard
            namespaces={namespaces}
            sources={sources}
            onSelect={setSelection}
            onReload={reload}
          />
        )}
        {selection.kind === 'agent' && <AgentView />}
        {selection.kind === 'own-llms' && <LlmsTxtView kind="own" key="own" />}
        {selection.kind === 'namespace-llms' && (
          <LlmsTxtView
            kind="namespace"
            namespace={selection.namespace}
            entries={entries.filter((entry) => entry.startsWith(`${selection.namespace}/`))}
            onSelect={setSelection}
            onReload={reload}
            key={`ns-${selection.namespace}`}
          />
        )}
        {selection.kind === 'own-entry' && (
          <EntryView
            name={selection.name}
            onSelect={setSelection}
            onBack={() => {
              const namespace = selection.name.split('/')[0];
              setSelection(namespace && namespace !== selection.name ? { kind: 'namespace-llms', namespace } : { kind: 'own-llms' });
            }}
            onChanged={reload}
            onDeleted={() => { setSelection({ kind: 'own-llms' }); reload(); }}
          />
        )}
        {selection.kind === 'source' && (
          <SourceView
            id={selection.id}
            onSelect={setSelection}
            onChanged={reload}
            onDeleted={() => { setSelection({ kind: 'own-llms' }); reload(); }}
          />
        )}
        {selection.kind === 'reader' && (
          <ReaderView
            doc={selection.doc}
            onBack={() => {
              if (namespaces.some((namespace) => namespace.name === selection.doc)) {
                setSelection({ kind: 'namespace-llms', namespace: selection.doc });
                return;
              }
              const source = sources.find((s) => s.slug === selection.doc);
              setSelection(source ? { kind: 'source', id: source.id } : { kind: 'dashboard' });
            }}
          />
        )}
      </div>
      {probeOpen && (
        <ProbeDialog
          onClose={() => setProbeOpen(false)}
          onAdded={async (s) => {
            setProbeOpen(false);
            await reload();
            setSelection({ kind: 'source', id: s.id });
          }}
        />
      )}
    </div>
  );
}
