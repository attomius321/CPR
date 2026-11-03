import { useState } from 'react';
import { relativeDate } from '../history/commits.js';
import type { Notice } from './shell-context.js';
import {
  AGENT_NAMES,
  shownWindows,
  showsAge,
  usageTitle,
  usageTone,
  windowLabel,
} from './usage.js';
import { tip } from '../ui/tip.js';
import { useUsage } from './useUsage.js';

/**
 * The shell's status bar (V29a): on the left the last thing said (a start, a checkout, an
 * error), until the next; on the right each subscription's windows of use (V29c).
 */
export function StatusBar({ notice }: { notice: Notice | null }) {
  return (
    <footer className="statusbar" aria-label="Status bar">
      {notice && <NoticeLine key={`${notice.text}\n${notice.copy ?? ''}`} notice={notice} />}
      <Usage />
    </footer>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const said = [notice.text, notice.warning].filter(Boolean).join(' · ');
  return (
    <p
      className={`statusbar-notice${notice.error ? ' error' : ''}`}
      role={notice.error ? 'alert' : 'status'}
      {...tip(said)}
    >
      {notice.text}
      {notice.warning && <span className="warning"> · {notice.warning}</span>}
      {notice.href && (
        <>
          {' '}
          {/* In the shell: the shell opens it in place (V48). */}
          <a className="link" href={notice.href}>
            Open
          </a>
        </>
      )}
      {notice.copy !== undefined && (
        <>
          {' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              navigator.clipboard
                .writeText(notice.copy ?? '')
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied === null ? 'Copy the prompt' : copied ? 'Copied' : 'Could not copy'}
          </button>
        </>
      )}
    </p>
  );
}

/** Each subscription: its plan and windows, a thin bar each; on hover, resets and age. */
function Usage() {
  const report = useUsage();
  if (!report || report.subscriptions.length === 0) return null;
  const now = Date.now();
  return (
    <ul className="usage" aria-label="Usage">
      {report.subscriptions.map((subscription) => {
        const title = usageTitle(subscription, now);
        return (
          <li
            key={subscription.agent}
            className={`usage-subscription${showsAge(subscription) ? ' cached' : ''}`}
            {...tip(title)}
            aria-label={title.replaceAll('\n', '. ')}
            tabIndex={0}
          >
            <strong>{AGENT_NAMES[subscription.agent]}</strong>
            {subscription.plan && <span className="usage-plan">{subscription.plan}</span>}
            {shownWindows(subscription).map((w) => (
              <span
                key={`${w.minutes}`}
                className={`usage-window tone-${usageTone(w.usedPercent, subscription.limited, w.warning)}`}
              >
                <span className="usage-label">{windowLabel(w.minutes)}</span>
                <span className="usage-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, w.usedPercent)}%` }} />
                </span>
                <span className="usage-percent">{Math.round(w.usedPercent)}%</span>
              </span>
            ))}
            {showsAge(subscription) && (
              <span className="usage-age">{relativeDate(subscription.at, now)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
