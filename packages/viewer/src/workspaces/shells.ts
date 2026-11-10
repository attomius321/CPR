// A workspace's shells (V45): terminals in its worktree beside its agent's, in tabs of their own.
// What the panel decides about them, kept pure.
import type { WorkspaceShell } from '@symbiote/core';
import type { AgentView, View } from './WorkspaceTabs.js';

/** Most shells a workspace has open at once: the server's `MAX_SHELLS`. */
export const MAX_SHELLS = 8;

/** `&shell=<n>`: the shell's tab picked (a reload comes back to it), or null. */
export function shellOfUrl(search: string): number | null {
  const value = new URLSearchParams(search).get('shell');
  return value !== null && /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

/** A shell's tab: `Shell <n>`. */
export const shellName = (number: number): string => `Shell ${number}`;

/** What × asks before closing a shell where a program runs (decision 298); null: nothing. */
export function closeQuestion(shell: WorkspaceShell): string | null {
  return shell.running
    ? `${shell.running} is running in ${shellName(shell.number)}: closing the shell ends it.`
    : null;
}

/** The shell shown once shell `number` closed or exited: its neighbour, the one before first. */
export function shellAfter(shells: readonly WorkspaceShell[], number: number): number | null {
  const others = shells.filter((shell) => shell.number !== number);
  const before = others.filter((shell) => shell.number < number).at(-1);
  return (before ?? others[0])?.number ?? null;
}

/** What a workspace's page knows when it picks the tab to show. */
export interface TabState {
  /** The tab picked (the address's), or none. */
  chosen: View | null;
  /** Its shells, null until read. */
  shells: readonly WorkspaceShell[] | null;
  /** The shell picked (`&shell=<n>`). */
  shellShown: number | null;
  /** Split's shell (`&split=<n>`). */
  split: number | null;
  /** Its agent opens in a terminal. */
  terminals: boolean;
  /** Shells can run in its worktree. */
  shellsCan: boolean;
  /** Hive drives or drove it: it has a Run tab. */
  hive: boolean;
}

/** The tab shown, and the shell drawn in it or beside the agent's terminal. */
export interface ShownTab {
  shellNumber: number | null;
  splitNumber: number | null;
  view: View;
  shownShell: WorkspaceShell | undefined;
}

/**
 * The tab shown (V45, V89). The shell picked; once it went (closed, exited), its neighbour, the
 * one before first; none left, or `symbiote view` started again: the agent's tab. Split's shell,
 * as for a picked one: its neighbour once it went; none left, Split is off.
 */
export function shownTab({
  chosen,
  shells,
  shellShown,
  split,
  terminals,
  shellsCan,
  hive,
}: TabState): ShownTab {
  const splitCan = terminals && shellsCan;
  const fallback: AgentView = terminals ? 'terminal' : 'thread';
  const shellNumber =
    shellShown === null || shells === null || shells.some((shell) => shell.number === shellShown)
      ? shellShown
      : shellAfter(shells, shellShown);
  const splitNumber =
    !splitCan || split === null
      ? null
      : shells === null || shells.some((shell) => shell.number === split)
        ? split
        : shellAfter(shells, split);
  const shellGone = chosen === 'shell' && (!shellsCan || (shells !== null && shellNumber === null));
  const view: View =
    splitNumber !== null
      ? 'terminal'
      : chosen === 'terminal' && !terminals
        ? 'thread'
        : shellGone || (chosen === 'run' && !hive)
          ? fallback
          : (chosen ?? fallback);
  const shownShell =
    splitNumber !== null
      ? shells?.find((shell) => shell.number === splitNumber)
      : view === 'shell'
        ? shells?.find((shell) => shell.number === shellNumber)
        : undefined;
  return { shellNumber, splitNumber, view, shownShell };
}

/** The shells with `shell` among them, once, by number. */
export function withShell(
  shells: readonly WorkspaceShell[],
  shell: WorkspaceShell,
): WorkspaceShell[] {
  return [...shells.filter((other) => other.id !== shell.id), shell].sort(
    (a, b) => a.number - b.number,
  );
}
