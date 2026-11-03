import { ReactFlowProvider } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  Fragment,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import type { BranchReviewInfo, Graph, ReviewFile } from '@symbiote/core';
import {
  BackLink,
  DiffProgress,
  FileTotals,
  analysisState,
  pairLabel,
  reviewSince,
} from './DiffProgress.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { Canvas } from './Canvas.js';
import { useDiffGraph } from './useDiffGraph.js';
import { useReview } from './useReview.js';
import {
  diffName,
  diffTitle,
  diffView,
  revisionsLabel,
  withDiffView,
  type DiffView,
} from '../shell/pages.js';
import { briefTip, workspaceHref, workspaceName } from '../workspaces/workspaces.js';
import { DiffShell } from './DiffShell.js';
import { Shell } from '../shell/Shell.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { DetailPanel } from './DetailPanel.js';
import {
  FilesKeys,
  FilesPage,
  useReviewFiles,
  type FileFocus,
  type FilesTab,
} from './FilesPage.js';
import { stepFile } from './file-diff.js';
import type { Draft } from './comments.js';
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
import { PageHead } from '../ui/PageHead.js';
import { ForwardIcon, ReviewIcon, RunningIcon, SymbioteMark } from '../ui/icons.js';
import { browserStore } from './store.js';
import { WindowButtons } from '../shell/TitleBar.js';
import { useLayout } from '../graph/useLayout.js';
import { loadWidths, saveWidth, withWidth, type Widths } from '../ui/widths.js';
import { tip } from '../ui/tip.js';

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
  /** The page asked for (V60): Graph by `?view=graph`; null, the default (Files, if it can be). */
  const [asked, setAsked] = useState<DiffView | null>(() => diffView(window.location.search));
  /** The file the Files page shows (null: the first), its tab, and a line to bring into view. */
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [filesTab, setFilesTab] = useState<FilesTab>('files');
  const [fileFocus, setFileFocus] = useState<FileFocus | null>(null);
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
  const {
    marks,
    draft,
    updateDraft,
    verdict,
    setVerdict,
    toggleReviewed,
    addDraft,
    addLineDraft,
    removeDraft,
  } = useReview(graph, store);
  const analyzing = state.status === 'analyzing' ? state : undefined;
  const analyzedPair = analyzing?.loaded.pair;
  const served = (state.status === 'ready' || state.status === 'analyzing') && state.files;
  // While the pair is analyzed, git's files from it (V90, decision 847).
  const files = useReviewFiles(
    graph,
    served,
    analyzedPair && `${analyzedPair.base}..${analyzedPair.head}`,
  );
  // Files first (decision 431), unless the address asks for Graph or there is no diff to show:
  // a graph opened from a file has no server. While it is analyzed, the steps (V90) unless the
  // Files page is asked for and its files are served.
  const page: DiffView = analyzing
    ? asked === 'files' && served
      ? 'files'
      : 'graph'
    : (asked ?? (state.status === 'ready' && !state.files ? 'graph' : 'files'));
  const showPage = useCallback((next: DiffView) => {
    setAsked(next);
    window.history.replaceState(window.history.state, '', withDiffView(window.location.href, next));
  }, []);
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
  // A new graph starts with every big neighbourhood collapsed, and every project shown; its
  // Files page at its first file.
  useEffect(() => {
    setExpanded(new Set());
    setProject(null);
    setCollapsed(new Set());
    setOpenFile(null);
    setFileFocus(null);
  }, [graph]);
  const openTheFile = useCallback((path: string) => {
    setOpenFile(path);
    setFileFocus(null);
  }, []);
  /**
   * What a comment in the review tab is on: a line, in its file on the Files page; a symbol's
   * comment on the Graph page, or one on no line, in the symbol's panel.
   */
  const openDraft = useCallback(
    (d: Draft) => {
      const at = d.anchor;
      if (d.symbol !== undefined && (page === 'graph' || !at)) {
        showPage('graph');
        setSelected(d.symbol);
        return;
      }
      const file =
        at &&
        files.find((f) => (at.side === 'head' ? f.path : (f.previousPath ?? f.path)) === at.path);
      if (!at || !file) return;
      showPage('files');
      setFilesTab('files');
      setOpenFile(file.path);
      setFileFocus({ path: file.path, key: `${at.side}:${at.line}` });
    },
    [page, files, showPage],
  );
  const toggleCollapsed = useCallback((folder: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });
  }, []);

  // Keyboard review: j/k walk the changes, r marks reviewed, f focuses, p (P) shows the next
  // (previous) project only, c comments, o opens in VS Code, / searches, Esc closes, g switches
  // between the pages. On the Files page, j/k walk the files and c comments on the first change.
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
      if (
        event.key === 'g' &&
        (state.status === 'ready' || (state.status === 'analyzing' && served))
      ) {
        showPage(page === 'files' ? 'graph' : 'files');
      } else if (page === 'files') {
        if (event.key === 'j' || event.key === 'k') {
          setOpenFile((path) =>
            stepFile(files, path ?? files[0]?.path ?? null, event.key === 'j' ? 1 : -1),
          );
          setFileFocus(null);
        } else if (event.key === 'c') {
          event.preventDefault();
          const input = document.getElementById('comment-input');
          if (input) input.focus();
          else
            document
              .querySelector<HTMLElement>(
                '.file-code .row-add.pickable, .file-code .row-del.pickable',
              )
              ?.click();
        } else if (event.key === 'o') document.getElementById('open-in-editor')?.click();
      } else if (event.key === 'c' && document.getElementById('comment-input')) {
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
  }, [changes, walked, selected, toggleReviewed, state.status, page, showPage, files, served]);

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
        files: false,
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
  // The review to post or finish, in the sidebar's tab on either page.
  const reviewProps =
    forge && state.status === 'ready'
      ? {
          forge,
          draft,
          onBody: (body: string) => updateDraft((d) => ({ ...d, body }), 300),
          verdict,
          onVerdict: setVerdict,
          onRemove: removeDraft,
          onPosted: () => {
            updateDraft(() => ({ drafts: [], body: '' }));
            setVerdict('comment');
          },
          ...(state.branchReview
            ? {
                local: {
                  branch: state.branchReview.branch,
                  head: state.branchReview.head,
                  ...(state.branchReview.into ? { into: state.branchReview.into } : {}),
                },
              }
            : {}),
        }
      : undefined;
  const widthStyle = {
    '--sidebar-width': widths.sidebar ? `${widths.sidebar}px` : undefined,
    '--panel-width': widths.panel ? `${widths.panel}px` : undefined,
  } as CSSProperties;
  const sidebarHandle = (
    <Resizer
      gutter
      label="Resize review sidebar"
      side="before"
      variable="--sidebar-width"
      onResize={(width) => resize('sidebar', width)}
      onDrag={setResizing}
    />
  );
  // The head's title; while it is analyzed the review's branch or the pair (V90), else
  // Symbiote's window with its name, as the bar had it.
  const title =
    state.status === 'ready' ? (
      <DiffName graph={state.graph} review={state.branchReview} />
    ) : analyzing?.branchReview ? (
      <span className="review-of">
        Review of <strong>{analyzing.branchReview.branch}</strong>
      </span>
    ) : analyzedPair ? (
      <span className="revisions">{pairLabel(analyzedPair)}</span>
    ) : inView ? (
      'Review'
    ) : (
      'Symbiote'
    );
  const opening =
    analyzing && analyzing.loaded.pair ? analysisState(analyzing.loaded, analyzing.seen) : null;
  const content = (
    <div
      className={inView ? 'app' : 'app alone'}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* The page frame's head (V72, decision 511): what is reviewed the title, its facts the
          line, the way back and the page's toggles its actions, Files and Graph its end (V76c).
          With no shell (symbiote pr) it is the window's title bar, Symbiote's S its icon (N1d). */}
      <PageHead
        className="bar"
        icon={inView ? <ReviewIcon /> : <SymbioteMark />}
        title={title}
        line={
          analyzing && analyzedPair ? (
            <HeadFacts
              review={analyzing.branchReview}
              revisions={analyzing.branchReview ? pairLabel(analyzedPair) : undefined}
              files={files}
            />
          ) : state.status === 'ready' ? (
            // The commits compared, unless they are the title.
            <HeadFacts
              review={state.branchReview}
              revisions={
                (state.branchReview ?? state.graph.changeRequest)
                  ? revisionsLabel(state.graph)
                  : undefined
              }
              files={files}
              graph={state.graph}
            />
          ) : undefined
        }
        actions={
          <>
            {opening && (
              <StatusLabel tone={opening.tone} className="analysis-state">
                {opening.words}
              </StatusLabel>
            )}
            {state.status === 'ready' && <FindingPills graph={state.graph} />}
            {analyzing && inView && <BackLink />}
            {state.status === 'ready' && state.commits && <BackLink />}
            {state.status === 'ready' && page === 'files' && (
              <Help label="This page's keys">
                <FilesKeys review={Boolean(forge)} canOpen={state.open} />
                <p>
                  Click a file for its changes
                  {forge ? ', a line of them to comment on it' : ''}; folded lines open on a click.
                </p>
              </Help>
            )}
            {state.status === 'ready' && page === 'graph' && (
              <>
                <Help label="This page's keys">
                  <DiffKeys
                    grouped={changes.some((file) => file.project)}
                    review={Boolean(forge)}
                    canOpen={state.open}
                    files
                  />
                  <p>Click a symbol for its details, a group to show its symbols.</p>
                </Help>
              </>
            )}
          </>
        }
        end={
          // Files and Graph at the head's end (V76c, decision 568): the actions before it change
          // with the page, and wrap under the title on their own; it stays put. The window's
          // buttons stay last.
          state.status === 'ready' || !inView || (analyzing && served) ? (
            <>
              {(state.status === 'ready' || (analyzing && served)) && (
                <PageSwitch page={page} onPage={showPage} building={!!analyzing} />
              )}
              {!inView && <WindowButtons />}
            </>
          ) : undefined
        }
      />
      {analyzing && analyzedPair && page === 'files' ? (
        <main className={`files-main${resizing ? ' resizing' : ''}`} style={widthStyle}>
          <FilesPage
            graph={undefined}
            head={analyzedPair.head}
            files={files}
            open={openFile}
            onOpenFile={openTheFile}
            served={served}
            canOpen={false}
            tab="files"
            onTab={setFilesTab}
            onOpenDraft={openDraft}
            focus={null}
            handle={sidebarHandle}
          />
        </main>
      ) : state.status === 'ready' && page === 'files' ? (
        <main className={`files-main${resizing ? ' resizing' : ''}`} style={widthStyle}>
          <FilesPage
            graph={state.graph}
            head={state.graph.revisions.head.sha ?? state.graph.revisions.head.ref}
            files={files}
            open={openFile}
            onOpenFile={openTheFile}
            served={served}
            canOpen={state.open}
            tab={reviewProps ? filesTab : 'files'}
            onTab={setFilesTab}
            review={reviewProps}
            comments={
              reviewProps
                ? {
                    drafts: draft.drafts,
                    unchanged: forge === 'local',
                    onAdd: addLineDraft,
                    onRemove: removeDraft,
                  }
                : undefined
            }
            onOpenDraft={openDraft}
            focus={fileFocus}
            handle={sidebarHandle}
          />
        </main>
      ) : (
        <main className={`canvas${resizing ? ' resizing' : ''}`} style={widthStyle}>
          {state.status === 'loading' && <p className="hint">Loading graph…</p>}
          {state.status === 'empty' && (
            <DropZone error={state.error} onFile={(file) => void load(file)} />
          )}
          {state.status === 'analyzing' && (
            <DiffProgress
              loaded={state.loaded}
              seen={state.seen}
              review={state.branchReview}
              files={files}
              onRetry={retry}
              onReadFiles={(path) => {
                if (path) openTheFile(path);
                showPage('files');
              }}
            />
          )}
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
                review={reviewProps}
                onOpenDraft={openDraft}
              />
              {sidebarHandle}
              {/* The canvas a card (V61), its legend at its foot since V72: the cards of the two
                  pages start and end at the same places. */}
              <div className="canvas-card">
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
                {layout && (
                  <Legend frames={layout.nodes[0]?.type === 'project'}>
                    {/* The view's toggles at the legend's end (V90, decision 838). */}
                    {state.graph.since && (
                      <label
                        className="toggle"
                        {...tip('Leave out symbols changed the same way as in the earlier version')}
                      >
                        <input
                          type="checkbox"
                          checked={sinceOnly}
                          onChange={(e) => setSinceOnly(e.target.checked)}
                        />
                        Only changes since {state.graph.since.sha.slice(0, 7)}
                      </label>
                    )}
                    <label
                      className="toggle"
                      {...tip('Show only the selected symbol and its neighbours', { keys: 'f' })}
                    >
                      <input
                        type="checkbox"
                        checked={focus}
                        onChange={(e) => setFocus(e.target.checked)}
                      />
                      Focus
                    </label>
                    <label className="toggle" {...tip('Show unchanged neighbours and packages')}>
                      <input
                        type="checkbox"
                        checked={context}
                        onChange={(e) => setContext(e.target.checked)}
                      />
                      Context
                    </label>
                    <label className="toggle" {...tip('Show the uses of types')}>
                      <input
                        type="checkbox"
                        checked={typeReferences}
                        onChange={(e) => setTypeReferences(e.target.checked)}
                      />
                      Type references
                    </label>
                  </Legend>
                )}
              </div>
              {selected && (
                <Resizer
                  gutter
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
      )}
    </div>
  );
  // Only a diff: the shell's own pages are drawn by Shell, and while loading it is not known yet.
  const diff = state.status === 'ready' || state.status === 'analyzing';
  return inView && diff ? <DiffShell repo={inView.repo}>{content}</DiffShell> : content;
}

/**
 * The diff's two pages (V60, decision 431): Files and Graph, `g` between them; while it is
 * analyzed (`building`, V90) Graph is its steps, a spinner beside its name.
 */
function PageSwitch({
  page,
  onPage,
  building = false,
}: {
  page: DiffView;
  onPage: (page: DiffView) => void;
  building?: boolean;
}) {
  const views: [DiffView, string, string][] = [
    ['files', 'Files', 'The changed files and their diffs'],
    ['graph', 'Graph', 'The changed symbols and the calls between them'],
  ];
  return (
    <div className="scopes page-switch" role="tablist" aria-label="Page">
      {views.map(([view, name, words]) => (
        <button
          key={view}
          type="button"
          role="tab"
          aria-selected={page === view}
          className={`scope${page === view ? ' active' : ''}`}
          {...tip(words, { keys: 'g' })}
          onClick={() => onPage(view)}
        >
          {building && view === 'graph' && <RunningIcon />}
          {name}
        </button>
      ))}
    </div>
  );
}

/**
 * What a diff's page reviews, its head's title (V72): "Review of wip" (V15), else its pull or merge
 * request, else its revisions — the window's title without "Symbiote" (`diffName`).
 */
function DiffName({ graph, review }: { graph: Graph; review: BranchReviewInfo | undefined }) {
  const request = graph.changeRequest;
  if (request) {
    return (
      <a className="request" href={request.url} target="_blank" rel="noreferrer">
        {diffName(graph)}
        {request.draft && <span className="chip">draft</span>}
        {request.state !== 'open' && <span className="chip">{request.state}</span>}
      </a>
    );
  }
  if (review) {
    return (
      <span className="review-of" {...tip(review.note)}>
        Review of <strong>{review.branch}</strong>
      </span>
    );
  }
  return <span className="revisions">{diffName(graph)}</span>;
}

/**
 * The head's line (V90, decision 839): the workspace this branch is (a link to it, V18b), the
 * branch it goes into, how it stands against the last review (V15), the commits compared, and the
 * change in git's files and lines (else its symbols, for a graph with no server).
 */
function HeadFacts({
  review,
  revisions,
  files,
  graph,
}: {
  review: BranchReviewInfo | undefined;
  revisions: string | undefined;
  files: readonly ReviewFile[];
  graph?: Graph;
}) {
  const workspace = useWorkspaces().list?.workspaces.find((f) => f.branch === review?.branch);
  const lines = files.some((f) => f.added !== undefined);
  const parts: [string, ReactNode][] = [];
  if (workspace && review) {
    parts.push([
      'workspace',
      <a
        className="review-workspace"
        href={workspaceHref(review.branch)}
        aria-label={`Workspace: ${workspaceName(workspace)}`}
        {...tip(briefTip(workspace.brief))}
      >
        {workspaceName(workspace)}
      </a>,
    ]);
  }
  if (review?.into) parts.push(['into', <span>into {review.into}</span>]);
  if (review)
    parts.push(['since', <span className="review-after">{reviewSince(review.since)}</span>]);
  if (revisions) parts.push(['revisions', <span className="revisions">{revisions}</span>]);
  const count = graph?.stats.filesChanged ?? files.length;
  if (count > 0 || graph) {
    parts.push([
      'change',
      <span className="summary">
        <span className="summary-files">
          {count} file{count === 1 ? '' : 's'}
        </span>
        {lines ? (
          <FileTotals files={files} />
        ) : (
          graph && (
            <>
              <span className="chip-added">+{graph.stats.symbols.added}</span>
              <span className="chip-removed">−{graph.stats.symbols.removed}</span>
              <span className="chip-modified">~{graph.stats.symbols.modified}</span>
            </>
          )
        )}
        {graph?.since && <SinceChip graph={graph} />}
      </span>,
    ]);
  }
  return (
    <span className="diff-facts">
      {parts.map(([key, part], i) => (
        <Fragment key={key}>
          {i > 0 && (
            <span className="facts-sep" aria-hidden="true">
              ·
            </span>
          )}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** The change's findings in the head (V90): an error and a warning pill, each its icon and word. */
function FindingPills({ graph }: { graph: Graph }) {
  const severity = (s: string) => graph.findings.filter((f) => f.severity === s).length;
  const errors = severity('error');
  const warnings = severity('warning');
  return (
    <>
      {errors > 0 && (
        <StatusLabel tone="error" className="finding-pill pill-error">
          {plural(errors, 'error')}
        </StatusLabel>
      )}
      {warnings > 0 && (
        <StatusLabel tone="warning" className="finding-pill pill-warning">
          {plural(warnings, 'warning')}
        </StatusLabel>
      )}
    </>
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
      {...tip(
        since.dropped.length
          ? `No longer changed\n${since.dropped.join(', ')}`
          : `Compared with ${since.ref}`,
      )}
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

/**
 * The canvas's foot (V90): the marks for a change's kinds, the edges, the frames' parts when
 * drawn; the view's toggles (`children`) at its end. `frames`: the canvas draws projects' frames.
 */
function Legend({ frames, children }: { frames: boolean; children: ReactNode }) {
  return (
    <footer className="legend">
      {(
        [
          ['added', '+'],
          ['removed', '−'],
          ['modified', '~'],
          ['moved', null],
        ] as const
      ).map(([kind, glyph]) => (
        <span key={kind} className={`legend-item tone-${kind}`}>
          <span className={`symbol-mark mark-${kind}`} aria-hidden="true">
            {glyph ?? <ForwardIcon />}
          </span>
          {kind}
        </span>
      ))}
      <span className="legend-item legend-context">unchanged</span>
      <span className="legend-edge edge-head">added call</span>
      <span className="legend-edge edge-base">removed call</span>
      {frames && <span className="legend-edge edge-cross">call between projects</span>}
      <span className="legend-item legend-summary">many neighbours, grouped</span>
      {frames && <span className="legend-item legend-project">project (app or library)</span>}
      <span className="legend-toggles">{children}</span>
    </footer>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
