// `symbiote view`'s usage (`GET /api/usage`, V29c), one read for every component that shows it:
// the status bar and the Overview (V91, decision 851) share it, so the page asks once a minute.
import { useEffect, useState } from 'react';
import type { UsageReport } from '@symbiote/core';

/**
 * How often the page asks `symbiote view`, which answers from its copy and reads the vendors at
 * most every 5 minutes (decision 175): a new read shows within a minute.
 */
const USAGE_EVERY_MS = 60_000;

let current: UsageReport | null = null;
const listeners = new Set<(report: UsageReport | null) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function read(): void {
  fetch('/api/usage')
    .then((response) => (response.ok ? (response.json() as Promise<UsageReport>) : null))
    .then((report) => {
      if (!report) return;
      current = report;
      for (const listener of listeners) listener(report);
    })
    .catch(() => {});
}

function tick(): void {
  if (document.visibilityState !== 'hidden') read();
  timer = setTimeout(tick, USAGE_EVERY_MS);
}

const onShown = () => {
  if (document.visibilityState !== 'hidden') read();
};

/** The usage, asked on mount, every minute while the page shows, and on focus. */
export function useUsage(): UsageReport | null {
  const [report, setReport] = useState(current);
  useEffect(() => {
    listeners.add(setReport);
    if (listeners.size === 1) {
      read();
      timer = setTimeout(tick, USAGE_EVERY_MS);
      window.addEventListener('focus', onShown);
      document.addEventListener('visibilitychange', onShown);
    } else if (current) {
      setReport(current);
    }
    return () => {
      listeners.delete(setReport);
      if (listeners.size > 0) return;
      clearTimeout(timer);
      window.removeEventListener('focus', onShown);
      document.removeEventListener('visibilitychange', onShown);
    };
  }, []);
  return report;
}
