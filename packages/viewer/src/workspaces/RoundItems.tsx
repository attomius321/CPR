// A round's steps on the Run tab's timeline (V92, decisions 862–864): the writer's commits, the
// check's commands and its log's tail, the review and its proven defects, the landing.
import { useState } from 'react';
import type {
  HiveCheck,
  HiveFinding,
  HiveLive,
  WorkspaceCommit,
  WorkspaceHiveDetail,
} from '@symbiote/core';
import { getJson } from '../ui/http.js';
import {
  ChecksIcon,
  CommitIcon,
  FailedIcon,
  FlaskIcon,
  MergeIcon,
  PencilIcon,
  ReviewIcon,
} from '../ui/icons.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { useSeconds } from './clock.js';
import { aboutWords, checkSteps, clockWords, liveWords } from './hive-live.js';
import {
  costWords,
  findingWords,
  landingOutcome,
  requestKind,
  verdictWords,
} from './hive-rounds.js';
import { checkRows, type RunRound } from './run-timeline.js';
import { modelName } from './run-choices.js';
import { ChecksMark, Item, type ItemState } from './RunItem.js';
import { Loading } from '../ui/Loading.js';
import { enc, hm, short } from './run-words.js';
import { FullLog, useLogTail } from './RunLog.js';

/** A kept test's file: its text read when it is opened. */
function TestFile({ branch, round, path }: { branch: string; round: number; path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <details
      className="hive-more"
      onToggle={(event) => {
        if (!event.currentTarget.open || text !== null) return;
        getJson<{ text: string }>(
          `/api/workspaces/hive/test?branch=${enc(branch)}&round=${round}&path=${enc(path)}`,
        )
          .then((read) => setText(read.text))
          .catch((failed: unknown) => setError((failed as Error).message));
      }}
    >
      <summary>
        <code>{path}</code>
      </summary>
      {error ? (
        <p className="hive-line error">{error}</p>
      ) : text === null ? (
        <Loading className="hint">Reading…</Loading>
      ) : (
        <pre>{text}</pre>
      )}
    </details>
  );
}

/**
 * A proven defect as a card (decision 864): Proven, the defect, its test and command, Symbiote's
 * rerun; a dropped finding one faint line with why.
 */
function Defect({
  branch,
  round,
  finding,
}: {
  branch: string;
  round: number;
  finding: HiveFinding;
}) {
  const words = findingWords(finding);
  if (!finding.kept) {
    return (
      <p className="run-dropped">
        <span className="chip">{words.text}</span> {finding.defect}
        {words.why && <span className="run-why"> · {words.why}</span>}
      </p>
    );
  }
  return (
    <div className="run-defect">
      <p className="run-defect-what">
        <StatusLabel tone="error" icon={<FlaskIcon />}>
          {words.text}
        </StatusLabel>
        <span>{finding.defect}</span>
      </p>
      <p className="run-defect-how">
        {finding.test && <span className="run-defect-test">{finding.test}</span>}
        <code>{finding.command}</code>
        <span className="run-defect-rerun">
          rerun by Symbiote{finding.code != null ? ` · exit ${finding.code}` : ''}
        </span>
      </p>
      {finding.files.map((path) => (
        <TestFile key={path} branch={branch} round={round} path={path} />
      ))}
      {finding.output && (
        <details className="hive-more">
          <summary>Symbiote&apos;s rerun</summary>
          <pre>{finding.output}</pre>
        </details>
      )}
    </div>
  );
}

/** The writer's commits in a round, its lines and its time. */
export function WriterItem({ round, running }: { round: RunRound; running: boolean }) {
  const { writer } = round;
  const lines = writer.commits.length > 0;
  return (
    <Item
      name="Writer"
      state={running ? 'run' : 'ok'}
      icon={<PencilIcon />}
      words={running && !lines ? 'writing' : writer.words}
      end={
        <>
          {lines && (
            <span className="run-lines">
              <span className="add">+{writer.added}</span>{' '}
              <span className="del">−{writer.removed}</span>
            </span>
          )}
          {writer.ms !== undefined && <span>{clockWords(writer.ms)}</span>}
        </>
      }
    >
      {lines && (
        <ul className="run-commits" aria-label="Its commits">
          {writer.commits.slice(0, 6).map((commit: WorkspaceCommit) => (
            <li key={commit.sha}>
              <CommitIcon />
              <code>{short(commit.sha)}</code>
              <span>{commit.subject}</span>
            </li>
          ))}
          {writer.commits.length > 6 && (
            <li className="run-more">and {writer.commits.length - 6} more</li>
          )}
        </ul>
      )}
    </Item>
  );
}

/** A finished check's commands, each with its time; the failing one in red. */
function Commands({ check }: { check: HiveCheck }) {
  const rows = checkRows(check);
  if (rows.length === 0) return null;
  return (
    <ul className="run-commands" aria-label="Its commands">
      {rows.map((row, i) => (
        <li key={i} className={`run-command is-${row.mark}`}>
          <span className="run-mark" aria-label={row.mark === 'skipped' ? 'not run' : row.mark}>
            {row.mark === 'passed' ? <ChecksMark /> : row.mark === 'failed' ? <FailedIcon /> : null}
          </span>
          <code>{row.command}</code>
          <span className="run-command-note">
            {row.mark === 'failed' ? 'failed' : row.mark === 'skipped' ? 'not run' : ''}
          </span>
          <span className="run-time">{row.time}</span>
        </li>
      ))}
    </ul>
  );
}

/** The running check's commands (decision 862): done, running with its bar, waiting. */
function LiveCommands({ live }: { live: Extract<HiveLive, { kind: 'check' }> }) {
  const now = useSeconds();
  const steps = checkSteps(live, now);
  return (
    <ul className="run-commands" aria-label="Its commands">
      {steps.map((step, i) => {
        const expected = live.expected?.steps[i];
        const elapsed = now - Date.parse(live.since);
        const share = expected ? Math.min(1, elapsed / expected) : undefined;
        return (
          <li key={i} className={`run-command is-${step.mark}`}>
            <span className="run-mark" aria-label={step.mark}>
              {step.mark === 'passed' ? (
                <ChecksMark />
              ) : step.mark === 'failed' ? (
                <FailedIcon />
              ) : step.mark === 'running' ? (
                <span className="run-spinner" />
              ) : null}
            </span>
            <code>{step.command}</code>
            <span className="run-command-note">
              {step.mark === 'running' && share !== undefined && (
                <span
                  className="run-bar"
                  role="progressbar"
                  aria-label={`${step.command}, against its last passing run`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share * 100)}
                >
                  <i style={{ width: `${share * 100}%` }} />
                </span>
              )}
            </span>
            <span className="run-time">{step.time}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The check of a round: on its commit, its commands, the log's tail while it runs. */
export function CheckItem({
  branch,
  round,
  live,
}: {
  branch: string;
  round: RunRound;
  live: Extract<HiveLive, { kind: 'check' }> | undefined;
}) {
  const now = useSeconds();
  const tail = useLogTail(branch, live?.log);
  const { check } = round;
  if (live) {
    const time = clockWords(now - Date.parse(live.started));
    const of = live.expected ? ` of ${aboutWords(live.expected.ms)}` : '';
    return (
      <Item
        name="Check"
        state="run"
        icon={<ChecksIcon />}
        words={
          round.writer.commits[0] ? (
            <>
              on <code>{short(round.writer.commits[0].sha)}</code>
            </>
          ) : undefined
        }
        end={
          <>
            {live.log && (
              <FullLog
                branch={branch}
                log={live.log}
                label="The check, now"
                running
                commands={live.commands}
                {...(live.expected ? { expected: live.expected.steps } : {})}
              />
            )}
            <span>
              {time}
              {of}
            </span>
          </>
        }
      >
        <LiveCommands live={live} />
        {tail.length > 0 && (
          <pre className="run-log-tail" aria-label="The log's last lines">
            {tail.join('\n')}
          </pre>
        )}
      </Item>
    );
  }
  if (!check) {
    return (
      <Item
        name="Check"
        state="todo"
        icon={<ChecksIcon />}
        words="runs on the writer's next commit"
      />
    );
  }
  return (
    <Item
      name="Check"
      state={check.ok ? 'ok' : 'fail'}
      icon={<ChecksIcon />}
      words={
        <>
          {check.ok ? 'passed on' : 'failed on'} <code>{short(check.at)}</code>
        </>
      }
      end={
        <>
          {check.log && (
            <FullLog branch={branch} log={check.log} label={`The check of round ${round.round}`} />
          )}
          <span>{clockWords(check.ms)}</span>
        </>
      }
    >
      <Commands check={check} />
      {check.output && !check.ok && !check.steps?.length && (
        <pre className="run-output">{check.output}</pre>
      )}
    </Item>
  );
}

/** The running review of a round: its verdict, model, time and cost, what it said and proved. */
export function ReviewItem({
  branch,
  round,
  live,
  last,
}: {
  branch: string;
  round: RunRound;
  live: Extract<HiveLive, { kind: 'review' }> | undefined;
  last: boolean;
}) {
  const now = useSeconds();
  const { review, check } = round;
  if (live) {
    const words = liveWords({ live }, now);
    return (
      <Item
        name="Running review"
        state="run"
        icon={<ReviewIcon />}
        words={words?.detail ?? 'the reviewer reads the change'}
        end={<span>{words?.time}</span>}
        last={last}
      />
    );
  }
  if (!review) {
    return (
      <Item
        name="Running review"
        state="todo"
        icon={<ReviewIcon />}
        words={check && !check.ok ? 'not run: the check failed' : 'starts when the check passes'}
        last={last}
      />
    );
  }
  const verdict = verdictWords(review);
  const facts = [
    review.model ? modelName(review.model) : undefined,
    review.effort,
    clockWords(review.ms),
    review.cost !== undefined ? costWords(review.cost) : undefined,
  ].filter((fact): fact is string => Boolean(fact));
  const state: ItemState =
    verdict.tone === 'ok' ? 'ok' : verdict.tone === 'bad' ? 'fail' : 'warning';
  return (
    <Item
      name="Running review"
      state={state}
      icon={<ReviewIcon />}
      words={
        review.verdict === 'approved'
          ? 'no defect proven'
          : review.verdict === 'changes'
            ? `proved ${verdict.text.replace(/ proven$/, '')} with ${review.findings.filter((f) => f.kept).length === 1 ? 'a failing test' : 'failing tests'}`
            : verdict.text.toLowerCase()
      }
      end={
        <>
          {review.log && (
            <FullLog
              branch={branch}
              log={review.log}
              label={`The running review of round ${review.round}`}
            />
          )}
          <span>{facts.join(' · ')}</span>
        </>
      }
      last={last}
    >
      {review.summary && <p className="run-quote">“{review.summary}”</p>}
      {review.error && <p className="run-why">{review.error}</p>}
      {review.ran && (
        <details className="hive-more">
          <summary>What it ran</summary>
          <p className="hive-ran">{review.ran}</p>
        </details>
      )}
      {review.findings.map((finding, i) => (
        <Defect key={i} branch={branch} round={review.round} finding={finding} />
      ))}
    </Item>
  );
}

/** The landing, in the round Hive is on: in flight, landed, or what it will do. */
export function LandItem({ detail, into }: { detail: WorkspaceHiveDetail; into: string }) {
  const landing = detail.landings?.at(-1);
  const request = detail.request;
  if (landing) {
    const landed = landing.outcome === 'landed';
    const ended = landing.outcome !== undefined;
    return (
      <Item
        name="Land"
        state={landed ? 'ok' : ended ? 'fail' : 'run'}
        icon={<MergeIcon />}
        words={landingOutcome(landing, landing.via === 'request' ? request : undefined)}
        end={landing.ended ? <span>{hm(landing.ended)}</span> : undefined}
        last
      >
        {landing.output && !landed && <pre className="run-output">{landing.output}</pre>}
        {landing.log && (
          <div className="run-actions">
            <FullLog
              branch={detail.branch}
              log={landing.log}
              label={`The merge into ${landing.into}`}
            />
          </div>
        )}
      </Item>
    );
  }
  return (
    <Item
      name="Land"
      state="todo"
      icon={<MergeIcon />}
      words={
        detail.step === 'stuck'
          ? 'nothing landed'
          : request
            ? `after an approval: ${requestKind(request).toLowerCase()} into ${request.into}`
            : `after an approval: merge queue into ${into}, then push`
      }
      last
    />
  );
}
