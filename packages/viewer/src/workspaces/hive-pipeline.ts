// A Hive workspace's pipeline card in Hive's words (V93, decision 884; spikes/hive-redesign's
// proofs 02, 03 and 07): each step's detail from what Hive recorded — the commits and rounds, the
// command checking and its time against the last passing check, the reviewer, the landing — the
// check's progress, one mark a round, and the head's pill. Pure: `test/hive-pipeline.test.ts`.
import type { WorkspaceHiveDetail } from '@symbiote/core';
import { clockWords, liveWords } from './hive-live.js';
import type { PipelineStepWords, StepsModel } from './workspace-steps.js';
import { modelName } from './workspaces.js';

/** A round's mark: failed, landed, running, or to come. */
export type RoundMark = 'fail' | 'ok' | 'run' | 'todo';

export interface HivePipelineWords {
  steps: (PipelineStepWords & { progress?: number })[];
  rounds: RoundMark[];
  pill: string;
  /** When a stopped run ended: its last check's end, for the time "brief to stop". */
  ended?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A check's time: "38 s", "1:10". */
const tookWords = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : clockWords(ms));

const VERBS: Partial<Record<WorkspaceHiveDetail['step'], string>> = {
  writing: 'Writing',
  checking: 'Checking',
  reviewing: 'Reviewing',
  landing: 'Landing',
};

const VERDICT_WORDS: Record<string, string> = {
  changes: 'changes asked',
  failed: 'failed',
  unavailable: 'unavailable',
};

/** The pipeline card of a Hive workspace from its steps (`hiveSteps`) and Hive's record of it. */
export function hivePipeline(
  model: StepsModel,
  detail: WorkspaceHiveDetail,
  ctx: { into: string; commits: number; push: boolean; now: number },
): HivePipelineWords {
  const { round, rounds } = detail;
  const landed = detail.landings?.findLast((landing) => landing.outcome === 'landed');
  const stopped = detail.step === 'stuck';
  const finished = stopped || landed !== undefined || detail.step === 'answered';
  const live = liveWords(detail, ctx.now);
  const lastOk = detail.checks.findLast((check) => check.ok);
  const lastCheck = detail.checks.at(-1);
  const approved = detail.reviews.findLast((review) => review.verdict === 'approved');
  const lastReview = detail.reviews.at(-1);
  const landTo = `merge queue → ${ctx.into}${ctx.push ? ', push' : ''}`;

  const done: Record<string, () => string> = {
    Write: () =>
      `${plural(ctx.commits, 'commit')}${finished && round > 1 ? ` · ${round} rounds` : ''}`,
    Check: () => (lastOk ? `passed in ${tookWords(lastOk.ms)}` : 'passed'),
    Review: () =>
      approved
        ? `approved${approved.cost !== undefined ? ` · $${approved.cost.toFixed(2)}` : ''}`
        : 'approved',
    Land: () => {
      const sha = (landed?.merge ?? landed?.at ?? '').slice(0, 7);
      if (!sha) return `into ${ctx.into}`;
      return `${sha} in ${landed?.into ?? ctx.into}${landed?.pushed?.ok ? ' · pushed' : ''}`;
    },
  };
  const now: Record<string, () => { detail: string; progress?: number }> = {
    Write: () => ({ detail: 'writing' }),
    Check: () => {
      const check = detail.live?.kind === 'check' ? detail.live : undefined;
      if (!check || !live) return { detail: 'checking' };
      const words = `${check.step + 1} of ${check.commands.length} · ${live.time}`;
      const expected = check.expected?.ms;
      if (!expected) return { detail: words };
      const elapsed = Math.max(0, ctx.now - Date.parse(check.started));
      return { detail: words, progress: Math.min(1, elapsed / expected) };
    },
    Review: () => ({ detail: live ? live.time : 'reviewing' }),
    Land: () => ({ detail: 'in the merge queue' }),
  };
  const bad: Record<string, () => string> = {
    Write: () => 'stopped',
    Check: () => (lastCheck?.failed ? `failed: ${lastCheck.failed}` : 'failed'),
    Review: () => (lastReview ? (VERDICT_WORDS[lastReview.verdict] ?? 'stopped') : 'stopped'),
    Land: () => detail.landings?.at(-1)?.outcome ?? 'stopped',
  };
  const todo: Record<string, () => string> = {
    Write: () => 'the writer',
    Check: () => (stopped ? `not run on round ${round}` : 'the check'),
    Review: () => {
      if (stopped) return `not run on round ${round}`;
      const asked = lastReview?.model;
      return asked
        ? [modelName(asked), lastReview.effort].filter(Boolean).join(' · ')
        : 'proves defects';
    },
    Land: () => (stopped ? 'nothing landed' : landTo),
  };

  // Where it stopped, from Hive's record: the list's summary may not carry its check.
  const at = stopped ? stopAt(detail) : model.at;
  const steps = model.steps.map((name, i) => {
    if (i < at) return { name, state: 'done' as const, detail: done[name]?.() ?? '' };
    if (i > at) return { name, state: 'todo' as const, detail: todo[name]?.() ?? '' };
    if (stopped || model.mark === 'bad')
      return { name, state: 'bad' as const, detail: bad[name]?.() ?? '' };
    return { name, state: model.mark, ...(now[name]?.() ?? { detail: model.detail }) };
  });

  const rounds_: RoundMark[] = Array.from({ length: rounds }, (_, i) => {
    const n = i + 1;
    if (n < round) return 'fail';
    if (n > round) return 'todo';
    if (stopped) return 'fail';
    return landed || detail.step === 'answered' ? 'ok' : 'run';
  });

  const verb = VERBS[detail.step];
  const pill = landed
    ? `Landed in ${landed.into}${landed.pushed?.ok ? ' · pushed' : ''}`
    : stopped
      ? `Stopped · ${round} of ${rounds} rounds`
      : detail.step === 'answered'
        ? 'Answered'
        : `${detail.pause ? 'Paused' : (verb ?? 'Working')} · round ${round} of ${rounds}`;
  const checkEnd =
    lastCheck?.started !== undefined
      ? new Date(Date.parse(lastCheck.started) + lastCheck.ms).toISOString()
      : undefined;
  return { steps, rounds: rounds_, pill, ...(stopped && checkEnd ? { ended: checkEnd } : {}) };
}

/** The step a stopped run stopped at: its landing, else its review, else its check, else Write. */
function stopAt(detail: WorkspaceHiveDetail): number {
  const landing = detail.landings?.at(-1);
  if (landing?.outcome && landing.outcome !== 'landed') return 3;
  const review = detail.reviews.at(-1);
  const check = detail.checks.at(-1);
  if (check && check.round === detail.round && !check.ok) return 1;
  if (review && review.round === detail.round && review.verdict !== 'approved') return 2;
  if (check && !check.ok) return 1;
  return 0;
}
