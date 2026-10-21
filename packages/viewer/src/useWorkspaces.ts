import { useEffect, useState } from 'react';
import type { BranchReviewList, MergeList, WorkspaceList } from '@symbiote/core';
import { mergeLive } from './merges.js';

/**
 * The workspaces, the reviews and the merge queue (V26), read together: a review changes what a
 * workspace needs next, and an approval is merged.
 */
export interface WorkspacesState {
  list: WorkspaceList | null;
  reviews: BranchReviewList | null;
  /** Null where Symbiote does not merge (no repository). */
  merges: MergeList | null;
}

/** While an agent works or waits, how often its state is read again. */
const POLL_MS = 5_000;
/** While a merge is queued, merging or checking. */
const MERGE_POLL_MS = 1_500;

// One reader for every component on the page (the tab bar, the page, the review header).
let current: WorkspacesState = { list: null, reviews: null, merges: null };
const listeners = new Set<(state: WorkspacesState) => void>();
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const live = (state: WorkspacesState) =>
  state.list?.workspaces.some(
    (f) => f.agent.state === 'working' || f.agent.state === 'needs-you',
  ) ?? false;

const merging = (state: WorkspacesState) => mergeLive(state.merges?.merges ?? []);

/** Terminals open in panels: what is typed in one may start a turn (V27b, decision 161). */
let terminalsOpen = 0;

/**
 * How long until the next read: 1.5 s while a merge runs; 5 s while an agent works or waits, or
 * a terminal is open (`open`); none otherwise.
 */
export function readEvery(state: WorkspacesState, open: number): number | null {
  if (merging(state)) return MERGE_POLL_MS;
  return live(state) || open > 0 ? POLL_MS : null;
}

/** Holds the reads on while an agent's terminal is open; the way to let go. */
export function holdReads(): () => void {
  terminalsOpen += 1;
  schedule();
  let held = true;
  return () => {
    if (held) terminalsOpen -= 1;
    held = false;
  };
}

async function read<T>(path: string): Promise<T | null> {
  const response = await fetch(path);
  return response.ok ? ((await response.json()) as T) : null;
}

/** Reads the workspaces (V18b), the reviews and the merges, unless a read is under way. */
function refresh(): Promise<void> {
  loading ??= Promise.all([
    read<WorkspaceList>('/api/workspaces'),
    read<BranchReviewList>('/api/reviews'),
    read<MergeList>('/api/merges'),
  ])
    .then(([list, reviews, merges]) => {
      current = { list, reviews, merges };
      for (const listener of listeners) listener(current);
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
      schedule();
    });
  return loading;
}

/** The read after the one under way, which every caller meanwhile shares. */
let next: Promise<void> | null = null;

/**
 * Reads them again after a change, and tells every reader. A read under way may have started
 * before the change (a Land clicked as its merge opened, V29b): one more read follows it.
 */
export function reloadWorkspaces(): Promise<void> {
  if (!loading) return refresh();
  next ??= loading.then(() => {
    next = null;
    return refresh();
  });
  return next;
}

/** Reads them anew, after any read under way, and gives what was read. */
export async function readWorkspacesAgain(): Promise<WorkspacesState> {
  await reloadWorkspaces();
  return current;
}

/**
 * The next read, while a page reads them and an agent works or waits, a terminal is open, or a
 * merge runs; none when hidden.
 */
function schedule(): void {
  clearTimeout(timer);
  if (listeners.size === 0) return;
  const wait = readEvery(current, terminalsOpen);
  if (wait === null) return;
  timer = setTimeout(() => {
    if (document.visibilityState === 'hidden') schedule();
    else void refresh();
  }, wait);
}

const onShown = () => {
  if (document.visibilityState !== 'hidden') void refresh();
};

/**
 * The workspaces, reviews and merges, read on mount, when the page is back in view, every 5 s
 * while an agent works or waits for the person, and every 1.5 s while a merge runs.
 */
export function useWorkspaces(): WorkspacesState {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) {
      window.addEventListener('focus', onShown);
      document.addEventListener('visibilitychange', onShown);
    }
    void refresh();
    return () => {
      listeners.delete(setState);
      if (listeners.size > 0) return;
      window.removeEventListener('focus', onShown);
      document.removeEventListener('visibilitychange', onShown);
      clearTimeout(timer);
    };
  }, []);
  return state;
}
