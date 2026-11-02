// What turning Hive mode on or off concerns, in words (HV4, decisions 771, 772): the workspaces
// in normal mode that keep it off, and what Hive off does to each Hive workspace in flight. Pure.
import type { HiveLandingSetting, HiveLandsBy, HiveState, HiveStep } from '@symbiote/core';

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
  { by: 'queue', label: 'The merge queue' },
  { by: 'request', label: 'A pull or merge request' },
];

/** What a choice does. */
export function landsByWords(by: HiveLandsBy): string {
  return by === 'request'
    ? 'Hive pushes the branch and opens a pull request (GitHub) or merge request (GitLab) into the branch the workspace started from. You review and merge it there: your merge lands it. A conflict goes back to the agent.'
    : 'Hive merges each workspace into the branch it started from through the merge queue, which checks the merge, lands it and pushes both branches.';
}

/** The forge `origin` names and whether a request can be opened now (decision 793). */
export function forgeWords(setting: HiveLandingSetting): { text: string; ok: boolean } {
  const { forge, why } = setting;
  const at = forge ? `origin is ${forge.project} on ${FORGES[forge.kind].name}` : '';
  if (why) {
    const cannot = `Hive cannot open a request now: ${why.replace(/\.$/, '')}.`;
    return { text: at ? `${at}. ${cannot}` : cannot, ok: false };
  }
  return { text: `${at}; a token is found.`, ok: true };
}
