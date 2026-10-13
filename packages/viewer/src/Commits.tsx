import { useCallback, useEffect, useRef, useState } from 'react';
import type { Commit, CommitPage, CommitRef } from '@cpr/core';
import {
  comparison,
  graphLoaded,
  pick,
  relativeDate,
  shortSha,
  type Loaded,
  type Pair,
} from './commits.js';

/** The commits page and the diffs it starts live at the server's root (`cpr view`). */
const COMMITS_PAGE = '/';

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-cpr': '1' };

async function fetchCommits(skip: number): Promise<CommitPage> {
  const response = await fetch(`${COMMITS_PAGE}api/commits?skip=${skip}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as CommitPage;
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

/**
 * The current branch's commits, newest first: click (or x) picks one end, another the other end;
 * the older is the base. Compare (Enter) opens the diff; "This commit" compares one with its
 * parent.
 */
export function CommitsPage() {
  const [page, setPage] = useState<CommitPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [starting, setStarting] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    fetchCommits(0)
      .then(setPage)
      .catch((e: unknown) => setError(`Could not list commits: ${(e as Error).message}`));
  }, []);

  const loadMore = useCallback(async () => {
    if (!page) return;
    setLoadingMore(true);
    try {
      const next = await fetchCommits(page.commits.length);
      setPage({ ...next, commits: [...page.commits, ...next.commits] });
    } catch (e) {
      setError(`Could not list more commits: ${(e as Error).message}`);
    } finally {
      setLoadingMore(false);
    }
  }, [page]);

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

  const commits = page?.commits ?? [];
  const current = comparison(commits, picks);

  // j/k move, x picks, Enter compares: as in the change list.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'j') setCursor((i) => Math.min(i + 1, commits.length - 1));
      else if (event.key === 'k') setCursor((i) => Math.max(i - 1, 0));
      else if (event.key === 'x') {
        const sha = commits[cursor]?.sha;
        if (sha) setPicks((p) => pick(p, sha));
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
  }, [commits, cursor, current, starting, compare]);

  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!page) {
    return <p className={error ? 'hint error' : 'hint'}>{error ?? 'Listing commits…'}</p>;
  }
  const now = Date.now();
  return (
    <div className="commits">
      <div className="commits-scroll">
        <h1 className="commits-title">
          Commits on {page.branch ?? 'a detached HEAD'}
          <span className="commits-help">
            Pick two to compare them, or one against its parent · j/k move, x picks, Enter compares
          </span>
        </h1>
        {commits.length === 0 ? (
          <p className="hint">No commits yet.</p>
        ) : (
          <ol className="commit-list" ref={list} aria-label="Commits">
            {commits.map((commit, i) => (
              <CommitRow
                key={commit.sha}
                commit={commit}
                now={now}
                picked={picks.includes(commit.sha)}
                cursor={i === cursor}
                onPick={() => {
                  setCursor(i);
                  setPicks((p) => pick(p, commit.sha));
                }}
                onThis={() => {
                  const parent = commit.parents[0];
                  if (parent) void compare({ base: parent, head: commit.sha });
                }}
                disabled={starting}
              />
            ))}
          </ol>
        )}
        {page.more && (
          <button
            type="button"
            className="load-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
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
  commit,
  now,
  picked,
  cursor,
  onPick,
  onThis,
  disabled,
}: {
  commit: Commit;
  now: number;
  picked: boolean;
  cursor: boolean;
  onPick: () => void;
  onThis: () => void;
  disabled: boolean;
}) {
  const root = commit.parents.length === 0;
  return (
    <li className={`commit${picked ? ' picked' : ''}${cursor ? ' cursor' : ''}`} onClick={onPick}>
      <span className="commit-pick" role="img" aria-label={picked ? 'picked' : 'not picked'}>
        {picked ? '●' : '○'}
      </span>
      <code className="commit-sha">{shortSha(commit.sha)}</code>
      <span className="commit-subject" title={commit.subject}>
        {commit.subject}
      </span>
      {commit.refs.map((ref) => (
        <RefBadge key={`${ref.kind}:${ref.name}`} commitRef={ref} />
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
    </li>
  );
}

function RefBadge({ commitRef }: { commitRef: CommitRef }) {
  return <span className={`ref ref-${commitRef.kind}`}>{commitRef.name}</span>;
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
