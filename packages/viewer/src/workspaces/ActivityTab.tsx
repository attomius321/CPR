// A workspace's Activity tab (V48c; V73): what happened as a timeline of phases — exploring,
// implementing, testing, debugging, committing — between the milestones (prompts, messages,
// questions, reports, commits, the verdict), each opening to every event and each event to what
// was recorded of it; a live strip on top while the agent works or waits; the raw stream one
// switch away (`activity/ActivityTimeline.tsx`, shared with Nucleus's since NU2). Read with the
// list (every 5 s while its agent works or waits).
import { useMemo } from 'react';
import type { WorkspaceSummary, WorkspaceThread } from '@symbiote/core';
import { useChanges } from './ChangesPanel.js';
import { useTools } from './activity/api.js';
import { ActivityTimeline } from './activity/ActivityTimeline.js';
import { activityEvents, rawLines } from './activity/events.js';
import { activityGroups } from './activity/groups.js';
import { liveActivity } from './activity/live.js';

export function ActivityTab({
  workspace,
  thread,
  version,
}: {
  workspace: WorkspaceSummary;
  thread: WorkspaceThread | null;
  /** The list as last read: its commits and tools are read again with it. */
  version: unknown;
}) {
  const changes = useChanges(workspace.branch, version);
  const commits = changes && typeof changes === 'object' ? changes.commits.listed : null;
  const read = useTools(workspace.branch, version);
  const tools = read?.tools;
  const worktree = workspace.worktree.path;
  const events = useMemo(
    () => activityEvents(workspace, thread, tools, commits),
    [workspace, thread, tools, commits],
  );
  const groups = useMemo(
    () => activityGroups(events, { agent: workspace.agent, worktree }),
    [events, workspace.agent, worktree],
  );
  const live = useMemo(
    () => liveActivity(workspace.agent, worktree, events, groups),
    [workspace.agent, worktree, events, groups],
  );
  if (!thread) return <p className="hint">Reading what happened…</p>;
  return (
    <ActivityTimeline
      events={events}
      groups={groups}
      live={live}
      raw={() => rawLines(workspace, thread, tools, commits)}
      worktree={worktree}
      ready={read !== null}
      cut={read?.cut === true}
      exportFrom={`/api/workspaces/activity/export?branch=${encodeURIComponent(workspace.branch)}`}
      after={
        read &&
        !read.tools &&
        thread.recorded && (
          <li className="activity-note-row hint">
            Its commands and edits are not recorded: its agent started before Symbiote kept them.
          </li>
        )
      }
    />
  );
}
