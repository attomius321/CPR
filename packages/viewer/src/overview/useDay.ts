// The Overview's day read (V91, decisions 851, 852): `GET /api/workspaces/day?since=`, from the
// page's local midnight six days back. Read on mount, again when the list's read shows something
// moved (a state, a step, a round, a landing, a merge), and at local midnight: no timer of its
// own besides midnight's.
import { useEffect, useState } from 'react';
import type { WorkspaceDay } from '@symbiote/core';
import type { WorkspacesState } from '../workspaces/useWorkspaces.js';
import { getJson } from '../ui/http.js';
import { nextMidnight, sinceOf } from './day.js';

/** What, in the list's read, moves the day: each workspace's and each merge's state. */
export function dayKey({ list, merges }: Pick<WorkspacesState, 'list' | 'merges'>): string {
  const workspaces = (list?.workspaces ?? []).map((w) =>
    [
      w.branch,
      w.agent.state,
      w.ahead,
      w.merged,
      w.activity?.since,
      w.hive?.step,
      w.hive?.round,
      w.hive?.landing?.outcome,
      w.hive?.review?.at,
      w.hive?.check?.at,
    ].join(':'),
  );
  const queue = (merges?.merges ?? []).map((m) => `${m.id}:${m.state}`);
  return [...workspaces, ...queue].join('|');
}

/** The page's day: the time it counts today from, moved at each local midnight. */
function useToday(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), nextMidnight(now) - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

/** The day read, and the time it counts today from. */
export function useDay(state: Pick<WorkspacesState, 'list' | 'merges'>): {
  day: WorkspaceDay | null;
  today: number;
} {
  const today = useToday();
  const since = sinceOf(today);
  const key = dayKey(state);
  const ready = state.list !== null;
  const [day, setDay] = useState<WorkspaceDay | null>(null);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    getJson<WorkspaceDay>(`/api/workspaces/day?since=${encodeURIComponent(since)}`)
      .then((read) => live && setDay(read))
      .catch(() => {
        // Not served (an older `symbiote view`) or failed: the figures say what the list says.
      });
    return () => {
      live = false;
    };
  }, [since, key, ready]);
  return { day, today };
}
