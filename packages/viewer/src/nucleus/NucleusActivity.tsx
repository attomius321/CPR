// Nucleus's Activity tab (NU2): what it did, across its conversations, as a workspace's Activity
// tab draws it (`ActivityTimeline`, V73's timeline and V74's colours): the person's messages and
// its answers, its calls with the gate's decisions, the web, Symbiote's tools and each Confirm,
// its sessions' own events. Read from `/api/nucleus/activity` with Nucleus's state, while shown.
import { useEffect, useMemo, useState } from 'react';
import type { NucleusActivity as Activity, PageAgentState } from '@symbiote/core';
import { ActivityTimeline } from '../workspaces/activity/ActivityTimeline.js';
import { nucleusEvents, nucleusRawLines } from '../workspaces/activity/events.js';
import { activityGroups } from '../workspaces/activity/groups.js';
import { liveActivity } from '../workspaces/activity/live.js';
import { nucleusAgent } from './page-agent.js';

/** Nucleus's activity, read again with each read of its state; null until the first answers. */
function useNucleusActivity(read: PageAgentState | null): Activity | null {
  const [activity, setActivity] = useState<Activity | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/nucleus/activity')
      .then((response) => (response.ok ? (response.json() as Promise<Activity>) : null))
      .then((answer) => {
        if (live && answer) setActivity(answer);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [read]);
  return activity;
}

export function NucleusActivity({ read }: { read: PageAgentState | null }) {
  const activity = useNucleusActivity(read);
  const conversation = read?.conversation ?? null;
  const agent = useMemo(() => nucleusAgent(conversation), [conversation]);
  const worktree = read?.checkout ?? '';
  const lines = activity?.lines;
  const events = useMemo(() => nucleusEvents(lines ?? []), [lines]);
  const groups = useMemo(
    () => activityGroups(events, { agent, worktree, nucleus: true }),
    [events, agent, worktree],
  );
  const live = useMemo(
    () => liveActivity(agent, worktree, events, groups),
    [agent, worktree, events, groups],
  );
  if (!activity) return <p className="hint activity-empty">Reading what Nucleus did…</p>;
  if (activity.lines.length === 0) {
    return (
      <p className="hint activity-empty">
        Nothing recorded yet: what Nucleus does is recorded from its next conversation, or its
        session&apos;s next wake.
      </p>
    );
  }
  return (
    <ActivityTimeline
      events={events}
      groups={groups}
      live={live}
      raw={() => nucleusRawLines(activity.lines)}
      worktree={worktree}
      ready
      cut={activity.cut}
      exportFrom="/api/nucleus/activity/export"
    />
  );
}
