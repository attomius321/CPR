// The Activity tab's timeline (V73; shared with Nucleus's since NU2): the bar (phases and calls,
// or lines recorded; Timeline or Raw events), the live strip, the groups on the rail with a day's
// row where the day changes, or the raw stream. Groups keep their keys, so an open one stays open;
// those a read adds fade in; the view follows the end while it is there.
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import { useMarkdown } from '../../ui/markdown.js';
import type { ActivityEvent, RawLine } from './events.js';
import type { ActivityGroup } from './groups.js';
import type { LiveActivity } from './live.js';
import { GroupRow } from './GroupRow.js';
import { LiveStrip } from './LiveStrip.js';
import { RawStream } from './RawStream.js';

/** How near the end counts as at it: the view follows new rows only from there. */
const END_PX = 24;

type Mode = 'timeline' | 'raw';

/** The groups the bar counts as phases: work, not the milestones between. */
const PHASES = new Set<ActivityGroup['kind']>([
  'explore',
  'implement',
  'docs',
  'test',
  'visual',
  'debug',
  'git',
  'web',
  'symbiote',
  'other',
]);

const dayOf = (at: string) => new Date(at).toDateString();
const dayText = (at: string) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function ActivityTimeline({
  events,
  groups,
  live,
  raw,
  worktree,
  ready,
  cut,
  after,
}: {
  events: readonly ActivityEvent[];
  groups: readonly ActivityGroup[];
  live: LiveActivity | null;
  /** The raw stream's lines, read when it is shown. */
  raw: () => RawLine[];
  /** Where paths are written short from. */
  worktree: string;
  /** Read once: the groups drawn then come in still, those after fade in. */
  ready: boolean;
  /** Older lines were left out: Symbiote reads the newest megabyte. */
  cut?: boolean;
  /** A note after the rows. */
  after?: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>('timeline');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback(
    (key: string) =>
      setOpen((before) => {
        const next = new Set(before);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
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
  if (first.current === null && ready) first.current = new Set(groups.map((g) => g.key));
  useLayoutEffect(() => {
    const shown = box.current;
    if (shown && atEnd.current) shown.scrollTop = shown.scrollHeight;
  }, [groups.length, lexer, mode]);
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const shown = event.currentTarget;
    atEnd.current = shown.scrollHeight - shown.scrollTop - shown.clientHeight < END_PX;
  };

  const calls = events.filter((e) => e.kind === 'call').length;
  const phases = groups.filter((g) => PHASES.has(g.kind));
  const days = new Set(groups.flatMap((g) => (g.start ? [dayOf(g.start)] : [])));
  const lines = mode === 'raw' ? raw() : [];
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
          {cut && (
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
          {after}
        </ol>
      )}
    </>
  );
}
