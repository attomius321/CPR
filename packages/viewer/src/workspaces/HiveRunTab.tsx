// A Hive workspace's Run tab (V92, decisions 860–867; its Review tab since HV3): a stop or a
// landing first, then each round on a timeline — the writer's commits, the check's commands with
// their times and the log's tail while it runs, the running review and its proven defects as cards,
// the landing — the round Hive is on open and the older ones folded to a line. HV8's request and
// HV5's pause above them. Its facts and spend are the side card's (`RunFacts`).
import { useState } from 'react';
import type {
  HiveLanding,
  HiveRequest,
  WorkspaceCommit,
  WorkspaceHiveDetail,
  WorkspaceSummary,
} from '@symbiote/core';
import { ChevronIcon, CommentIcon, FailedIcon, MergeIcon } from '../ui/icons.js';
import { StatusLabel, type StatusTone } from '../ui/StatusLabel.js';
import { useSeconds } from './clock.js';
import { clockWords } from './hive-live.js';
import {
  landingOutcome,
  pauseWords,
  requestKind,
  requestName,
  requestState,
  reviewWords,
  stepWords,
} from './hive-rounds.js';
import { landedWords, runRounds, stopWords, type RunRound } from './run-timeline.js';
import { Loading } from '../ui/Loading.js';
import { hm, short } from './run-words.js';
import { FullLog } from './RunLog.js';
import { CheckItem, LandItem, ReviewItem, WriterItem } from './RoundItems.js';

/** A step on the timeline: done, running, failed or still to come. */
const TONES: Record<RunRound['status']['tone'], StatusTone> = {
  run: 'run',
  ok: 'ok',
  fail: 'error',
  warn: 'warning',
};

/** A round open: its head, then its steps on the timeline. */
function OpenRound({
  branch,
  round,
  detail,
  into,
  onFold,
}: {
  branch: string;
  round: RunRound;
  detail: WorkspaceHiveDetail;
  into: string;
  /** An older round opened: folds it again. */
  onFold?: () => void;
}) {
  const live = round.current ? detail.live : undefined;
  const writing = round.current && detail.step === 'writing';
  const span =
    round.current && round.status.tone === 'run' && round.from !== undefined
      ? `started ${hm(round.from)}`
      : round.from !== undefined && round.to !== undefined
        ? `${hm(round.from)} – ${hm(round.to)}`
        : '';
  const lands = round.current;
  return (
    <section className="run-round" aria-label={`Round ${round.round}`}>
      <div className="run-round-head">
        <h3>Round {round.round}</h3>
        <StatusLabel tone={TONES[round.status.tone]}>{round.status.text}</StatusLabel>
        {span && <span className="run-when">{span}</span>}
        {onFold && (
          <button
            type="button"
            className="icon-button run-fold"
            aria-label={`Fold round ${round.round}`}
            onClick={onFold}
          >
            <ChevronIcon open />
          </button>
        )}
      </div>
      <ol className="run-items">
        <WriterItem round={round} running={writing} />
        <CheckItem branch={branch} round={round} live={live?.kind === 'check' ? live : undefined} />
        <ReviewItem
          branch={branch}
          round={round}
          live={live?.kind === 'review' ? live : undefined}
          last={!lands}
        />
        {lands && <LandItem detail={detail} into={into} />}
      </ol>
    </section>
  );
}

/** An older round, folded to a line (decision 861): a click opens it. */
function FoldedRound({ round, onOpen }: { round: RunRound; onOpen: () => void }) {
  return (
    <button type="button" className="run-folded" onClick={onOpen} aria-expanded={false}>
      <ChevronIcon open={false} />
      <b>Round {round.round}</b>
      <StatusLabel tone={TONES[round.status.tone]}>{round.status.text}</StatusLabel>
      {round.gist && <span className="run-gist">{round.gist}</span>}
      {round.facts && <span className="run-when">{round.facts}</span>}
    </button>
  );
}

/** The pull or merge request Hive opened (HV8): its link, state and Symbiote's review on it. */
function RequestLine({ request }: { request: HiveRequest }) {
  const state = requestState(request);
  const tone = state.tone === 'ok' ? 'ok' : state.tone === 'bad' ? 'error' : 'you';
  return (
    <p className="run-request" aria-label={`${requestKind(request)} ${requestName(request)}`}>
      <StatusLabel tone={tone}>{state.text}</StatusLabel>
      <a href={request.url} target="_blank" rel="noreferrer">
        {requestName(request)}
      </a>
      <span className="run-why">
        at <code>{short(request.at)}</code> · {reviewWords(request)}
      </span>
    </p>
  );
}

/** A landing that did not land (HV4): why, its lines, its log. */
function FailedLanding({
  branch,
  landing,
  request,
}: {
  branch: string;
  landing: HiveLanding;
  request: HiveRequest | undefined;
}) {
  return (
    <p className="run-line run-landing-failed">
      <StatusLabel tone="error">Not landed</StatusLabel>
      {landingOutcome(landing, landing.via === 'request' ? request : undefined)}
      {landing.log && (
        <FullLog branch={branch} log={landing.log} label={`The merge into ${landing.into}`} />
      )}
    </p>
  );
}

/** The Run tab of a workspace Hive drives. */
export function HiveRunTab({
  workspace,
  detail,
  error,
  commits,
  onMessage,
}: {
  workspace: Pick<WorkspaceSummary, 'branch' | 'created' | 'from'>;
  detail: WorkspaceHiveDetail | null;
  error: string | null;
  /** The branch's commits, newest first, from the changes read the side card shares. */
  commits: readonly WorkspaceCommit[];
  /** Message the writer: the Thread's box, the one way to send it a message. */
  onMessage: () => void;
}) {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const now = useSeconds();
  const branch = workspace.branch;
  if (error) {
    return (
      <div className="run-tab">
        <p className="hive-line error" role="alert">
          Hive&apos;s rounds could not be read: {error}
        </p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="run-tab">
        <Loading className="hint">Reading Hive&apos;s rounds…</Loading>
      </div>
    );
  }
  const rounds = runRounds(detail, commits, workspace.created);
  const stop = stopWords(detail);
  const landed = landedWords(detail);
  const failedLandings = (detail.landings ?? []).filter(
    (l) => l.outcome !== undefined && l.outcome !== 'landed',
  );
  const lastCheck = detail.checks.at(-1);
  const into = workspace.from ?? 'main';
  const toggle = (n: number) =>
    setOpened((all) => {
      const next = new Set(all);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const ended = detail.step === 'landed' || detail.step === 'answered';
  return (
    <div className="run-tab">
      {stop && (
        <section className="run-callout is-fail" role="alert" aria-label={stop.title}>
          <span className="run-callout-icon" aria-hidden="true">
            <FailedIcon />
          </span>
          <div className="run-callout-body">
            <h2>{stop.title}</h2>
            <p>{stop.why}</p>
            {lastCheck && !lastCheck.ok && (lastCheck.output || lastCheck.failed) && (
              <pre className="run-output">
                {lastCheck.failed && (
                  <span className="run-output-head">
                    {lastCheck.failed}{' '}
                    <span className="run-faint">failed after {clockWords(lastCheck.ms)}</span>
                    {'\n'}
                  </span>
                )}
                {lastCheck.output}
              </pre>
            )}
            <div className="run-actions">
              <button type="button" className="button primary hive" onClick={onMessage}>
                <CommentIcon />
                Message the writer
              </button>
              {lastCheck?.log && (
                <FullLog
                  branch={branch}
                  log={lastCheck.log}
                  label={`The check of round ${lastCheck.round}`}
                />
              )}
              <span className="run-faint">A message starts its rounds again.</span>
            </div>
          </div>
        </section>
      )}
      {landed && (
        <section className="run-callout is-ok" role="status" aria-label={landed.title}>
          <span className="run-callout-icon" aria-hidden="true">
            <MergeIcon />
          </span>
          <div className="run-callout-body">
            <h2>{landed.title}</h2>
            <p>{landed.line}</p>
          </div>
          {landed.at && <span className="run-when">{hm(landed.at)}</span>}
        </section>
      )}
      {detail.request && !landed && <RequestLine request={detail.request} />}
      {detail.pause && (
        <p className="run-line" role="status">
          <StatusLabel tone="info">Paused</StatusLabel>
          {pauseWords(detail.pause, now).replace(/^Paused: /, '')}
        </p>
      )}
      {!detail.on && !ended && (
        <p className="run-line">
          <StatusLabel tone="idle">Hive off</StatusLabel>
          {stepWords(detail, now).replace(/^Hive is off: /, '')}
        </p>
      )}
      {failedLandings.map((landing) => (
        <FailedLanding
          key={`${landing.entry}-${landing.queued}`}
          branch={branch}
          landing={landing}
          request={detail.request}
        />
      ))}
      {rounds.map((round) =>
        round.current || opened.has(round.round) ? (
          <OpenRound
            key={round.round}
            branch={branch}
            round={round}
            detail={detail}
            into={into}
            {...(round.current ? {} : { onFold: () => toggle(round.round) })}
          />
        ) : (
          <FoldedRound key={round.round} round={round} onOpen={() => toggle(round.round)} />
        ),
      )}
    </div>
  );
}
