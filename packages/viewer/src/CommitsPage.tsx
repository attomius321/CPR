import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  BranchReviewList,
  CheckoutResult,
  CheckoutTarget,
  Commit,
  FeatureStart,
  HistoryPage,
  HistoryRefs,
  HistoryScope,
  HistoryShape,
  RefList,
  RepoStatus,
} from '@cpr/core';
import { BranchesPanel } from './BranchesPanel.js';
import { checkedOut, checkoutChoices, type CheckoutChoice } from './checkout.js';
import { reviewChoices, reviewMarks, type ReviewChoice, type ReviewMark } from './branchReviews.js';
import { CheckoutDialog } from './CheckoutDialog.js';
import {
  featureChips,
  featureHref,
  featuresFirst,
  startedNotice,
  type AgentChip,
} from './features.js';
import { FeatureMark } from './FeatureMark.js';
import { useFeatureStarter } from './FeatureStarter.js';
import { useFeatures } from './useFeatures.js';
import { RowMenu, type RowMenuItem } from './RowMenu.js';
import {
  BLOCK,
  blocksAround,
  comparison,
  graphLoaded,
  parentRows,
  pick,
  relativeDate,
  rowBadges,
  shortSha,
  type Comparison,
  type Loaded,
  type Pair,
  type Picked,
} from './commits.js';
import { GraphCell, ROW_HEIGHT } from './GraphCell.js';
import { laneSpacing, layoutLanes } from './lanes.js';

/** The commits page and the diffs it starts live at the server's root (`cpr view`). */
const COMMITS_PAGE = '/';

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-cpr': '1' };

/** Rows drawn beyond the view, above and below. */
const OVERSCAN = 10;

/** The history changed since the page listed it (a branch moved): it must list it again. */
class StaleHistory extends Error {}

async function fetchRows(
  scope: HistoryScope,
  from: number,
  to: number,
  version?: string,
): Promise<HistoryPage> {
  const query = new URLSearchParams({ scope, from: String(from), to: String(to) });
  if (version) query.set('version', version);
  const response = await fetch(`${COMMITS_PAGE}api/history?${query}`);
  if (response.status === 409) throw new StaleHistory();
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as HistoryPage;
}

async function fetchShape(scope: HistoryScope, version: string): Promise<HistoryShape> {
  const query = new URLSearchParams({ scope, version });
  const response = await fetch(`${COMMITS_PAGE}api/history/shape?${query}`);
  if (response.status === 409) throw new StaleHistory();
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as HistoryShape;
}

/** The branches with their tips' rows in this listing (V10b). */
async function fetchBranches(scope: HistoryScope, version: string): Promise<HistoryRefs> {
  const query = new URLSearchParams({ scope, version });
  const response = await fetch(`${COMMITS_PAGE}api/history/refs?${query}`);
  if (response.status === 409) throw new StaleHistory();
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as HistoryRefs;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${COMMITS_PAGE}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

/** Checks out a target; resolves with where HEAD is, or rejects with git's (or CPR's) words. */
async function postCheckout(target: CheckoutTarget): Promise<CheckoutResult> {
  const response = await fetch(`${COMMITS_PAGE}api/checkout`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(target),
  });
  if (response.ok) return (await response.json()) as CheckoutResult;
  const text = await response.text();
  let message = text;
  try {
    message = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // a plain-text refusal
  }
  throw new Error(message);
}

/** Starts analyzing a pair (or finds it analyzed); resolves with its page's URL. */
export async function startDiff(pair: Pair): Promise<string> {
  const response = await fetch(`${COMMITS_PAGE}api/diffs`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(pair),
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { url: string }).url;
}

/** Starts reviewing a branch (V15); resolves with its page's URL, or rejects with why not. */
async function startReview(ref: string): Promise<string> {
  const response = await fetch(`${COMMITS_PAGE}api/reviews`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ ref }),
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { url: string }).url;
}

/** The reviewer's branch reviews (V15); null when the server keeps none. */
async function fetchReviews(): Promise<BranchReviewList | null> {
  const response = await fetch(`${COMMITS_PAGE}api/reviews`);
  return response.ok ? ((await response.json()) as BranchReviewList) : null;
}

async function stopDiff(pair: Pair): Promise<void> {
  await fetch(`${COMMITS_PAGE}api/diffs/stop`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(pair),
  });
}

/** This page's graph, or how its analysis is going. */
export async function fetchGraph(url: string): Promise<Loaded> {
  try {
    const response = await fetch(url);
    const body: unknown = await response.json().catch(() => null);
    return graphLoaded(response.status, body);
  } catch {
    return { kind: 'missing' };
  }
}

/** "← Commits", on a diff's page. */
export function BackToCommits() {
  return (
    <a className="back" href={COMMITS_PAGE} title="Back to the commits">
      ← Commits
    </a>
  );
}

const scopeOfUrl = (): HistoryScope =>
  new URLSearchParams(window.location.search).get('scope') === 'current' ? 'current' : 'all';

/** `?branch=<name>` (V18b: a feature's branch): its tip, once listed. */
const branchOfUrl = (): string | null => new URLSearchParams(window.location.search).get('branch');

/** The commit the cursor was on before listing anew, and how far down the view it was. */
interface Keep {
  sha: string;
  offset: number;
}

/** What the page says after a checkout or a feature's start, above the rows. */
interface Notice {
  text: string;
  warning?: string;
  /** Text the person may copy from it: a feature's prompt when no agent took it (V18). */
  copy?: string;
}

/**
 * The repository's history as a graph (V10): every branch, or the current one ("This branch",
 * `?scope=current`). A click selects a row. In compare mode (V13: its toggle, or x) a click (or
 * x) picks one end, another the other end; the older is the base. Compare (Enter) opens the
 * diff; one picked is compared with its parent. A row's menu (right-click, "⋯", c or r) checks
 * out its branches, tags or the commit (V11), and reviews its branches (V15).
 */
export function CommitsPage() {
  const [scope, setScope] = useState(scopeOfUrl);
  // Listing anew (after a checkout, or a change made elsewhere) starts a new generation.
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
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
  const [keep, setKeep] = useState<Keep | null>(null);
  const choose = useCallback((next: HistoryScope) => {
    window.history.replaceState(null, '', next === 'all' ? COMMITS_PAGE : '?scope=current');
    setNotice(null);
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
  const relist = useCallback((next: Notice | null, branch?: string, kept?: Keep) => {
    setNotice(next);
    // A new branch (a feature's): its tip once listed.
    if (branch) setGoTo(branch);
    setKeep(kept ?? null);
    setGeneration((g) => g + 1);
  }, []);
  // A new scope or generation starts afresh: its own rows, lanes and picks.
  return (
    <History
      key={`${scope}:${generation}`}
      scope={scope}
      onScope={choose}
      notice={notice}
      onRelist={relist}
      comparing={comparing}
      onComparing={setComparing}
      panel={{ filter, onFilter: setFilter, toggled, onToggle: toggle }}
      goTo={goTo}
      keep={keep}
      onGoElsewhere={goElsewhere}
      onArrived={arrived}
    />
  );
}

function History({
  scope,
  onScope,
  notice,
  onRelist,
  comparing,
  onComparing,
  panel,
  goTo,
  keep,
  onGoElsewhere,
  onArrived,
}: {
  scope: HistoryScope;
  onScope: (scope: HistoryScope) => void;
  notice: Notice | null;
  /** Lists anew, saying `notice`; with `branch`, the cursor goes to its tip. */
  onRelist: (notice: Notice | null, branch?: string, keep?: Keep) => void;
  comparing: boolean;
  onComparing: (comparing: boolean) => void;
  /** The branches panel's filter and folders, kept by the page across listings. */
  panel: {
    filter: string;
    onFilter: (filter: string) => void;
    toggled: ReadonlySet<string>;
    onToggle: (key: string) => void;
  };
  /** A branch whose tip to go to once listed (from "This branch", `?branch=`, a new feature). */
  goTo: string | null;
  /** Listed anew while reading: the commit to keep the cursor on, where it was in the view. */
  keep: Keep | null;
  /** A branch this scope does not list: list every branch, then go to it. */
  onGoElsewhere: (name: string) => void;
  onArrived: () => void;
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
  // A row's menu (check out, review), then a checkout's confirmation (V11).
  const [menu, setMenu] = useState<{
    at: { x: number; y: number };
    /** The row's commit. */
    sha: string;
    /** The submenu shown at first: `c` and `r` (V14, V15). */
    open?: 'checkout' | 'review';
    checkout: CheckoutChoice[];
    review: ReviewChoice[];
    status: RepoStatus;
  } | null>(null);
  const [confirm, setConfirm] = useState<{ choice: CheckoutChoice; status: RepoStatus } | null>(
    null,
  );
  const [checkingOut, setCheckingOut] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  // Branch reviews (V15): marks on badges, dots on commits added since; read again when the
  // page is back, since a review is made on another page.
  const [reviews, setReviews] = useState<BranchReviewList | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      fetchReviews()
        .then((list) => live && setReviews(list))
        .catch(() => {});
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);
  const marks = useMemo(() => reviewMarks(reviews), [reviews]);

  const failed = useCallback((e: unknown) => {
    if (e instanceof StaleHistory) setStale(true);
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
        .then((status) => status.version !== first.version && onRelist(null))
        .catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [first, onRelist]);

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
      fetchRows(scope, block * BLOCK, Math.min(rows, (block + 1) * BLOCK), first.version)
        .then((page) => {
          page.commits.forEach((c, i) => details.current.set(page.from + i, c));
          setLoaded((n) => n + 1);
        })
        .catch((e: unknown) => {
          asked.current.delete(block);
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

  // The cursor starts on HEAD's row, once it is known; listed anew while reading, on the commit
  // it was on, where it was in the view.
  useLayoutEffect(() => {
    if (placed.current || headRow === null || !first) return;
    placed.current = true;
    const kept = keep ? first.commits.findIndex((c) => c.sha === keep.sha) : -1;
    const box = scroller.current;
    if (keep && kept >= 0 && box) {
      setCursor(kept);
      box.scrollTop = (list.current?.offsetTop ?? 0) + kept * ROW_HEIGHT - keep.offset;
      return;
    }
    setCursor(headRow);
    if ((headRow + 1) * ROW_HEIGHT > view.height) reveal(headRow, true);
  }, [headRow, view.height, reveal, keep, first]);

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
  const openMenu = useCallback(
    (row: number, x: number, y: number, open?: 'checkout' | 'review') => {
      const commit = details.current.get(row);
      if (!commit) return;
      setCursor(row);
      Promise.all([
        fetchJson<RefList>('api/refs'),
        fetchJson<RepoStatus>('api/status'),
        fetchReviews(),
      ])
        .then(([refs, status, list]) => {
          if (list) setReviews(list);
          setMenu({
            at: { x, y },
            sha: commit.sha,
            ...(open ? { open } : {}),
            checkout: checkoutChoices(commit, refs, status),
            review: list ? reviewChoices(commit, refs, list) : [],
            status,
          });
        })
        .catch((e: unknown) => setError(`Could not read the branches: ${(e as Error).message}`));
    },
    [],
  );
  const closeMenu = useCallback(() => setMenu(null), []);

  // Starting a feature (V18): the dialog, then the page listed anew on its branch.
  const started = useCallback(
    (start: FeatureStart) => onRelist(startedNotice(start), start.feature.branch),
    [onRelist],
  );
  const starter = useFeatureStarter(started, setError);
  const openFeature = starter.open;

  // Each feature's mark on its branch's badges, a link to it (V18b); its agent's commits listed
  // as they come, the cursor kept on its commit.
  const { list: features, reviews: featureReviews } = useFeatures();
  const chips = useMemo(
    () => featureChips(features?.features ?? [], featureReviews, refs?.remotes ?? []),
    [features, featureReviews, refs],
  );
  // The features that need the person, first in the branches panel (V23).
  const firstBranches = useMemo(
    () => featuresFirst(features?.features ?? [], featureReviews),
    [features, featureReviews],
  );
  useEffect(() => {
    if (!refs || !features) return;
    const moved = features.features.some((f) => {
      const listed = refs.branches.find((b) => b.name === f.branch);
      return f.tip !== null && listed !== undefined && listed.sha !== f.tip;
    });
    if (!moved) return;
    const box = scroller.current;
    const sha = details.current.get(cursor)?.sha;
    const top = (list.current?.offsetTop ?? 0) + cursor * ROW_HEIGHT;
    onRelist(null, undefined, sha && box ? { sha, offset: top - box.scrollTop } : undefined);
    // Only a feature's tip moving lists anew; the cursor is read as it is then.
  }, [features, refs, onRelist]);

  /** The feature whose branch's tip is this commit (V18b), if any. */
  const featureOn = (sha: string) =>
    (features?.features ?? [])
      .filter((f) => f.tip === sha)
      .slice(0, 1)
      .map((f) => f.branch);

  /**
   * "Check out ▸" (V14), "Review ▸" when the row has branches (V15), and "Start a feature here"
   * (V18).
   */
  const menuItems = ({
    sha,
    checkout,
    review,
    status,
  }: NonNullable<typeof menu>): RowMenuItem[] => [
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
    ...(review.length === 0
      ? []
      : [
          {
            label: 'Review',
            choices: review,
            onChoose: (index: number) => {
              const choice = review[index];
              setMenu(null);
              if (!choice || choice.disabled) return;
              startReview(choice.review)
                .then((url) => window.location.assign(url))
                .catch((e: unknown) =>
                  setError(`Could not review ${choice.ref.name}: ${(e as Error).message}`),
                );
            },
          },
        ]),
    ...featureOn(sha).map((branch) => ({
      label: 'Open its workspace',
      onSelect: () => window.location.assign(featureHref(branch)),
    })),
    {
      label: 'Start a workspace here',
      onSelect: () => {
        setMenu(null);
        openFeature(sha);
      },
    },
  ];

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

  // j/k move, x picks (turning compare mode on), Enter compares, Escape leaves compare mode.
  // Attached as the rows are drawn (a layout effect), not after the paint: a key pressed as soon
  // as they show is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement) return;
      // The menu and the dialogs take their own keys.
      if (menu || confirm || starter.isOpen) return;
      if (event.key === 'j' || event.key === 'k') {
        const next = Math.max(0, Math.min(rows - 1, cursor + (event.key === 'j' ? 1 : -1)));
        setCursor(next);
        reveal(next);
      } else if (event.key === 'x') {
        onComparing(true);
        pickRow(cursor);
      } else if (event.key === 'c') {
        const box = list.current?.querySelector('.commit.cursor')?.getBoundingClientRect();
        // `c` checks out: straight to the targets.
        if (box) openMenu(cursor, box.left + 48, box.bottom, 'checkout');
      } else if (event.key === 'r') {
        const box = list.current?.querySelector('.commit.cursor')?.getBoundingClientRect();
        // `r` reviews: straight to the row's branches.
        if (box) openMenu(cursor, box.left + 48, box.bottom, 'review');
      } else if (event.key === 'n') {
        openFeature();
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
    rows,
    cursor,
    current,
    starting,
    compare,
    pickRow,
    reveal,
    menu,
    confirm,
    starter.isOpen,
    openFeature,
    openMenu,
    comparing,
    onComparing,
    stopComparing,
    panelOpen,
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
  return (
    <div className={comparing ? 'commits comparing' : 'commits'}>
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
        />
        <div className="commits-scroll" ref={scroller} onScroll={measure}>
          <h1 className="commits-title">
            Commits
            <button
              type="button"
              className="branches-toggle"
              aria-expanded={panelOpen}
              title="Branches (/)"
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
                title="Go to HEAD"
                onClick={() => jump(headRow)}
              >
                HEAD → {first.branch ?? `${shortSha(first.head)} (detached)`}
              </button>
            )}
            <span className="commits-tail">
              <span className="commits-help">
                {comparing
                  ? 'Pick two to compare them, or one against its parent · x picks, Enter compares, Esc leaves'
                  : 'j/k move · c checks out · r reviews · x picks to compare · / finds a branch'}
              </span>
              <span className="commits-actions">
                <button
                  type="button"
                  className="start-feature"
                  title="Start a workspace: a branch, its worktree and an agent (n)"
                  onClick={() => openFeature()}
                >
                  Start a workspace
                  <kbd aria-hidden="true">n</kbd>
                </button>
                <button
                  type="button"
                  className="compare-mode"
                  aria-pressed={comparing}
                  title={comparing ? 'Leave compare mode (Esc)' : 'Pick commits to compare (x)'}
                  onClick={() => (comparing ? stopComparing() : onComparing(true))}
                >
                  Compare mode
                  <kbd aria-hidden="true">{comparing ? 'Esc' : 'x'}</kbd>
                </button>
              </span>
            </span>
          </h1>
          {notice && (
            <p className="checkout-notice" role="status">
              {notice.text}
              {notice.warning && <span className="warning"> · {notice.warning}</span>}
              {notice.copy !== undefined && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(notice.copy ?? '')
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false));
                    }}
                  >
                    {copied === null ? 'Copy the prompt' : copied ? 'Copied' : 'Could not copy'}
                  </button>
                </>
              )}
            </p>
          )}
          {error && (
            <p className="commits-error error" role="alert">
              {error}
            </p>
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
      </div>
      {menu && (
        <RowMenu
          at={menu.at}
          items={menuItems(menu)}
          {...(menu.open === 'checkout' ? { open: 0 } : {})}
          {...(menu.open === 'review' && menu.review.length > 0 ? { open: 1 } : {})}
          onClose={closeMenu}
        />
      )}
      {starter.dialog}
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
        <footer className="compare-bar">
          <CompareLabel
            current={current}
            swapped={swapped}
            defaultBranch={shape?.defaultBranch?.name ?? null}
            onJump={jump}
          />
          {compareError && <span className="error">{compareError}</span>}
          {current?.diverged && (
            <button
              type="button"
              className="link"
              title="Compare the other pick from the fork point"
              onClick={() => setSwapped((s) => !s)}
            >
              Swap
            </button>
          )}
          {picks.length > 0 && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setPicks([]);
                setSwapped(false);
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="button compare"
            disabled={!current?.pair || starting}
            onClick={() => current?.pair && void compare(current.pair)}
          >
            {starting ? 'Starting…' : 'Compare'}
          </button>
        </footer>
      )}
    </div>
  );
}

/**
 * What Compare will analyze. Diverged picks (V10c): the fork point's SHA goes to its row, and a
 * note names the other pick, whose commits since the fork are not in the diff.
 */
function CompareLabel({
  current,
  swapped,
  defaultBranch,
  onJump,
}: {
  current: Comparison | null;
  swapped: boolean;
  /** The default branch's name, for why the other pick is the base's side. */
  defaultBranch: string | null;
  onJump: (row: number) => void;
}) {
  const plain = (label: string) => (
    <span className="compare-label">
      <span className="compare-pair">{label}</span>
    </span>
  );
  if (!current) return plain('Pick two commits, or one to compare with its parent');
  const { pair, diverged } = current;
  if (!pair || !diverged) return plain(current.label);
  const fork = shortSha(pair.base);
  const other = shortSha(diverged.other);
  const head = shortSha(pair.head);
  const why = swapped
    ? 'Swapped'
    : {
        default: `${other} is on ${defaultBranch ?? 'the default branch'}`,
        head: `${other} is on the branch checked out`,
        older: `${other} is the older pick`,
      }[diverged.by];
  return (
    <span className="compare-label">
      <span className="compare-pair">
        <button
          type="button"
          className="link fork-sha"
          title="Their fork point: go to its row"
          onClick={() => onJump(diverged.forkRow)}
        >
          {fork}
        </button>
        {current.label.slice(fork.length)}
      </span>
      <span
        className="compare-diverged"
        title={`${why}: this diff shows what ${head} adds since they forked at ${fork}. Swap compares ${other} instead.`}
      >
        {' '}
        · diverged from {other}: its {diverged.otherCommits} commit
        {diverged.otherCommits === 1 ? '' : 's'} since the fork{' '}
        {diverged.otherCommits === 1 ? 'is' : 'are'} not in this diff
      </span>
    </span>
  );
}

function CommitRow({
  row,
  commit,
  now,
  comparing,
  picked,
  cursor,
  flash,
  onClick,
  onMenu,
  graph,
  branch,
  reviewed,
  agents,
  added,
}: {
  row: number;
  /** Not loaded yet: the graph alone, and grey bars. */
  commit: Commit | undefined;
  now: number;
  /** Compare mode: the row shows whether it is picked. */
  comparing: boolean;
  picked: boolean;
  cursor: boolean;
  /** Just gone to from the branches panel. */
  flash: boolean;
  onClick: () => void;
  /** Opens the row's checkout menu at a point of the window. */
  onMenu: (x: number, y: number) => void;
  graph: ReactNode;
  /** The branch checked out (null when HEAD is detached), for HEAD's badge. */
  branch: string | null;
  /** Each reviewed branch's mark, by ref name (V15, V16). */
  reviewed: ReadonlyMap<string, ReviewMark>;
  /** Each feature's mark by ref name, a link to the feature (V18b). */
  agents: ReadonlyMap<string, AgentChip & { href: string }>;
  /** The reviewed branches this commit was added to since their review. */
  added?: string[];
}) {
  const style = { top: row * ROW_HEIGHT, height: ROW_HEIGHT };
  if (!commit) {
    return (
      <li
        className={`commit loading${cursor ? ' cursor' : ''}${flash ? ' flash' : ''}`}
        style={style}
      >
        {graph}
        {comparing && <span className="commit-pick" />}
        <span className="loading-bar sha-bar" />
        <span className="loading-bar subject-bar" />
      </li>
    );
  }
  const head = commit.refs.some((ref) => ref.kind === 'head');
  return (
    <li
      className={`commit${head ? ' head' : ''}${picked ? ' picked' : ''}${cursor ? ' cursor' : ''}${flash ? ' flash' : ''}`}
      style={style}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    >
      {graph}
      {comparing && (
        <span className="commit-pick" role="img" aria-label={picked ? 'picked' : 'not picked'}>
          {picked ? '●' : '○'}
        </span>
      )}
      <code className="commit-sha">{shortSha(commit.sha)}</code>
      {added && (
        <span
          className="review-new"
          role="img"
          aria-label={`new since your review of ${added.join(', ')}`}
          title={`New since your review of ${added.join(', ')}`}
        />
      )}
      <span className="commit-subject" title={commit.subject}>
        {commit.subject}
      </span>
      {rowBadges(commit.refs, branch, reviewed, agents).map((badge) => (
        <span
          key={`${badge.kind}:${badge.label}`}
          className={`ref ref-${badge.kind}`}
          // A badge cut short (a narrow window, a long name) is named in full on hover.
          title={badge.title ?? badge.label}
        >
          {badge.agent && <FeatureMark chip={badge.agent} />}
          {badge.label}
          {badge.review && (
            <span
              className={`ref-review ref-review-${badge.review.tone}`}
              title={badge.review.title}
            >
              {badge.review.mark}
            </span>
          )}
        </span>
      ))}
      <span className="commit-author">{commit.author}</span>
      <time
        className="commit-date"
        dateTime={commit.date}
        title={new Date(commit.date).toLocaleString()}
      >
        {relativeDate(commit.date, now)}
      </time>
      <button
        type="button"
        className="link commit-menu"
        title="Check out… (c)"
        aria-label="Check out…"
        onClick={(event) => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(box.right - 8, box.bottom);
        }}
      >
        ⋯
      </button>
    </li>
  );
}

const PHASES: Record<string, string> = {
  checkout: 'checking out',
  loadBase: 'loading base',
  loadHead: 'loading head',
  extract: 'extracting symbols',
  references: 'finding references',
  findings: 'looking for findings',
};

const pairLabel = ({ base, head }: Pair) => `${shortSha(base)} → ${shortSha(head)}`;

/** A diff being analyzed, failed or stopped: what is happening, and the ways out. */
export function DiffProgress({
  loaded,
  onRetry,
}: {
  loaded: Exclude<Loaded, { kind: 'graph' }>;
  onRetry: (pair: Pair) => void;
}) {
  const [stopping, setStopping] = useState(false);
  const pair = loaded.pair;
  if (!pair) return null;

  if (loaded.kind === 'progress') {
    const seconds = Math.round(loaded.elapsedMs / 1000);
    const what =
      loaded.queued > 0
        ? `waiting for ${loaded.queued} other analysis${loaded.queued === 1 ? '' : 'es'}`
        : (PHASES[loaded.phase ?? ''] ?? 'starting');
    return (
      <div className="diff-progress" role="status">
        <p>
          Analyzing {pairLabel(pair)} — <span className="diff-phase">{what}</span> · {seconds} s
        </p>
        <button
          type="button"
          className="button"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void stopDiff(pair).finally(() => window.location.assign(COMMITS_PAGE));
          }}
        >
          Stop
        </button>{' '}
        <BackToCommits />
      </div>
    );
  }
  return (
    <div className="diff-progress">
      {loaded.kind === 'failed' ? (
        <>
          <p>Analyzing {pairLabel(pair)} failed:</p>
          <pre className="error">{loaded.error}</pre>
        </>
      ) : (
        <p>{pairLabel(pair)} is not analyzed: its analysis was stopped.</p>
      )}
      <button type="button" className="button" onClick={() => onRetry(pair)}>
        Analyze again
      </button>{' '}
      <BackToCommits />
    </div>
  );
}
