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

/** Why Hive cannot turn on now; null when it can. */
export function onRefusal(state: Pick<HiveState, 'normal'>): string | null {
  const { normal } = state;
  if (normal.length === 0) return null;
  const one = normal.length === 1;
  return `Hive cannot turn on while ${one ? 'a workspace is' : 'these workspaces are'} in normal mode. Land ${one ? 'it' : 'them'} or clean ${one ? 'it' : 'them'} up first:`;
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
