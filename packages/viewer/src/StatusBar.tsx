import { useEffect, useState } from 'react';
import type { UsageReport } from '@cpr/core';
import { relativeDate } from './commits.js';
import type { Notice } from './shell-context.js';
import { AGENT_NAMES, shownWindows, usageTitle, usageTone, windowLabel } from './usage.js';

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
      title={said}
    >
      {notice.text}
      {notice.warning && <span className="warning"> · {notice.warning}</span>}
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

/** How often the page asks: `cpr view` reads the vendors at most this often too (decision 175). */
const USAGE_EVERY_MS = 60_000;

/** `cpr view`'s usage (`GET /api/usage`): asked every minute while the page shows, and on focus. */
function useUsage(): UsageReport | null {
  const [report, setReport] = useState<UsageReport | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      fetch('/api/usage')
        .then((response) => (response.ok ? (response.json() as Promise<UsageReport>) : null))
        .then((read) => live && read && setReport(read))
        .catch(() => {});
    };
    const tick = () => {
      if (document.visibilityState !== 'hidden') read();
      timer = setTimeout(tick, USAGE_EVERY_MS);
    };
    const onShown = () => {
      if (document.visibilityState !== 'hidden') read();
    };
    read();
    timer = setTimeout(tick, USAGE_EVERY_MS);
    window.addEventListener('focus', onShown);
    document.addEventListener('visibilitychange', onShown);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener('focus', onShown);
      document.removeEventListener('visibilitychange', onShown);
    };
  }, []);
  return report;
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
            className={`usage-subscription${subscription.source === 'cached' ? ' cached' : ''}`}
            title={title}
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
            {subscription.source === 'cached' && (
              <span className="usage-age">{relativeDate(subscription.at, now)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
