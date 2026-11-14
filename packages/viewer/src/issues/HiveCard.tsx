import type { ReactNode } from 'react';
import type { IssueDecision, IssueRecord } from '@symbiote/core';
import { longDate } from '../history/commits.js';
import { useShell } from '../shell/shell-context.js';
import {
  DoneIcon,
  FailedIcon,
  HexagonIcon,
  QuestionIcon,
  RefusedIcon,
  WaitingIcon,
} from '../ui/icons.js';
import { Loading } from '../ui/Loading.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { tip } from '../ui/tip.js';
import {
  cardOffer,
  costWords,
  decisionChip,
  decisionWords,
  flagWords,
  modelWords,
  readWords,
  timeWords,
  writerWords,
  type Chip,
  type StartOffer,
} from './classification.js';
import { relativeTime } from './issues.js';

const ICONS: Record<Chip['word'], () => ReactNode> = {
  Taken: DoneIcon,
  Held: WaitingIcon,
  Asked: QuestionIcon,
  Refused: RefusedIcon,
  Failed: FailedIcon,
};

/** A decision as a status: its icon and its word in its tone, its words in the tip. */
function Decision({ chip, className }: { chip: Chip; className: string }) {
  const Icon = ICONS[chip.word];
  return (
    <span className={`${className}-tip`} {...tip(chip.tip)}>
      <StatusLabel tone={chip.tone} icon={<Icon />} className={className}>
        {chip.word}
      </StatusLabel>
    </span>
  );
}

/**
 * A row's chip (decision 1055): Taken, Held, Asked, Refused or Failed; Classifying while this
 * page's Classify runs; nothing for an issue never classified.
 */
export function DecisionChip({
  decision,
  running,
}: {
  decision: IssueDecision | undefined;
  running: boolean;
}) {
  if (running) {
    return (
      <StatusLabel tone="run" className="issues-decision">
        Classifying
      </StatusLabel>
    );
  }
  if (!decision) return null;
  return <Decision chip={decisionChip(decision)} className="issues-decision" />;
}

/**
 * The Hive card on an issue (HV9c, decision 1056): the classifier's decision and what decided it,
 * the brief a take would start, the run; Classify, or Classify again once the issue or the
 * classifier changed or the last one failed. With Hive off, a past decision and nothing offered.
 * HV10b: Start in Hive on a take of the issue's current text, the person's click; once started,
 * its workspace's branch and Hive's step, linked.
 */
export function HiveCard({
  number,
  record,
  hive,
  about,
  identity,
  snapshot,
  running,
  refused,
  text,
  now,
  onClassify,
  offer: started,
  starting,
  startRefused,
  onStart,
}: {
  number: number;
  record: IssueRecord | null;
  hive: boolean;
  about: boolean;
  identity: string | undefined;
  snapshot: string | undefined;
  running: boolean;
  refused: string | undefined;
  /** Markdown drawn as the issue's text is: the brief holds the issue's quotes. */
  text: (markdown: string) => ReactNode;
  now: number;
  onClassify: () => void;
  /** What it offers to start (HV10b): Start in Hive, or the workspace open. */
  offer: StartOffer;
  starting: boolean;
  startRefused: string | undefined;
  onStart: () => void;
}) {
  const shell = useShell();
  const offer = cardOffer({ hive, about, record, snapshot, identity });
  if (!offer.show) return null;
  // A failed classification's answer did not fit: none of it is the decision's.
  const answer = record?.decision === 'failed' ? undefined : record?.answer;
  const flags = [...new Set([...(answer?.flags ?? []), ...(record?.snapshot?.flags ?? [])])];
  const button =
    offer.action &&
    (running ? (
      <button type="button" className="button secondary" disabled>
        <Loading inline>Classifying…</Loading>
      </button>
    ) : (
      <button
        type="button"
        className={offer.action === 'classify' ? 'button' : 'button secondary'}
        onClick={onClassify}
      >
        {offer.action === 'classify' ? 'Classify' : 'Classify again'}
      </button>
    ));

  return (
    <section className="issues-hive" aria-label={`Hive's decision on #${number}`}>
      <div className="issues-hive-head">
        <HexagonIcon />
        <h4>Hive</h4>
        {record ? (
          <Decision chip={decisionChip(record)} className="issues-hive-decision" />
        ) : (
          <span className="issues-muted">Not classified</span>
        )}
        {record && (
          <span className="issues-muted issues-hive-when" {...tip(longDate(record.run.at))}>
            {relativeTime(record.run.at, now)}
          </span>
        )}
        {(button || started.start) && (
          <div className="end">
            {button}
            {started.start &&
              (starting ? (
                <button type="button" className="button" disabled>
                  <Loading inline>Starting…</Loading>
                </button>
              ) : (
                <button type="button" className="button" onClick={onStart} disabled={running}>
                  <HexagonIcon />
                  Start in Hive
                </button>
              ))}
          </div>
        )}
      </div>
      {started.workspace && (
        <p className="issues-hive-workspace">
          <span className="issues-hive-label">Its workspace</span>
          <a
            href={`/?branch=${encodeURIComponent(started.workspace.branch)}`}
            onClick={(event) => {
              if (!shell || !started.workspace) return;
              event.preventDefault();
              shell.navigate({ page: 'workspace', branch: started.workspace.branch });
            }}
          >
            {started.workspace.branch}
          </a>
          {started.workspace.step && started.workspace.tone && (
            <StatusLabel tone={started.workspace.tone} className="issues-hive-step">
              {started.workspace.step}
            </StatusLabel>
          )}
        </p>
      )}
      {startRefused && (
        <p className="error issues-hive-refused" role="alert">
          {startRefused}
        </p>
      )}
      {offer.blocked === 'hive-off' && (
        <p className="issues-hive-note">
          Hive mode is off: its past decisions show, and Classify needs it on.
        </p>
      )}
      {offer.blocked === 'no-about' && (
        <p className="issues-hive-note">
          Write what the project is and what Hive may take on first, in{' '}
          <a
            href="/settings?prompt=hive-mode"
            onClick={(event) => {
              if (!shell) return;
              event.preventDefault();
              shell.navigate({ page: 'settings', prompt: 'hive-mode' });
            }}
          >
            Settings, Hive mode
          </a>
          : the classifier reads it with every issue.
        </p>
      )}
      {offer.why && <p className="issues-hive-note">{offer.why}</p>}
      {!record && offer.action === 'classify' && (
        <p className="issues-hive-note">
          The classifier reads the issue and answers take, ask or refuse, with its reasons. It
          starts nothing.
        </p>
      )}
      {running && <p className="issues-hive-note">It answers in 10 to 20 seconds.</p>}
      {refused && (
        <p className="error issues-hive-refused" role="alert">
          {refused}
        </p>
      )}
      {record && (
        <div className="issues-hive-body">
          <p className="issues-hive-line">{decisionWords(record)}</p>
          {answer && answer.reasons.length > 0 && (
            <ul className="issues-hive-reasons" aria-label="Its reasons">
              {answer.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {record.decision === 'ask' && answer?.question && (
            <div className="issues-hive-question">
              <span className="issues-hive-label">Its question to the author</span>
              <p>{answer.question}</p>
            </div>
          )}
          {flags.length > 0 && (
            <div className="issues-hive-flags" role="list" aria-label="Flags">
              {flags.map((flag) => {
                const words = flagWords(flag);
                return (
                  <span key={flag} role="listitem" className="chip" {...tip(words.tip)}>
                    {words.label}
                  </span>
                );
              })}
            </div>
          )}
          <dl className="issues-hive-facts">
            {record.decision === 'take' && answer && (
              <div>
                <dt>Writer</dt>
                <dd>{writerWords(answer)}</dd>
              </div>
            )}
            <div>
              <dt>Classifier</dt>
              <dd>
                {modelWords(record.classifier.model, record.classifier.effort)},{' '}
                {costWords(record.run.cost)}, {timeWords(record.run.ms)}
                {record.run.tries > 1 &&
                  `; asked twice${record.run.retried ? `, its first answer's ${record.run.retried} did not fit` : ''}`}
              </dd>
            </div>
            {record.snapshot && (
              <div>
                <dt>Read</dt>
                <dd>{readWords(record.snapshot)}</dd>
              </div>
            )}
          </dl>
          {record.decision === 'take' && record.brief && (
            <details className="issues-hive-brief">
              <summary>The brief it would start</summary>
              {text(record.brief)}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
