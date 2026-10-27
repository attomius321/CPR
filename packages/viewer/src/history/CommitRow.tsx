// A row of History's list: its graph cell, SHA, subject, badges, author and date (V10).
import type { ReactNode } from 'react';
import type { Commit } from '@symbiote/core';
import { reviewTip, type ReviewMark } from './branchReviews.js';
import { longDate, relativeDate, rowBadges, shortSha } from './commits.js';
import { ROW_HEIGHT } from './GraphCell.js';
import type { AgentChip } from '../workspaces/workspaces.js';
import { WorkspaceMark } from '../workspaces/WorkspaceMark.js';
import { MoreIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';

export function CommitRow({
  row,
  commit,
  now,
  comparing,
  picked,
  cursor,
  flash,
  matched = false,
  onClick,
  onMenu,
  graph,
  branch,
  reviewed,
  agents,
  added,
}: {
  row: number;
  /** Not loaded yet: the graph alone, and grey bars. */
  commit: Commit | undefined;
  now: number;
  /** Compare mode: the row shows whether it is picked. */
  comparing: boolean;
  picked: boolean;
  cursor: boolean;
  /** Just gone to from the branches panel. */
  flash: boolean;
  /** Found by Git's search (V66f). */
  matched?: boolean;
  onClick: () => void;
  /** Opens the row's checkout menu at a point of the window. */
  onMenu: (x: number, y: number) => void;
  graph: ReactNode;
  /** The branch checked out (null when HEAD is detached), for HEAD's badge. */
  branch: string | null;
  /** Each reviewed branch's mark, by ref name (V15, V16). */
  reviewed: ReadonlyMap<string, ReviewMark>;
  /** Each workspace's mark by ref name, a link to the workspace (V18b). */
  agents: ReadonlyMap<string, AgentChip & { href: string }>;
  /** The reviewed branches this commit was added to since their review. */
  added?: string[];
}) {
  const style = { top: row * ROW_HEIGHT, height: ROW_HEIGHT };
  if (!commit) {
    return (
      <li
        className={`commit loading${cursor ? ' cursor' : ''}${flash ? ' flash' : ''}`}
        style={style}
      >
        {graph}
        {comparing && <span className="commit-pick" />}
        <span className="loading-bar sha-bar" />
        <span className="loading-bar subject-bar" />
      </li>
    );
  }
  const head = commit.refs.some((ref) => ref.kind === 'head');
  return (
    <li
      className={`commit${head ? ' head' : ''}${picked ? ' picked' : ''}${cursor ? ' cursor' : ''}${flash ? ' flash' : ''}${matched ? ' matched' : ''}`}
      style={style}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    >
      {graph}
      {comparing && (
        <span className="commit-pick" role="img" aria-label={picked ? 'picked' : 'not picked'}>
          {picked ? '●' : '○'}
        </span>
      )}
      <code className="commit-sha">{shortSha(commit.sha)}</code>
      {added && (
        <span
          className="review-new"
          role="img"
          aria-label={`new since your review of ${added.join(', ')}`}
          {...tip(`New since your review of ${added.join(', ')}`, { tone: 'info' })}
        />
      )}
      <span className="commit-subject" {...tip(commit.subject)}>
        {commit.subject}
      </span>
      {rowBadges(commit.refs, branch, reviewed, agents).map((badge) => (
        <span
          key={`${badge.kind}:${badge.label}`}
          className={`ref ref-${badge.kind}`}
          // A badge cut short (a narrow window, a long name) is named in full on hover.
          {...tip(badge.title ?? badge.label)}
        >
          {badge.agent && <WorkspaceMark chip={badge.agent} />}
          {badge.label}
          {badge.review && (
            <span
              className={`ref-review ref-review-${badge.review.tone}`}
              {...reviewTip(badge.review)}
            >
              {badge.review.mark}
            </span>
          )}
        </span>
      ))}
      <span className="commit-author">{commit.author}</span>
      <time className="commit-date" dateTime={commit.date} {...tip(longDate(commit.date))}>
        {relativeDate(commit.date, now)}
      </time>
      <button
        type="button"
        className="link commit-menu"
        {...tip('Check out…', { keys: 'c' })}
        aria-label="Check out…"
        onClick={(event) => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(box.right - 8, box.bottom);
        }}
      >
        <MoreIcon />
      </button>
    </li>
  );
}
