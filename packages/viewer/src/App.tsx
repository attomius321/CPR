import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useStoreApi,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import type { BranchReviewInfo, Graph } from '@cpr/core';
import { newDraft, refreshDrafts, type Anchor, type ReviewDraft } from './comments.js';
import type { Loaded, Pair } from './commits.js';
import { BackLink, HistoryPage, DiffProgress, fetchGraph, startDiff } from './HistoryPage.js';
import { workspaceHref, workspaceName } from './workspaces.js';
import { WorkspacesPage } from './WorkspacesPage.js';
import { PageTabs } from './PageTabs.js';
import { useWorkspaces } from './useWorkspaces.js';
import { DetailPanel } from './DetailPanel.js';
import { FileNode } from './FileNode.js';
import {
  decorate,
  edgesToDraw,
  projectAt,
  type FlowEdge,
  type FlowNode,
  type SymbolData,
} from './flow.js';
import {
  changeList,
  filterChanges,
  neighbourhood,
  nextProject,
  onlyProject,
  projectNeighbourhood,
  reviewStatus,
  stepChange,
  toggleMark,
  withoutCollapsed,
  type Marks,
} from './review.js';
import { ProjectNode } from './ProjectNode.js';
import { MAP_ZOOM, mapZoomStyle } from './mapzoom.js';
import { Resizer } from './Resizer.js';
import { pageOfPath } from './pages.js';
import { Sidebar, type SidebarTab } from './Sidebar.js';
import { asMarks, asReviewDraft, browserStore, serverStore, type Store } from './store.js';
import { SummaryNode } from './SummaryNode.js';
import { SymbolNode } from './SymbolNode.js';
import { useLayout } from './useLayout.js';

const nodeTypes = {
  symbol: SymbolNode,
  file: FileNode,
  summary: SummaryNode,
  project: ProjectNode,
};

type State =
  | { status: 'loading' }
  | { status: 'empty'; error?: string }
  /** `cpr view`'s History, at `/history`: pick commits to compare. */
  | { status: 'history' }
  /** `cpr view`'s first page, Workspaces (V25: at `/`; `/workspaces` and `/workspaces` before). */
  | { status: 'workspaces' }
  /** A diff's page while it is analyzed, or once it failed or was stopped. */
  | { status: 'analyzing'; loaded: Exclude<Loaded, { kind: 'graph' }> }
  /**
   * `sources`: opened through `cpr view`, so `/api/source` exists. `forge`: opened through
   * `cpr pr`, which posts reviews there. `commits`: a diff of `cpr view`, which lists commits.
   * `open`: the server opens files in VS Code (`/api/open`).
   */
  | {
      status: 'ready';
      graph: Graph;
      sources: boolean;
      forge: Forge | null;
      store: Store;
      commits: boolean;
      open: boolean;
      /** A branch's review (V15): what it covers, and what came since the last one. */
      branchReview?: BranchReviewInfo;
    };

/** Where a review goes: a forge (`cpr pr`), or the repository itself (a branch review, V16). */
type Forge = 'github' | 'gitlab' | 'local';

interface Capabilities {
  sources: boolean;
  review: { forge: Forge } | null;
  /** `/api/state` keeps reviewed marks and drafts in the CLI's cache. */
  state?: boolean;
  /** `cpr view`: History, and diffs analyzed when picked. */
  commits?: boolean;
  /** `cpr view`, `cpr pr`: `/api/open` opens a file of the change in VS Code. */
  open?: boolean;
  /** `cpr view`: this page is a branch's review (V15). */
  branchReview?: BranchReviewInfo;
}

/** How often a diff's page asks how its analysis is going. */
const POLL_MS = 500;

/** Where the graph comes from: `?graph=<url>`, else `cpr view`'s API. */
function graphUrl(): string {
  return new URLSearchParams(window.location.search).get('graph') ?? './api/graph';
}

/** Widths the reviewer gave the sidebar and the detail panel; unset, the stylesheet's. */
interface Widths {
  sidebar?: number;
  panel?: number;
}

const WIDTHS_KEY = 'cpr.viewer.widths';

/** Kept in this browser for every graph: how wide panels read best is the reviewer's. */
function loadWidths(): Widths {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WIDTHS_KEY) ?? '{}') as unknown;
    if (!stored || typeof stored !== 'object') return {};
    const width = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
    const { sidebar, panel } = stored as Record<string, unknown>;
    return {
      ...(width(sidebar) ? { sidebar: width(sidebar) } : {}),
      ...(width(panel) ? { panel: width(panel) } : {}),
    };
  } catch {
    return {};
  }
}

function saveWidths(widths: Widths): void {
  try {
    window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // Storage blocked: the widths last until the page closes.
  }
}

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [typeReferences, setTypeReferences] = useState(false);
  const [context, setContext] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  /** Summary nodes whose neighbours are shown. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** With `--since`: only what changed since the earlier version. */
  const [sinceOnly, setSinceOnly] = useState(true);
  const [marks, setMarks] = useState<Marks>({});
  /** The sidebar tab picked; until then, the findings if there are any. */
  const [tab, setTab] = useState<SidebarTab | null>(null);
  /** Words the change list is narrowed to. */
  const [search, setSearch] = useState('');
  /** The one project (by folder) the list and the canvas show; null for all. */
  const [project, setProject] = useState<string | null>(null);
  /** Projects (by folder) folded in the change list. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<ReviewDraft>({ drafts: [], body: '' });
  const [widths, setWidths] = useState<Widths>(loadWidths);
  /** A panel is being resized: the canvas waits for the drop to centre the selection again. */
  const [resizing, setResizing] = useState(false);
  const resize = useCallback((panel: keyof Widths, width: number | null) => {
    setWidths((current) => {
      const next = { ...current };
      if (width === null) delete next[panel];
      else next[panel] = width;
      saveWidths(next);
      return next;
    });
  }, []);

  const graph = state.status === 'ready' ? state.graph : undefined;
  const forge = state.status === 'ready' ? state.forge : null;
  const store = state.status === 'ready' ? state.store : undefined;
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

  useEffect(() => {
    if (!graph || !store) return;
    let live = true;
    setMarks({});
    setDraft({ drafts: [], body: '' });
    void Promise.all([store.load('review'), store.load('drafts')]).then(([marks, drafts]) => {
      if (!live) return;
      setMarks(asMarks(marks));
      // Under `cpr pr`, drafts may come from an earlier push of the change.
      const saved = asReviewDraft(drafts);
      setDraft({ ...saved, drafts: refreshDrafts(graph, saved.drafts) });
    });
    return () => {
      live = false;
    };
  }, [graph, store]);

  /** `delay`: typing a summary saves once it pauses. */
  const updateDraft = useCallback(
    (change: (current: ReviewDraft) => ReviewDraft, delay = 0) => {
      setDraft((current) => {
        const next = change(current);
        store?.save('drafts', next, delay);
        return next;
      });
    },
    [store],
  );

  const toggleReviewed = useCallback(
    (id: string) => {
      if (!graph) return;
      setMarks((current) => {
        const next = toggleMark(graph, current, id);
        store?.save('review', next);
        return next;
      });
    },
    [graph, store],
  );

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

  /** Bumped to load the page again: after "Analyze again". */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const url = graphUrl();
    const served = url === './api/graph';
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const capabilities = served ? await fetchCapabilities() : null;
      let opened = attempt === 0;
      const poll = async (): Promise<void> => {
        const loaded = await fetchGraph(url);
        if (!live) return;
        if (loaded.kind === 'graph') {
          const { graph } = loaded;
          setState({
            status: 'ready',
            graph,
            sources: served,
            forge: capabilities?.review?.forge ?? null,
            store: capabilities?.state ? serverStore() : browserStore(graph),
            commits: !!capabilities?.commits,
            open: !!capabilities?.open,
            ...(capabilities?.branchReview ? { branchReview: capabilities.branchReview } : {}),
          });
        } else if (loaded.kind === 'progress' || loaded.kind === 'failed') {
          setState({ status: 'analyzing', loaded });
          if (loaded.kind === 'progress') timer = setTimeout(() => void poll(), POLL_MS);
        } else if (loaded.pair && capabilities?.commits) {
          // A diff's page opened anew (a bookmark, a restarted server): analyze it.
          if (!opened) return setState({ status: 'analyzing', loaded });
          opened = false;
          await startDiff(loaded.pair).catch(() => undefined);
          if (live) await poll();
        } else if (!capabilities?.commits) setState({ status: 'empty' });
        else {
          const { page, moved } = pageOfPath(window.location.pathname);
          // An old address of Workspaces, kept for bookmarks: shown as today's.
          if (moved) {
            const { search, hash } = window.location;
            window.history.replaceState(null, '', `${moved}${search}${hash}`);
          }
          setState({ status: page });
        }
      };
      await poll();
    })();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [attempt]);
  const retry = useCallback((pair: Pair) => {
    void startDiff(pair)
      .catch(() => undefined)
      .then(() => setAttempt((n) => n + 1));
  }, []);

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
      setState({ status: 'empty', error: `Not a CPR graph: ${(error as Error).message}` });
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

  const addDraft = useCallback(
    (symbol: string, anchor: Anchor | null, body: string) => {
      const node = graph?.nodes.find((n) => n.id === symbol);
      if (node) updateDraft((d) => ({ ...d, drafts: [...d.drafts, newDraft(node, anchor, body)] }));
    },
    [graph, updateDraft],
  );
  const removeDraft = useCallback(
    (id: string) => updateDraft((d) => ({ ...d, drafts: d.drafts.filter((x) => x.id !== id) })),
    [updateDraft],
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

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="bar">
        <strong className="brand">CPR</strong>
        {(state.status === 'history' || state.status === 'workspaces') && (
          <PageTabs active={state.status} />
        )}
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
          </>
        )}
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
        {state.status === 'history' && <HistoryPage />}
        {state.status === 'workspaces' && <WorkspacesPage />}
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
}

interface CanvasProps {
  /** Decorated: reviewed marks and the selection. */
  nodes: FlowNode[];
  /** The layout's: the canvas picks and decorates those it draws (`edgesToDraw`). */
  edges: FlowEdge[];
  fileEdges: FlowEdge[];
  /** The undecorated layout: it changes only when what is drawn changes. */
  layoutNodes: FlowNode[];
  /** A layout for a newer view is being made: this one stays until it arrives. */
  pending: boolean;
  selected: string | null;
  /** In focus mode the whole (small) neighbourhood is fitted; otherwise the selection is centered. */
  focus: boolean;
  /** The one project shown (by folder), or null: a new one is fitted as a whole, once. */
  scope: string | null;
  /** A panel beside it is being dragged wider or narrower. */
  resizing: boolean;
  onSelect: (id: string | null) => void;
  onToggleSummary: (id: string) => void;
  /** Symbols to bring into view: a group just shown or hidden. */
  reveal: string[] | null;
}

/** How long after React Flow's end of a move the edges come back, unless it moves again. */
const MOVE_END_DELAY = 100;
/** Nothing uses edge clicks or hovers: no invisible wide path beside each edge. */
const EDGE_OPTIONS = { interactionWidth: 0 };
const PRO_OPTIONS = { hideAttribution: true };

/** The minimap draws every node: its class must not change identity with each render. */
function minimapClass(n: Node): string {
  if (n.type === 'symbol') return `minimap-${(n.data as SymbolData).tone}`;
  if (n.type === 'summary') return 'minimap-summary';
  return n.type === 'project' ? 'minimap-project' : 'minimap-file';
}

/** The graph; brings the selected symbol into view when it, or the layout, changes. */
function Canvas({
  nodes,
  edges,
  fileEdges,
  layoutNodes,
  pending,
  selected,
  focus,
  scope,
  resizing,
  onSelect,
  onToggleSummary,
  reveal,
}: CanvasProps) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  // Zoomed out, the canvas is a map; labels scale with `--cpr-zoom`, set without re-rendering
  // and only where they read it.
  const map = useStore((state) => state.transform[2] < MAP_ZOOM);
  // The canvas narrows when the detail panel opens or a panel is resized: centre the selection
  // again then (after the drop: following the drag would shake the canvas).
  const size = useStore((state) => `${state.width}x${state.height}`);
  const store = useStoreApi();
  useEffect(() => {
    const labels = mapZoomStyle(document);
    labels.update(store.getState().transform[2]);
    const unsubscribe = store.subscribe((state) => labels.update(state.transform[2]));
    return () => {
      unsubscribe();
      labels.remove();
    };
  }, [store]);

  // While the view moves, a large graph draws fewer edges. A move starts with the view's first
  // change (React Flow's start comes with any press, a click included) and ends a little after
  // React Flow says so: an animation interrupted by the next one ends after the next has started.
  const [moving, setMoving] = useState(false);
  const stop = useRef<ReturnType<typeof setTimeout>>(undefined);
  const move = useCallback(() => {
    clearTimeout(stop.current);
    setMoving(true);
  }, []);
  const moved = useCallback(() => {
    clearTimeout(stop.current);
    stop.current = setTimeout(() => setMoving(false), MOVE_END_DELAY);
  }, []);
  useEffect(() => () => clearTimeout(stop.current), []);
  const drawn = useMemo(
    () => edgesToDraw({ edges, fileEdges }, { map, moving, selected }),
    [edges, fileEdges, map, moving, selected],
  );

  // Stable, as React Flow hands them to every node: a new one re-renders thousands of them.
  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === 'symbol') onSelect(node.id);
      else if (node.type === 'summary') onToggleSummary(node.id);
      // On the map, a file box is what is clicked: zoom into it.
      else if (node.type === 'file' && map) {
        void fitView({ nodes: [{ id: node.id }], duration: 300, maxZoom: 1.1 });
      }
    },
    [map, fitView, onSelect, onToggleSummary],
  );
  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      // On the map, an empty part of a frame (frames never take the pointer there): zoom into
      // the frame. Anywhere else, the canvas: deselect.
      const frame = map
        ? projectAt(layoutNodes, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
        : undefined;
      if (frame) void fitView({ nodes: [{ id: frame }], duration: 300, maxZoom: 1.1 });
      else onSelect(null);
    },
    [map, layoutNodes, fitView, screenToFlowPosition, onSelect],
  );

  // The project last fitted as a whole: walking its symbols then centres each, as without one.
  const fitted = useRef(scope);
  useEffect(() => {
    // Fit once the layout asked for is drawn, not the one it replaces: the view moves once.
    if (resizing || pending) return;
    // Wait a frame so React Flow has measured nodes that just appeared.
    const frame = requestAnimationFrame(() => {
      const rescoped = fitted.current !== scope;
      fitted.current = scope;
      if (reveal)
        void fitView({ nodes: reveal.map((id) => ({ id })), duration: 300, maxZoom: 1.1 });
      else if (focus || rescoped) void fitView({ duration: 300, maxZoom: 1.1 });
      else if (selected) void fitView({ nodes: [{ id: selected }], duration: 300, maxZoom: 1.1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, focus, scope, layoutNodes, size, reveal, resizing, pending, fitView]);

  return (
    <ReactFlow<Node, Edge>
      nodes={nodes}
      edges={drawn}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={EDGE_OPTIONS}
      onMove={move}
      onMoveEnd={moved}
      fitView
      onlyRenderVisibleElements
      {...(map ? { className: 'map' } : {})}
      colorMode="system"
      minZoom={0.05}
      nodesConnectable={false}
      // The layout is computed: a drag that starts on a box pans the canvas instead of moving it.
      nodesDraggable={false}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      proOptions={PRO_OPTIONS}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeClassName={minimapClass} />
      {pending && (
        <Panel position="top-center" className="layout-pending" role="status">
          Laying out…
        </Panel>
      )}
    </ReactFlow>
  );
}

/** What the server offers; `cpr view` builds before this endpoint existed answer nothing. */
async function fetchCapabilities(): Promise<Capabilities | null> {
  try {
    const response = await fetch('./api/capabilities');
    return response.ok ? ((await response.json()) as Capabilities) : null;
  } catch {
    return null;
  }
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
  const { base, head } = graph.revisions;
  // A pair picked from the commits page is named by its SHAs: once, short.
  const side = (ref: string, sha: string | null) =>
    !sha ? ref : ref === sha ? sha.slice(0, 7) : `${ref} (${sha.slice(0, 7)})`;
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
      <span className="revisions">
        {side(base.ref, base.sha)} → {side(head.ref, head.sha)}
      </span>
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
        Run <code>cpr view main</code>, or drop a graph JSON from{' '}
        <code>cpr diff main --out graph.json</code> here.
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
      <span className="legend-hint">click a symbol for details, a group to show its symbols</span>
    </footer>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
