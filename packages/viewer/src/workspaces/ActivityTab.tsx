// A workspace's Activity tab (V48c; V73): what happened as a timeline of phases — exploring,
// implementing, testing, debugging, committing — between the milestones (prompts, messages,
// questions, reports, commits, the verdict), each opening to every event and each event to what
// was recorded of it; a live strip on top while the agent works or waits; the raw stream one
// switch away. Read with the list (every 5 s while its agent works or waits): groups keep their
// keys, so an open one stays open; the view follows the end while it is there.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { WorkspaceSummary, WorkspaceThread } from '@symbiote/core';
import { useMarkdown } from '../ui/markdown.js';
import { useChanges } from './ChangesPanel.js';
import { useTools } from './activity/api.js';
import { activityEvents, rawLines } from './activity/events.js';
import { activityGroups, type ActivityGroup } from './activity/groups.js';
import { liveActivity } from './activity/live.js';
import { GroupRow } from './activity/GroupRow.js';
import { LiveStrip } from './activity/LiveStrip.js';
import { RawStream } from './activity/RawStream.js';

/** How near the end counts as at it: the view follows new rows only from there. */
const END_PX = 24;

type Mode = 'timeline' | 'raw';

const dayOf = (at: string) => new Date(at).toDateString();
const dayText = (at: string) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

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
  const live = useMemo(() => liveActivity(workspace, events, groups), [workspace, events, groups]);
  const [mode, setMode] = useState<Mode>('timeline');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback(
    (key: string) =>
      setOpen((before) => {
        const after = new Set(before);
        if (after.has(key)) after.delete(key);
        else after.add(key);
        return after;
      }),
    [],
  );
  const lexer = useMarkdown();
  // The timeline's list or the raw stream's box, whichever is shown: it scrolls.
  const box = useRef<HTMLElement | null>(null);
  const setBox = useCallback((element: HTMLElement | null) => {
    box.current = element;
  }, []);
  const atEnd = useRef(true);
  // The groups drawn at first come in still; groups added after, by a read, fade in.
  const first = useRef<Set<string> | null>(null);
  if (first.current === null && thread && read) first.current = new Set(groups.map((g) => g.key));
  useLayoutEffect(() => {
    const shown = box.current;
    if (shown && atEnd.current) shown.scrollTop = shown.scrollHeight;
  }, [groups.length, lexer, mode]);
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const shown = event.currentTarget;
    atEnd.current = shown.scrollHeight - shown.scrollTop - shown.clientHeight < END_PX;
  };
  if (!thread) return <p className="hint">Reading what happened…</p>;

  const calls = events.filter((e) => e.kind === 'call').length;
  const phases = groups.filter((g) => !g.milestone && g.kind !== 'made' && g.kind !== 'session');
  const days = new Set(groups.flatMap((g) => (g.start ? [dayOf(g.start)] : [])));
  const lines = mode === 'raw' ? rawLines(workspace, thread, tools, commits) : [];
  const rows: { key: string; day?: string; group?: ActivityGroup }[] = [];
  let day: string | null = null;
  for (const group of groups) {
    if (days.size > 1 && group.start && dayOf(group.start) !== day) {
      day = dayOf(group.start);
      rows.push({ key: `day:${day}`, day: dayText(group.start) });
    }
    rows.push({ key: group.key, group });
  }

  return (
    <>
      <div className="activity-bar">
        <span className="activity-counts">
          {mode === 'raw'
            ? plural(lines.length, 'line recorded', 'lines recorded')
            : `${plural(phases.length, 'phase', 'phases')} · ${plural(calls, 'call', 'calls')}`}
        </span>
        <span className="scopes" role="group" aria-label="Show">
          {(['timeline', 'raw'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              className={mode === choice ? 'scope active' : 'scope'}
              aria-pressed={mode === choice}
              onClick={() => {
                atEnd.current = true;
                setMode(choice);
              }}
            >
              {choice === 'timeline' ? 'Timeline' : 'Raw events'}
            </button>
          ))}
        </span>
      </div>
      {live && <LiveStrip live={live} />}
      {mode === 'raw' ? (
        <div className="activity-scroll" ref={setBox} onScroll={onScroll}>
          <RawStream lines={lines} worktree={worktree} />
        </div>
      ) : (
        <ol ref={setBox} className="activity" aria-label="Activity" onScroll={onScroll}>
          {read?.cut && (
            <li className="activity-note-row hint">
              Older calls are not shown: Symbiote reads the newest megabyte of them.
            </li>
          )}
          {rows.map((row) =>
            row.group ? (
              <GroupRow
                key={row.key}
                group={row.group}
                open={open.has(row.key)}
                onToggle={onToggle}
                worktree={worktree}
                lexer={lexer}
                fresh={first.current !== null && !first.current.has(row.key)}
              />
            ) : (
              <li key={row.key} className="activity-day">
                <span className="activity-when" />
                <span className="activity-rail" aria-hidden="true" />
                <span className="activity-day-text">{row.day}</span>
              </li>
            ),
          )}
          {read && !read.tools && thread.recorded && (
            <li className="activity-note-row hint">
              Its commands and edits are not recorded: its agent started before Symbiote kept them.
            </li>
          )}
        </ol>
      )}
    </>
  );
}
