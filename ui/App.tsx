import React, { useEffect, useState } from 'react';
import { api, type NamespaceHealthReport, type Source } from './api';
import { Sidebar } from './components/Sidebar';
import { LlmsTxtView } from './components/LlmsTxtView';
import { EntryView } from './components/EntryView';
import { SourceView } from './components/SourceView';
import { ProbeDialog } from './components/ProbeDialog';
import { Dashboard } from './components/Dashboard';
import { AgentView } from './components/AgentView';

export type Selection =
  | { kind: 'dashboard' }
  | { kind: 'agent' }
  | { kind: 'own-llms' }
  | { kind: 'namespace-llms'; namespace: string }
  | { kind: 'own-entry'; name: string }
  | { kind: 'source'; id: number };

export interface Namespace {
  name: string;
  title: string;
  summary: string | null;
  note?: string | null;
  entryCount?: number;
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
        entries={entries}
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
            key={`ns-${selection.namespace}`}
          />
        )}
        {selection.kind === 'own-entry' && (
          <EntryView
            name={selection.name}
            onChanged={reload}
            onDeleted={() => { setSelection({ kind: 'own-llms' }); reload(); }}
          />
        )}
        {selection.kind === 'source' && (
          <SourceView
            id={selection.id}
            onChanged={reload}
            onDeleted={() => { setSelection({ kind: 'own-llms' }); reload(); }}
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
