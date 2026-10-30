// A shown file's history and blame (decision 643): its commits across renames, each a way to its
// row with the file open there; each line's commit, named on the first line of its run.
import { useEffect, useMemo, useState } from 'react';
import type { FileBlame, FileCommit } from '@symbiote/core';
import { blameStarts } from './actions.js';
import { fetchBlame, fetchFileHistory } from './git-api.js';
import { longDate, relativeDate, shortSha } from './commits.js';
import { tip } from '../ui/tip.js';

/** Lines drawn before "Show all", as the diff's. */
const MAX_LINES = 2000;

type Loaded<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed'; error: string };

/** Reads `read` once per change of it: loading, ready or failed. */
function useRead<T>(read: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setLoaded({ status: 'loading' });
    read().then(
      (value) => live && setLoaded({ status: 'ready', value }),
      (e: unknown) => live && setLoaded({ status: 'failed', error: (e as Error).message }),
    );
    return () => {
      live = false;
    };
  }, [read]);
  return loaded;
}

/**
 * The commits that changed `path`, from commit `sha` down (from HEAD for an uncommitted file):
 * the one shown marked; a click goes to its row, the file open there.
 */
export function FileHistory({
  path,
  sha,
  onGo,
}: {
  path: string;
  sha: string | null;
  onGo: (commit: FileCommit) => void;
}) {
  const read = useMemo(() => () => fetchFileHistory(path, sha), [path, sha]);
  const loaded = useRead(read);
  if (loaded.status === 'loading')
    return <p className="hint git-diff-note">Reading its history…</p>;
  if (loaded.status === 'failed')
    return <p className="hint error git-diff-note">Could not read its history: {loaded.error}</p>;
  if (loaded.value.length === 0)
    return <p className="hint git-diff-note">Never committed: no history yet.</p>;
  const now = Date.now();
  return (
    <ol className="git-file-history" aria-label={`History of ${path}`}>
      {loaded.value.map((commit) => (
        <li key={commit.sha}>
          <button
            type="button"
            className={`git-file-commit${commit.sha === sha ? ' current' : ''}`}
            aria-current={commit.sha === sha || undefined}
            {...tip(
              `${commit.subject}\n${commit.author}, ${longDate(commit.date)}${commit.path === path ? '' : `\nAs ${commit.path}`}\nGo to it, the file open there`,
            )}
            onClick={() => onGo(commit)}
          >
            <code className="git-file-sha">{shortSha(commit.sha)}</code>
            <span className="git-file-subject">{commit.subject}</span>
            {commit.path !== path && <span className="chip">{commit.path}</span>}
            <span className="git-file-meta">
              {commit.author} · {relativeDate(commit.date, now)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Each line of `path` at commit `sha` (or in the checkout) and its commit, named on the first
 * line of each run; a click on it goes to that commit, the file open there.
 */
export function FileBlameView({
  path,
  sha,
  onGo,
}: {
  path: string;
  sha: string | null;
  onGo: (commit: { sha: string; path: string }) => void;
}) {
  const read = useMemo(() => () => fetchBlame(path, sha), [path, sha]);
  const loaded = useRead<FileBlame>(read);
  const [all, setAll] = useState(false);
  const starts = useMemo(
    () => (loaded.status === 'ready' ? blameStarts(loaded.value.lines) : new Set<number>()),
    [loaded],
  );
  if (loaded.status === 'loading') return <p className="hint git-diff-note">Reading its blame…</p>;
  if (loaded.status === 'failed')
    return <p className="hint error git-diff-note">Could not blame it: {loaded.error}</p>;
  const { lines, commits } = loaded.value;
  const shown = all ? lines : lines.slice(0, MAX_LINES);
  const now = Date.now();
  return (
    <div className="code git-blame" role="table" aria-label={`Blame of ${path}`}>
      {shown.map((line, i) => {
        const commit = line.sha ? commits[line.sha] : undefined;
        const first = starts.has(i);
        return (
          <div key={i} className={`row git-blame-row${first ? ' first' : ''}`} role="row">
            <span className="git-blame-who">
              {first &&
                (line.sha && commit ? (
                  <button
                    type="button"
                    className="link git-blame-commit"
                    {...tip(
                      `${commit.subject}\n${commit.author}, ${longDate(commit.date)}\nGo to it, the file open there`,
                    )}
                    onClick={() => onGo({ sha: line.sha as string, path: commit.path ?? path })}
                  >
                    <code>{shortSha(line.sha)}</code> {commit.author} ·{' '}
                    {relativeDate(commit.date, now)}
                  </button>
                ) : (
                  <span className="muted">Not committed yet</span>
                ))}
            </span>
            <span className="ln">{i + 1}</span>
            <span className="text">{line.text}</span>
          </div>
        );
      })}
      {!all && lines.length > MAX_LINES && (
        <button type="button" className="more" onClick={() => setAll(true)}>
          Show all {lines.length} lines
        </button>
      )}
    </div>
  );
}
