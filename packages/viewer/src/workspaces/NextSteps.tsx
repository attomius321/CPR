// Start's What happens next (V93, proof 06): the steps from the start to the merge, the person's
// marked.
import type { ReactNode } from 'react';
import { BellIcon, MergeIcon, PencilIcon, ReviewIcon } from '../ui/icons.js';
import type { WorkKind } from '@symbiote/core';
import { whatHappensNext, type NextStep } from './start-next.js';

/** What happens next's marks (V93, proof 06): the person's violet, the rest faint. */
const NEXT_ICONS: Record<NextStep['icon'], ReactNode> = {
  pencil: <PencilIcon />,
  bell: <BellIcon />,
  eye: <ReviewIcon />,
  merge: <MergeIcon />,
};

/** What happens next once it starts, by the run's choices (V93): normal mode's only. */
export function NextSteps({
  planFirst,
  into,
  kind,
  agent,
}: {
  planFirst: boolean;
  /** The branch it merges into: the one it starts from. */
  into: string;
  kind: WorkKind;
  /** An agent is found: without one, the person gives the prompt. */
  agent: boolean;
}) {
  return (
    <section className="start-card start-next" aria-labelledby="start-next-title">
      <div className="card-head">
        <h2 id="start-next-title">What happens next</h2>
      </div>
      <ol className="start-next-steps">
        {whatHappensNext({ planFirst, into, kind, agent }).map((step) => (
          <li key={step.words} className={step.you ? 'you' : undefined}>
            {NEXT_ICONS[step.icon]}
            <span>
              {step.words}
              {step.turn && <b> {step.turn}</b>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
