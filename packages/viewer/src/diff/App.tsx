import { ReactFlowProvider } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import type { Graph, Severity } from '@symbiote/core';
import { BackLink, DiffProgress, analysisState, pairLabel } from './DiffProgress.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { useDiffGraph } from './useDiffGraph.js';
import { useReview } from './useReview.js';
import {
  diffTitle,
  diffView,
  revisionsLabel,
  withDiffView,
  type DiffView,
} from '../shell/pages.js';
import { DiffShell } from './DiffShell.js';
import { Shell } from '../shell/Shell.js';
import { DetailPanel } from './DetailPanel.js';
import { FilesKeys, FilesPage, useReviewFiles } from './FilesPage.js';
import { symbolAt, type Anchor, type Draft } from './comments.js';
import { anchorKey, symbolFocus, type FileFocus } from './file-diff.js';
import { decorate, onCanvas } from '../graph/flow.js';
import {
  changeList,
  filterChanges,
  foldFindings,
  layoutView,
  onlyProject,
  reviewStatus,
  withoutCollapsed,
} from './review.js';
import { Resizer } from '../ui/Resizer.js';
import { DiffKeys, Sidebar, type SidebarTab } from './Sidebar.js';
import { Help } from '../ui/Help.js';
import { PageHead } from '../ui/PageHead.js';
import { ReviewIcon, SymbioteMark } from '../ui/icons.js';
import { browserStore } from './store.js';
import { WindowButtons } from '../shell/TitleBar.js';
import { useLayout } from '../graph/useLayout.js';
import { loadWidths, saveWidth, withWidth, type Widths } from '../ui/widths.js';
import { Loading } from '../ui/Loading.js';
import { DiffName, FindingPills, HeadFacts, PageSwitch } from './DiffHead.js';
import { CanvasCard, DropZone } from './CanvasCard.js';
import { useDiffKeys } from './useDiffKeys.js';
import { useFirstView } from './useFirstView.js';
import { useTrail } from './useTrail.js';

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
  /** The sidebar tab picked; until then, the findings if any is listed (not folded, V100). */
  const [tab, setTab] = useState<SidebarTab | null>(null);
  /** A head's pill clicked (V100): the Findings tab shows the first finding of its severity. */
  const [findingAt, setFindingAt] = useState<{ severity: Severity } | null>(null);
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
  const [fileFocus, setFileFocus] = useState<FileFocus | null>(null);
  /**
   * The line last clicked or commented on Files (V104): `g` picks the symbol holding it, while its
   * file is shown.
   */
  const [fileLine, setFileLine] = useState<Anchor | null>(null);
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
    toggleViewed,
    addDraft,
    addLineDraft,
    editDraft,
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
    setFileLine(null);
    window.history.replaceState(window.history.state, '', withDiffView(window.location.href, next));
  }, []);
  /** The findings listed and the settled signature changes folded (V100, decisions 968–969). */
  const findings = useMemo(() => foldFindings(graph?.findings ?? [], graph?.projects), [graph]);
  // A pill, on either page: the Graph page's Findings tab at its severity.
  const showFindings = useCallback(
    (severity: Severity) => {
      setTab('findings');
      showPage('graph');
      setFindingAt({ severity });
    },
    [showPage],
  );
  const findingShown = useCallback(() => setFindingAt(null), []);
  // The Graph page's first view (V109, decision 986): with an error or a warning, its riskiest
  // finding's symbol, focused; F between it and the whole change, the choice kept.
  const framing = useFirstView({
    graph,
    page,
    shown: findings.shown,
    selected,
    setSelected,
    setFocus,
  });
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
  // A new graph starts with every big neighbourhood collapsed, and every project shown. One that
  // replaces another (a file dropped) starts its Files page at its first file; the first keeps the
  // file read while the change was analyzed, held by path below (V102).
  const shownGraph = useRef<Graph | undefined>(undefined);
  useEffect(() => {
    setExpanded(new Set());
    setProject(null);
    setCollapsed(new Set());
    if (shownGraph.current) setOpenFile(null);
    shownGraph.current = graph;
    setFileFocus(null);
    setFileLine(null);
  }, [graph]);
  // While the change is analyzed, the Files page's first file is held by path: the graph puts the
  // list in order of risk (V102), and the file read stays open.
  const firstFile = files[0]?.path;
  useEffect(() => {
    if (analyzing && page === 'files' && openFile === null && firstFile) setOpenFile(firstFile);
  }, [analyzing, page, openFile, firstFile]);
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
      setOpenFile(file.path);
      setFileFocus({ path: file.path, key: `${at.side}:${at.line}` });
    },
    [page, files, showPage],
  );
  /** Where the picked symbol's lines are on Files (V104): its file and its lines there. */
  const pickedLines = useMemo(() => {
    const node = selected === null ? undefined : graph?.nodes.find((n) => n.id === selected);
    return node ? symbolFocus(node, files) : null;
  }, [graph, selected, files]);
  /**
   * The other page, following the pick (V104, decision 977): Files at the picked symbol's first
   * changed row; Graph with the symbol holding the line last clicked on Files picked, while that
   * line's file is shown. Without either, the page as it was left.
   */
  const follow = useCallback(
    (next: DiffView) => {
      if (next !== page && next === 'files' && pickedLines) {
        setOpenFile(pickedLines.path);
        setFileFocus(pickedLines);
      } else if (next !== page && next === 'graph' && graph && fileLine) {
        const shown = files.find((file) => file.path === openFile) ?? files[0];
        const node =
          shown && anchorKey(shown, fileLine)
            ? symbolAt(graph, fileLine.side, fileLine.path, fileLine.line)
            : undefined;
        if (node) setSelected(node.id);
      }
      showPage(next);
    },
    [page, pickedLines, graph, fileLine, files, openFile, showPage],
  );
  const toggleCollapsed = useCallback((folder: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });
  }, []);

  const trail = useTrail(selected, setSelected);
  useDiffKeys({
    state,
    served,
    page,
    follow,
    files,
    setOpenFile,
    setFileFocus,
    forge,
    openFile,
    toggleViewed,
    setTab,
    walked,
    setSelected,
    selected,
    toggleReviewed,
    setFocus,
    setProject,
    changes,
    back: trail.previous === null ? null : trail.back,
  });

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

  // Layout once per view; selecting and marking only decorate it, so nothing moves. Focus on a
  // symbol narrows further than showing one project, type references included (V101).
  const focusOn = focus ? selected : null;
  const view = useMemo(
    () =>
      graph
        ? layoutView(graph, changes, { typeReferences, context, expanded, focusOn, project })
        : { typeReferences, context, expanded },
    [graph, changes, typeReferences, context, expanded, focusOn, project],
  );
  // Made in a worker: the last layout stays drawn until the one for this view arrives.
  const { layout, pending } = useLayout(graph, view);
  const flowNodes = useMemo(
    () =>
      layout ? decorate(layout.nodes, { reviewed, sinceOnly: onlySince, selected }) : undefined,
    [layout, reviewed, onlySince, selected],
  );
  /**
   * For the detail panel's marks: the symbols on the canvas (V101, decision 972). None while a
   * new view is laid out (Focus moving to the next pick): the old one would mark its neighbours.
   */
  const shownOnCanvas = useMemo(
    () => (layout && selected && !pending ? onCanvas(layout, selected) : undefined),
    [layout, selected, pending],
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
          onSending: () => store?.cancel('drafts'),
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
            {state.status === 'ready' && (
              <FindingPills shown={findings.shown} onPick={showFindings} />
            )}
            {analyzing && inView && <BackLink />}
            {state.status === 'ready' && state.commits && <BackLink />}
            {state.status === 'ready' && page === 'files' && (
              <Help label="This page's keys">
                <FilesKeys review={Boolean(forge)} canOpen={state.open} />
                <p>
                  Click a file for its changes
                  {forge ? ', a line of them to comment on it' : ''}; folded lines open on a click.{' '}
                  <kbd>g</kbd> picks the symbol of the line clicked on the graph.
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
                  <p>
                    Click a symbol for its details, a group to show its symbols. With one picked,{' '}
                    <kbd>g</kbd> shows its lines on Files.
                  </p>
                  <p>
                    A change with an error or a warning opens on the worst one. <kbd>F</kbd> shows
                    the whole change, and the worst again; the page opens next time on the one you
                    left.
                  </p>
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
                <PageSwitch page={page} onPage={follow} building={!!analyzing} />
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
            marks={marks}
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
            marks={marks}
            onToggleViewed={reviewProps ? toggleViewed : undefined}
            review={reviewProps}
            comments={
              reviewProps
                ? {
                    drafts: draft.drafts,
                    unchanged: forge === 'local',
                    onAdd: addLineDraft,
                    onEdit: editDraft,
                    onRemove: removeDraft,
                  }
                : undefined
            }
            onOpenDraft={openDraft}
            focus={fileFocus}
            line={fileLine}
            onLine={setFileLine}
            handle={sidebarHandle}
          />
        </main>
      ) : (
        <main className={`canvas${resizing ? ' resizing' : ''}`} style={widthStyle}>
          {state.status === 'loading' && <Loading className="hint">Loading graph…</Loading>}
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
                findings={findings}
                findingAt={findingAt}
                onFindingShown={findingShown}
                changes={changes}
                shown={shown}
                search={search}
                onSearch={setSearch}
                tab={tab ?? (findings.shown.length > 0 ? 'findings' : 'changes')}
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
              <CanvasCard
                state={state}
                layout={layout}
                flowNodes={flowNodes}
                pending={pending}
                selected={selected}
                setSelected={setSelected}
                focus={focus}
                setFocus={setFocus}
                project={project}
                resizing={resizing}
                toggleSummary={toggleSummary}
                reveal={reveal}
                framing={framing}
                sinceOnly={sinceOnly}
                setSinceOnly={setSinceOnly}
                context={context}
                setContext={setContext}
                typeReferences={typeReferences}
                setTypeReferences={setTypeReferences}
              />
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
                  onSelect={trail.followLink}
                  {...(trail.previous !== null
                    ? { back: { to: trail.previous, go: trail.back } }
                    : {})}
                  onClose={() => setSelected(null)}
                  // Its lines on Files (V104, decision 978): where its file's diff is served.
                  {...(pickedLines && served ? { onShowLines: () => follow('files') } : {})}
                  // Focus draws every neighbour, but unchanged ones while Context is off.
                  canvas={shownOnCanvas && { shown: shownOnCanvas, focusShows: !focus && context }}
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
