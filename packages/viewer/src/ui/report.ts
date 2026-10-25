// The pages' errors for Symbiote's logs (LG1, decision 353): posted to `symbiote view`, which
// writes them as `viewer` lines beside its own. A page throwing in a loop must not flood it: one
// error is sent once per `REPEAT_MS` with how many times it came, and `PER_MINUTE` at most.

import { WRITE_HEADERS } from './http.js';

/** What `POST /api/logs` takes (`parsePageError` in the CLI). */
export interface PageError {
  level: 'error' | 'warn';
  msg: string;
  page: string;
  err?: { name: string; message: string; stack?: string };
  componentStack?: string;
  repeated?: number;
  dropped?: number;
}

/** How long the same error is only counted, and how many errors a page sends a minute. */
export const REPEAT_MS = 10_000;
export const PER_MINUTE = 30;

const cut = (text: string, most: number) => (text.length > most ? text.slice(0, most) : text);

/** A thrown or rejected value as a page's error: an Error's parts, else its text; kept short. */
export function pageErrorOf(value: unknown, page: string, componentStack?: string): PageError {
  const made: PageError = { level: 'error', msg: '', page };
  if (value instanceof Error) {
    made.msg = cut(value.message || value.name, 1000);
    made.err = {
      name: value.name,
      message: cut(value.message, 1000),
      ...(value.stack ? { stack: cut(value.stack, 8000) } : {}),
    };
  } else {
    let text: string;
    try {
      text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
    } catch {
      text = String(value);
    }
    made.msg = cut(text, 1000);
  }
  if (componentStack) made.componentStack = cut(componentStack, 4000);
  return made;
}

/**
 * The reporter's rules, pure: an error is sent at once; the same one again within `REPEAT_MS`
 * is only counted, and sent once more when that time ends, with `repeated`; past `PER_MINUTE` a
 * minute errors are dropped, and the next one sent says how many (`dropped`).
 */
export function reporter({
  send,
  now,
  later,
}: {
  send: (error: PageError) => void;
  now: () => number;
  later: (run: () => void, ms: number) => void;
}): (error: PageError) => void {
  const recent = new Map<string, { repeated: number }>();
  const sentAt: number[] = [];
  let dropped = 0;
  const emit = (error: PageError) => {
    const at = now();
    while (sentAt.length > 0 && at - (sentAt[0] ?? 0) >= 60_000) sentAt.shift();
    if (sentAt.length >= PER_MINUTE) {
      dropped++;
      return;
    }
    sentAt.push(at);
    send(dropped > 0 ? { ...error, dropped } : error);
    dropped = 0;
  };
  return (error) => {
    const frame = error.err?.stack?.split('\n')[1]?.trim() ?? '';
    const key = `${error.level}\n${error.msg}\n${frame}`;
    const seen = recent.get(key);
    if (seen) {
      seen.repeated++;
      return;
    }
    const entry = { repeated: 0 };
    recent.set(key, entry);
    emit(error);
    later(() => {
      recent.delete(key);
      if (entry.repeated > 0) emit({ ...error, repeated: entry.repeated });
    }, REPEAT_MS);
  };
}

/**
 * Sends this page's uncaught errors and unhandled rejections to the server; answers the report
 * for React's `onUncaughtError`, with its component stack. An error React reports is then given
 * to `window.reportError` as React does by default, so the console and the e2e checks see it as
 * before; the window's listener knows it and does not send it twice.
 */
export function reportPageErrors(): (error: unknown, componentStack?: string) => void {
  const report = reporter({
    send: (error) => {
      // Best effort: a server that is gone cannot be told, and that must not be one more error.
      void fetch('/api/logs', {
        method: 'POST',
        headers: WRITE_HEADERS,
        body: JSON.stringify(error),
        keepalive: true,
      }).catch(() => undefined);
    },
    now: Date.now,
    later: (run, ms) => void setTimeout(run, ms),
  });
  const fromReact = new WeakSet<object>();
  const page = () => window.location.pathname;
  window.addEventListener('error', (event) => {
    const error: unknown = event.error;
    if (typeof error === 'object' && error !== null && fromReact.has(error)) return;
    report(pageErrorOf(error ?? event.message, page()));
  });
  window.addEventListener('unhandledrejection', (event) => {
    report(pageErrorOf(event.reason, page()));
  });
  return (error, componentStack) => {
    report(pageErrorOf(error, page(), componentStack));
    if (typeof error === 'object' && error !== null) fromReact.add(error);
    window.reportError(error);
  };
}
