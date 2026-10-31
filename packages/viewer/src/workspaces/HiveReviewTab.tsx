// A Hive workspace's Review tab (HV3, decision 681): what Hive did — each round's check and running
// review, their findings with the tests that prove them and Symbiote's rerun — and Land, which in
// Hive mode takes the place of the person's review of the branch.
import { useEffect, useState } from 'react';
import type {
  HiveCheck,
  HiveFinding,
  HiveReview,
  MergeEntry,
  WorkspaceHiveDetail,
} from '@symbiote/core';
import { getJson, postJson } from '../ui/http.js';
import { reloadWorkspaces } from './useWorkspaces.js';
import {
  checkWords,
  costWords,
  durationWords,
  findingWords,
  hiveRounds,
  stepWords,
  verdictWords,
} from './hive-rounds.js';

const short = (sha: string) => sha.slice(0, 7);
const enc = encodeURIComponent;

/**
 * Land (HV3): the commit Hive checked and reviewed approved for the person and queued into its
 * target, as Merge into does. The workspace head's primary in Hive mode, seen from every tab.
 */
export function LandButton({
  branch,
  className = 'button primary',
}: {
  branch: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; error?: true } | null>(null);
  const land = () => {
    setBusy(true);
    setSaid(null);
    postJson<MergeEntry>('/api/workspaces/hive/land', { branch })
      .then((entry) => {
        setSaid({ text: `Queued: Symbiote merges it into ${entry.into}` });
        void reloadWorkspaces();
      })
      .catch((failed: unknown) => setSaid({ text: (failed as Error).message, error: true }))
      .finally(() => setBusy(false));
  };
  return (
    <span className="hive-land">
      <button type="button" className={className} disabled={busy} onClick={land}>
        {busy ? 'Landing…' : 'Land'}
      </button>
      {said && (
        <span className={said.error ? 'hive-land-said error' : 'hive-land-said'} role="status">
          {said.text}
        </span>
      )}
    </span>
  );
}

/** A check of a round: passed or failed, on which commit, its failing command and last lines. */
function CheckRow({ check }: { check: HiveCheck }) {
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
      {check.output && !check.ok && (
        <details className="hive-more">
          <summary>Its last lines</summary>
          <pre>{check.output}</pre>
        </details>
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

/** The Review tab of a workspace Hive drives: its rounds, newest first, and what Land approves. */
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
  const asked = detail.on && detail.step === 'landing';
  return (
    <div className="hive-review">
      <div className="hive-review-head">
        <p className="hive-now">{stepWords(detail)}</p>
      </div>
      {asked && detail.checked && (
        <p className="hive-line hive-asked">
          Land approves <code>{short(detail.checked)}</code>, the commit Hive checked
          {detail.reviews.some((r) => r.at === detail.checked && r.verdict === 'approved')
            ? ' and reviewed'
            : ''}
          , and queues it to merge.
        </p>
      )}
      {rounds.length === 0 && (
        <p className="hint">Hive checks and reviews the branch once the writer ends a turn.</p>
      )}
      {rounds.map((round) => (
        <section key={round.round} className="hive-round" aria-label={`Round ${round.round}`}>
          <h2>Round {round.round}</h2>
          {round.checks.map((check, i) => (
            <CheckRow key={`c${i}`} check={check} />
          ))}
          {round.reviews.map((review, i) => (
            <ReviewRow key={`r${i}`} branch={branch} review={review} />
          ))}
        </section>
      ))}
    </div>
  );
}
