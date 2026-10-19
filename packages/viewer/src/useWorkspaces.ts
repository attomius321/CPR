import { useEffect, useState } from 'react';
import type { BranchReviewList, WorkspaceList } from '@cpr/core';

/** The workspaces and the reviews, read together: a review changes what a workspace needs next. */
export interface WorkspacesState {
  list: WorkspaceList | null;
  reviews: BranchReviewList | null;
}

/** While an agent works or waits, how often its state is read again. */
const POLL_MS = 5_000;

// One reader for every component on the page (the tab bar, the page, the review header).
let current: WorkspacesState = { list: null, reviews: null };
const listeners = new Set<(state: WorkspacesState) => void>();
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const live = (state: WorkspacesState) =>
  state.list?.workspaces.some(
    (f) => f.agent.state === 'working' || f.agent.state === 'needs-you',
  ) ?? false;

async function read<T>(path: string): Promise<T | null> {
  const response = await fetch(path);
  return response.ok ? ((await response.json()) as T) : null;
}

/** Reads the workspaces (V18b) and the reviews again, and tells every reader. */
export function reloadWorkspaces(): Promise<void> {
  loading ??= Promise.all([
    read<WorkspaceList>('/api/workspaces'),
    read<BranchReviewList>('/api/reviews'),
  ])
    .then(([list, reviews]) => {
      current = { list, reviews };
      for (const listener of listeners) listener(current);
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
      schedule();
    });
  return loading;
}

/**
 * Reads them anew, after any read under way (it may have started before a change, such as a
 * stop), and gives what was read.
 */
export async function readWorkspacesAgain(): Promise<WorkspacesState> {
  await loading;
  await reloadWorkspaces();
  return current;
}

/** The next read, while a page reads them and an agent works or waits; none when hidden. */
function schedule(): void {
  clearTimeout(timer);
  if (listeners.size === 0 || !live(current)) return;
  timer = setTimeout(() => {
    if (document.visibilityState === 'hidden') schedule();
    else void reloadWorkspaces();
  }, POLL_MS);
}

const onShown = () => {
  if (document.visibilityState !== 'hidden') void reloadWorkspaces();
};

/**
 * The workspaces and reviews, read on mount, when the page is back in view, and every 5 s while
 * an agent works or waits for the person.
 */
export function useWorkspaces(): WorkspacesState {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) {
      window.addEventListener('focus', onShown);
      document.addEventListener('visibilitychange', onShown);
    }
    void reloadWorkspaces();
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
