import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Commit, HistoryScope } from '@symbiote/core';
import { fetchRowsOf, StaleHistory } from './api.js';
import { BranchesPanel } from './BranchesPanel.js';
import { CompareBar } from './CompareBar.js';
import { useBranchReviews } from './useBranchReviews.js';
import { useDetailsPlace } from './details.js';
import { GitFile } from './GitFile.js';
import { blocksAround, shortSha } from './commits.js';
import { ROW_HEIGHT } from './GraphCell.js';
import { Resizer } from '../ui/Resizer.js';
import { loadWidths, saveWidth } from '../ui/widths.js';
import { GIT_PAGE } from '../shell/pages.js';
import { useShell, type Notice } from '../shell/shell-context.js';
import { Loading } from '../ui/Loading.js';
import { WORKING } from './WorkingRow.js';
import { GitMenus, useGitMenus } from './GitMenus.js';
import { useWorkingChanges } from './useWorkingChanges.js';
import { useShownFile } from './useShownFile.js';
import { useRowsInView } from './useRowsInView.js';
import { useCompare } from './useCompare.js';
import { useFindRows } from './useFindRows.js';
import { useRelist } from './useRelist.js';
import { useHistoryKeys } from './useHistoryKeys.js';
import { useHistoryRows } from './useHistoryRows.js';
import { useBranchesPanel } from './useBranchesPanel.js';
import { useWorkspaceChips } from './useWorkspaceChips.js';
import { useSyncRun } from './useSyncRun.js';
import { CommitsHead } from './CommitsHead.js';
import { CommitList } from './CommitList.js';
import { GitDetailsPane } from './GitDetailsPane.js';
import { GitHead } from './GitHead.js';

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
  // Listing or a menu failed (under the title); a comparison failed (in the compare bar).
  const [error, setError] = useState<string | null>(null);
  // Rows' details by row number, filled block by block; `loaded` re-renders when one arrives.
  const details = useRef(new Map<number, Commit>());
  const asked = useRef(new Set<number>());
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

  const {
    first,
    setFirst,
    shape,
    setShape,
    refs,
    setRefs,
    stale,
    setStale,
    loaded,
    setLoaded,
    relistRef,
    parents,
    headRow,
    lanes,
    spacing,
    graphWidth,
    rows,
    loadBlock,
  } = useHistoryRows({ scope, details, asked, readChanges, setError });

  const { view, scroller, list, measure, firstShown, lastShown, reveal } = useRowsInView({
    first,
    rows,
  });

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

  const { panelOpen, setPanelOpen, filterRef, flash, setFlash, branches, goToBranch } =
    useBranchesPanel({ shape, refs, jump, scope, onGoElsewhere, goTo, onArrived });

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

  const { workspaces, chips, firstBranches } = useWorkspaceChips({ refs, relistRef });

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

  const runSync = useSyncRun({ setSyncing, onRelist, shell, relistRef, readChanges });

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
  const below = place === 'below';
  return (
    <div className={comparing ? 'commits comparing' : 'commits'}>
      <GitHead
        first={first}
        sync={sync}
        findRef={findRef}
        find={find}
        query={query}
        matches={matches}
        cursor={cursor}
        step={step}
        syncing={syncing}
        runSync={runSync}
        pane={pane}
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
            <CommitsHead
              fileShown={fileShown}
              panelOpen={panelOpen}
              setPanelOpen={setPanelOpen}
              scope={scope}
              onScope={onScope}
              first={first}
              headRow={headRow}
              jump={jump}
              comparing={comparing}
              stopComparing={stopComparing}
              onComparing={onComparing}
            />
            {error && (
              <p className="commits-error error" role="alert">
                {error}
              </p>
            )}
            <CommitList
              scroller={scroller}
              measure={measure}
              fileShown={fileShown}
              working={working}
              spacing={spacing}
              graphWidth={graphWidth}
              headRow={headRow}
              cursor={cursor}
              setCursor={setCursor}
              rows={rows}
              list={list}
              firstShown={firstShown}
              lastShown={lastShown}
              picks={picks}
              lanes={lanes}
              details={details}
              comparing={comparing}
              flash={flash}
              matched={matched}
              pickRow={pickRow}
              openMenu={openMenu}
              first={first}
              marks={marks}
              chips={chips}
              parents={parents}
              forkRow={forkRow}
              jump={jump}
              shape={shape}
            />
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
            <GitDetailsPane
              cursor={cursor}
              details={details}
              working={working}
              changesRead={changesRead}
              shownHere={shownHere}
              setOpenFile={setOpenFile}
              setChanges={setChanges}
              onRelist={onRelist}
              setQuestion={setQuestion}
              answered={answered}
              commitRead={commitRead}
              parents={parents}
              starting={starting}
              jump={jump}
              compare={compare}
            />
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
