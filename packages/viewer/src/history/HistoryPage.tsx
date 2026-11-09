import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  Commit,
  HistoryPage,
  HistoryRefs,
  HistoryScope,
  HistoryShape,
  PullMode,
  RepoStatus,
} from '@symbiote/core';
import {
  fetchBranches,
  fetchJson,
  fetchRows,
  fetchRowsOf,
  fetchShape,
  StaleHistory,
} from './api.js';
import { BranchesPanel } from './BranchesPanel.js';
import { CommitRow } from './CommitRow.js';
import { CompareBar } from './CompareBar.js';
import { useBranchReviews } from './useBranchReviews.js';
import { fetchRemotes, pull, push } from './git-api.js';
import { useDetailsPlace, headLine } from './details.js';
import { CommitDetails } from './CommitDetails.js';
import { ChangesDetails } from './ChangesDetails.js';
import { GitFile } from './GitFile.js';
import { FindBox } from './FindBox.js';
import { SyncBar, type SyncRun } from './SyncBar.js';
import { workspaceChips, workspacesFirst } from '../workspaces/workspace-groups.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { BLOCK, blocksAround, parentRows, shortSha } from './commits.js';
import { GraphCell, ROW_HEIGHT } from './GraphCell.js';
import { Help } from '../ui/Help.js';
import { GitIcon } from '../ui/icons.js';
import { Resizer } from '../ui/Resizer.js';
import { PageHead } from '../ui/PageHead.js';
import { loadWidths, saveWidth } from '../ui/widths.js';
import { laneSpacing, layoutLanes } from './lanes.js';
import { GIT_PAGE } from '../shell/pages.js';
import { useShell, type Notice } from '../shell/shell-context.js';
import { tip } from '../ui/tip.js';
import { Loading } from '../ui/Loading.js';
import { WorkingRow, WORKING } from './WorkingRow.js';
import { GitMenus, useGitMenus } from './GitMenus.js';
import { useWorkingChanges } from './useWorkingChanges.js';
import { useShownFile } from './useShownFile.js';
import { useRowsInView } from './useRowsInView.js';
import { useCompare } from './useCompare.js';
import { useFindRows } from './useFindRows.js';
import { useRelist } from './useRelist.js';
import { useHistoryKeys } from './useHistoryKeys.js';

const scopeOfUrl = (): HistoryScope =>
  new URLSearchParams(window.location.search).get('scope') === 'current' ? 'current' : 'all';

/** `?branch=<name>` (V18b: a workspace's branch): its tip, once listed. */
const branchOfUrl = (): string | null => new URLSearchParams(window.location.search).get('branch');

/**
 * Git (V66; History before it): the repository's history as a graph (V10), every branch or the
 * current one ("This branch", `?scope=current`). A click selects a row, whose details show in a
 * pane (V66b); the checkout's uncommitted changes are a row above the commits, staged and
 * committed in the pane (V66c). In compare mode (V13: its toggle, or x) a click (or x) picks one
 * end, another the other end; the older is the base. Compare (Enter) opens the diff; one picked
 * is compared with its parent. A row's menu (right-click, "⋯" or c) checks out its branches,
 * tags or the commit (V11) and makes a branch or a tag there (V66d); a branch's in the panel
 * reviews, renames or deletes it. The row's menu reads no branch review: it waited 1.5 s for them
 * with 113 reviewed branches (fix/git-right-click-on-commit). The head fetches, pulls and pushes
 * (V66e) and finds commits (V66f). A file clicked in the pane shows in the rows' place (V70).
 */
export function HistoryPage() {
  const [scope, setScope] = useState(scopeOfUrl);
  // Listing anew (after a checkout, or a change made elsewhere) starts a new generation.
  const [generation, setGeneration] = useState(0);
  // What a checkout or a start says goes to the shell's status bar (V29a).
  const shell = useShell();
  // Kept across generations; the picks are not.
  const [comparing, setComparing] = useState(false);
  // The branches panel's filter and folders flipped (V10b).
  const [filter, setFilter] = useState('');
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (key: string) =>
      setToggled((keys) => {
        const next = new Set(keys);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  // A branch to go to once every branch is listed: "This branch" did not list its tip.
  const [goTo, setGoTo] = useState<string | null>(branchOfUrl);
  // The search's words and the details pane, kept across listings (V66).
  const [query, setQuery] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsWidth, setDetailsWidth] = useState(() => loadWidths().details);
  const choose = useCallback((next: HistoryScope) => {
    window.history.replaceState(null, '', next === 'all' ? GIT_PAGE : '?scope=current');
    setScope(next);
  }, []);
  const goElsewhere = useCallback(
    (name: string) => {
      setGoTo(name);
      choose('all');
    },
    [choose],
  );
  const arrived = useCallback(() => setGoTo(null), []);
  const relist = useCallback(
    (next: Notice | null, branch?: string) => {
      if (next) shell?.notify(next);
      // A new branch (a workspace's): its tip once listed.
      if (branch) setGoTo(branch);
      setGeneration((g) => g + 1);
    },
    [shell],
  );
  // A new scope or generation starts afresh: its own rows, lanes and picks. What moves unasked
  // is listed in place instead (decision 634).
  return (
    <History
      key={`${scope}:${generation}`}
      scope={scope}
      onScope={choose}
      onRelist={relist}
      comparing={comparing}
      onComparing={setComparing}
      panel={{ filter, onFilter: setFilter, toggled, onToggle: toggle }}
      goTo={goTo}
      onGoElsewhere={goElsewhere}
      onArrived={arrived}
      find={{ query, onQuery: setQuery }}
      details={{
        open: detailsOpen,
        onOpen: setDetailsOpen,
        width: detailsWidth,
        onWidth: (width) => {
          setDetailsWidth(width ?? undefined);
          saveWidth('details', width);
        },
      }}
    />
  );
}

function History({
  scope,
  onScope,
  onRelist,
  comparing,
  onComparing,
  panel,
  goTo,
  onGoElsewhere,
  onArrived,
  find,
  details: pane,
}: {
  scope: HistoryScope;
  onScope: (scope: HistoryScope) => void;
  /**
   * Lists afresh after the person's own change, saying `notice` in the status bar; with `branch`,
   * the cursor goes to its tip.
   */
  onRelist: (notice: Notice | null, branch?: string) => void;
  comparing: boolean;
  onComparing: (comparing: boolean) => void;
  /** The branches panel's filter and folders, kept by the page across listings. */
  panel: {
    filter: string;
    onFilter: (filter: string) => void;
    toggled: ReadonlySet<string>;
    onToggle: (key: string) => void;
  };
  /** A branch whose tip to go to once listed (from "This branch", `?branch=`, a new workspace). */
  goTo: string | null;
  /** A branch this scope does not list: list every branch, then go to it. */
  onGoElsewhere: (name: string) => void;
  onArrived: () => void;
  /** The search's words (V66f), kept by the page across listings. */
  find: { query: string; onQuery: (query: string) => void };
  /** The details pane (V66b): shown or folded (`d`), and its width on the right. */
  details: {
    open: boolean;
    onOpen: (open: boolean) => void;
    width: number | undefined;
    onWidth: (width: number | null) => void;
  };
}) {
  const [first, setFirst] = useState<HistoryPage | null>(null);
  const [shape, setShape] = useState<HistoryShape | null>(null);
  // The branches with their tips' rows (V10b); the panel over the rows under 900 px.
  const [refs, setRefs] = useState<HistoryRefs | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  // A row gone to from the panel flashes.
  const [flash, setFlash] = useState<number | null>(null);
  // Listing or a menu failed (under the title); a comparison failed (in the compare bar).
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  // Rows' details by row number, filled block by block; `loaded` re-renders when one arrives.
  const details = useRef(new Map<number, Commit>());
  const asked = useRef(new Set<number>());
  const [loaded, setLoaded] = useState(0);
  const [cursor, setCursor] = useState(0);
  const placed = useRef(false);
  // Branch reviews (V15): marks on badges, dots on commits added since.
  const marks = useBranchReviews();

  const { setChanges, sync, syncing, setSyncing, stashes, readChanges, working } =
    useWorkingChanges();
  const {
    openFile,
    setOpenFile,
    onWorking,
    shownHere,
    commitRead,
    changesRead,
    fileShown,
    fileOrder,
    shownStaged,
    loadShown,
    openShown,
    staging,
  } = useShownFile({ cursor, details, working, pane, setChanges });
  const [resizing, setResizing] = useState(false);
  const place = useDetailsPlace();

  // Listing anew in place (decision 634), defined once the rows are: what a stale answer calls.
  const relistRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const failed = useCallback((e: unknown) => {
    if (e instanceof StaleHistory) void relistRef.current();
    else setError(`Could not list commits: ${(e as Error).message}`);
  }, []);

  // The first rows at once, then the shape of the whole history.
  useEffect(() => {
    let live = true;
    fetchRows(scope, 0, BLOCK)
      .then((page) => {
        if (!live) return;
        page.commits.forEach((c, i) => details.current.set(i, c));
        asked.current.add(0);
        setFirst(page);
        fetchBranches(scope, page.version)
          .then((r) => live && setRefs(r))
          .catch((e: unknown) => {
            if (e instanceof StaleHistory) setStale(true);
            else setError(`Could not list the branches: ${(e as Error).message}`);
          });
        return fetchShape(scope, page.version).then((s) => live && setShape(s));
      })
      .catch(failed);
    return () => {
      live = false;
    };
  }, [scope, failed]);

  // A checkout or a commit made elsewhere (a terminal, an editor) shows when the page is back.
  useEffect(() => {
    if (!first) return;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      fetchJson<RepoStatus>('api/status')
        .then((status) => (status.version !== first.version ? relistRef.current() : readChanges()))
        .catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [first, readChanges]);

  const parents = useMemo(
    () => shape?.parents ?? (first ? parentRows(first.commits) : []),
    [shape, first],
  );
  const headRow = useMemo(() => {
    if (shape) return shape.head;
    const row = first?.commits.findIndex((c) => c.sha === first.head) ?? -1;
    return row < 0 ? null : row;
  }, [shape, first]);
  const lanes = useMemo(() => layoutLanes(parents, headRow), [parents, headRow]);
  const widest = useMemo(() => lanes.reduce((w, row) => Math.max(w, row.width), 1), [lanes]);
  const spacing = laneSpacing(widest);
  const graphWidth = Math.ceil(widest * spacing);
  const rows = lanes.length;

  const { view, scroller, list, measure, firstShown, lastShown, reveal } = useRowsInView({
    first,
    rows,
  });

  /** Loads a block of rows' details, unless asked for already. */
  const loadBlock = useCallback(
    (block: number) => {
      if (!first || asked.current.has(block)) return;
      asked.current.add(block);
      // Into this listing's rows: listed anew in place meanwhile, they are another's.
      const into = details.current;
      const wanted = asked.current;
      fetchRows(scope, block * BLOCK, Math.min(rows, (block + 1) * BLOCK), first.version)
        .then((page) => {
          page.commits.forEach((c, i) => into.set(page.from + i, c));
          setLoaded((n) => n + 1);
        })
        .catch((e: unknown) => {
          wanted.delete(block);
          failed(e);
        });
    },
    [first, rows, scope, failed],
  );

  // Details of the rows near the view, a block at a time.
  useEffect(() => {
    if (rows === 0) return;
    for (const block of blocksAround(firstShown, lastShown, rows)) loadBlock(block);
  }, [rows, firstShown, lastShown, loadBlock]);

  const jump = useCallback(
    (row: number) => {
      setCursor(row);
      reveal(row, true);
    },
    [reveal],
  );

  // The panel's branches once the whole history is laid out: a tip anywhere can be reached.
  const branches = shape ? refs : null;
  /** A branch from the panel: its tip's row, flashed; else every branch, then there. */
  const goToBranch = useCallback(
    ({ name, row }: { name: string; row: number | null }) => {
      setPanelOpen(false);
      if (row !== null) {
        jump(row);
        setFlash(row);
      } else if (scope === 'current') onGoElsewhere(name);
    },
    [jump, scope, onGoElsewhere],
  );
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [flash]);
  // Listed anew for a branch "This branch" did not hold: go there once it is.
  useEffect(() => {
    if (!goTo || !branches) return;
    onArrived();
    const tip = [...branches.branches, ...branches.remotes].find((b) => b.name === goTo);
    if (tip && tip.row !== null) goToBranch(tip);
  }, [goTo, branches, onArrived, goToBranch]);

  // The cursor starts on HEAD's row, once it is known.
  useLayoutEffect(() => {
    if (placed.current || headRow === null || !first) return;
    placed.current = true;
    setCursor(headRow);
    if ((headRow + 1) * ROW_HEIGHT > view.height) reveal(headRow, true);
  }, [headRow, view.height, reveal, first]);

  // Starting a workspace (V18) at a row's commit: the shell's page (V30a).
  const shell = useShell();
  const openWorkspace = useCallback((sha?: string) => shell?.startWorkspace(sha), [shell]);

  // Each workspace's mark on its branch's badges, a link to it (V18b); its agent's commits listed
  // as they come, in place (decision 634).
  const { list: workspaces, reviews: workspaceReviews } = useWorkspaces();
  const chips = useMemo(
    () => workspaceChips(workspaces?.workspaces ?? [], workspaceReviews, refs?.remotes ?? []),
    [workspaces, workspaceReviews, refs],
  );
  // The workspaces that need the person, first in the branches panel (V23).
  const firstBranches = useMemo(
    () => workspacesFirst(workspaces?.workspaces ?? [], workspaceReviews),
    [workspaces, workspaceReviews],
  );
  useEffect(() => {
    if (!refs || !workspaces) return;
    const moved = workspaces.workspaces.some((f) => {
      const listed = refs.branches.find((b) => b.name === f.branch);
      return f.tip !== null && listed !== undefined && listed.sha !== f.tip;
    });
    if (moved) void relistRef.current();
  }, [workspaces, refs]);

  // The row's, a branch's and a stash's menus, and the git writes they ask (V11, V66d; decisions
  // 636–645).
  const menus = useGitMenus({
    details,
    cursor,
    setCursor,
    setError,
    first,
    refs,
    shell,
    openWorkspace,
    workspaces,
    goToBranch,
    onRelist,
    readChanges,
    relistRef,
  });
  const {
    menu,
    confirm,
    refAction,
    branchMenu,
    stashMenu,
    question,
    setQuestion,
    setBranchMenu,
    setStashMenu,
    openMenu,
    checkoutBranch,
    answered,
  } = menus;

  /** Fetch, pull or push (V66e): the status bar says how it ended; the page lists again. */
  const runSync = useCallback(
    (run: SyncRun, mode: PullMode = 'ff-only') => {
      setSyncing(run);
      const said =
        run === 'fetch'
          ? fetchRemotes().then(() => ({ text: 'Fetched every remote' }))
          : run === 'pull'
            ? pull(mode).then(({ stopped }) =>
                stopped ? { text: 'Pulled, with conflicts', warning: stopped } : { text: 'Pulled' },
              )
            : push().then(({ upstream, set }) => ({
                text: set ? `Pushed to ${upstream}, now its upstream` : `Pushed to ${upstream}`,
              }));
      said.then(
        (notice) => {
          // A pull moves the branch checked out: afresh, on HEAD. Fetch and push move only
          // remote branches: in place (decision 634).
          if (run === 'pull') return onRelist(notice);
          shell?.notify(notice);
          void relistRef.current().finally(() => setSyncing(null));
        },
        (e: unknown) => {
          setSyncing(null);
          shell?.notify({ text: `Could not ${run}`, warning: (e as Error).message, error: true });
          readChanges();
        },
      );
    },
    [onRelist, shell, readChanges],
  );

  const {
    picks,
    setPicks,
    swapped,
    setSwapped,
    starting,
    compareError,
    compare,
    current,
    forkRow,
    pickRow,
    stopComparing,
  } = useCompare({ parents, headRow, shape, loaded, details, loadBlock, onComparing });

  // The search (V66f): asked once typing stops, the cursor on the first row found from it.
  const cursorAt = useRef(cursor);
  cursorAt.current = cursor;
  const { query, matches, matched, step, findRef } = useFindRows({
    find,
    first,
    scope,
    cursor,
    cursorAt,
    jump,
    relistRef,
    setError,
  });
  const { latest } = useRelist({
    scope,
    readChanges,
    first,
    headRow,
    picks,
    openFile,
    cursorAt,
    scroller,
    list,
    details,
    asked,
    setFirst,
    setShape,
    setRefs,
    setCursor,
    setPicks,
    setFlash,
    setLoaded,
    setStale,
    setError,
    relistRef,
    reveal,
    measure,
  });

  /** A commit of a file's history or blame (decision 643): its row, the file open there. */
  const goToFile = useCallback(
    ({ sha, path }: { sha: string; path: string }) => {
      const version = latest.current.first?.version;
      if (!version) return;
      fetchRowsOf(scope, version, [sha])
        .then(([row]) => {
          if (row === null || row === undefined)
            return shell?.notify({
              text: `${shortSha(sha)} is not listed here`,
              warning:
                scope === 'current'
                  ? 'Show every branch to go to it'
                  : 'No branch listed holds it (a hidden one may)',
            });
          jump(row);
          setOpenFile({ sha, path });
        })
        .catch((e: unknown) => {
          if (e instanceof StaleHistory) void relistRef.current();
          else setError(`Could not find ${shortSha(sha)}: ${(e as Error).message}`);
        });
    },
    [scope, shell, jump],
  );

  // The uncommitted row gone (committed, or changed elsewhere): the cursor back on HEAD.
  useEffect(() => {
    if (cursor === WORKING && !working) setCursor(headRow ?? 0);
  }, [cursor, working, headRow]);

  useHistoryKeys({
    menu,
    confirm,
    refAction,
    branchMenu,
    stashMenu,
    question,
    fileShown,
    shownHere,
    setOpenFile,
    fileOrder,
    working,
    rows,
    cursor,
    setCursor,
    reveal,
    pane,
    findRef,
    onComparing,
    pickRow,
    list,
    openMenu,
    setPanelOpen,
    filterRef,
    panelOpen,
    comparing,
    stopComparing,
    current,
    starting,
    compare,
    openWorkspace,
  });

  if (stale) {
    return (
      <p className="hint">
        The branches moved since this page listed them.{' '}
        <button type="button" className="link" onClick={() => onRelist(null)}>
          List them again
        </button>
      </p>
    );
  }
  if (!first) {
    return error ? (
      <p className="hint error">{error}</p>
    ) : (
      <Loading className="hint">Listing commits…</Loading>
    );
  }
  const now = Date.now();
  const picked = new Set(picks.map((p) => p.sha));
  const shown: number[] = [];
  for (let row = firstShown; row <= lastShown; row++) shown.push(row);
  const selected = cursor === WORKING ? undefined : details.current.get(cursor);
  const below = place === 'below';
  return (
    <div className={comparing ? 'commits comparing' : 'commits'}>
      {/* The page's head (V66; the page frame's since V72): its icon, its name and where the
          branch is against its upstream; the search and the remotes at its right. */}
      <PageHead
        className="git-bar"
        icon={<GitIcon />}
        title="Git"
        line={headLine(first.branch, sync)}
        actions={
          <>
            <FindBox
              inputRef={findRef}
              query={find.query}
              matches={query ? matches : null}
              at={matches ? matches.indexOf(cursor) : -1}
              onQuery={find.onQuery}
              onStep={step}
            />
            <SyncBar sync={sync} running={syncing} onRun={runSync} />
            <button
              type="button"
              className="compare-mode details-toggle"
              aria-pressed={pane.open}
              {...tip(pane.open ? 'Fold the details' : 'Show the details', { keys: 'd' })}
              onClick={() => pane.onOpen(!pane.open)}
            >
              Details
              <kbd aria-hidden="true">d</kbd>
            </button>
          </>
        }
      />
      <div className="commits-body">
        <BranchesPanel
          refs={branches}
          scope={scope}
          current={first.branch}
          marks={marks.marks}
          agents={chips}
          first={firstBranches}
          open={panelOpen}
          filter={panel.filter}
          onFilter={panel.onFilter}
          toggled={panel.toggled}
          onToggle={panel.onToggle}
          filterRef={filterRef}
          onGo={goToBranch}
          onCheckout={checkoutBranch}
          onMenu={(entry, x, y) => setBranchMenu({ at: { x, y }, entry })}
          stashes={stashes}
          onStash={(stash, x, y) => setStashMenu({ at: { x, y }, stash })}
        />
        <div
          className={`commits-main${below ? ' below' : ''}${resizing ? ' resizing' : ''}`}
          style={
            pane.width ? ({ '--details-width': `${pane.width}px` } as CSSProperties) : undefined
          }
        >
          {/* The header above the box that scrolls (V66): the scrollbar runs beside the rows only. */}
          <div className="commits-card">
            <div className="card-head commits-title" inert={!!fileShown}>
              <button
                type="button"
                className="branches-toggle"
                aria-expanded={panelOpen}
                {...tip('Branches', { keys: '/' })}
                onClick={() => setPanelOpen((o) => !o)}
              >
                Branches
              </button>
              <span className="scopes" role="group" aria-label="Branches">
                <button
                  type="button"
                  className={scope === 'all' ? 'scope active' : 'scope'}
                  aria-pressed={scope === 'all'}
                  onClick={() => onScope('all')}
                >
                  All branches
                </button>
                <button
                  type="button"
                  className={scope === 'current' ? 'scope active' : 'scope'}
                  aria-pressed={scope === 'current'}
                  onClick={() => onScope('current')}
                >
                  This branch{first.branch ? ` (${first.branch})` : ''}
                </button>
              </span>
              {first.head && headRow !== null && (
                <button
                  type="button"
                  className="head-chip"
                  {...tip('Go to HEAD')}
                  onClick={() => jump(headRow)}
                >
                  HEAD → {first.branch ?? `${shortSha(first.head)} (detached)`}
                </button>
              )}
              <span className="commits-tail">
                <span className="commits-actions">
                  {/* The keys behind the "?" (V29b), and what compare mode asks (V37: beside the
                    toggle it wrapped the head onto two lines). */}
                  <Help label="Git's keys">
                    <span className="commits-help">
                      {comparing
                        ? 'Pick two to compare them, or one against its parent · x picks, Enter compares, Esc leaves'
                        : 'j/k move · c checks out · x picks to compare · / finds a branch · f finds a commit · d shows or folds the details · a branch: double-click checks it out, right-click for more · a file shown: j/k its files, o its diff in VS Code, Esc back'}
                    </span>
                  </Help>
                  <button
                    type="button"
                    className="compare-mode"
                    aria-pressed={comparing}
                    {...tip(comparing ? 'Leave compare mode' : 'Pick commits to compare', {
                      keys: comparing ? 'Esc' : 'x',
                    })}
                    onClick={() => (comparing ? stopComparing() : onComparing(true))}
                  >
                    Compare mode
                    <kbd aria-hidden="true">{comparing ? 'Esc' : 'x'}</kbd>
                  </button>
                </span>
              </span>
            </div>
            {error && (
              <p className="commits-error error" role="alert">
                {error}
              </p>
            )}
            <div className="commits-scroll" ref={scroller} onScroll={measure} inert={!!fileShown}>
              {working && (
                <WorkingRow
                  changes={working}
                  spacing={spacing}
                  width={graphWidth}
                  joined={headRow === 0}
                  cursor={cursor === WORKING}
                  onClick={() => setCursor(WORKING)}
                />
              )}
              {rows === 0 ? (
                <p className="hint">No commits yet.</p>
              ) : (
                <ol
                  className="commit-list"
                  ref={list}
                  aria-label="Commits"
                  style={{ height: rows * ROW_HEIGHT }}
                >
                  {shown.map((row) => {
                    const lane = lanes[row];
                    const commit = details.current.get(row);
                    return (
                      <CommitRow
                        key={row}
                        row={row}
                        commit={commit}
                        now={now}
                        comparing={comparing}
                        picked={!!commit && picked.has(commit.sha)}
                        cursor={row === cursor}
                        flash={row === flash}
                        matched={matched.has(row)}
                        onClick={() => {
                          setCursor(row);
                          if (comparing) pickRow(row);
                        }}
                        onMenu={(x, y) => openMenu(row, x, y)}
                        branch={first.branch}
                        reviewed={marks.marks}
                        agents={chips}
                        {...(commit && marks.added.has(commit.sha)
                          ? { added: marks.added.get(commit.sha) }
                          : {})}
                        graph={
                          lane && (
                            <GraphCell
                              row={lane}
                              index={row}
                              spacing={spacing}
                              width={graphWidth}
                              merge={(parents[row]?.length ?? 0) > 1}
                              head={row === headRow}
                              picked={!!commit && picked.has(commit.sha)}
                              fork={row === forkRow}
                              onJump={jump}
                            />
                          )
                        }
                      />
                    );
                  })}
                </ol>
              )}
              {!shape && first.listed > 0 && (
                <Loading className="hint listing">Listing the rest…</Loading>
              )}
            </div>
            {fileShown && (
              <GitFile
                key={`${shownHere?.sha ?? 'working'}:${shownStaged}:${fileShown.path}`}
                file={fileShown}
                sha={shownHere?.sha ?? null}
                {...(staging ? { staging } : {})}
                onGo={goToFile}
                {...(onWorking ? { side: shownStaged ? 'staged' : 'not staged' } : {})}
                load={loadShown}
                onEditor={openShown}
                onClose={() => setOpenFile(null)}
              />
            )}
          </div>
          {pane.open && !below && (
            <Resizer
              gutter
              label="Resize the details"
              side="after"
              variable="--details-width"
              min={300}
              room={400}
              onResize={pane.onWidth}
              onDrag={setResizing}
            />
          )}
          {pane.open && (
            <aside
              className="git-details"
              aria-label={cursor === WORKING ? 'Uncommitted changes' : 'Commit details'}
            >
              {cursor === WORKING && working && changesRead ? (
                <ChangesDetails
                  changes={working}
                  read={changesRead}
                  open={shownHere}
                  onOpen={(file) => setOpenFile(file && { ...file, sha: null })}
                  onChanges={setChanges}
                  onCommitted={(sha, amend) =>
                    onRelist({ text: `${amend ? 'Amended' : 'Committed'} ${shortSha(sha)}` })
                  }
                  onAsk={setQuestion}
                  onDone={answered}
                />
              ) : selected && commitRead ? (
                <CommitDetails
                  key={selected.sha}
                  read={commitRead}
                  commit={selected}
                  parentRows={parents[cursor] ?? []}
                  starting={starting}
                  open={shownHere?.path ?? null}
                  onOpen={(path) => setOpenFile(path ? { sha: selected.sha, path } : null)}
                  onJump={jump}
                  onReview={(parent) => void compare({ base: parent, head: selected.sha })}
                />
              ) : (
                <p className="hint git-details-hint">Select a commit to see its details.</p>
              )}
            </aside>
          )}
        </div>
      </div>
      <GitMenus menus={menus} onRelist={onRelist} />
      {comparing && (
        <CompareBar
          current={current}
          swapped={swapped}
          defaultBranch={shape?.defaultBranch?.name ?? null}
          error={compareError}
          picked={picks.length > 0}
          starting={starting}
          onJump={jump}
          onSwap={() => setSwapped((s) => !s)}
          onClear={() => {
            setPicks([]);
            setSwapped(false);
          }}
          onCompare={(pair) => void compare(pair)}
        />
      )}
    </div>
  );
}
