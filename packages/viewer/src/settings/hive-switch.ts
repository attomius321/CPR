// What turning Hive mode on or off concerns, in words (HV4, decisions 771, 772): the workspaces
// in normal mode that keep it off, and what Hive off does to each Hive workspace in flight. Pure.
import type { HiveLandsBy, HivePacingSetting, HiveState, HiveStep } from '@symbiote/core';

/** A workspace as the questions name it: its title, else its branch. */
export const nameOf = (w: { branch: string; title?: string }) => w.title ?? w.branch;

const FORGES = {
  github: { name: 'GitHub', request: 'pull request', sign: '#' },
  gitlab: { name: 'GitLab', request: 'merge request', sign: '!' },
} as const;

/**
 * What turning Hive off does to a workspace at `step`, and what turning it on again does; its
 * request, when one is open (HV8), stays open on the forge whatever the step.
 */
export function offWords(step: HiveStep, request?: HiveState['flight'][number]['request']): string {
  const open = request
    ? `its ${FORGES[request.forge].request} ${FORGES[request.forge].sign}${request.number} stays open on ${FORGES[request.forge].name}`
    : null;
  switch (step) {
    case 'writing':
      return `its agent is stopped; on again, Hive tells it to continue${open ? `; ${open}` : ''}`;
    case 'checking':
      return `its check is stopped; on again, the check runs again${open ? `; ${open}` : ''}`;
    case 'reviewing':
      return `its review is stopped and its copy deleted; on again, a new review${open ? `; ${open}` : ''}`;
    case 'landing':
      return open
        ? `${open}: merge it there; Hive reads it again once on`
        : 'its landing goes on: the merge queue checks, lands and pushes it; Hive records it once on again';
    default:
      return open ? `nothing runs for it; ${open}` : 'nothing runs for it';
  }
}

/** How Hive lands, the two choices of Settings' Hive page (HV8, decision 788). */
export const LANDS_BY: { by: HiveLandsBy; label: string }[] = [
  { by: 'queue', label: 'Merge queue' },
  { by: 'request', label: 'Pull request' },
];

/** The thresholds Settings offers (HV5, decision 797); 90 % is the default. */
const PAUSE_AT = [50, 60, 70, 80, 90, 95, 100];

/** Settings' choices for `hive.usage.pauseAt`: never, then the thresholds, the project's own too. */
export function pauseChoices(current: number | false): { value: string; label: string }[] {
  const listed =
    current === false || PAUSE_AT.includes(current)
      ? PAUSE_AT
      : [...PAUSE_AT, current].sort((a, b) => a - b);
  return [
    { value: 'off', label: 'Never: Hive does not pause by usage' },
    ...listed.map((n) => ({ value: String(n), label: n === 90 ? '90 % (default)' : `${n} %` })),
  ];
}

/** What the threshold does, or why nothing pauses Hive (HV5, decisions 797, 799). */
export function pauseAtWords(setting: Pick<HivePacingSetting, 'pauseAt' | 'read'>): string {
  if (!setting.read) {
    return 'Symbiote reads no usage here (SYMBIOTE_USAGE=off): Hive does not pause for it.';
  }
  if (setting.pauseAt === false) {
    return "Hive starts agents whatever your subscription's usage says.";
  }
  return `While any window of your Claude subscription (the 5-hour session, the week, a model's week) is at ${setting.pauseAt} % or more, Hive starts no agent for any workspace until it resets, then goes on by itself. A turn or review already running finishes. Usage that cannot be read for 15 minutes pauses Hive too.`;
}

/** The budget as typed (HV5): dollars above 0, or empty for none; else why not. */
export function budgetOf(text: string): { value: number | null } | { problem: string } {
  const typed = text.trim().replace(/^\$\s*/, '');
  if (typed === '') return { value: null };
  const value = Number(typed);
  return /^\d+(\.\d+)?$/.test(typed) && value > 0 && value <= 1_000_000
    ? { value }
    : { problem: 'A budget is an amount in dollars above 0, or empty for none.' };
}

/** What the budget does (HV5, decision 801). */
export function budgetWords(budget: number | null): string {
  if (budget === null) return 'No budget: a workspace spends what its rounds take.';
  return `A workspace that has spent $${budget.toFixed(2)} (its writer's sessions and its running reviews, by Claude Code's own count) stops, with why. A turn or review already running finishes first.`;
}

/** One thing Hive checks before it turns on (V92, decision 872). */
export interface ReadyItem {
  key: 'check' | 'normal' | 'limits' | 'access';
  /** `fail` keeps Turn on Hive off; `warn` is said, never blocks. */
  mark: 'ok' | 'fail' | 'warn';
  text: string;
  detail: string;
  /** Still read: `detail` is drawn as a loading (fix/static-loadings). */
  reading?: true;
  /** The workspaces in normal mode that keep it off, named. */
  names?: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where the check comes from, short: `merge.checks`, else the file it was found in. */
export const checkSource = (source: string) =>
  source.includes('(merge.checks)') ? 'merge.checks' : source;

/**
 * What Hive checks before it starts (V92, decision 872), only what Symbiote can know: a check is
 * set, no workspace in normal mode is open (772), its limits as they are, and the full access it
 * gives, a warning. `ready` while none fails; nothing read yet is not ready.
 */
export function hiveReadiness({
  state,
  pacing,
  rounds,
}: {
  state: Pick<HiveState, 'normal' | 'check'> | null;
  pacing: (Pick<HivePacingSetting, 'pauseAt' | 'budget'> & Partial<HivePacingSetting>) | null;
  rounds: number;
}): { items: ReadyItem[]; ready: boolean } {
  const check: ReadyItem = !state
    ? { key: 'check', mark: 'fail', text: 'A check is set', detail: 'reading…', reading: true }
    : state.check
      ? {
          key: 'check',
          mark: 'ok',
          text: 'A check is set',
          detail: `${state.check.commands.join(', ')}, from ${checkSource(state.check.source)}`,
        }
      : {
          key: 'check',
          mark: 'fail',
          text: 'No check is set',
          detail: 'set merge.checks in symbiote/config.json',
        };
  const open = state?.normal ?? [];
  const one = open.length === 1;
  const normal: ReadyItem =
    open.length === 0
      ? {
          key: 'normal',
          mark: state ? 'ok' : 'fail',
          text: 'No workspace in normal mode is open',
          detail: '',
        }
      : {
          key: 'normal',
          mark: 'fail',
          text: `${plural(open.length, 'workspace')} in normal mode ${one ? 'is' : 'are'} open`,
          detail: `finish or clean ${one ? 'it' : 'them'} up first`,
          names: open.map(nameOf),
        };
  const limits: ReadyItem = {
    key: 'limits',
    mark: 'ok',
    text: 'Limits',
    detail: [
      !pacing || pacing.pauseAt === false ? 'no pause' : `pauses at ${pacing.pauseAt} %`,
      pacing?.budget != null ? `$${pacing.budget.toFixed(2)} a workspace` : 'no budget',
      plural(rounds, 'round'),
    ].join(' · '),
  };
  const access: ReadyItem = {
    key: 'access',
    mark: 'warn',
    text: 'Full access',
    detail: 'its agents can run anything on this machine',
  };
  const items = [check, normal, limits, access];
  return { items, ready: state !== null && items.every((item) => item.mark !== 'fail') };
}
