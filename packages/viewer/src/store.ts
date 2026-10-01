import type { Graph } from '@cpr/core';
import type { ReviewDraft } from './comments.js';
import { reviewKey, type Marks } from './review.js';

/** What the viewer keeps between sessions. */
export type StateName = 'review' | 'drafts';

export interface Store {
  load(name: StateName): Promise<unknown>;
  /** Saves after `delay` ms; a newer value for the same name replaces a pending one. */
  save(name: StateName, value: unknown, delay?: number): void;
}

/**
 * State kept by `cpr view` / `cpr pr` in the CLI's cache folder: it survives restarts on another
 * port, where browser storage (per origin) would start empty.
 */
export function serverStore(): Store {
  const pending = new Map<StateName, unknown>();
  const timers = new Map<StateName, number>();
  // One write at a time per name, so an older value never lands after a newer one.
  const queues = new Map<StateName, Promise<unknown>>();

  const flush = (name: StateName, keepalive = false) => {
    if (!pending.has(name)) return;
    const body = JSON.stringify(pending.get(name));
    pending.delete(name);
    const put = () =>
      fetch(`./api/state/${name}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-cpr': '1' },
        body,
        keepalive,
      }).catch(() => undefined);
    queues.set(name, keepalive ? put() : (queues.get(name) ?? Promise.resolve()).then(put));
  };
  window.addEventListener('pagehide', () => {
    for (const name of [...pending.keys()]) flush(name, true);
  });

  return {
    async load(name) {
      try {
        const response = await fetch(`./api/state/${name}`);
        return response.ok ? ((await response.json()) as unknown) : null;
      } catch {
        return null;
      }
    },
    save(name, value, delay = 0) {
      pending.set(name, value);
      window.clearTimeout(timers.get(name));
      timers.set(
        name,
        window.setTimeout(() => flush(name), delay),
      );
    },
  };
}

/** Browser storage, for a graph opened from a file: per revision pair (or change request). */
export function browserStore(graph: Graph): Store {
  return {
    load(name) {
      try {
        return Promise.resolve(
          JSON.parse(window.localStorage.getItem(reviewKey(graph, name)) ?? 'null'),
        );
      } catch {
        return Promise.resolve(null);
      }
    },
    save(name, value) {
      try {
        window.localStorage.setItem(reviewKey(graph, name), JSON.stringify(value));
      } catch {
        // Private windows and blocked storage: state lasts for this page only.
      }
    },
  };
}

export function asMarks(value: unknown): Marks {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Marks) : {};
}

export function asReviewDraft(value: unknown): ReviewDraft {
  const draft = (value ?? {}) as Partial<ReviewDraft>;
  return {
    drafts: Array.isArray(draft.drafts) ? draft.drafts : [],
    body: typeof draft.body === 'string' ? draft.body : '',
  };
}
