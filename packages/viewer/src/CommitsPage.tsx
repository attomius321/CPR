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
  CheckoutResult,
  CheckoutTarget,
  Commit,
  CommitRef,
  HistoryPage,
  HistoryScope,
  HistoryShape,
  RefList,
  RepoStatus,
} from '@cpr/core';
import { checkedOut, checkoutChoices, type CheckoutChoice } from './checkout.js';
import { CheckoutDialog, CheckoutMenu } from './CheckoutMenu.js';
import {
  BLOCK,
  blocksAround,
  comparison,
  graphLoaded,
  parentRows,
  pick,
  relativeDate,
  shortSha,
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
    <a className="back" href={COMMITS_PAGE} title="Pick other commits">
      ← Commits
    </a>
  );
}

const scopeOfUrl = (): HistoryScope =>
  new URLSearchParams(window.location.search).get('scope') === 'current' ? 'current' : 'all';

/** What the page says after a checkout, above the rows. */
interface Notice {
  text: string;
  warning?: string;
}

/**
 * The repository's history as a graph (V10): every branch, or the current one ("This branch",
 * `?scope=current`). Click (or x) picks one end, another the other end; the older is the base.
 * Compare (Enter) opens the diff; "This commit" compares one with its parent. A row's menu
 * (right-click, "⋯" or c) checks out its branches, tags or the commit (V11).
 */
export function CommitsPage() {
  const [scope, setScope] = useState(scopeOfUrl);
  // Listing anew (after a checkout, or a change made elsewhere) starts a new generation.
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const choose = (next: HistoryScope) => {
    window.history.replaceState(null, '', next === 'all' ? COMMITS_PAGE : '?scope=current');
    setNotice(null);
    setScope(next);
  };
  const relist = useCallback((next: Notice | null) => {
    setNotice(next);
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
    />
  );
}

function History({
  scope,
  onScope,
  notice,
  onRelist,
}: {
  scope: HistoryScope;
  onScope: (scope: HistoryScope) => void;
  notice: Notice | null;
  onRelist: (notice: Notice | null) => void;
}) {
  const [first, setFirst] = useState<HistoryPage | null>(null);
  const [shape, setShape] = useState<HistoryShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  // Rows' details by row number, filled block by block; `loaded` re-renders when one arrives.
  const details = useRef(new Map<number, Commit>());
  const asked = useRef(new Set<number>());
  const [, setLoaded] = useState(0);
  const [picks, setPicks] = useState<Picked[]>([]);
  const [cursor, setCursor] = useState(0);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState({ top: 0, height: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const placed = useRef(false);
  // A row's checkout menu, then its confirmation (V11).
  const [menu, setMenu] = useState<{
    at: { x: number; y: number };
    choices: CheckoutChoice[];
    status: RepoStatus;
  } | null>(null);
  const [confirm, setConfirm] = useState<{ choice: CheckoutChoice; status: RepoStatus } | null>(
    null,
  );
  const [checkingOut, setCheckingOut] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

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

  // Details of the rows near the view, a block at a time.
  useEffect(() => {
    if (!first || rows === 0) return;
    for (const block of blocksAround(firstShown, lastShown, rows)) {
      if (asked.current.has(block)) continue;
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
    }
  }, [first, rows, firstShown, lastShown, scope, failed]);

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

  // The cursor starts on HEAD's row, once it is known.
  useLayoutEffect(() => {
    if (placed.current || headRow === null) return;
    placed.current = true;
    setCursor(headRow);
    if ((headRow + 1) * ROW_HEIGHT > view.height) reveal(headRow, true);
  }, [headRow, view.height, reveal]);

  const compare = useCallback(async (pair: Pair) => {
    setStarting(true);
    setError(null);
    try {
      window.location.assign(await startDiff(pair));
    } catch (e) {
      setError(`Could not compare: ${(e as Error).message}`);
      setStarting(false);
    }
  }, []);

  /** Opens row `row`'s checkout menu at a point of the window. */
  const openMenu = useCallback((row: number, x: number, y: number) => {
    const commit = details.current.get(row);
    if (!commit) return;
    setCursor(row);
    Promise.all([fetchJson<RefList>('api/refs'), fetchJson<RepoStatus>('api/status')])
      .then(([refs, status]) =>
        setMenu({ at: { x, y }, choices: checkoutChoices(commit, refs, status), status }),
      )
      .catch((e: unknown) => setError(`Could not read the branches: ${(e as Error).message}`));
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

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

  const current = comparison(picks, parents);
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
  }, []);

  // j/k move, x picks, Enter compares: as in the change list. Attached as the rows are drawn
  // (a layout effect), not after the paint: a key pressed as soon as they show is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement) return;
      // The menu and the confirmation take their own keys.
      if (menu || confirm) return;
      if (event.key === 'j' || event.key === 'k') {
        const next = Math.max(0, Math.min(rows - 1, cursor + (event.key === 'j' ? 1 : -1)));
        setCursor(next);
        reveal(next);
      } else if (event.key === 'x') pickRow(cursor);
      else if (event.key === 'c') {
        const box = list.current?.querySelector('.commit.cursor')?.getBoundingClientRect();
        if (box) openMenu(cursor, box.left + 48, box.bottom);
      } else if (
        event.key === 'Enter' &&
        // A focused button takes Enter itself.
        !(event.target instanceof HTMLButtonElement) &&
        current &&
        !starting
      ) {
        event.preventDefault();
        void compare(current);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, current, starting, compare, pickRow, reveal, menu, confirm, openMenu]);

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
    <div className="commits">
      <div className="commits-scroll" ref={scroller} onScroll={measure}>
        <h1 className="commits-title">
          Commits
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
          <span className="commits-help">
            Pick two to compare them, or one against its parent · j/k move, x picks, Enter compares,
            c checks out
          </span>
        </h1>
        {notice && (
          <p className="checkout-notice" role="status">
            {notice.text}
            {notice.warning && <span className="warning"> · {notice.warning}</span>}
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
                  picked={!!commit && picked.has(commit.sha)}
                  cursor={row === cursor}
                  onPick={() => {
                    setCursor(row);
                    pickRow(row);
                  }}
                  onThis={() => {
                    const parent = commit?.parents[0];
                    if (commit && parent) void compare({ base: parent, head: commit.sha });
                  }}
                  disabled={starting}
                  onMenu={(x, y) => openMenu(row, x, y)}
                  graph={
                    lane && (
                      <GraphCell
                        row={lane}
                        index={row}
                        spacing={spacing}
                        width={graphWidth}
                        merge={(parents[row]?.length ?? 0) > 1}
                        picked={!!commit && picked.has(commit.sha)}
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
      {menu && (
        <CheckoutMenu
          choices={menu.choices}
          at={menu.at}
          onClose={closeMenu}
          onChoose={(choice) => {
            setMenu(null);
            if (choice.disabled) return;
            setRefused(null);
            setConfirm({ choice, status: menu.status });
          }}
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
      <footer className="compare-bar">
        <span className="compare-label">
          {current ? current.label : 'Pick two commits, or one to compare with its parent'}
        </span>
        {error && <span className="error">{error}</span>}
        {picks.length > 0 && (
          <button type="button" className="link" onClick={() => setPicks([])}>
            Clear
          </button>
        )}
        <button
          type="button"
          className="button compare"
          disabled={!current || starting}
          onClick={() => current && void compare(current)}
        >
          {starting ? 'Starting…' : 'Compare'}
        </button>
      </footer>
    </div>
  );
}

function CommitRow({
  row,
  commit,
  now,
  picked,
  cursor,
  onPick,
  onThis,
  onMenu,
  disabled,
  graph,
}: {
  row: number;
  /** Not loaded yet: the graph alone, and grey bars. */
  commit: Commit | undefined;
  now: number;
  picked: boolean;
  cursor: boolean;
  onPick: () => void;
  onThis: () => void;
  /** Opens the row's checkout menu at a point of the window. */
  onMenu: (x: number, y: number) => void;
  disabled: boolean;
  graph: ReactNode;
}) {
  const style = { top: row * ROW_HEIGHT, height: ROW_HEIGHT };
  if (!commit) {
    return (
      <li className={`commit loading${cursor ? ' cursor' : ''}`} style={style}>
        {graph}
        <span className="commit-pick" />
        <span className="loading-bar sha-bar" />
        <span className="loading-bar subject-bar" />
      </li>
    );
  }
  const root = commit.parents.length === 0;
  return (
    <li
      className={`commit${picked ? ' picked' : ''}${cursor ? ' cursor' : ''}`}
      style={style}
      onClick={onPick}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    >
      {graph}
      <span className="commit-pick" role="img" aria-label={picked ? 'picked' : 'not picked'}>
        {picked ? '●' : '○'}
      </span>
      <code className="commit-sha">{shortSha(commit.sha)}</code>
      <span className="commit-subject" title={commit.subject}>
        {commit.subject}
      </span>
      <RefBadges refs={commit.refs} />
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
        className="link commit-this"
        disabled={root || disabled}
        title={root ? 'The first commit has no parent' : 'Compare this commit with its parent'}
        onClick={(event) => {
          event.stopPropagation();
          onThis();
        }}
      >
        This commit
      </button>
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

/** Badges shown on a row before the rest are folded into "+N" (Qwik tags 9 packages at once). */
const MAX_BADGES = 3;

/** A row's branches and tags: the first few, then "+N" naming the others. */
function RefBadges({ refs }: { refs: readonly CommitRef[] }) {
  const shown = refs.length > MAX_BADGES ? refs.slice(0, MAX_BADGES - 1) : refs;
  const folded = refs.slice(shown.length);
  return (
    <>
      {shown.map((ref) => (
        <span key={`${ref.kind}:${ref.name}`} className={`ref ref-${ref.kind}`}>
          {ref.name}
        </span>
      ))}
      {folded.length > 0 && (
        <span className="ref ref-more" title={folded.map((ref) => ref.name).join('\n')}>
          +{folded.length}
        </span>
      )}
    </>
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
