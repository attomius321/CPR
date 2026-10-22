// Subscription usage in the status bar (V29c), kept pure: a window's label from its length, its
// tone, and what a hover says. The numbers come from `symbiote view` (`GET /api/usage`).
import type { UsageSubscription, UsageWindow } from '@symbiote/core';
import { relativeDate } from '../history/commits.js';

/** Vendors by name, not by logo (decision 181). */
export const AGENT_NAMES: Record<UsageSubscription['agent'], string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** The program that kept a copy of the numbers. */
const PROGRAMS: Record<UsageSubscription['agent'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/**
 * A window's name from its length (decision 173): 5h, wk, 30d; others in days, hours or minutes.
 * A fixed "5h · wk" would be wrong for Codex's Go plan, whose one window is 30 days.
 */
export function windowLabel(minutes: number): string {
  if (minutes === 10_080) return 'wk';
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export type UsageTone = 'ok' | 'high' | 'full';

/**
 * Green under 80 %, amber from 80 % or when the vendor warns, red at 100 % or when the vendor says
 * a limit is reached.
 */
export function usageTone(usedPercent: number, limited = false, warning = false): UsageTone {
  if (limited || usedPercent >= 100) return 'full';
  return usedPercent >= 80 || warning ? 'high' : 'ok';
}

/** When a window starts again, from now: "resets in 3 h 45 min", "resets in 5 days 5 h". */
export function resetText(resetsAt: string, now: number): string {
  const ms = Date.parse(resetsAt) - now;
  if (!(ms > 0)) return 'has reset';
  const total = Math.ceil(ms / 60_000);
  const days = Math.floor(total / 1_440);
  const hours = Math.floor((total % 1_440) / 60);
  const minutes = total % 60;
  if (days > 0) return `resets in ${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} h` : ''}`;
  if (hours > 0) return `resets in ${hours} h${minutes ? ` ${minutes} min` : ''}`;
  return `resets in ${minutes} min`;
}

/** The plan's own windows, in the bar; a model's own (`scope`) is shown on hover only. */
export const shownWindows = (subscription: UsageSubscription): UsageWindow[] =>
  subscription.windows.filter((w) => !w.scope);

/** What a hover says: the plan, each window and when it resets, how old the numbers are. */
export function usageTitle(subscription: UsageSubscription, now: number): string {
  const { agent, plan, windows, at, source, note, limited } = subscription;
  const lines = [[AGENT_NAMES[agent], plan].filter(Boolean).join(' ')];
  for (const w of windows) {
    const name = w.scope ? `${windowLabel(w.minutes)} (${w.scope})` : windowLabel(w.minutes);
    const reset = w.resetsAt ? `, ${resetText(w.resetsAt, now)}` : '';
    lines.push(`${name}: ${Math.round(w.usedPercent)} % used${reset}`);
  }
  if (windows.length === 0) lines.push('No window to show now');
  if (limited) lines.push(`${AGENT_NAMES[agent]} says a limit is reached`);
  const age = relativeDate(at, now);
  lines.push(
    source === 'live'
      ? `Read ${age}${note ? `, not since: ${note}` : ''}`
      : `${PROGRAMS[agent]}'s copy, ${age}${note ? `: ${note}` : ''}`,
  );
  return lines.join('\n');
}

/** The numbers are not from the last read, a copy or the last ones kept: the bar says how old. */
export const showsAge = (subscription: UsageSubscription): boolean =>
  subscription.source === 'cached' || subscription.note !== undefined;
