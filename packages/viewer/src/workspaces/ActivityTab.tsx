// A workspace's Activity tab (V48c): what happened, in time order, from the records Symbiote has.
// Read with the list (on focus, every 5 s while its agent works or waits): new rows are added at
// the end, the others kept by their keys, and the view follows the end while it is there.
import { memo, useLayoutEffect, useMemo, useRef, type UIEvent } from 'react';
import type { WorkspaceSummary, WorkspaceThread } from '@symbiote/core';
import { markdownNodes, useMarkdown, type Lexer } from '../ui/markdown.js';
import { useChanges } from './ChangesPanel.js';
import { timelineItems, type TimelineItem } from './timeline.js';
import { tip } from '../ui/tip.js';
import { longDate } from '../history/commits.js';

const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** How near the end counts as at it: the view follows new rows only from there. */
const END_PX = 24;

export function ActivityTab({
  workspace,
  thread,
  version,
}: {
  workspace: WorkspaceSummary;
  thread: WorkspaceThread | null;
  /** The list as last read: its commits are read again with it. */
  version: unknown;
}) {
  const changes = useChanges(workspace.branch, version);
  const commits = changes && typeof changes === 'object' ? changes.commits.listed : null;
  const items = useMemo(
    () => timelineItems(workspace, thread, commits),
    [workspace, thread, commits],
  );
  const lexer = useMarkdown();
  const list = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  // The rows drawn at first come in still; rows added after, by a read, fade in.
  const first = useRef<Set<string> | null>(null);
  if (first.current === null && thread) first.current = new Set(items.map((item) => item.key));
  useLayoutEffect(() => {
    const box = list.current;
    if (box && atEnd.current) box.scrollTop = box.scrollHeight;
  }, [items.length, lexer]);
  const onScroll = (event: UIEvent<HTMLOListElement>) => {
    const box = event.currentTarget;
    atEnd.current = box.scrollHeight - box.scrollTop - box.clientHeight < END_PX;
  };
  if (!thread) return <p className="hint">Reading what happened…</p>;
  return (
    <ol ref={list} className="activity" aria-label="Activity" onScroll={onScroll}>
      {items.map((item) => (
        <ActivityRow
          key={item.key}
          item={item}
          lexer={lexer}
          fresh={!first.current?.has(item.key)}
        />
      ))}
      {!thread.tools && thread.recorded && (
        <li className="activity-note hint">
          Its commands and edits are not recorded: its agent started before Symbiote kept them.
        </li>
      )}
    </ol>
  );
}

/** One row: its time, its mark, what happened; what it opens to, when it has more. */
const ActivityRow = memo(
  function ActivityRow({
    item,
    lexer,
    fresh,
  }: {
    item: TimelineItem;
    lexer: Lexer | null;
    fresh: boolean;
  }) {
    const { kind, at, text, detail, failed } = item;
    const body =
      detail === undefined ? null : kind === 'report' && lexer ? (
        <div className="activity-detail markdown">{markdownNodes(lexer(detail))}</div>
      ) : (
        <div className="activity-detail">{detail}</div>
      );
    return (
      <li className={`activity-row kind-${kind}${failed ? ' failed' : ''}${fresh ? ' fresh' : ''}`}>
        {at ? (
          <time className="activity-time" dateTime={at} {...tip(longDate(at))}>
            {timeOf(at)}
          </time>
        ) : (
          <span className="activity-time" {...tip('Codex gives no time for this')} />
        )}
        <span className="activity-mark" aria-hidden="true" />
        {body ? (
          <details className="activity-text">
            <summary>
              <span>{text}</span>
            </summary>
            {body}
          </details>
        ) : (
          <span className="activity-text" {...tip(text)}>
            {text}
          </span>
        )}
      </li>
    );
  },
  (a, b) =>
    a.lexer === b.lexer &&
    a.fresh === b.fresh &&
    a.item.text === b.item.text &&
    a.item.detail === b.item.detail &&
    a.item.failed === b.item.failed &&
    a.item.at === b.item.at,
);
