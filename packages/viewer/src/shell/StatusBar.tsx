import { useEffect, useMemo, useState } from 'react';
import type { RepoStatus } from '@symbiote/core';
import { relativeDate } from '../history/commits.js';
import { BellIcon, BranchIcon, MergeIcon, SpinIcon } from '../ui/icons.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { hiveGroups, workspaceGroups } from '../workspaces/workspaces.js';
import { useHive } from './hive.js';
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
 * The shell's status bar (V29a): on the left where the checkout is and what waits and works
 * (V93, decision 879), then the last thing said (a start, a checkout, an error), until the next;
 * on the right each subscription's windows of use (V29c).
 */
export function StatusBar({ notice }: { notice: Notice | null }) {
  return (
    <footer className="statusbar" aria-label="Status bar">
      <Segments />
      {notice && <NoticeLine key={`${notice.text}\n${notice.copy ?? ''}`} notice={notice} />}
      <Usage />
    </footer>
  );
}

/** The checkout: its branch and commit, read on load, when the window is back and each minute. */
function useCheckout(): Pick<RepoStatus, 'branch' | 'head'> | null {
  const [status, setStatus] = useState<Pick<RepoStatus, 'branch' | 'head'> | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/api/status')
        .then((response) => (response.ok ? (response.json() as Promise<RepoStatus>) : null))
        .then((read) => live && read && setStatus({ branch: read.branch, head: read.head }))
        .catch(() => {});
    };
    read();
    const timer = setInterval(read, 60_000);
    window.addEventListener('focus', read);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, []);
  return status;
}

/**
 * The proofs' left side (decision 879): the branch checked out and its commit, how many wait for
 * the person (violet), how many agents work; in Hive mode Hive on, in flight, landed today and
 * the branch. From the list the sidenav reads.
 */
function Segments() {
  const hiveMode = useHive();
  const { list, reviews } = useWorkspaces();
  const checkout = useCheckout();
  const workspaces = list?.workspaces;
  const counts = useMemo(() => {
    if (!workspaces) return null;
    if (hiveMode) {
      const groups = hiveGroups(workspaces, reviews, Date.now());
      return { flight: groups.flight.length, landed: groups.today.length, waits: 0, working: 0 };
    }
    const groups = workspaceGroups(workspaces, reviews);
    return {
      flight: 0,
      landed: 0,
      waits: groups.waiting.length + groups.review.length,
      working: groups.working.length,
    };
  }, [workspaces, reviews, hiveMode]);
  const branch = checkout && (
    <span
      className="statusbar-seg"
      {...tip(
        checkout.head
          ? `Checked out: ${checkout.branch ?? 'a detached HEAD'} at ${checkout.head.slice(0, 7)}`
          : 'Checked out',
      )}
    >
      <BranchIcon />
      {checkout.branch ?? 'detached'}
      {!hiveMode && checkout.head && (
        <span className="statusbar-sha">{checkout.head.slice(0, 7)}</span>
      )}
    </span>
  );
  if (hiveMode) {
    return (
      <>
        <span className="statusbar-seg">
          <span className="statusbar-dot" aria-hidden="true" />
          Hive on
        </span>
        {counts && (
          <>
            <span className="statusbar-seg">
              <SpinIcon />
              {counts.flight} in flight
            </span>
            <span className="statusbar-seg">
              <MergeIcon />
              {counts.landed} landed today
            </span>
          </>
        )}
        {branch}
      </>
    );
  }
  return (
    <>
      {branch}
      {counts && (
        <>
          <span className="statusbar-seg you">
            <BellIcon />
            {counts.waits} wait for you
          </span>
          <span className="statusbar-seg">
            <SpinIcon />
            {counts.working} {counts.working === 1 ? 'agent' : 'agents'} working
          </span>
        </>
      )}
    </>
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
