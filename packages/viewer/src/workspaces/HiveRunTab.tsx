// A Hive workspace's Run tab (V92, decisions 860–867; its Review tab since HV3): a stop or a
// landing first, then each round on a timeline — the writer's commits, the check's commands with
// their times and the log's tail while it runs, the running review and its proven defects as cards,
// the landing — the round Hive is on open and the older ones folded to a line. HV8's request and
// HV5's pause above them. Its facts and spend are the side card's (`RunFacts`).
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type {
  HiveCheck,
  HiveFinding,
  HiveLanding,
  HiveLive,
  HiveRequest,
  LogRead,
  WorkspaceCommit,
  WorkspaceHiveDetail,
  WorkspaceSummary,
} from '@symbiote/core';
import { getJson } from '../ui/http.js';
import {
  ChecksIcon,
  ChevronIcon,
  CommentIcon,
  CommitIcon,
  DocumentsIcon,
  FailedIcon,
  FlaskIcon,
  MergeIcon,
  PencilIcon,
  ReviewIcon,
} from '../ui/icons.js';
import { StatusLabel, type StatusTone } from '../ui/StatusLabel.js';
import { useSeconds } from './clock.js';
import { StepLog } from './StepLog.js';
import { aboutWords, checkSteps, clockWords, liveWords } from './hive-live.js';
import {
  costWords,
  findingWords,
  landingOutcome,
  pauseWords,
  requestKind,
  requestName,
  requestState,
  reviewWords,
  stepWords,
  verdictWords,
} from './hive-rounds.js';
import { checkRows, landedWords, runRounds, stopWords, type RunRound } from './run-timeline.js';
import { modelName } from './workspaces.js';
import { ChecksMark, Item, type ItemState } from './RunItem.js';
import { Loading } from '../ui/Loading.js';
import { useTouched } from '../shell/events.js';

const short = (sha: string) => sha.slice(0, 7);
const enc = encodeURIComponent;
const two = (n: number) => String(n).padStart(2, '0');
/** A time of day: "12:44". */
const hm = (at: number | string) => {
  const date = new Date(at);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
};

/** A Hive run's log (decision 700): `/api/workspaces/hive/log`, streamed as a merge's is. */
const logSource = (branch: string, log: string) => (from: number) =>
  `/api/workspaces/hive/log?branch=${enc(branch)}&log=${enc(log)}&from=${from}`;

/** A step on the timeline: done, running, failed or still to come. */
const TONES: Record<RunRound['status']['tone'], StatusTone> = {
  run: 'run',
  ok: 'ok',
  fail: 'error',
  warn: 'warning',
};

// ESC [ … a letter: a log's colours and cursor moves, left out of its tail.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** The last `count` lines the running step of a log wrote (decision 863), as it streams. */
function useLogTail(branch: string, log: string | undefined, count = 4): string[] {
  const [tail, setTail] = useState<string[]>([]);
  useEffect(() => {
    setTail([]);
    if (!log) return;
    let text = '';
    const events = new EventSource(logSource(branch, log)(0));
    events.addEventListener('lines', (event) => {
      const read = JSON.parse((event as MessageEvent<string>).data) as LogRead<string>;
      for (const line of read.lines) {
        // A new step's lines are its own.
        if ('step' in line || 'run' in line) text = '';
        else if ('out' in line) text = (text + line.out).slice(-8_000);
      }
      const lines = text
        .replace(ANSI, '')
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l !== '');
      setTail(lines.slice(-count));
    });
    events.addEventListener('gone', () => events.close());
    events.onerror = () => events.close();
    return () => events.close();
  }, [branch, log, count]);
  return tail;
}

/** Full log: a run's log under its step, read when opened; live while it runs. */
function FullLog({
  branch,
  log,
  label,
  running = false,
  commands,
  expected,
}: {
  branch: string;
  log: string;
  label: string;
  running?: boolean;
  commands?: string[];
  expected?: number[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button ghost run-full-log"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <DocumentsIcon />
        {open ? 'Hide the log' : 'Full log'}
      </button>
      {open && (
        <StepLog
          id={log}
          source={logSource(branch, log)}
          state={
            running
              ? {
                  running: true,
                  checking: true,
                  ...(commands ? { commands } : {}),
                  ...(expected ? { expected } : {}),
                }
              : { running: false, checking: false }
          }
          label={label}
          className="hive-log run-log"
          waitingWords={<Loading inline>Reading its log…</Loading>}
        />
      )}
    </>
  );
}

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
function WriterItem({ round, running }: { round: RunRound; running: boolean }) {
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
function CheckItem({
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
function ReviewItem({
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
function LandItem({ detail, into }: { detail: WorkspaceHiveDetail; into: string }) {
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

/**
 * What Hive did with a workspace (`/api/workspaces/hive`), read with every read of the list; the
 * last answer stays while the next is read. The page reads it once (V89) for its head's spend, the
 * side card and this tab; `on` false reads nothing (not a Hive workspace).
 */
export function useHiveDetail(
  branch: string,
  version: unknown,
  on: boolean,
): { detail: WorkspaceHiveDetail | null; error: string | null } {
  const [detail, setDetail] = useState<WorkspaceHiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Its record and its events written (V94c): what the list's JSON may not show.
  const record = useTouched(`hive/${branch}.json`);
  const events = useTouched(`hive/${branch}.jsonl`);
  useEffect(() => {
    if (!on) return;
    let live = true;
    getJson<WorkspaceHiveDetail>(`/api/workspaces/hive?branch=${enc(branch)}`)
      .then((read) => {
        if (!live) return;
        setDetail(read);
        setError(null);
      })
      .catch((failed: unknown) => live && setError((failed as Error).message));
    return () => {
      live = false;
    };
  }, [branch, version, on, record, events]);
  return { detail, error };
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

/** The side card's Run and Spend (decision 867): the run's facts, what it spent. */
export function RunFacts({
  workspace,
  detail,
}: {
  workspace: Pick<WorkspaceSummary, 'agent' | 'from' | 'hive'>;
  detail: WorkspaceHiveDetail | null;
}) {
  const now = useSeconds();
  if (!detail) return null;
  const hive = workspace.hive;
  const live = hive ? liveWords(hive, now) : null;
  const stop = stopWords(detail);
  const landed = detail.landings?.findLast((l) => l.outcome === 'landed');
  const stage: { text: string; tone: string } = stop
    ? {
        text: `Stopped${detail.round >= detail.rounds ? ` · ${detail.round} of ${detail.rounds}` : ''}`,
        tone: 'fail',
      }
    : landed
      ? { text: 'Landed', tone: 'ok' }
      : detail.pause
        ? { text: 'Paused', tone: 'info' }
        : live
          ? { text: live.head, tone: 'run' }
          : {
              text:
                detail.step === 'writing'
                  ? 'Writing'
                  : detail.step === 'landing'
                    ? 'Landing'
                    : detail.step === 'answered'
                      ? 'Answered'
                      : detail.step.charAt(0).toUpperCase() + detail.step.slice(1),
              tone: 'run',
            };
  const review = detail.reviews.at(-1);
  const into = landed?.into ?? workspace.from ?? 'main';
  // Landed or stopped, the first row says when and how, as proofs 03 and 07 (V93).
  const lastCheck = detail.checks.at(-1);
  const stoppedAt =
    lastCheck?.started !== undefined ? Date.parse(lastCheck.started) + lastCheck.ms : undefined;
  const why = detail.note?.startsWith('its spend reached its budget')
    ? 'budget'
    : detail.round >= detail.rounds
      ? 'round cap'
      : 'stopped';
  const how = detail.request ? requestKind(detail.request).toLowerCase() : 'merge queue';
  const first: [string, ReactNode, string?] =
    landed && !stop
      ? ['Landed', landed.ended ? `${hm(landed.ended)} · ${how}` : how, 'ok']
      : stop
        ? ['Stopped', stoppedAt !== undefined ? `${hm(stoppedAt)} · ${why}` : why, 'fail']
        : ['Stage', stage.text, stage.tone];
  const facts: [string, ReactNode, string?][] = [
    first,
    [
      'Writer',
      `Claude Code${workspace.agent.model ? ` · ${modelName(workspace.agent.model)}` : ''}`,
    ],
    ...(review?.model
      ? ([['Reviewer', [modelName(review.model), review.effort].filter(Boolean).join(' · ')]] as [
          string,
          string,
        ][])
      : []),
    ...(landed || stop
      ? []
      : ([
          [
            'Lands in',
            <>
              <code>{into}</code> · {how}
            </>,
          ],
        ] as [string, ReactNode][])),
    ...(landed?.merge
      ? ([
          [
            'Merged',
            <>
              <code>{short(landed.merge)}</code> into {landed.into}
            </>,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(detail.pushed
      ? ([
          [
            'Pushed',
            detail.pushed.ok ? (
              <>
                <code>{short(detail.pushed.sha)}</code> · {hm(detail.pushed.at)}
              </>
            ) : (
              'refused'
            ),
            detail.pushed.ok ? undefined : 'fail',
          ],
        ] as [string, ReactNode, string?][])
      : []),
    ...(stop ? ([['Landed', 'nothing']] as [string, ReactNode][]) : []),
  ];
  const spend = detail.spend;
  const budget = spend?.budget;
  return (
    <div className="run-side">
      <section className="changes-section" aria-label="Run">
        <h2>Run</h2>
        <dl className="changes-facts run-facts">
          {facts.map(([key, value, tone]) => (
            <Fragment key={key}>
              <dt>{key}</dt>
              <dd {...(tone ? { 'data-tone': tone } : {})}>{value}</dd>
            </Fragment>
          ))}
        </dl>
      </section>
      {spend && (
        <section className="changes-section run-spend" aria-label="Spend">
          <h2>Spend</h2>
          <p className="run-spend-top">
            <b>{costWords(spend.total)}</b>
            {budget !== undefined && <span>budget {costWords(budget)}</span>}
          </p>
          {budget !== undefined && (
            <span
              className={`run-bar${spend.total >= budget ? ' is-over' : ''}`}
              role="meter"
              aria-label="Spent of the budget"
              aria-valuemin={0}
              aria-valuemax={budget}
              aria-valuenow={Math.min(spend.total, budget)}
            >
              <i style={{ width: `${Math.min(100, (spend.total / budget) * 100)}%` }} />
            </span>
          )}
          <p className="run-spend-split">
            <span>
              {spend.writer === undefined ? 'writer not read' : `writer ${costWords(spend.writer)}`}
            </span>
            <span>
              {spend.reviewed
                ? `${spend.reviewed} review${spend.reviewed === 1 ? '' : 's'} ${costWords(spend.reviews)}`
                : 'no review'}
            </span>
          </p>
        </section>
      )}
    </div>
  );
}
