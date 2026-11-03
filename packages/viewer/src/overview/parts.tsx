// The Overview's parts (V91): a card with its head, the feed of today's events, an empty card's
// line.
import type { ReactNode } from 'react';
import {
  AnsweredIcon,
  BellIcon,
  BugIcon,
  FlaskIcon,
  IdleIcon,
  MergeIcon,
  PermissionIcon,
  PlanIcon,
  PlusIcon,
  QuestionIcon,
  ReviewIcon,
  RunningIcon,
  StoppedIcon,
} from '../ui/icons.js';
import { clockOf } from './day.js';
import type { FeedIcon, FeedItem } from './feed.js';

/** A card of the Overview: its head (title, count, what is at its end), then its body. */
export function OverviewCard({
  title,
  count,
  end,
  className,
  children,
}: {
  title: string;
  count?: number;
  end?: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`overview-card ${className}`} aria-label={title}>
      <div className="card-head">
        <h2>{title}</h2>
        {count !== undefined && <span className="overview-count">{count}</span>}
        {end !== undefined && <div className="end">{end}</div>}
      </div>
      {children}
    </section>
  );
}

/** What an empty card says, in its body. */
export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="overview-empty">{children}</p>
);

const ICONS: Record<FeedIcon, () => ReactNode> = {
  question: QuestionIcon,
  permission: PermissionIcon,
  plan: BellIcon,
  review: ReviewIcon,
  answered: AnsweredIcon,
  start: PlusIcon,
  merge: MergeIcon,
  check: FlaskIcon,
  bug: BugIcon,
  stopped: StoppedIcon,
  pause: IdleIcon,
  request: PlanIcon,
  run: RunningIcon,
};

/** Today's events, the newest first: the time, an icon in its state's colour, what and about. */
export function Feed({ items, empty }: { items: readonly FeedItem[]; empty: ReactNode }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ol className="feed" aria-label="Today's events">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <li key={item.key} className="feed-event" data-tone={item.tone}>
            <time className="feed-when" dateTime={item.at}>
              {clockOf(item.at)}
            </time>
            <Icon />
            <span className="feed-what">
              {item.what}
              <span className="feed-about">{item.about}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
