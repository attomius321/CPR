// One file's diff in Git's details pane (V66b, c): git's diff, read and folded as the Files page's
// (V60), drawn with its rows. An uncommitted modified file's lines and hunks are picked and staged
// or unstaged (decision 642).
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { LinePick } from '@symbiote/core';
import { foldRows, parseFileDiff, type FileDiff } from '../diff/file-diff.js';
import { LineNumber } from '../diff/DetailPanel.js';
import { changeRuns, picksIn } from './actions.js';
import { tip } from '../ui/tip.js';

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; diff: FileDiff; index: string }
  | { status: 'failed'; error: string };

/** Rows drawn before "Show all": a long file's diff stays quick to open. */
const MAX_ROWS = 2000;

/** Staging a file's lines: the side its diff is (staged: lines are unstaged from it). */
export interface Staging {
  staged: boolean;
  /** Stages (or unstages) the lines picked, from the diff whose `index` line was read. */
  onLines: (lines: LinePick[], index: string) => Promise<void>;
}

/**
 * The diff of `path` that `load` reads (git's text, or null when there is none): its changes
 * with 3 lines around them, the rest folded; a fold opens on a click. With `staging`, a changed
 * line is picked by a click on its mark (Shift for a run), and each hunk has its own button.
 */
export function GitDiff({
  path,
  load,
  staging,
}: {
  path: string;
  load: () => Promise<string | null>;
  staging?: Staging;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoaded({ status: 'loading' });
    setOpened(new Set());
    setAll(false);
    setPicked(new Set());
    setLast(null);
    load()
      .then((text) => {
        if (live)
          setLoaded({
            status: 'ready',
            diff: text === null ? { kind: 'none' } : parseFileDiff(text),
            index: /^index .*$/m.exec(text ?? '')?.[0] ?? '',
          });
      })
      .catch((e: unknown) => live && setLoaded({ status: 'failed', error: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [load]);
  const rows = useMemo(
    () => (loaded.status === 'ready' && loaded.diff.kind === 'rows' ? loaded.diff.rows : []),
    [loaded],
  );
  const folds = useMemo(() => foldRows(rows, opened), [rows, opened]);
  const runs = useMemo(() => (staging ? changeRuns(rows) : []), [rows, staging]);
  const runAt = useMemo(() => new Map(runs.map((run) => [run.start, run])), [runs]);
  if (loaded.status === 'loading') return <p className="hint git-diff-note">Reading the diff…</p>;
  if (loaded.status === 'failed')
    return <p className="hint error git-diff-note">Could not read the diff: {loaded.error}</p>;
  if (loaded.diff.kind === 'binary')
    return <p className="hint git-diff-note">A binary file: no lines to show.</p>;
  if (loaded.diff.kind === 'none')
    return <p className="hint git-diff-note">No line changed: its name or mode only.</p>;
  const { index } = loaded;
  const verb = staging?.staged ? 'Unstage' : 'Stage';
  const send = (lines: LinePick[]) => {
    if (!staging || busy || lines.length === 0) return;
    setBusy(true);
    setError(null);
    staging
      .onLines(lines, index)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  /** A click on a line's mark picks it; with Shift, every line from the last picked. */
  const pick = (at: number, run: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      if (run && last !== null) {
        for (let i = Math.min(last, at); i <= Math.max(last, at); i++) next.add(i);
      } else if (!next.delete(at)) next.add(at);
      return next;
    });
    setLast(at);
  };
  const lines = staging ? picksIn(rows, picked) : [];
  let count = 0;
  const cut = all ? -1 : folds.findIndex((fold) => fold.kind === 'row' && ++count > MAX_ROWS);
  const drawn = cut < 0 ? folds : folds.slice(0, cut);
  return (
    <>
      {staging && (lines.length > 0 || error) && (
        <div className="git-picks" role="status">
          {lines.length > 0 && (
            <>
              <span>
                {lines.length} line{lines.length === 1 ? '' : 's'} picked
              </span>
              <button
                type="button"
                className="button git-picks-button"
                disabled={busy}
                onClick={() => send(lines)}
              >
                {busy ? 'Working…' : `${verb} ${lines.length === 1 ? 'it' : 'them'}`}
              </button>
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => setPicked(new Set())}
              >
                Clear
              </button>
            </>
          )}
          {error && <span className="error git-picks-error">{error}</span>}
        </div>
      )}
      <div
        className={`code git-diff${staging ? ' picking' : ''}`}
        role="table"
        aria-label={`Diff of ${path}`}
      >
        {drawn.map((fold) => {
          if (fold.kind === 'gap')
            return (
              <button
                key={`gap-${fold.start}`}
                type="button"
                className="fold"
                onClick={() => setOpened((current) => new Set(current).add(fold.start))}
              >
                {fold.end - fold.start} unchanged line{fold.end - fold.start === 1 ? '' : 's'}
              </button>
            );
          const { row, index: at } = fold;
          const run = runAt.get(at);
          const changed = row.type !== 'same';
          const sign = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
          const line = row.type === 'del' ? row.base : row.head;
          return (
            <Fragment key={at}>
              {run && (
                <div className="git-hunk">
                  <button
                    type="button"
                    className="link git-hunk-button"
                    disabled={busy}
                    {...tip(
                      `${verb} the ${run.picks.length} changed line${run.picks.length === 1 ? '' : 's'} here`,
                    )}
                    onClick={() => send(run.picks)}
                  >
                    {verb} this hunk
                  </button>
                </div>
              )}
              <div
                className={`row row-${row.type}${picked.has(at) ? ' picked' : ''}`}
                role="row"
                aria-selected={staging && changed ? picked.has(at) : undefined}
              >
                <LineNumber row={row} side="base" onOpen={undefined} />
                <LineNumber row={row} side="head" onOpen={undefined} />
                {staging && changed ? (
                  <button
                    type="button"
                    className="mark git-pick"
                    aria-pressed={picked.has(at)}
                    aria-label={`Pick ${row.type === 'add' ? 'added' : 'removed'} line ${line ?? ''}`}
                    onClick={(event) => pick(at, event.shiftKey)}
                  >
                    {sign}
                  </button>
                ) : (
                  <span className="mark">{sign}</span>
                )}
                <span className="text">{row.text}</span>
              </div>
            </Fragment>
          );
        })}
        {cut >= 0 && (
          <button type="button" className="more" onClick={() => setAll(true)}>
            Show all {rows.length} lines
          </button>
        )}
      </div>
    </>
  );
}
