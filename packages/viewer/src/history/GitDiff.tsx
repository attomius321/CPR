// One file's diff in Git's details pane (V66b, c): git's diff, read and folded as the Files page's
// (V60), drawn with its rows.
import { useEffect, useMemo, useState } from 'react';
import { foldRows, parseFileDiff, type FileDiff } from '../diff/file-diff.js';
import { LineNumber } from '../diff/DetailPanel.js';

type Loaded =
  { status: 'loading' } | { status: 'ready'; diff: FileDiff } | { status: 'failed'; error: string };

/** Rows drawn before "Show all": a long file's diff stays quick to open. */
const MAX_ROWS = 2000;

/**
 * The diff of `path` that `load` reads (git's text, or null when there is none): its changes
 * with 3 lines around them, the rest folded; a fold opens on a click.
 */
export function GitDiff({ path, load }: { path: string; load: () => Promise<string | null> }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    setLoaded({ status: 'loading' });
    setOpened(new Set());
    setAll(false);
    load()
      .then((text) => {
        if (live)
          setLoaded({
            status: 'ready',
            diff: text === null ? { kind: 'none' } : parseFileDiff(text),
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
  if (loaded.status === 'loading') return <p className="hint git-diff-note">Reading the diff…</p>;
  if (loaded.status === 'failed')
    return <p className="hint error git-diff-note">Could not read the diff: {loaded.error}</p>;
  if (loaded.diff.kind === 'binary')
    return <p className="hint git-diff-note">A binary file: no lines to show.</p>;
  if (loaded.diff.kind === 'none')
    return <p className="hint git-diff-note">No line changed: its name or mode only.</p>;
  let count = 0;
  const cut = all ? -1 : folds.findIndex((fold) => fold.kind === 'row' && ++count > MAX_ROWS);
  const drawn = cut < 0 ? folds : folds.slice(0, cut);
  return (
    <div className="code git-diff" role="table" aria-label={`Diff of ${path}`}>
      {drawn.map((fold) =>
        fold.kind === 'row' ? (
          <div key={fold.index} className={`row row-${fold.row.type}`} role="row">
            <LineNumber row={fold.row} side="base" onOpen={undefined} />
            <LineNumber row={fold.row} side="head" onOpen={undefined} />
            <span className="mark">
              {fold.row.type === 'add' ? '+' : fold.row.type === 'del' ? '−' : ' '}
            </span>
            <span className="text">{fold.row.text}</span>
          </div>
        ) : (
          <button
            key={`gap-${fold.start}`}
            type="button"
            className="fold"
            onClick={() => setOpened((current) => new Set(current).add(fold.start))}
          >
            {fold.end - fold.start} unchanged line{fold.end - fold.start === 1 ? '' : 's'}
          </button>
        ),
      )}
      {cut >= 0 && (
        <button type="button" className="more" onClick={() => setAll(true)}>
          Show all {rows.length} lines
        </button>
      )}
    </div>
  );
}
