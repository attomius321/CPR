import { ReactFlowProvider } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import { flushSync } from 'react-dom';
import type { BranchReviewInfo, Graph } from '@symbiote/core';
import { BackLink, DiffProgress } from './DiffProgress.js';
import { Canvas } from './Canvas.js';
import { useDiffGraph } from './useDiffGraph.js';
import { useReview } from './useReview.js';
import { diffTitle, revisionsLabel } from '../shell/pages.js';
import { workspaceHref, workspaceName } from '../workspaces/workspaces.js';
import { DiffShell } from './DiffShell.js';
import { Shell } from '../shell/Shell.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { DetailPanel } from './DetailPanel.js';
import { decorate } from '../graph/flow.js';
import {
  changeList,
  filterChanges,
  neighbourhood,
  nextProject,
  onlyProject,
  projectNeighbourhood,
  reviewStatus,
  stepChange,
  withoutCollapsed,
} from './review.js';
import { Resizer } from '../ui/Resizer.js';
import { DiffKeys, Sidebar, type SidebarTab } from './Sidebar.js';
import { Help } from '../ui/Help.js';
import { browserStore } from './store.js';
import { WindowButtons } from '../shell/TitleBar.js';
import { useLayout } from '../graph/useLayout.js';
import { loadWidths, saveWidth, withWidth, type Widths } from '../ui/widths.js';

export function App() {
  const { state, setState, inView, retry } = useDiffGraph();
  const [typeReferences, setTypeReferences] = useState(false);
  const [context, setContext] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  /** Summary nodes whose neighbours are shown. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** With `--since`: only what changed since the earlier version. */
  const [sinceOnly, setSinceOnly] = useState(true);
  /** The sidebar tab picked; until then, the findings if there are any. */
  const [tab, setTab] = useState<SidebarTab | null>(null);
  /** Words the change list is narrowed to. */
  const [search, setSearch] = useState('');
  /** The one project (by folder) the list and the canvas show; null for all. */
  const [project, setProject] = useState<string | null>(null);
  /** Projects (by folder) folded in the change list. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [widths, setWidths] = useState<Widths>(loadWidths);
  /** A panel is being resized: the canvas waits for the drop to centre the selection again. */
  const [resizing, setResizing] = useState(false);
  const resize = useCallback((panel: 'sidebar' | 'panel', width: number | null) => {
    setWidths((current) => withWidth(current, panel, width));
    saveWidth(panel, width);
  }, []);

  const graph = state.status === 'ready' ? state.graph : undefined;
  const forge = state.status === 'ready' ? state.forge : null;
  const store = state.status === 'ready' ? state.store : undefined;
  const { marks, draft, updateDraft, toggleReviewed, addDraft, removeDraft } = useReview(
    graph,
    store,
  );
  const onlySince = sinceOnly && !!graph?.since;
  const changes = useMemo(
    () => (graph ? changeList(graph, { sinceOnly: onlySince }) : []),
    [graph, onlySince],
  );
  /** The changes the project filter and the search leave: what the list shows. */
  const shown = useMemo(
    () => filterChanges(onlyProject(changes, project), search),
    [changes, project, search],
  );
  /** What j/k walk: the list, without the projects folded in it. */
  const walked = useMemo(() => withoutCollapsed(shown, collapsed), [shown, collapsed]);
  const { reviewed, stale } = useMemo(
    () =>
      graph
        ? reviewStatus(graph, marks)
        : { reviewed: new Set<string>(), stale: new Set<string>() },
    [graph, marks],
  );
  const reviewOf = state.status === 'ready' ? state.branchReview?.branch : undefined;
  // The window's title (N1a): the request, the branch reviewed, or the pair.
  useEffect(() => {
    if (graph) document.title = diffTitle(graph, reviewOf);
  }, [graph, reviewOf]);
  // A new graph starts with every big neighbourhood collapsed, and every project shown.
  useEffect(() => {
    setExpanded(new Set());
    setProject(null);
    setCollapsed(new Set());
  }, [graph]);
  const toggleCollapsed = useCallback((folder: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });
  }, []);

  // Keyboard review: j/k walk the changes, r marks reviewed, f focuses, p (P) shows the next
  // (previous) project only, c comments, o opens in VS Code, / searches, Esc closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const typing =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio'].includes(target.type));
      if (typing) {
        // Esc leaves the field (keeping what was typed) instead of closing the panel.
        if (event.key === 'Escape') target.blur();
        return;
      }
      if (event.key === 'c' && document.getElementById('comment-input')) {
        event.preventDefault();
        document.getElementById('comment-input')?.focus();
      } else if (event.key === 'o') {
        document.getElementById('open-in-editor')?.click();
      } else if (event.key === '/') {
        event.preventDefault();
        flushSync(() => setTab('changes'));
        document.getElementById('change-search')?.focus();
      } else if (event.key === 'j') setSelected((id) => stepChange(walked, id, 1));
      else if (event.key === 'k') setSelected((id) => stepChange(walked, id, -1));
      else if (event.key === 'r' && selected) toggleReviewed(selected);
      else if (event.key === 'f') setFocus((on) => !on);
      else if (event.key === 'p' || event.key === 'P') {
        setProject((folder) => nextProject(changes, folder, event.key === 'p' ? 1 : -1));
      } else if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changes, walked, selected, toggleReviewed]);

  const load = useCallback(async (file: File) => {
    try {
      const graph = JSON.parse(await file.text()) as Graph;
      setState({
        status: 'ready',
        graph,
        sources: false,
        forge: null,
        store: browserStore(graph),
        commits: false,
        open: false,
      });
      setSelected(null);
      setSearch('');
    } catch (error) {
      setState({ status: 'empty', error: `Not a Symbiote graph: ${(error as Error).message}` });
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) void load(file);
    },
    [load],
  );

  // Layout once per view; selecting and marking only decorate it, so nothing moves.
  // Focus on a symbol narrows further than showing one project.
  const focusSet = useMemo(() => {
    if (!graph) return undefined;
    if (focus && selected) return neighbourhood(graph, selected);
    return project === null ? undefined : projectNeighbourhood(graph, changes, project);
  }, [graph, focus, selected, project, changes]);
  const view = useMemo(
    () => ({ typeReferences, context, expanded, ...(focusSet ? { focus: focusSet } : {}) }),
    [typeReferences, context, expanded, focusSet],
  );
  // Made in a worker: the last layout stays drawn until the one for this view arrives.
  const { layout, pending } = useLayout(graph, view);
  const flowNodes = useMemo(
    () =>
      layout ? decorate(layout.nodes, { reviewed, sinceOnly: onlySince, selected }) : undefined,
    [layout, reviewed, onlySince, selected],
  );

  // Selecting a symbol that sits inside a collapsed summary (from the detail panel) shows it.
  useEffect(() => {
    const summary = selected ? layout?.hidden.get(selected) : undefined;
    if (summary) setExpanded((current) => new Set(current).add(summary));
  }, [selected, layout]);

  // After a group is shown or hidden, the canvas fits it (and its symbol), until the next
  // selection.
  const [reveal, setReveal] = useState<string[] | null>(null);
  useEffect(() => setReveal(null), [selected]);
  const toggleSummary = useCallback(
    (id: string) => {
      const open = !expanded.has(id);
      const owner = layout?.nodes.find((n) => n.id === id);
      const of = owner?.type === 'summary' ? [owner.data.of] : [];
      setReveal([id, ...of, ...(open ? (layout?.members.get(id) ?? []) : [])]);
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    [expanded, layout],
  );

  if (state.status === 'shell') return <Shell repo={state.repo} />;
  const page = (
    <div
      className={inView ? 'app' : 'app alone'}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="bar">
        <strong className="brand">Symbiote</strong>
        {state.status === 'ready' && state.commits && <BackLink />}
        {state.status === 'ready' && state.branchReview && <ReviewOf review={state.branchReview} />}
        {state.status === 'ready' && <Summary graph={state.graph} />}
        <div className="spacer" />
        {state.status === 'ready' && (
          <>
            {state.graph.since && (
              <label
                className="toggle"
                title="Leave out symbols changed the same way as in the earlier version"
              >
                <input
                  type="checkbox"
                  checked={sinceOnly}
                  onChange={(e) => setSinceOnly(e.target.checked)}
                />
                Only changes since {state.graph.since.sha.slice(0, 7)}
              </label>
            )}
            <label className="toggle" title="Show only the selected symbol and its neighbours (f)">
              <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} />
              Focus
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={context}
                onChange={(e) => setContext(e.target.checked)}
              />
              Context
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={typeReferences}
                onChange={(e) => setTypeReferences(e.target.checked)}
              />
              Type references
            </label>
            <Help label="This page's keys">
              <DiffKeys
                grouped={changes.some((file) => file.project)}
                review={Boolean(forge)}
                canOpen={state.open}
              />
              <p>Click a symbol for its details, a group to show its symbols.</p>
            </Help>
          </>
        )}
        {/* A page with no shell (symbiote pr) is the window's title bar: its buttons, on Linux (N1d). */}
        {!inView && <WindowButtons />}
      </header>
      <main
        className={`canvas${resizing ? ' resizing' : ''}`}
        style={
          {
            '--sidebar-width': widths.sidebar ? `${widths.sidebar}px` : undefined,
            '--panel-width': widths.panel ? `${widths.panel}px` : undefined,
          } as CSSProperties
        }
      >
        {state.status === 'loading' && <p className="hint">Loading graph…</p>}
        {state.status === 'empty' && (
          <DropZone error={state.error} onFile={(file) => void load(file)} />
        )}
        {state.status === 'analyzing' && <DiffProgress loaded={state.loaded} onRetry={retry} />}
        {state.status === 'ready' && (
          <ReactFlowProvider>
            <Sidebar
              graph={state.graph}
              changes={changes}
              shown={shown}
              search={search}
              onSearch={setSearch}
              tab={tab ?? (state.graph.findings.length > 0 ? 'findings' : 'changes')}
              onTab={setTab}
              reviewed={reviewed}
              stale={stale}
              selected={selected}
              onSelect={setSelected}
              onToggleReviewed={toggleReviewed}
              project={project}
              onProject={setProject}
              collapsed={collapsed}
              onCollapse={toggleCollapsed}
              canOpen={state.open}
              review={
                forge
                  ? {
                      forge,
                      draft,
                      onBody: (body) => updateDraft((d) => ({ ...d, body }), 300),
                      onRemove: removeDraft,
                      onPosted: () => updateDraft(() => ({ drafts: [], body: '' })),
                      ...(state.status === 'ready' && state.branchReview
                        ? {
                            local: {
                              branch: state.branchReview.branch,
                              head: state.branchReview.head,
                              ...(state.branchReview.into ? { into: state.branchReview.into } : {}),
                            },
                          }
                        : {}),
                    }
                  : undefined
              }
            />
            <Resizer
              label="Resize review sidebar"
              side="before"
              variable="--sidebar-width"
              onResize={(width) => resize('sidebar', width)}
              onDrag={setResizing}
            />
            {layout && flowNodes ? (
              <Canvas
                nodes={flowNodes}
                edges={layout.edges}
                fileEdges={layout.fileEdges}
                layoutNodes={layout.nodes}
                pending={pending}
                selected={selected}
                focus={focus}
                scope={project}
                resizing={resizing}
                onSelect={setSelected}
                onToggleSummary={toggleSummary}
                reveal={reveal}
              />
            ) : (
              // The first layout: the change list and findings are there meanwhile.
              <p className="hint canvas-waiting layout-pending" role="status">
                Laying out…
              </p>
            )}
            {selected && (
              <Resizer
                label="Resize detail panel"
                side="after"
                variable="--panel-width"
                onResize={(width) => resize('panel', width)}
                onDrag={setResizing}
              />
            )}
            {selected && (
              <DetailPanel
                key={selected}
                graph={state.graph}
                id={selected}
                {...(changes.some((f) => f.project) && state.graph.projects
                  ? { projects: state.graph.projects }
                  : {})}
                sources={state.sources}
                canOpen={state.open}
                reviewed={reviewed.has(selected)}
                stale={stale.has(selected)}
                onToggleReviewed={() => toggleReviewed(selected)}
                onSelect={setSelected}
                onClose={() => setSelected(null)}
                comments={
                  forge
                    ? {
                        drafts: draft.drafts.filter((d) => d.symbol === selected),
                        onAdd: (anchor, body) => addDraft(selected, anchor, body),
                        onRemove: removeDraft,
                      }
                    : undefined
                }
              />
            )}
          </ReactFlowProvider>
        )}
      </main>
      {layout && <Legend frames={layout.nodes[0]?.type === 'project'} />}
    </div>
  );
  // Only a diff: the shell's own pages are drawn by Shell, and while loading it is not known yet.
  const diff = state.status === 'ready' || state.status === 'analyzing';
  return inView && diff ? <DiffShell repo={inView.repo}>{page}</DiffShell> : page;
}

/**
 * "Review of wip · 2 commits since your last review" (V15); the commits compared follow, in the
 * summary.
 */
function ReviewOf({ review }: { review: BranchReviewInfo }) {
  const { branch, since, note } = review;
  // The workspace this branch is (V18b): a link to it.
  const workspace = useWorkspaces().list?.workspaces.find((f) => f.branch === branch);
  const after =
    since === null
      ? 'first review'
      : since === 0
        ? 'no commits since your last review'
        : `${since} commit${since === 1 ? '' : 's'} since your last review`;
  return (
    <span className="review-of" {...(note ? { title: note } : {})}>
      Review of <strong>{branch}</strong> · {after}
      {workspace && (
        <>
          {' · '}
          <a className="review-workspace" href={workspaceHref(branch)} title={workspace.brief}>
            Workspace: {workspaceName(workspace)}
          </a>
        </>
      )}
    </span>
  );
}

function Summary({ graph }: { graph: Graph }) {
  const { added, removed, modified } = graph.stats.symbols;
  const severity = (s: string) => graph.findings.filter((f) => f.severity === s).length;
  const request = graph.changeRequest;
  return (
    <div className="summary">
      {request && (
        <a className="request" href={request.url} target="_blank" rel="noreferrer">
          {request.forge === 'gitlab' ? '!' : '#'}
          {request.number} {request.title}
          {request.draft && <span className="chip">draft</span>}
          {request.state !== 'open' && <span className="chip">{request.state}</span>}
        </a>
      )}
      <span className="revisions">{revisionsLabel(graph)}</span>
      <span className="chip">{graph.stats.filesChanged} files</span>
      <span className="chip chip-added">+{added}</span>
      <span className="chip chip-removed">−{removed}</span>
      <span className="chip chip-modified">~{modified}</span>
      {severity('error') > 0 && (
        <span className="badge badge-error">{plural(severity('error'), 'error')}</span>
      )}
      {severity('warning') > 0 && (
        <span className="badge badge-warning">{plural(severity('warning'), 'warning')}</span>
      )}
      {graph.since && <SinceChip graph={graph} />}
    </div>
  );
}

/** How this version compares with the earlier one (`--since`). */
function SinceChip({ graph }: { graph: Graph }) {
  const since = graph.since;
  if (!since) return null;
  const count = (status: string) => graph.nodes.filter((n) => n.since === status).length;
  const parts = [
    ['new', count('new')],
    ['updated', count('updated')],
    ['same', count('same')],
    ['dropped', since.dropped.length],
  ].filter(([, n]) => n !== 0);
  return (
    <span
      className="chip chip-since"
      title={
        since.dropped.length
          ? `No longer changed: ${since.dropped.join(', ')}`
          : `Compared with ${since.ref}`
      }
    >
      since {since.sha.slice(0, 7)}: {parts.map(([word, n]) => `${n} ${word}`).join(' · ')}
    </span>
  );
}

function DropZone({ error, onFile }: { error?: string | undefined; onFile: (file: File) => void }) {
  return (
    <div className="dropzone">
      <h1>Review a change as a graph</h1>
      <p>
        Run <code>symbiote view main</code>, or drop a graph JSON from{' '}
        <code>symbiote diff main --out graph.json</code> here.
      </p>
      <label className="button">
        Choose a file
        <input
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** `frames`: the canvas draws projects' frames, so their parts are explained too. */
function Legend({ frames }: { frames: boolean }) {
  return (
    <footer className="legend">
      {(['added', 'removed', 'modified', 'moved', 'context', 'external', 'unknown'] as const).map(
        (tone) => (
          <span key={tone} className={`legend-item tone-${tone}`}>
            {tone}
          </span>
        ),
      )}
      <span className="legend-edge edge-head">added edge</span>
      <span className="legend-edge edge-base">removed edge</span>
      {frames && <span className="legend-edge edge-cross">edge between projects</span>}
      <span className="legend-item legend-summary">many neighbours, grouped</span>
      {frames && <span className="legend-item legend-project">project (app or library)</span>}
    </footer>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
