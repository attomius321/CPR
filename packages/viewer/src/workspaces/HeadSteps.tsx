// A workspace's steps in its head (V89, decisions 823–825): the track, the step's word and what it
// waits on, then its figures — Commits and Files in normal mode, round, time and spend in Hive.
// Its clocks tick in components of their own, so a second's tick renders them alone.
import type { HiveSpend } from '@symbiote/core';
import { StageTrack } from '../ui/StageTrack.js';
import { useSecondsWhile } from './clock.js';
import { clockWords } from './hive-live.js';
import type { StepsModel } from './workspace-steps.js';
import { tip } from '../ui/tip.js';

/** "0:48", ticking each second from `since` (to `until`, once it ended). */
export function Since({ since, until }: { since: string; until?: string }) {
  const now = useSecondsWhile(until === undefined);
  const end = until === undefined ? now || Date.now() : Date.parse(until);
  return <>{clockWords(end - Date.parse(since))}</>;
}

/** Dollars as Hive's pages say them: "$1.48". */
const dollars = (n: number) => `$${n.toFixed(2)}`;

/** Normal mode's figures: the branch's commits, and the files it changed, committed or not. */
export interface NormalFigures {
  commits: number;
  /** Unknown until its changes are read. */
  files: number | null;
}

/** Hive's figures: how long since the brief (to its landing), and what it spent. */
export interface HiveFigures {
  started: string;
  ended?: string;
  spend?: HiveSpend;
}

export function HeadSteps({
  model,
  normal,
  hive,
}: {
  model: StepsModel;
  normal?: NormalFigures;
  hive?: HiveFigures;
}) {
  return (
    <div className="head-steps" data-tone={model.tone}>
      <StageTrack steps={model.steps} at={model.at} state={model.mark} />
      <span className="head-steps-word">{model.word}</span>
      {(model.detail || model.since) && (
        <span className="head-steps-k">
          {model.detail}
          {model.since && (
            <>
              {model.detail ? ' ' : ''}
              <Since since={model.since} />
            </>
          )}
        </span>
      )}
      {normal && (
        <>
          <span className="head-steps-sep" aria-hidden="true" />
          <span className="head-steps-k">Commits</span>
          <b>{normal.commits}</b>
          {normal.files !== null && (
            <>
              <span className="head-steps-k">Files</span>
              <b>{normal.files}</b>
            </>
          )}
        </>
      )}
      {hive && (
        <>
          <span className="head-steps-sep" aria-hidden="true" />
          <span className="head-steps-k">Time</span>
          <b>
            <Since since={hive.started} {...(hive.ended ? { until: hive.ended } : {})} />
          </b>
          {hive.spend && (
            <span
              className="head-steps-spend"
              {...tip(
                `The writer ${hive.spend.writer === undefined ? 'not read' : dollars(hive.spend.writer)}, ${hive.spend.reviewed} review${hive.spend.reviewed === 1 ? '' : 's'} ${dollars(hive.spend.reviews)}`,
              )}
            >
              <span className="head-steps-k">Spend</span>
              <b>{dollars(hive.spend.total)}</b>
              {hive.spend.budget !== undefined && (
                <span className="head-steps-k">of {dollars(hive.spend.budget)}</span>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
