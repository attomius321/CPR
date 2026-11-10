import { useEffect, useState } from 'react';
import type { BranchReviewList, MergeList, PageAgentState, WorkspaceList } from '@symbiote/core';
import { mergeLive } from './merges.js';
import { pushed, type Parts, type Status } from '../shell/events.js';

/**
 * The workspaces, the reviews and the merge queue (V26), read together: a review changes what a
 * workspace needs next, and an approval is merged. Nucleus's state too (V35), and Scribe's (V41):
 * the sidenav shows them.
 */
export interface WorkspacesState {
  list: WorkspaceList | null;
  reviews: BranchReviewList | null;
  /** Null where Symbiote does not merge (no repository). */
  merges: MergeList | null;
  /** Null where there is no Nucleus (no repository). */
  nucleus: PageAgentState | null;
  /** Null where there is no Scribe (no repository). */
  scribe: PageAgentState | null;
  /** When they were last read (V48), by the page's clock; absent before the first. */
  readAt?: number;
  /** The last read failed (V48): Symbiote did not answer. What was read stays. */
  failing?: true;
}

/** While an agent works or waits, how often its state is read again. */
const POLL_MS = 5_000;
/** While a merge is queued, merging or checking. */
const MERGE_POLL_MS = 1_500;

// One reader for every component on the page (the tab bar, the page, the review header).
let current: WorkspacesState = {
  list: null,
  reviews: null,
  merges: null,
  nucleus: null,
  scribe: null,
};
const listeners = new Set<(state: WorkspacesState) => void>();
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Nucleus or Scribe answering, or waiting on the person (V59: its link a band until a read). */
const busy = (page: PageAgentState | null) =>
  page?.conversation?.state === 'working' || page?.conversation?.state === 'needs-you';

/** Hive's steps that move on their own while Hive is on (HV4): until it lands or stops. */
const HIVE_AT_WORK = new Set(['writing', 'checking', 'reviewing', 'landing']);

const live = (state: WorkspacesState) =>
  (state.list?.workspaces.some(
    (f) =>
      f.agent.state === 'working' ||
      f.agent.state === 'needs-you' ||
      (f.hive !== undefined && !f.hive.off && HIVE_AT_WORK.has(f.hive.step)),
  ) ??
    false) ||
  busy(state.nucleus) ||
  busy(state.scribe);

const merging = (state: WorkspacesState) => mergeLive(state.merges?.merges ?? []);

/** Terminals open in panels: what is typed in one may start a turn (V27b, decision 161). */
let terminalsOpen = 0;
/**
 * Until when the last terminal closed counts as open (V50): a question typed just before leaving
 * Nucleus's starts its turn after, and a read on the next page may come before the server's list
 * says so.
 */
let closedUntil = 0;

/**
 * How long until the next read: 1.5 s while a merge runs; 5 s while an agent works or waits, Hive
 * is at work on a workspace (HV4), Nucleus answers, Scribe writes, either waits on the person, a
 * terminal is open (`open`), or the last read failed (V48: until one answers); none otherwise.
 */
export function readEvery(state: WorkspacesState, open: number): number | null {
  if (merging(state)) return MERGE_POLL_MS;
  return live(state) || open > 0 || state.failing ? POLL_MS : null;
}

/** Holds the reads on while an agent's terminal is open; the way to let go. */
export function holdReads(): () => void {
  terminalsOpen += 1;
  schedule();
  let held = true;
  return () => {
    if (held) {
      terminalsOpen -= 1;
      closedUntil = Date.now() + POLL_MS;
    }
    held = false;
  };
}

async function read<T>(path: string): Promise<T | null> {
  const response = await fetch(path);
  return response.ok ? ((await response.json()) as T) : null;
}

/** Whether `symbiote view` pushes them (V94a): then nothing is read on a timer or on focus. */
const streaming = () => pushed().status() !== 'unavailable';

/** `next`'s value, or `was` when its JSON is the same: what did not change keeps its object. */
function kept<T>(was: T, next: T): T {
  return JSON.stringify(was) === JSON.stringify(next) ? was : next;
}

/**
 * Each field's last push from the stream, on a count of pushes (fix/e2e-flakes): a page's own read
 * that began before it may have been answered before it too, and never replaces it. The stream
 * sends what changed since what it sent, so an older answer put back would stay (a merge shown
 * Queued after the stream had said it cannot fast-forward).
 */
let pushes = 0;
const pushedAt = new Map<keyof WorkspacesState, number>();

/** `read`, unless the stream pushed `field` after the read began at `from`: then `was`. */
const newer = <T>(field: keyof WorkspacesState, from: number, was: T, read: T): T =>
  (pushedAt.get(field) ?? 0) > from ? was : kept(was, read);

/** Reads the workspaces (V18b), the reviews, the merges, Nucleus and Scribe, unless one is under way. */
function refresh(): Promise<void> {
  const from = pushes;
  loading ??= Promise.all([
    read<WorkspaceList>('/api/workspaces'),
    read<BranchReviewList>('/api/reviews'),
    read<MergeList>('/api/merges'),
    read<PageAgentState>('/api/nucleus'),
    read<PageAgentState>('/api/scribe'),
  ])
    .then(([list, reviews, merges, nucleus, scribe]) => {
      // A page's own read while pushed (after its action, V94a): what did not change is kept, as
      // the stream keeps it. Polling replaces every part, as before.
      current = streaming()
        ? {
            list: newer('list', from, current.list, list),
            reviews: newer('reviews', from, current.reviews, reviews),
            merges: newer('merges', from, current.merges, merges),
            nucleus: newer('nucleus', from, current.nucleus, nucleus),
            scribe: newer('scribe', from, current.scribe, scribe),
            readAt: Date.now(),
          }
        : { list, reviews, merges, nucleus, scribe, readAt: Date.now() };
      for (const listener of listeners) listener(current);
    })
    .catch(() => {
      // The stream says whether Symbiote answers; a page's own read that failed says nothing.
      if (streaming()) return;
      // Symbiote did not answer (V48): what was read stays, said to be from then.
      if (current.failing) return;
      current = { ...current, failing: true };
      for (const listener of listeners) listener(current);
    })
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
 * Whether the page reads while hidden: in the app, whose window's icon says what waits (N2), a
 * minimized window too; in a browser, only once it is back in view.
 */
export const readsHidden = (): boolean => window.symbioteApp?.waiting !== undefined;

/**
 * The next read, while a page reads them and an agent works or waits, a terminal is open, or a
 * merge runs; none when hidden, but in the app.
 */
function schedule(): void {
  clearTimeout(timer);
  if (listeners.size === 0 || streaming()) return;
  const wait = readEvery(current, terminalsOpen + (Date.now() < closedUntil ? 1 : 0));
  if (wait === null) return;
  timer = setTimeout(() => {
    if (document.visibilityState === 'hidden' && !readsHidden()) schedule();
    else void refresh();
  }, wait);
}

const onShown = () => {
  if (!streaming() && document.visibilityState !== 'hidden') void refresh();
};

/** Which of the pushed parts is which of the state's fields. */
const FIELDS = {
  workspaces: 'list',
  reviews: 'reviews',
  merges: 'merges',
  nucleus: 'nucleus',
  scribe: 'scribe',
} as const;

/**
 * What the stream sent (V94a): the parts that changed replace theirs; while it is lost, the
 * sidenav says since when it was last heard; with no stream, polling as before V94.
 */
function onPushed(changed: Parts, status: Status): void {
  if (status === 'unavailable') {
    void refresh();
    return;
  }
  let next: WorkspacesState | null = null;
  for (const [part, field] of Object.entries(FIELDS) as [
    keyof typeof FIELDS,
    keyof WorkspacesState,
  ][]) {
    if (!(part in changed)) continue;
    pushedAt.set(field, ++pushes);
    next ??= { ...current, readAt: Date.now() };
    (next as unknown as Record<string, unknown>)[field] = changed[part] ?? null;
  }
  if (status === 'streaming' && current.failing) {
    next ??= { ...current, readAt: Date.now() };
    delete next.failing;
  } else if (status === 'reconnecting' && !current.failing) {
    next = { ...(next ?? current), failing: true, readAt: pushed().heardAt() || Date.now() };
  }
  if (!next) return;
  current = next;
  for (const listener of listeners) listener(current);
}
let unsubscribe: (() => void) | null = null;

/**
 * The workspaces, reviews and merges, as `symbiote view` pushes them (V94a). Without its stream,
 * read on mount, when the page is back in view, every 5 s while an agent works or waits for the
 * person, and every 1.5 s while a merge runs.
 */
export function useWorkspaces(): WorkspacesState {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) {
      window.addEventListener('focus', onShown);
      document.addEventListener('visibilitychange', onShown);
      unsubscribe = pushed().subscribe(onPushed);
    }
    if (!streaming()) void refresh();
    return () => {
      listeners.delete(setState);
      if (listeners.size > 0) return;
      unsubscribe?.();
      unsubscribe = null;
      window.removeEventListener('focus', onShown);
      document.removeEventListener('visibilitychange', onShown);
      clearTimeout(timer);
    };
  }, []);
  return state;
}
