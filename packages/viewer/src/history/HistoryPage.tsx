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
  RefList,
  RepoStatus,
  StashEntry,
  SyncState,
  WorkingChanges,
} from '@symbiote/core';
import {
  fetchBranches,
  fetchJson,
  fetchRows,
  fetchRowsOf,
  fetchShape,
  postCheckout,
  StaleHistory,
  startDiff,
  startReview,
} from './api.js';
import { BranchesPanel } from './BranchesPanel.js';
import { CommitRow } from './CommitRow.js';
import { CompareBar } from './CompareBar.js';
import { useBranchReviews } from './useBranchReviews.js';
import { branchChoice, checkedOut, checkoutChoices, type CheckoutChoice } from './checkout.js';
import {
  cherryPick,
  deleteRemoteBranch,
  fetchChangeFile,
  fetchChanges,
  fetchCommitFile,
  fetchLeaving,
  fetchRemotes,
  fetchStashes,
  fetchSync,
  findRows,
  hideBranch,
  merge,
  openDiff,
  pull,
  push,
  rebase,
  reset,
  revert,
  stageLines,
  unstash,
} from './git-api.js';
import type { Staging } from './GitDiff.js';
import { AskDialog, type After, type Ask } from './AskDialog.js';
import { stashWords, stoppedNotice } from './actions.js';
import {
  changesOrder,
  changesSummary,
  followShown,
  nextMatch,
  rowAfterListing,
  stepShown,
  syncWords,
  useDetailsPlace,
  type ShownFile,
} from './details.js';
import { CommitDetails, useCommitRead } from './CommitDetails.js';
import { ChangesDetails, useChangesRead } from './ChangesDetails.js';
import { GitFile, OPEN_FILE_ID } from './GitFile.js';
import { FindBox } from './FindBox.js';
import { SyncBar, type SyncRun } from './SyncBar.js';
import { RefDialog, type RefAction } from './RefDialog.js';
import type { PanelEntry } from './branches.js';
import { CheckoutDialog } from './CheckoutDialog.js';
import { workspaceChips, workspaceHref, workspacesFirst } from '../workspaces/workspaces.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { RowMenu, type RowMenuItem } from './RowMenu.js';
import {
  BLOCK,
  blocksAround,
  comparison,
  parentRows,
  pick,
  shortSha,
  type Pair,
  type Picked,
} from './commits.js';
import { GraphCell, ROW_HEIGHT } from './GraphCell.js';
import { Help } from '../ui/Help.js';
import { GitIcon } from '../ui/icons.js';
import { keyIsTaken } from '../ui/keys.js';
import { Resizer } from '../ui/Resizer.js';
import { PageHead } from '../ui/PageHead.js';
import { loadWidths, saveWidth } from '../ui/widths.js';
import { laneSpacing, layoutLanes } from './lanes.js';
import { GIT_PAGE } from '../shell/pages.js';
import { useShell, type Notice } from '../shell/shell-context.js';
import { tip } from '../ui/tip.js';

/** Rows drawn beyond the view, above and below. */
const OVERSCAN = 10;

const scopeOfUrl = (): HistoryScope =>
  new URLSearchParams(window.location.search).get('scope') === 'current' ? 'current' : 'all';

/** `?branch=<name>` (V18b: a workspace's branch): its tip, once listed. */
const branchOfUrl = (): string | null => new URLSearchParams(window.location.search).get('branch');

type BranchEntry = Extract<PanelEntry, { kind: 'branch' }>;

/** The uncommitted row's number (V66c): above the first commit's. */
const WORKING = -1;

/** How long the search waits for typing to stop. */
const FIND_MS = 250;

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
  const [compareError, setCompareError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  // Rows' details by row number, filled block by block; `loaded` re-renders when one arrives.
  const details = useRef(new Map<number, Commit>());
  const asked = useRef(new Set<number>());
  const [loaded, setLoaded] = useState(0);
  const [picks, setPicks] = useState<Picked[]>([]);
  // Diverged picks compared the other way round (V10c); picking again resets it.
  const [swapped, setSwapped] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState({ top: 0, height: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const placed = useRef(false);
  // A row's menu (check out, a branch or a tag there), then a checkout's confirmation (V11).
  const [menu, setMenu] = useState<{
    at: { x: number; y: number };
    /** The row's commit. */
    sha: string;
    /** The submenu shown at first: `c`'s (V14). */
    open?: 'checkout';
    checkout: CheckoutChoice[];
    status: RepoStatus;
  } | null>(null);
  const [confirm, setConfirm] = useState<{ choice: CheckoutChoice; status: RepoStatus } | null>(
    null,
  );
  const [checkingOut, setCheckingOut] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  // Branch reviews (V15): marks on badges, dots on commits added since.
  const marks = useBranchReviews();

  // The checkout's uncommitted changes (V66c) and the branch's upstream (V66e), read as the page
  // lists and again when it is back in view.
  const [changes, setChanges] = useState<WorkingChanges | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [syncing, setSyncing] = useState<SyncRun | null>(null);
  // The stashes (decision 639), in the branches panel.
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const readChanges = useCallback(() => {
    fetchChanges()
      .then(setChanges)
      .catch(() => {});
    fetchSync()
      .then(setSync)
      .catch(() => {});
    fetchStashes()
      .then(setStashes)
      .catch(() => {});
  }, []);
  useEffect(readChanges, [readChanges]);
  // The uncommitted row: files changed, or an operation in progress (decision 636: its Continue
  // and Abort are in the row's pane, even with every file committed).
  const working =
    changes !== null &&
    (changes.staged.length + changes.unstaged.length > 0 || changes.operation !== null)
      ? changes
      : null;
  // The file shown in the rows' place (V70): of a commit, by its SHA, or uncommitted (null); not
  // by its row, which a commit listed above it changes (decision 635). Closed when the cursor
  // goes to another commit.
  const [openFile, setOpenFile] = useState<(ShownFile & { sha: string | null }) | null>(null);
  const onWorking = cursor === WORKING;
  const commitSha = onWorking ? null : (details.current.get(cursor)?.sha ?? null);
  const cursorKey = onWorking ? 'working' : (commitSha ?? `row ${cursor}`);
  useEffect(() => {
    // A row not read yet: decided once it is (a file's history goes to a row and opens the file).
    if (!onWorking && commitSha === null) return;
    setOpenFile((open) => (open && open.sha === commitSha ? open : null));
    // Only the cursor's commit changing closes the file: `cursorKey` says it.
  }, [cursorKey]);
  const shownHere =
    openFile && (onWorking ? openFile.sha === null : openFile.sha === commitSha) ? openFile : null;
  // Read for the pane and the file shown; not while the pane is folded and nothing is shown.
  const commitRead = useCommitRead(pane.open || shownHere ? commitSha : null);
  const workingHere = onWorking ? working : null;
  const changesRead = useChangesRead(workingHere);
  const fileShown = useMemo(() => {
    if (!shownHere) return null;
    if (onWorking) {
      const side = shownHere.staged ? changesRead?.staged : changesRead?.unstaged;
      return side?.find((f) => f.path === shownHere.path) ?? null;
    }
    return commitRead?.files.find((f) => f.path === shownHere.path) ?? null;
  }, [shownHere, onWorking, changesRead, commitRead]);
  // j/k's order: the pane's.
  const fileOrder = useMemo<ShownFile[]>(
    () =>
      onWorking
        ? workingHere
          ? changesOrder(workingHere)
          : []
        : (commitRead?.files.map(({ path }) => ({ path })) ?? []),
    [onWorking, workingHere, commitRead],
  );
  // Staged or unstaged, the uncommitted file shown follows it to its other side.
  useEffect(() => {
    if (!openFile || openFile.sha !== null) return;
    const next = working ? followShown(working, openFile) : null;
    if (next !== openFile) setOpenFile(next && { ...next, sha: null });
  }, [working, openFile]);
  const shownPath = shownHere?.path ?? null;
  const shownStaged = shownHere?.staged === true;
  const loadShown = useCallback(() => {
    if (!shownPath) return Promise.resolve(null);
    if (onWorking) return fetchChangeFile(shownPath, shownStaged);
    return commitSha ? fetchCommitFile(commitSha, shownPath) : Promise.resolve(null);
    // `workingHere`: an uncommitted file's diff is read again after a stage.
  }, [shownPath, shownStaged, onWorking, commitSha, workingHere]);
  const openShown = useCallback(
    () =>
      !shownPath
        ? Promise.resolve()
        : openDiff(
            onWorking
              ? { path: shownPath, staged: shownStaged }
              : { path: shownPath, sha: commitSha ?? '' },
          ),
    [shownPath, shownStaged, onWorking, commitSha],
  );
  // An uncommitted modified file's lines, staged or unstaged from its diff (decision 642).
  const staging = useMemo<Staging | undefined>(() => {
    if (!onWorking || !shownPath || fileShown?.status !== 'modified' || fileShown.previousPath)
      return undefined;
    return {
      staged: shownStaged,
      onLines: async (lines, index) =>
        setChanges(await stageLines(shownPath, shownStaged, lines, index)),
    };
  }, [onWorking, shownPath, shownStaged, fileShown]);
  // A branch or tag dialog (V66d), and a branch's menu in the panel.
  const [refAction, setRefAction] = useState<RefAction | null>(null);
  const [branchMenu, setBranchMenu] = useState<{
    at: { x: number; y: number };
    entry: BranchEntry;
  } | null>(null);
  // A git write asked first (decisions 636–645).
  const [question, setQuestion] = useState<Ask | null>(null);
  const [resizing, setResizing] = useState(false);
  const place = useDetailsPlace();
  // The search (V66f): the rows found in this listing, the field.
  const [matches, setMatches] = useState<number[] | null>(null);
  const findRef = useRef<HTMLInputElement>(null);

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

  // Which rows are in view: the list starts below the title, inside the scrolled box.
  const measure = useCallback(() => {
    const box = scroller.current;
    if (box)
      setView({ top: box.scrollTop - (list.current?.offsetTop ?? 0), height: box.clientHeight });
  }, []);
  useLayoutEffect(() => {
    measure();
    const box = scroller.current;
    if (!box) return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure, first]);
  const firstShown = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
  const lastShown = Math.min(rows - 1, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);

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

  /** Scrolls row `row` into view: to the middle when `center`, else just enough. */
  const reveal = useCallback((row: number, center = false) => {
    const box = scroller.current;
    if (!box) return;
    const top = (list.current?.offsetTop ?? 0) + row * ROW_HEIGHT;
    if (center) box.scrollTop = top - (box.clientHeight - ROW_HEIGHT) / 2;
    else if (top < box.scrollTop) box.scrollTop = top;
    else if (top + ROW_HEIGHT > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + ROW_HEIGHT - box.clientHeight;
    }
  }, []);
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

  const compare = useCallback(async (pair: Pair) => {
    setStarting(true);
    setCompareError(null);
    try {
      window.location.assign(await startDiff(pair));
    } catch (e) {
      setCompareError(`Could not compare: ${(e as Error).message}`);
      setStarting(false);
    }
  }, []);

  /** Opens row `row`'s menu at a point of the window, the submenu `open` shown. */
  const openMenu = useCallback((row: number, x: number, y: number, open?: 'checkout') => {
    const commit = details.current.get(row);
    if (!commit) return;
    setCursor(row);
    Promise.all([fetchJson<RefList>('api/refs'), fetchJson<RepoStatus>('api/status')])
      .then(([refs, status]) => {
        setMenu({
          at: { x, y },
          sha: commit.sha,
          ...(open ? { open } : {}),
          checkout: checkoutChoices(commit, refs, status),
          status,
        });
      })
      .catch((e: unknown) => setError(`Could not read the branches: ${(e as Error).message}`));
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

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

  /** The workspace whose branch's tip is this commit (V18b), if any. */
  const workspaceOn = (sha: string) =>
    (workspaces?.workspaces ?? [])
      .filter((f) => f.tip === sha)
      .slice(0, 1)
      .map((f) => f.branch);

  /** "Check out ▸" (V14) and "Start a workspace here" (V18), then a branch or a tag there. */
  const menuItems = ({ sha, checkout, status }: NonNullable<typeof menu>): RowMenuItem[] => [
    {
      label: 'Check out',
      choices: checkout,
      onChoose: (index) => {
        const choice = checkout[index];
        setMenu(null);
        if (!choice || choice.disabled) return;
        setRefused(null);
        setConfirm({ choice, status });
      },
    },
    ...workspaceOn(sha).map((branch) => ({
      label: 'Open its workspace',
      onSelect: () =>
        shell
          ? shell.navigate({ page: 'workspace', branch })
          : window.location.assign(workspaceHref(branch)),
    })),
    {
      label: 'Start a workspace here',
      onSelect: () => {
        setMenu(null);
        openWorkspace(sha);
      },
    },
    {
      label: 'New branch here…',
      onSelect: () => {
        setMenu(null);
        setRefAction({ kind: 'new-branch', at: sha });
      },
    },
    {
      label: 'New tag here…',
      onSelect: () => {
        setMenu(null);
        setRefAction({ kind: 'new-tag', at: sha });
      },
    },
    ...commitItems(sha),
    ...(details.current.get(cursor)?.sha === sha ? (details.current.get(cursor)?.refs ?? []) : [])
      .filter((ref) => ref.kind === 'tag')
      .map((ref) => ({
        label: `Delete the tag ${ref.name}…`,
        onSelect: () => {
          setMenu(null);
          setRefAction({ kind: 'delete-tag', name: ref.name });
        },
      })),
  ];

  /**
   * A commit's writes onto the branch checked out (decisions 637, 638, 640): cherry-pick, revert,
   * reset; its branches merged in or rebased onto.
   */
  const commitItems = (sha: string): RowMenuItem[] => {
    const ask = (question: Ask) => () => {
      setMenu(null);
      setQuestion(question);
    };
    const commit = details.current.get(cursor);
    const branches = (commit?.sha === sha ? commit.refs : []).flatMap((ref) =>
      (ref.kind === 'branch' || ref.kind === 'remote') && ref.name !== first?.branch
        ? [{ kind: ref.kind, name: ref.name }]
        : [],
    );
    const detached = first?.branch ? {} : { disabled: 'HEAD is detached: check out a branch' };
    const choices = (verb: string) =>
      branches.map((ref) => ({
        label: `${verb} ${ref.name}`,
        ref,
        note: ref.kind === 'remote' ? 'remote branch' : 'branch',
        ...detached,
      }));
    const choose = (make: (name: string) => Ask) => (index: number) => {
      const ref = branches[index];
      setMenu(null);
      if (ref && first?.branch) setQuestion(make(ref.name));
    };
    return [
      { label: `Cherry-pick onto ${onto}…`, onSelect: ask(askCherryPick(sha)) },
      { label: 'Revert…', onSelect: ask(askRevert(sha)) },
      { label: `Reset ${onto} to here…`, onSelect: ask(askReset(sha)) },
      ...(branches.length === 0
        ? []
        : [
            { label: `Merge into ${onto}`, choices: choices('Merge'), onChoose: choose(askMerge) },
            {
              label: `Rebase ${onto} onto`,
              choices: choices('Onto'),
              onChoose: choose(askRebase),
            },
          ]),
    ];
  };

  /** A branch's menu in the panel (V66d): check out, go to its tip, review, rename, delete. */
  const branchMenuItems = (entry: BranchEntry): RowMenuItem[] => {
    const local = refs?.branches.some((b) => b.name === entry.name) ?? false;
    const remote = local ? undefined : refs?.remotes.find((r) => r.name === entry.name);
    const close = (then: () => void) => () => {
      setBranchMenu(null);
      then();
    };
    return [
      { label: 'Check out…', onSelect: close(() => checkoutBranch(entry)) },
      ...(entry.row === null
        ? []
        : [{ label: 'Go to its tip', onSelect: close(() => goToBranch(entry)) }]),
      ...(local
        ? [
            {
              label: 'Review',
              onSelect: close(() => {
                startReview(entry.name)
                  .then((url) => window.location.assign(url))
                  .catch((e: unknown) =>
                    setError(`Could not review ${entry.name}: ${(e as Error).message}`),
                  );
              }),
            },
            {
              label: 'Rename…',
              onSelect: close(() => setRefAction({ kind: 'rename-branch', name: entry.name })),
            },
            {
              label: 'Delete…',
              onSelect: close(() => setRefAction({ kind: 'delete-branch', name: entry.name })),
            },
          ]
        : []),
      // Merged in or rebased onto (decision 638); a remote's deleted there (644); hidden (645).
      ...(first?.branch && entry.name !== first.branch
        ? [
            {
              label: `Merge into ${first.branch}…`,
              onSelect: close(() => setQuestion(askMerge(entry.name))),
            },
            {
              label: `Rebase ${first.branch} onto it…`,
              onSelect: close(() => setQuestion(askRebase(entry.name))),
            },
          ]
        : []),
      ...(remote
        ? [
            {
              label: `Delete from ${remote.remote}…`,
              onSelect: close(() => setQuestion(askDeleteRemote(entry.name, remote.remote))),
            },
          ]
        : []),
      ...(local && entry.name === first?.branch
        ? []
        : [
            {
              label: entry.hidden ? 'Show in the graph' : 'Hide from the graph',
              onSelect: close(() =>
                toggleHidden(
                  `refs/${local ? 'heads' : 'remotes'}/${entry.name}`,
                  entry.name,
                  !entry.hidden,
                ),
              ),
            },
          ]),
    ];
  };

  /** A branch checked out from the panel: the row menu's confirmation (V11), its rules (V66d). */
  const checkoutBranch = useCallback(
    (entry: BranchEntry) => {
      Promise.all([fetchJson<RefList>('api/refs'), fetchJson<RepoStatus>('api/status')])
        .then(([listed, status]) => {
          const choice = branchChoice(entry.name, listed, status);
          if (!choice) return setError(`No branch ${entry.name} to check out`);
          if (choice.disabled) return shell?.notify({ text: `${entry.name}: ${choice.disabled}` });
          setRefused(null);
          setConfirm({ choice, status });
        })
        .catch((e: unknown) => setError(`Could not read the branches: ${(e as Error).message}`));
    },
    [shell],
  );

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

  const runCheckout = useCallback(
    async ({ target }: CheckoutChoice) => {
      setCheckingOut(true);
      setRefused(null);
      try {
        const result = await postCheckout(target);
        const remote = target.kind === 'remote' ? target.name : undefined;
        onRelist({
          text: checkedOut(result, remote),
          ...(result.warning ? { warning: result.warning } : {}),
        });
      } catch (e) {
        setRefused((e as Error).message);
        setCheckingOut(false);
      }
    },
    [onRelist],
  );

  const current = useMemo(
    () =>
      comparison(
        picks,
        {
          parents,
          head: headRow,
          trunk: shape?.defaultBranch?.rows ?? [],
          complete: shape !== null,
          shaAt: (row) => details.current.get(row)?.sha,
        },
        swapped,
      ),
    // `loaded`: a block of details came, maybe the fork point's.
    [picks, parents, headRow, shape, swapped, loaded],
  );
  // Diverged picks: the fork point's details, wherever it is in the history.
  const forkRow = current?.diverged?.forkRow;
  useEffect(() => {
    if (forkRow !== undefined && !details.current.has(forkRow))
      loadBlock(Math.floor(forkRow / BLOCK));
  }, [forkRow, loadBlock]);
  const pickRow = useCallback((row: number) => {
    const commit = details.current.get(row);
    if (!commit) return;
    const next: Picked = {
      sha: commit.sha,
      row,
      ...(commit.parents[0] ? { parent: commit.parents[0] } : {}),
    };
    setPicks((ps) =>
      pick(
        ps.map((p) => p.sha),
        next.sha,
      ).map((sha) => ps.find((p) => p.sha === sha) ?? next),
    );
    setSwapped(false);
  }, []);
  /** Leaves compare mode: the picks go with it. */
  const stopComparing = useCallback(() => {
    setPicks([]);
    setSwapped(false);
    setCompareError(null);
    onComparing(false);
  }, [onComparing]);

  // The search (V66f): asked once typing stops, the cursor on the first row found from it.
  const query = find.query.trim();
  const version = first?.version;
  const cursorAt = useRef(cursor);
  cursorAt.current = cursor;
  // The words last searched: listed anew in place, the same words find again without moving.
  const searched = useRef('');
  useEffect(() => {
    if (!query || !version) {
      setMatches(null);
      searched.current = '';
      return;
    }
    const fresh = query !== searched.current;
    if (fresh) setMatches(null);
    let live = true;
    const timer = setTimeout(() => {
      findRows(scope, version, query)
        .then((found) => {
          if (!live) return;
          if (found === null) return void relistRef.current();
          setMatches(found);
          searched.current = query;
          const row = fresh ? nextMatch(found, cursorAt.current - 1, true) : null;
          if (row !== null) jump(row);
        })
        .catch((e: unknown) => live && setError(`Could not find commits: ${(e as Error).message}`));
    }, FIND_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, version, scope, jump]);
  const matched = useMemo(() => new Set(matches ?? []), [matches]);
  const step = useCallback(
    (forward: boolean) => {
      const row = matches ? nextMatch(matches, cursor, forward) : null;
      if (row !== null) jump(row);
    },
    [matches, cursor, jump],
  );
  // Listing anew in place (decision 634): what moved unasked (a branch elsewhere, an agent's
  // commit, a fetch) is read while the page stays, then swapped in at once. The cursor stays on its
  // commit (on HEAD from HEAD with no file shown), the rows where they were on screen, the file
  // shown and the pane as they were. One at a time; asked meanwhile, once more after.
  const latest = useRef({ first, headRow, picks, shown: openFile !== null });
  latest.current = { first, headRow, picks, shown: openFile !== null };
  const relisting = useRef<Promise<void> | null>(null);
  const relistAgain = useRef(false);
  const scrollTo = useRef<{ row: number; offset: number } | { reveal: number } | null>(null);
  const relistHere = useCallback((): Promise<void> => {
    if (relisting.current) {
      relistAgain.current = true;
      return relisting.current;
    }
    const run = async (tries: number): Promise<void> => {
      const { first: before, headRow: oldHead, picks: picked, shown } = latest.current;
      if (!before) return;
      readChanges();
      const page = await fetchRows(scope, 0, BLOCK);
      if (page.version === before.version) return;
      const cursor = cursorAt.current;
      const box = scroller.current;
      const top = list.current?.offsetTop ?? 0;
      const at = (row: number) => top + row * ROW_HEIGHT - (box?.scrollTop ?? 0);
      // The row kept in its place on screen: the cursor's when in view, else the first in view.
      const inView = (row: number) =>
        box !== null && row >= 0 && at(row) > -ROW_HEIGHT && at(row) < box.clientHeight;
      const anchor = inView(cursor)
        ? cursor
        : Math.max(0, Math.floor(((box?.scrollTop ?? 0) - top) / ROW_HEIGHT));
      const shaOf = (row: number) => details.current.get(row)?.sha;
      const kept = cursor === WORKING ? undefined : shaOf(cursor);
      const anchored = shaOf(anchor);
      const shas = [
        ...new Set([kept, anchored, ...picked.map((p) => p.sha)].filter((s) => s !== undefined)),
      ];
      try {
        const [nextShape, nextRefs, found] = await Promise.all([
          fetchShape(scope, page.version),
          fetchBranches(scope, page.version),
          shas.length > 0 ? fetchRowsOf(scope, page.version, shas) : Promise.resolve([]),
        ]);
        const rowOf = new Map(shas.map((sha, i) => [sha, found[i] ?? null]));
        const keptRow = kept === undefined ? null : (rowOf.get(kept) ?? null);
        const next = rowAfterListing({
          cursor,
          wasHead: cursor === oldHead,
          shown,
          kept: keptRow,
          head: nextShape.head,
        });
        // The first rows' details, and the cursor's when further down: its pane and file stay.
        const fresh = new Map<number, Commit>();
        page.commits.forEach((c, i) => fresh.set(i, c));
        const blocks = new Set([0]);
        if (next >= 0 && !fresh.has(next) && next < nextShape.rows) {
          const block = Math.floor(next / BLOCK);
          const more = await fetchRows(
            scope,
            block * BLOCK,
            Math.min(nextShape.rows, (block + 1) * BLOCK),
            page.version,
          );
          more.commits.forEach((c, i) => fresh.set(more.from + i, c));
          blocks.add(block);
        }
        const anchorRow = anchored === undefined ? null : (rowOf.get(anchored) ?? null);
        scrollTo.current =
          next >= 0 && next !== keptRow
            ? { reveal: next }
            : anchorRow !== null
              ? { row: anchorRow, offset: at(anchor) }
              : null;
        details.current = fresh;
        asked.current = blocks;
        setFirst(page);
        setShape(nextShape);
        setRefs(nextRefs);
        setCursor(next);
        setPicks((ps) =>
          ps.flatMap((p) => {
            const row = rowOf.get(p.sha);
            return row === null || row === undefined ? [] : [{ ...p, row }];
          }),
        );
        setFlash(null);
        setLoaded((n) => n + 1);
      } catch (e) {
        // Moved again while read: read the newer listing.
        if (e instanceof StaleHistory && tries > 0) return run(tries - 1);
        throw e;
      }
    };
    const done = run(2)
      .catch((e: unknown) => {
        if (e instanceof StaleHistory) setStale(true);
        else setError(`Could not list commits: ${(e as Error).message}`);
      })
      .finally(() => {
        relisting.current = null;
        if (relistAgain.current) {
          relistAgain.current = false;
          void relistRef.current();
        }
      });
    relisting.current = done;
    return done;
  }, [scope, readChanges]);
  relistRef.current = relistHere;

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

  /**
   * A git write done (decisions 636–645): the status bar says how it ended, then the page lists
   * afresh (HEAD moved), in place, or reads the uncommitted changes again.
   */
  const answered = useCallback(
    (notice: Notice, after: After) => {
      setQuestion(null);
      if (after === 'afresh') return onRelist(notice);
      shell?.notify(notice);
      if (after === 'here') void relistRef.current();
      else readChanges();
    },
    [onRelist, shell, readChanges],
  );
  // The branch the writes go onto: HEAD's.
  const onto = first?.branch ?? 'HEAD';
  const stopsNote = 'On a conflict it stops: the conflicts are in the uncommitted changes.';
  const askCherryPick = (sha: string): Ask => ({
    title: `Cherry-pick ${shortSha(sha)} onto ${onto}?`,
    note: `Its changes made again on ${onto}, a new commit. ${stopsNote}`,
    verb: 'Cherry-pick',
    run: async () =>
      stoppedNotice(await cherryPick(sha), `Cherry-picked ${shortSha(sha)} onto ${onto}`),
    after: 'afresh',
  });
  const askRevert = (sha: string): Ask => ({
    title: `Revert ${shortSha(sha)}?`,
    note: `A new commit on ${onto} that undoes its changes. ${stopsNote}`,
    verb: 'Revert',
    run: async () => stoppedNotice(await revert(sha), `Reverted ${shortSha(sha)}`),
    after: 'afresh',
  });
  const askReset = (sha: string): Ask => ({
    title: `Reset ${onto} to ${shortSha(sha)}?`,
    note: `${onto} moves to ${shortSha(sha)}. The changes of the commits it leaves stay on disk, and the commits stay in git's reflog: nothing is lost.`,
    verb: 'Reset',
    choices: [
      { value: 'mixed', label: 'Mixed', note: 'their changes not staged' },
      { value: 'soft', label: 'Soft', note: 'their changes staged' },
    ],
    more: async () => {
      const count = await fetchLeaving(sha);
      return count === 0
        ? `No commit leaves ${onto}.`
        : `${count} commit${count === 1 ? ' leaves' : 's leave'} ${onto}.`;
    },
    run: async ({ choice }) => {
      await reset(sha, choice === 'soft' ? 'soft' : 'mixed');
      return { text: `Reset ${onto} to ${shortSha(sha)}, ${choice}` };
    },
    after: 'afresh',
  });
  const askMerge = (name: string): Ask => ({
    title: `Merge ${name} into ${onto}?`,
    note: `git's merge: a fast-forward when ${onto} has no commit of its own, else a merge commit. ${stopsNote}`,
    verb: 'Merge',
    run: async () => stoppedNotice(await merge(name), `Merged ${name} into ${onto}`),
    after: 'afresh',
  });
  const askRebase = (name: string): Ask => ({
    title: `Rebase ${onto} onto ${name}?`,
    note: `${onto}'s own commits are made again on top of ${name}; local changes must be committed or stashed first. On a conflict it stops at that commit: the conflicts are in the uncommitted changes.`,
    verb: 'Rebase',
    run: async () => stoppedNotice(await rebase(name), `Rebased ${onto} onto ${name}`),
    after: 'afresh',
  });
  const askDeleteRemote = (name: string, remote: string): Ask => ({
    title: `Delete ${name} from ${remote}?`,
    note: `The branch goes from ${remote}, for everyone who fetches it; local branches stay. ${remote}'s default branch is refused.`,
    verb: 'Delete',
    danger: true,
    run: async () => {
      await deleteRemoteBranch(name);
      return { text: `Deleted ${name} from ${remote}` };
    },
    after: 'here',
  });
  /** Hides a branch from the graph or shows it again (decision 645): listed in place. */
  const toggleHidden = (ref: string, name: string, hidden: boolean) => {
    hideBranch(ref, hidden)
      .then(() => {
        shell?.notify({ text: hidden ? `Hid ${name} from the graph` : `Showing ${name} again` });
        void relistRef.current();
      })
      .catch((e: unknown) =>
        shell?.notify({
          text: `Could not ${hidden ? 'hide' : 'show'} ${name}`,
          warning: (e as Error).message,
          error: true,
        }),
      );
  };
  /** A stash's menu (decision 639): apply or pop it at once; drop it once asked. */
  const [stashMenu, setStashMenu] = useState<{
    at: { x: number; y: number };
    stash: StashEntry;
  } | null>(null);
  const stashItems = (entry: StashEntry): RowMenuItem[] => {
    const words = stashWords(entry);
    const apply = (action: 'apply' | 'pop') => () => {
      setStashMenu(null);
      unstash(entry.sha, action)
        .then((result) =>
          answered(
            stoppedNotice(result, `${action === 'pop' ? 'Popped' : 'Applied'} the stash ${words}`),
            'changes',
          ),
        )
        .catch((e: unknown) =>
          shell?.notify({
            text: `Could not ${action} the stash`,
            warning: (e as Error).message,
            error: true,
          }),
        );
    };
    return [
      { label: 'Apply', onSelect: apply('apply') },
      { label: 'Pop: apply, then drop', onSelect: apply('pop') },
      {
        label: 'Drop…',
        onSelect: () => {
          setStashMenu(null);
          setQuestion({
            title: `Drop the stash ${words}?`,
            note: 'Its changes are lost: git keeps no other copy.',
            verb: 'Drop',
            danger: true,
            run: async () => {
              await unstash(entry.sha, 'drop');
              return { text: `Dropped the stash ${words}` };
            },
            after: 'changes',
          });
        },
      },
    ];
  };
  // Listed in place: the rows where they were on screen, or the cursor revealed when it moved.
  useLayoutEffect(() => {
    const to = scrollTo.current;
    const box = scroller.current;
    if (!to || !box) return;
    scrollTo.current = null;
    if ('reveal' in to) reveal(to.reveal);
    else box.scrollTop = (list.current?.offsetTop ?? 0) + to.row * ROW_HEIGHT - to.offset;
    measure();
  }, [first, reveal, measure]);

  // The uncommitted row gone (committed, or changed elsewhere): the cursor back on HEAD.
  useEffect(() => {
    if (cursor === WORKING && !working) setCursor(headRow ?? 0);
  }, [cursor, working, headRow]);

  // j/k move, x picks (turning compare mode on), Enter compares, Escape leaves compare mode.
  // Attached as the rows are drawn (a layout effect), not after the paint: a key pressed as soon
  // as they show is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing (the search, the commit's message), and the menus and dialogs: their own keys.
      if (keyIsTaken(event) || menu || confirm || refAction || branchMenu || stashMenu || question)
        return;
      // A file shown in the rows' place (V70): j/k step the files, o opens its diff in VS Code,
      // Esc goes back to the rows; the rows' own keys wait under it.
      if (fileShown && shownHere) {
        if (event.key === 'j' || event.key === 'k') {
          const step = event.key === 'j' ? 1 : -1;
          setOpenFile({ ...stepShown(fileOrder, shownHere, step), sha: shownHere.sha });
          return;
        }
        if (event.key === 'o') {
          document.getElementById(OPEN_FILE_ID)?.click();
          return;
        }
        if (event.key === 'Escape') {
          setOpenFile(null);
          return;
        }
        if (['x', 'c', 'Enter'].includes(event.key)) return;
      }
      if (event.key === 'j' || event.key === 'k') {
        // Above the first commit, the uncommitted row when there is one (V66c).
        const top = working ? WORKING : 0;
        const next = Math.max(top, Math.min(rows - 1, cursor + (event.key === 'j' ? 1 : -1)));
        setCursor(next);
        reveal(next);
      } else if (event.key === 'd') pane.onOpen(!pane.open);
      else if (event.key === 'f') {
        event.preventDefault();
        findRef.current?.focus();
      } else if (event.key === 'x') {
        onComparing(true);
        pickRow(cursor);
      } else if (event.key === 'c') {
        const box = list.current?.querySelector('.commit.cursor')?.getBoundingClientRect();
        // `c` checks out: straight to the targets.
        if (box) openMenu(cursor, box.left + 48, box.bottom, 'checkout');
      } else if (event.key === '/') {
        // Finds a branch: the panel's filter (shown first under 900 px).
        event.preventDefault();
        setPanelOpen(true);
        requestAnimationFrame(() => filterRef.current?.focus());
      } else if (event.key === 'Escape' && panelOpen) setPanelOpen(false);
      else if (event.key === 'Escape' && comparing) stopComparing();
      else if (
        event.key === 'Enter' &&
        // A focused button takes Enter itself.
        !(event.target instanceof HTMLButtonElement) &&
        comparing &&
        current?.pair &&
        !starting
      ) {
        event.preventDefault();
        void compare(current.pair);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    fileShown,
    shownHere,
    fileOrder,
    rows,
    cursor,
    current,
    starting,
    compare,
    pickRow,
    reveal,
    menu,
    confirm,
    openWorkspace,
    openMenu,
    comparing,
    onComparing,
    stopComparing,
    panelOpen,
    refAction,
    branchMenu,
    stashMenu,
    question,
    working,
    pane,
  ]);

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
    return <p className={error ? 'hint error' : 'hint'}>{error ?? 'Listing commits…'}</p>;
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
            <div className="commits-title" inert={!!fileShown}>
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
              {!shape && first.listed > 0 && <p className="hint listing">Listing the rest…</p>}
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
      {branchMenu && (
        <RowMenu
          at={branchMenu.at}
          items={branchMenuItems(branchMenu.entry)}
          onClose={() => setBranchMenu(null)}
        />
      )}
      {stashMenu && (
        <RowMenu
          at={stashMenu.at}
          items={stashItems(stashMenu.stash)}
          onClose={() => setStashMenu(null)}
        />
      )}
      {question && (
        <AskDialog ask={question} onDone={answered} onCancel={() => setQuestion(null)} />
      )}
      {refAction && (
        <RefDialog
          action={refAction}
          onDone={(notice) => {
            setRefAction(null);
            onRelist(notice);
          }}
          onCancel={() => setRefAction(null)}
        />
      )}
      {menu && (
        <RowMenu
          at={menu.at}
          items={menuItems(menu)}
          {...(menu.open === 'checkout' ? { open: 0 } : {})}
          onClose={closeMenu}
        />
      )}
      {confirm && (
        <CheckoutDialog
          choice={confirm.choice}
          state={confirm.status}
          running={checkingOut}
          error={refused}
          onConfirm={() => void runCheckout(confirm.choice)}
          onCancel={() => setConfirm(null)}
        />
      )}
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

/** The head's line: the branch, then where it is against its upstream, the name said once. */
function headLine(branch: string | null, sync: SyncState | null): string {
  const name = branch ?? 'HEAD detached';
  if (!sync || !branch) return name;
  const words = syncWords(sync);
  return words.startsWith(`${branch} `) ? words : `${name} · ${words}`;
}

/**
 * The checkout's uncommitted changes as a row above the commits (V66c): its dot hollow on HEAD's
 * lane (lane 0), joined to HEAD's when HEAD is the first commit listed.
 */
function WorkingRow({
  changes,
  spacing,
  width,
  joined,
  cursor,
  onClick,
}: {
  changes: WorkingChanges;
  spacing: number;
  width: number;
  joined: boolean;
  cursor: boolean;
  onClick: () => void;
}) {
  const x = spacing / 2;
  const mid = ROW_HEIGHT / 2;
  return (
    <div
      className={`commit working${cursor ? ' cursor' : ''}`}
      style={{ height: ROW_HEIGHT }}
      role="button"
      tabIndex={-1}
      aria-label={`Uncommitted changes: ${changesSummary(changes)}`}
      onClick={onClick}
    >
      <svg className="graph" width={width} height={ROW_HEIGHT} aria-hidden="true">
        {joined && <path className="working-line" d={`M${x} ${mid + 4}V${ROW_HEIGHT}`} />}
        <circle className="working-dot" cx={x} cy={mid} r={4} />
      </svg>
      <span className="commit-subject">Uncommitted changes</span>
      <span className="working-summary">{changesSummary(changes)}</span>
    </div>
  );
}
