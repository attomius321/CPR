// A workspace's shells (V45): terminals in its worktree beside its agent's, in tabs of their own.
// What the panel decides about them, kept pure.
import type { WorkspaceShell } from '@symbiote/core';

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

/** The shells with `shell` among them, once, by number. */
export function withShell(
  shells: readonly WorkspaceShell[],
  shell: WorkspaceShell,
): WorkspaceShell[] {
  return [...shells.filter((other) => other.id !== shell.id), shell].sort(
    (a, b) => a.number - b.number,
  );
}
