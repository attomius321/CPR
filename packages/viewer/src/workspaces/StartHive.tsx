// Start a workspace in Hive mode (V92, decision 871; proof 05-new-goal): the check Hive will run
// under Done when, and how Hive runs the goal — its four steps with this repository's facts, then
// its rounds, budget and pause — from what Settings' Hive mode page sets.
import { useEffect, useState, type ReactNode } from 'react';
import type { HiveState } from '@symbiote/core';
import { reviewerWords, useHiveSettings } from '../overview/HiveOverview.js';
import { getJson } from '../ui/http.js';
import {
  ChecksIcon,
  ClockIcon,
  CoinsIcon,
  MergeIcon,
  PencilIcon,
  ReviewIcon,
  SubscriptionIcon,
} from '../ui/icons.js';
import { plural } from '../ui/plural.js';

/** The check Hive would run (`/api/hive/state`): undefined while read, null when none is set. */
export function useHiveCheck(on: boolean): HiveState['check'] | null | undefined {
  const [check, setCheck] = useState<HiveState['check'] | null | undefined>(undefined);
  useEffect(() => {
    if (!on) return;
    let live = true;
    getJson<HiveState>('/api/hive/state')
      .then((read) => live && setCheck(read.check ?? null))
      .catch(() => live && setCheck(null));
    return () => {
      live = false;
    };
  }, [on]);
  return check;
}

/** Where the check comes from, short: `merge.checks`, else the file it was found in. */
const sourceWords = (source: string) =>
  source.includes('(merge.checks)') ? 'merge.checks' : source;

/** Hive's check, under Done when: its commands as chips, where from; none, said in red. */
export function HiveCheckLine({ check }: { check: HiveState['check'] | null | undefined }) {
  if (check === undefined) return null;
  return (
    <p className={`start-hive-check${check ? '' : ' none'}`}>
      <ChecksIcon />
      <span className="start-hive-check-label">Hive&apos;s check:</span>
      {check ? (
        <>
          {check.commands.map((command) => (
            <code key={command}>{command}</code>
          ))}
          <span className="start-hive-check-from">from {sourceWords(check.source)}</span>
        </>
      ) : (
        <span>
          none is set: Hive reviews each commit without one. Set <code>merge.checks</code> in{' '}
          <code>symbiote/config.json</code>.
        </span>
      )}
    </p>
  );
}

/** How Hive runs the goal (decision 871): its steps with this repository's facts, its limits. */
export function HiveHow({
  check,
  into,
}: {
  check: HiveState['check'] | null | undefined;
  /** The branch it starts from, where it lands. */
  into: string;
}) {
  const { pacing, landing, reviewer } = useHiveSettings();
  const reviewerName = reviewerWords(reviewer)?.split(' · ')[0] ?? 'The reviewer';
  const steps: { name: string; icon: () => ReactNode; words: string }[] = [
    {
      name: 'Write',
      icon: PencilIcon,
      words: 'In its own worktree; Hive answers its questions.',
    },
    {
      name: 'Check',
      icon: ChecksIcon,
      words: check
        ? `${plural(check.commands.length, 'command')} on each commit; failures go back.`
        : 'No check is set: Hive reviews without one.',
    },
    {
      name: 'Review',
      icon: ReviewIcon,
      words: `${reviewerName} proves defects with failing tests.`,
    },
    {
      name: 'Land',
      icon: MergeIcon,
      words:
        landing?.by === 'request'
          ? `A pull request into ${into}; your merge lands it.`
          : `Merge queue into ${into}, then both pushed.`,
    },
  ];
  return (
    <section className="start-card start-hive-how" aria-labelledby="start-hive-how">
      <div className="card-head">
        <h2 id="start-hive-how">How Hive runs it</h2>
      </div>
      <ol className="start-hive-steps">
        {steps.map(({ name, icon: Icon, words }) => (
          <li key={name}>
            <span className="start-hive-node" aria-hidden="true">
              <Icon />
            </span>
            <span className="start-hive-words">
              <b>{name}</b>
              <span>{words}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="start-hive-limits">
        <span className="start-chip">
          <ClockIcon />3 rounds
        </span>
        <span className="start-chip">
          <CoinsIcon />
          {pacing?.budget != null ? `$${pacing.budget.toFixed(2)} budget` : 'no budget'}
        </span>
        <span className="start-chip">
          <SubscriptionIcon />
          {pacing?.pauseAt === false ? 'no pause by usage' : `pauses at ${pacing?.pauseAt ?? 90} %`}
        </span>
      </p>
    </section>
  );
}
