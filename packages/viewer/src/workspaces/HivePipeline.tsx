// A Hive workspace's pipeline card (V93, decision 884; spikes/hive-redesign's proofs 02, 03, 07):
// `hive-pipeline.ts`'s words on the shared card, a mark a round under Round and the spend against
// its budget under Spend; it ticks only while Hive checks or reviews.
import type { ReactNode } from 'react';
import type { WorkspaceHiveDetail } from '@symbiote/core';
import { Pipeline, type PipelineState } from '../ui/Pipeline.js';
import { useSecondsWhile } from './clock.js';
import { Since } from './HeadSteps.js';
import { hivePipeline, type RoundMark } from './hive-pipeline.js';
import type { StepsModel } from './workspace-steps.js';

const ROUND_WORDS: Record<RoundMark, string> = {
  fail: 'failed',
  ok: 'landed',
  run: 'running',
  todo: 'to come',
};

/** Dollars as the proofs write a budget: "$5", "$1.92". */
const dollars = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export function HivePipeline({
  model,
  detail,
  into,
  commits,
  push,
  created,
  landed,
  icon,
}: {
  model: StepsModel;
  detail: WorkspaceHiveDetail;
  into: string;
  commits: number;
  push: boolean;
  created: string;
  landed: string | undefined;
  icon: (name: string, state: PipelineState) => ReactNode;
}) {
  const tick = useSecondsWhile(detail.live !== undefined);
  const words = hivePipeline(model, detail, { into, commits, push, now: tick || Date.now() });
  const spend = detail.spend;
  const finished = landed !== undefined || detail.step === 'stuck';
  return (
    <Pipeline
      label="Its steps"
      steps={words.steps.map((step) => ({
        name: step.name,
        state: step.state,
        detail: step.detail,
        icon: icon(step.name, step.state),
        progress: step.progress,
      }))}
      cells={[
        {
          label: finished ? 'Rounds' : 'Round',
          value: (
            <>
              {detail.round} <small>of {detail.rounds}</small>
            </>
          ),
          words: (
            <span
              className="pipeline-rounds"
              role="img"
              aria-label={words.rounds
                .map((mark, i) => `Round ${i + 1} ${ROUND_WORDS[mark]}`)
                .join(', ')}
            >
              {words.rounds.map((mark, i) => (
                <i key={i} className={`is-${mark}`} />
              ))}
            </span>
          ),
        },
        {
          label: 'Time',
          value: (
            <Since
              since={created}
              {...(landed ? { until: landed } : words.ended ? { until: words.ended } : {})}
            />
          ),
          words: landed ? 'brief to landed' : words.ended ? 'brief to stop' : 'since the brief',
        },
        ...(spend
          ? [
              {
                label: 'Spend',
                value: (
                  <>
                    {dollars(Number(spend.total.toFixed(2)))}
                    {spend.budget !== undefined && <small> of {dollars(spend.budget)}</small>}
                  </>
                ),
                words:
                  spend.budget !== undefined && spend.budget > 0 ? (
                    <span className="pipeline-bar" aria-hidden="true">
                      <i
                        style={{ width: `${Math.min(100, (spend.total / spend.budget) * 100)}%` }}
                      />
                    </span>
                  ) : (
                    'no budget'
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}
