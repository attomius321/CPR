import type { ReactNode } from 'react';
import { ArrowDownIcon, CheckIcon } from '../ui/icons.js';
import { plural } from '../ui/plural.js';
import { tip } from '../ui/tip.js';
import type { ProgressLine } from './review.js';

/**
 * How far the review is, one line on both pages (V108, decision 984; V90's line on Graph before):
 * files viewed, symbols reviewed, the findings left on symbols not reviewed, a bar that fills when
 * nothing is left, and Next, the page's next thing left.
 */
export function ReviewProgress({
  progress,
  next,
  elsewhere,
}: {
  progress: ProgressLine;
  /** The page's next thing left, named for its button; absent when the page has none left. */
  next?: { label: string; onNext: () => void } | undefined;
  /** What is left only on the other page, shown in Next's place (Graph: files with no symbol). */
  elsewhere?: ReactNode;
}) {
  const { files, items, findings, bar } = progress;
  const done = bar.total > 0 && bar.done === bar.total;
  // A stylesheet counts once (V105, decision 980).
  const symbols =
    items.sheets === 0 ? (
      <span>
        {items.done} of {plural(items.total, 'symbol')} reviewed
      </span>
    ) : (
      <span
        {...tip(
          `${plural(items.total - items.sheets, 'symbol')} and ${plural(items.sheets, 'stylesheet')}: a stylesheet's rules count as one`,
        )}
      >
        {items.done} of {plural(items.total, 'change')} reviewed
      </span>
    );
  return (
    <div className={`review-progress${done ? ' done' : ''}`}>
      {done ? (
        <p className="review-progress-words">
          <CheckIcon />
          <span>
            Done: {plural(files.total, 'file')} viewed
            {items.total > 0 &&
              `, ${plural(items.total, items.sheets === 0 ? 'symbol' : 'change')} reviewed`}
          </span>
        </p>
      ) : (
        <p className="review-progress-words">
          <span>
            {files.done} of {plural(files.total, 'file')} viewed
          </span>
          {items.total > 0 && symbols}
        </p>
      )}
      <div className="review-progress-bar">
        <div
          className="progress"
          role="progressbar"
          aria-label="Review progress"
          aria-valuemin={0}
          aria-valuemax={bar.total}
          aria-valuenow={bar.done}
        >
          <div style={{ width: `${bar.total ? (bar.done / bar.total) * 100 : 0}%` }} />
        </div>
        {findings > 0 && (
          <span
            className="review-progress-findings"
            {...tip('Findings the Findings tab lists, on symbols not reviewed yet')}
          >
            {plural(findings, 'finding')} left
          </span>
        )}
        {next ? (
          <button
            type="button"
            className="review-next"
            aria-label={next.label}
            {...tip(next.label)}
            onClick={next.onNext}
          >
            Next
            <ArrowDownIcon />
          </button>
        ) : (
          !done && elsewhere
        )}
      </div>
    </div>
  );
}
