// A Hive workspace's Review tab (HV3, decision 681): what Hive did — each round's check and running
// review, their findings with the tests that prove them and Symbiote's rerun — and, since HV4,
// each landing Hive tried and the branch's last push. Hive lands on its own: no Land. HV8: the pull
// or merge request it waits on, beside the landings.
import { useEffect, useState } from 'react';
import type {
  HiveCheck,
  HiveFinding,
  HiveLanding,
  HiveLive,
  HiveRequest,
  HiveReview,
  WorkspaceHiveDetail,
} from '@symbiote/core';
import { getJson } from '../ui/http.js';
import { CheckIcon, CloseIcon } from '../ui/icons.js';
import { HiveNowLine } from './HiveNow.js';
import { StepLog } from './StepLog.js';
import {
  checkWords,
  costWords,
  durationWords,
  findingWords,
  hiveRounds,
  stepWords,
  landingOutcome,
  requestKind,
  requestName,
  requestState,
  reviewWords,
  verdictWords,
} from './hive-rounds.js';

const short = (sha: string) => sha.slice(0, 7);
const enc = encodeURIComponent;

/** A Hive run's log (decision 700): `/api/workspaces/hive/log`, streamed as a merge's is. */
const logSource = (branch: string, log: string) => (from: number) =>
  `/api/workspaces/hive/log?branch=${enc(branch)}&log=${enc(log)}&from=${from}`;

/**
 * What Hive runs now (decision 700): its words, ticking, then the run's steps — each of the
 * check's commands done, running or waiting; a review's installs, the reviewer and its reruns —
 * and its log as it comes.
 */
function NowSection({
  branch,
  live,
  note,
}: {
  branch: string;
  live: HiveLive;
  note: string | undefined;
}) {
  const check = live.kind === 'check';
  return (
    <section className="hive-round hive-running" aria-label="Now">
      <h2>Now</h2>
      <p className="hive-running-words" role="status">
        <HiveNowLine hive={{ live, ...(note ? { note } : {}) }} />
      </p>
      {live.log && (
        <StepLog
          // A new run's log is a new view: its steps and terminal start empty.
          key={live.log}
          id={live.log}
          source={logSource(branch, live.log)}
          state={
            check
              ? {
                  running: true,
                  checking: true,
                  commands: live.commands,
                  ...(live.expected ? { expected: live.expected.steps } : {}),
                }
              : { running: true, checking: false }
          }
          label={check ? 'The check, now' : 'The running review, now'}
          className="hive-log"
          waitingWords={check ? 'Starting the check' : 'Starting the review'}
        />
      )}
    </section>
  );
}

/** A finished run's kept log (decision 695), read when it is opened. */
function KeptLog({ branch, log, label }: { branch: string; log: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="hive-more hive-kept-log"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Its log</summary>
      {open && (
        <StepLog
          id={log}
          source={logSource(branch, log)}
          state={{ running: false, checking: false }}
          label={label}
          className="hive-log"
          waitingWords="Reading its log…"
        />
      )}
    </details>
  );
}

/**
 * The pull or merge request Hive opened (HV8): its link, its state, the commit it is at, and what
 * became of Symbiote's graph review on it.
 */
function RequestRow({ request }: { request: HiveRequest }) {
  const state = requestState(request);
  const tone = state.tone === 'ok' ? 'hive-ok' : state.tone === 'bad' ? 'badge-error' : 'hive-wait';
  return (
    <div className="hive-step" aria-label={`${requestKind(request)} ${requestName(request)}`}>
      <div className="hive-step-head">
        <span className={`badge ${tone}`}>{requestKind(request)}</span>
        <a className="link hive-request-link" href={request.url} target="_blank" rel="noreferrer">
          {requestName(request)}
        </a>
        <span className="hive-step-facts">
          {state.text} · into {request.into} · <code>{short(request.at)}</code>
        </span>
      </div>
      <p className={request.review?.error ? 'hive-line error' : 'hive-line'}>
        {reviewWords(request)}
      </p>
      {request.error && <p className="hive-line error">Not read: {request.error}</p>}
    </div>
  );
}

/** A check of a round: passed or failed, on which commit, its failing command and last lines. */
/** A landing Hive tried (HV4): how it ended, what failed, the merge's log kept. */
function LandingRow({
  branch,
  landing,
  request,
}: {
  branch: string;
  landing: HiveLanding;
  request: HiveRequest | undefined;
}) {
  const landed = landing.outcome === 'landed';
  const ended = landing.outcome !== undefined;
  return (
    <div className="hive-step" aria-label={`Landing in ${landing.into}, round ${landing.round}`}>
      <div className="hive-step-head">
        <span className={`badge ${landed || !ended ? 'hive-ok' : 'badge-error'}`}>
          {landed ? 'Landed' : ended ? 'Not landed' : 'Landing'}
        </span>
        <span className="hive-step-facts">
          {landingOutcome(landing, landing.via === 'request' ? request : undefined)} ·{' '}
          <code>{short(landing.at)}</code>
        </span>
      </div>
      {landing.output && (
        <details className="hive-more">
          <summary>Its last lines</summary>
          <pre>{landing.output}</pre>
        </details>
      )}
      {landing.log && (
        <KeptLog branch={branch} log={landing.log} label={`The merge into ${landing.into}`} />
      )}
    </div>
  );
}

function CheckRow({ branch, check }: { branch: string; check: HiveCheck }) {
  return (
    <div className="hive-step" aria-label={`Check, round ${check.round}`}>
      <div className="hive-step-head">
        <span className={`badge ${check.ok ? 'hive-ok' : 'badge-error'}`}>
          {check.ok ? 'Check passed' : 'Check failed'}
        </span>
        <span className="hive-step-facts">
          {checkWords(check)} · <code>{short(check.at)}</code>
        </span>
      </div>
      {check.failed && (
        <p className="hive-line">
          <code>{check.failed}</code> failed
        </p>
      )}
      {check.steps && check.steps.length > 0 && (
        <ul className="hive-check-steps" aria-label="Its commands">
          {check.steps.map((step, i) => (
            <li key={i} className={step.ok ? 'passed' : 'failed'}>
              <span className="hive-check-mark" aria-label={step.ok ? 'passed' : 'failed'}>
                {step.ok ? <CheckIcon /> : <CloseIcon />}
              </span>
              <code>{step.command}</code>
              <span className="hive-step-facts">{durationWords(step.ms)}</span>
            </li>
          ))}
        </ul>
      )}
      {check.output && !check.ok && !check.log && (
        <details className="hive-more">
          <summary>Its last lines</summary>
          <pre>{check.output}</pre>
        </details>
      )}
      {check.log && (
        <KeptLog branch={branch} log={check.log} label={`The check of round ${check.round}`} />
      )}
    </div>
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
      {error ? <p className="hive-line error">{error}</p> : <pre>{text ?? 'Reading…'}</pre>}
    </details>
  );
}

/** A finding: the defect, its test and command, proven or dropped on Symbiote's rerun. */
function FindingRow({
  branch,
  round,
  finding,
}: {
  branch: string;
  round: number;
  finding: HiveFinding;
}) {
  const words = findingWords(finding);
  return (
    <li className="hive-finding">
      <div className="hive-step-head">
        <span className={finding.kept ? 'badge badge-error' : 'chip'}>{words.text}</span>
        <span className="hive-defect">{finding.defect}</span>
      </div>
      <p className="hive-line">
        {finding.test && (
          <>
            <span className="hive-test">{finding.test}</span>
            {' · '}
          </>
        )}
        <code>{finding.command}</code>
      </p>
      {words.why && <p className="hive-line hive-why">{words.why}</p>}
      {finding.kept &&
        finding.files.map((path) => (
          <TestFile key={path} branch={branch} round={round} path={path} />
        ))}
      {finding.output && (
        <details className="hive-more">
          <summary>
            Symbiote&apos;s rerun{finding.code != null ? `, exit ${finding.code}` : ''}
          </summary>
          <pre>{finding.output}</pre>
        </details>
      )}
    </li>
  );
}

/** A running review of a round: its verdict, model, time and cost, what it said and found. */
function ReviewRow({ branch, review }: { branch: string; review: HiveReview }) {
  const verdict = verdictWords(review);
  const tone =
    verdict.tone === 'ok' ? 'hive-ok' : verdict.tone === 'bad' ? 'badge-error' : 'badge-warning';
  const facts = [
    review.model && review.effort ? `${review.model} at ${review.effort}` : review.model,
    durationWords(review.ms),
    review.cost !== undefined ? costWords(review.cost) : undefined,
  ].filter((fact): fact is string => Boolean(fact));
  return (
    <div className="hive-step" aria-label={`Review, round ${review.round}`}>
      <div className="hive-step-head">
        <span className={`badge ${tone}`}>{verdict.text}</span>
        <span className="hive-step-facts">
          Running review · {facts.join(' · ')} · <code>{short(review.at)}</code>
        </span>
      </div>
      {review.summary && <p className="hive-line">{review.summary}</p>}
      {review.error && <p className="hive-line hive-why">{review.error}</p>}
      {review.ran && (
        <details className="hive-more">
          <summary>What it ran</summary>
          <p className="hive-ran">{review.ran}</p>
        </details>
      )}
      {review.log && (
        <KeptLog
          branch={branch}
          log={review.log}
          label={`The running review of round ${review.round}`}
        />
      )}
      {review.findings.length > 0 && (
        <ul className="hive-findings" aria-label="Findings">
          {review.findings.map((finding, i) => (
            <FindingRow key={i} branch={branch} round={review.round} finding={finding} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Review tab of a workspace Hive drives: its landings, then its rounds, newest first. */
export function HiveReviewTab({ branch, version }: { branch: string; version: unknown }) {
  const [detail, setDetail] = useState<WorkspaceHiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
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
  }, [branch, version]);

  if (error) {
    return (
      <div className="hive-review">
        <p className="hive-line error" role="alert">
          Hive&apos;s rounds could not be read: {error}
        </p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="hive-review">
        <p className="hint">Reading Hive&apos;s rounds…</p>
      </div>
    );
  }
  const rounds = hiveRounds(detail);
  const landings = [...(detail.landings ?? [])].reverse();
  const pushed = detail.pushed;
  return (
    <div className="hive-review">
      <div className="hive-review-head">
        <p className="hive-now">{stepWords(detail)}</p>
      </div>
      {pushed && (
        <p className={pushed.ok ? 'hive-line' : 'hive-line error'}>
          {pushed.ok
            ? `The branch pushed to origin at ${short(pushed.sha)}`
            : `The branch not pushed to origin: ${pushed.error ?? 'refused'}`}
        </p>
      )}
      {landings.length > 0 && (
        <section className="hive-round" aria-label="Landings">
          <h2>Landing</h2>
          {detail.request && <RequestRow request={detail.request} />}
          {landings.map((landing) => (
            <LandingRow
              key={`${landing.entry}-${landing.queued}`}
              branch={branch}
              landing={landing}
              request={detail.request}
            />
          ))}
        </section>
      )}
      {detail.live && <NowSection branch={branch} live={detail.live} note={detail.note} />}
      {rounds.length === 0 && !detail.live && (
        <p className="hint">Hive checks and reviews the branch once the writer ends a turn.</p>
      )}
      {rounds.map((round) => (
        <section key={round.round} className="hive-round" aria-label={`Round ${round.round}`}>
          <h2>Round {round.round}</h2>
          {round.checks.map((check, i) => (
            <CheckRow key={`c${i}`} branch={branch} check={check} />
          ))}
          {round.reviews.map((review, i) => (
            <ReviewRow key={`r${i}`} branch={branch} review={review} />
          ))}
        </section>
      ))}
    </div>
  );
}
