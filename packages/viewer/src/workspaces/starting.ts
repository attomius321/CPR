// Workspaces being made (V48): the start page's request runs ~1 s (making the branch, its
// worktree, starting the agent); meanwhile the sidenav shows its card, starting. Held from the
// request until the list has the workspace, or the start failed.
import { useSyncExternalStore } from 'react';

export interface StartUnderWay {
  branch: string;
  /** The workspace's name, as its card will say it. */
  name: string;
  /** The agent it starts ("Claude Code"); absent when none was found. */
  agent?: string;
}

let starts: readonly StartUnderWay[] = [];
const listeners = new Set<() => void>();
const tell = () => {
  for (const listener of listeners) listener();
};

/** A start sent. */
export function beginStart(start: StartUnderWay): void {
  starts = [...starts.filter((s) => s.branch !== start.branch), start];
  tell();
}

/** A start answered: listed, or failed. */
export function endStart(branch: string): void {
  if (!starts.some((s) => s.branch === branch)) return;
  starts = starts.filter((s) => s.branch !== branch);
  tell();
}

export const startsNow = (): readonly StartUnderWay[] => starts;

export function subscribeStarts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The starts under way, for the sidenav. */
export function useStarts(): readonly StartUnderWay[] {
  return useSyncExternalStore(subscribeStarts, startsNow);
}
