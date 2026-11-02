// What turning Hive mode on or off concerns, in words (HV4, decisions 771, 772): the workspaces
// in normal mode that keep it off, and what Hive off does to each Hive workspace in flight. Pure.
import type { HiveState, HiveStep } from '@symbiote/core';

/** A workspace as the questions name it: its title, else its branch. */
export const nameOf = (w: { branch: string; title?: string }) => w.title ?? w.branch;

/** What turning Hive off does to a workspace at `step`, and what turning it on again does. */
export function offWords(step: HiveStep): string {
  switch (step) {
    case 'writing':
      return 'its agent is stopped; on again, Hive tells it to continue';
    case 'checking':
      return 'its check is stopped; on again, the check runs again';
    case 'reviewing':
      return 'its review is stopped and its copy deleted; on again, a new review';
    case 'landing':
      return 'its landing goes on: the merge queue checks, lands and pushes it; Hive records it once on again';
    default:
      return 'nothing runs for it';
  }
}

/** Why Hive cannot turn on now; null when it can. */
export function onRefusal(state: Pick<HiveState, 'normal'>): string | null {
  const { normal } = state;
  if (normal.length === 0) return null;
  const one = normal.length === 1;
  return `Hive cannot turn on while ${one ? 'a workspace is' : 'these workspaces are'} in normal mode. Land ${one ? 'it' : 'them'} or clean ${one ? 'it' : 'them'} up first:`;
}
