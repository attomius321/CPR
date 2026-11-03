// The pipeline card (V93, decisions 880, 884; the kits' `run.css` `.pipeline`): steps as hexagons
// on a line, each with its name and a detail, wires between them, and cells at its right end (the
// queue and the time on a merge; the turn, commits, round, time or spend on a workspace).
import type { ReactNode } from 'react';

export type PipelineState = 'done' | 'now' | 'you' | 'todo' | 'bad';

export interface PipelineStep {
  name: string;
  state: PipelineState;
  detail?: ReactNode;
  /** Its mark inside the hexagon (an icon, 13 px). */
  icon: ReactNode;
  /** In progress: how far, 0–1, as a bar under its words. */
  progress?: number | undefined;
}

export interface PipelineCell {
  label: string;
  value: ReactNode;
  /** Under the value. */
  words?: ReactNode;
  /** The value's tone: the person's turn in violet. */
  tone?: 'you';
}

/** A hexagon a point up, on the kits' 26 × 28 node. */
const HEX = '13,1 25,7.5 25,20.5 13,27 1,20.5 1,7.5';

const STATE_WORDS: Record<PipelineState, string> = {
  done: 'done',
  now: 'now',
  you: 'waits for you',
  todo: 'to come',
  bad: 'failed',
};

export function Pipeline({
  steps,
  cells,
  label,
}: {
  steps: readonly PipelineStep[];
  cells: readonly PipelineCell[];
  label: string;
}) {
  return (
    <section className="card pipeline" aria-label={label}>
      <ol className="pipeline-steps">
        {steps.map((step, i) => (
          <li
            key={step.name}
            className={`pipeline-step is-${step.state}`}
            aria-label={`${step.name}, ${STATE_WORDS[step.state]}`}
          >
            <span className="pipeline-node" aria-hidden="true">
              <svg className="pipeline-hex" viewBox="0 0 26 28">
                <polygon points={HEX} />
              </svg>
              {step.icon}
            </span>
            <span className="pipeline-words">
              <span className="pipeline-name">{step.name}</span>
              {step.detail !== undefined && <span className="pipeline-detail">{step.detail}</span>}
              {step.progress !== undefined && (
                <span
                  className="pipeline-progress"
                  role="progressbar"
                  aria-label={`${step.name}, against its last run`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(step.progress * 100)}
                >
                  <i style={{ width: `${step.progress * 100}%` }} />
                </span>
              )}
            </span>
            {i < steps.length - 1 && <span className="pipeline-wire" aria-hidden="true" />}
          </li>
        ))}
      </ol>
      {cells.length > 0 && (
        <dl className="pipeline-cells">
          {cells.map((cell) => (
            <div key={cell.label} className="pipeline-cell">
              <dt>{cell.label}</dt>
              <dd className={`pipeline-value${cell.tone ? ` tone-${cell.tone}` : ''}`}>
                {cell.value}
              </dd>
              {cell.words !== undefined && <dd className="pipeline-cell-words">{cell.words}</dd>}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
