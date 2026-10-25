// Compare mode's bar (V13): what Compare will analyze, then Swap (diverged picks, V10c), Clear and
// Compare.
import { shortSha, type Comparison, type Pair } from './commits.js';

/** The bar under History's rows while compare mode is on. */
export function CompareBar({
  current,
  swapped,
  defaultBranch,
  error,
  picked,
  starting,
  onJump,
  onSwap,
  onClear,
  onCompare,
}: {
  current: Comparison | null;
  swapped: boolean;
  /** The default branch's name, for why the other pick is the base's side. */
  defaultBranch: string | null;
  /** Why the last comparison could not start. */
  error: string | null;
  /** Whether a commit is picked: Clear is offered. */
  picked: boolean;
  starting: boolean;
  onJump: (row: number) => void;
  onSwap: () => void;
  onClear: () => void;
  onCompare: (pair: Pair) => void;
}) {
  return (
    <footer className="compare-bar">
      <CompareLabel
        current={current}
        swapped={swapped}
        defaultBranch={defaultBranch}
        onJump={onJump}
      />
      {error && <span className="error">{error}</span>}
      {current?.diverged && (
        <button
          type="button"
          className="button ghost"
          title="Compare the other pick from the fork point"
          onClick={onSwap}
        >
          Swap
        </button>
      )}
      {picked && (
        <button type="button" className="button ghost" onClick={onClear}>
          Clear
        </button>
      )}
      <button
        type="button"
        className="button compare"
        disabled={!current?.pair || starting}
        onClick={() => current?.pair && onCompare(current.pair)}
      >
        {starting ? 'Starting…' : 'Compare'}
      </button>
    </footer>
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
