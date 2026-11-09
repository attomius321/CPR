// A Hive workspace's facts in the side card (V92): first in it on the Run tab.
import { Fragment, type ReactNode } from 'react';
import type { WorkspaceHiveDetail, WorkspaceSummary } from '@symbiote/core';
import { useSeconds } from './clock.js';
import { liveWords } from './hive-live.js';
import { costWords, requestKind } from './hive-rounds.js';
import { stopWords } from './run-timeline.js';
import { modelName } from './run-choices.js';
import { hm, short } from './run-words.js';

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
