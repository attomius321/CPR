import { useEffect, useState } from 'react';
import type { BranchReviewList, FeatureList } from '@cpr/core';

/** The features and the reviews, read together: a review changes what a feature needs next. */
export interface FeaturesState {
  list: FeatureList | null;
  reviews: BranchReviewList | null;
}

/** While an agent works or waits, how often its state is read again. */
const POLL_MS = 5_000;

// One reader for every component on the page (the tab bar, the page, the review header).
let current: FeaturesState = { list: null, reviews: null };
const listeners = new Set<(state: FeaturesState) => void>();
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const live = (state: FeaturesState) =>
  state.list?.features.some((f) => f.agent.state === 'working' || f.agent.state === 'needs-you') ??
  false;

async function read<T>(path: string): Promise<T | null> {
  const response = await fetch(path);
  return response.ok ? ((await response.json()) as T) : null;
}

/** Reads the features (V18b) and the reviews again, and tells every reader. */
export function reloadFeatures(): Promise<void> {
  loading ??= Promise.all([
    read<FeatureList>('/api/features'),
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
export async function readFeaturesAgain(): Promise<FeaturesState> {
  await loading;
  await reloadFeatures();
  return current;
}

/** The next read, while a page reads them and an agent works or waits; none when hidden. */
function schedule(): void {
  clearTimeout(timer);
  if (listeners.size === 0 || !live(current)) return;
  timer = setTimeout(() => {
    if (document.visibilityState === 'hidden') schedule();
    else void reloadFeatures();
  }, POLL_MS);
}

const onShown = () => {
  if (document.visibilityState !== 'hidden') void reloadFeatures();
};

/**
 * The features and reviews, read on mount, when the page is back in view, and every 5 s while
 * an agent works or waits for the person.
 */
export function useFeatures(): FeaturesState {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) {
      window.addEventListener('focus', onShown);
      document.addEventListener('visibilitychange', onShown);
    }
    void reloadFeatures();
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
