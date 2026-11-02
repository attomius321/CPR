/** Hive's steps (V88, decision 818), as Hive Control draws them. */
export const HIVE_STAGES = ['Write', 'Check', 'Review', 'Land'] as const;

/** Normal mode's steps; Plan and Your OK only when Plan first is on (the normal kit). */
export const NORMAL_STAGES = ['Plan', 'Your OK', 'Build', 'Review', 'Merge'] as const;

/** A hexagon a point up, on a 12 × 13 box. */
const HEX = '6,0.5 11.5,3.5 11.5,9.5 6,12.5 0.5,9.5 0.5,3.5';

/** "A, B and C". */
const list = (words: readonly string[]) =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/**
 * The stage track (V88, decision 818; the kits' `.track`): a workspace's steps as hexagons on a
 * line, those before `at` done (green, joined in green), the one at `at` in progress (amber) or
 * failed (`state: 'bad'`, red), the rest to come; `at` past the last, all done. Its words are its
 * accessible name (`ui/status.css`). Placed by the pages' own redesigns.
 */
export function StageTrack({
  steps,
  at,
  state = 'now',
}: {
  steps: readonly string[];
  at: number;
  state?: 'now' | 'bad';
}) {
  const mark = (i: number) => (i < at ? 'done' : i === at ? state : 'todo');
  const done = steps.slice(0, Math.min(at, steps.length));
  const current = steps[at];
  const later = steps.slice(at + 1);
  const label =
    current === undefined
      ? `${list(done)} done`
      : [
          done.length > 0 && `${list(done)} done`,
          `${current} ${state === 'bad' ? 'failed' : 'now'}`,
          later.length > 0 && `${list(later)} to come`,
        ]
          .filter(Boolean)
          .join(', ');
  return (
    <span className="stage-track" role="img" aria-label={label}>
      {steps.map((step, i) => (
        <span key={step} className="stage-step">
          {i > 0 && <span className={`stage-link${i <= at ? ' done' : ''}`} />}
          <svg className={`stage-hex ${mark(i)}`} viewBox="0 0 12 13" aria-hidden="true">
            <polygon points={HEX} />
          </svg>
        </span>
      ))}
    </span>
  );
}
