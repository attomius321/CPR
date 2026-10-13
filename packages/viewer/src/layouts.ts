import type { Graph } from '@cpr/core';
import { layoutFlow, type FlowLayout, type LayoutOptions } from './flow.js';

/** What the main thread sends the layout worker: the graph once, then views to lay out. */
export type LayoutMessage =
  { type: 'graph'; graph: Graph } | { type: 'layout'; id: number; options: LayoutOptions };

/** The worker's answer to request `id`. */
export interface LayoutReply {
  id: number;
  layout: FlowLayout;
}

/** The part of a `Worker` used here. */
export interface LayoutWorker {
  postMessage(message: LayoutMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<LayoutReply>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  terminate(): void;
}

export interface LayoutRunner {
  layout(options: LayoutOptions): Promise<FlowLayout>;
  close(): void;
}

/** The same view gives the same key, whatever the order of its sets. */
export function layoutKey(options: LayoutOptions): string {
  const { typeReferences = false, context = true, focus, expanded } = options;
  return JSON.stringify([
    typeReferences,
    context,
    focus ? [...focus].sort() : null,
    [...(expanded ?? [])].sort(),
  ]);
}

/**
 * Recent layouts by view (`layoutKey`), and the view last asked for: a late answer for an older
 * view is kept for later, never drawn over a newer one.
 */
export class LayoutCache {
  /** Least recently used first. */
  private readonly kept = new Map<string, FlowLayout>();
  private readonly asked = new Set<string>();
  private latest: string | undefined;

  constructor(private readonly size = 8) {}

  get(key: string): FlowLayout | undefined {
    return this.kept.get(key);
  }

  /** The view to draw now: its layout if kept, else whether to request it (not yet asked). */
  ask(key: string): { layout: FlowLayout } | { request: boolean } {
    this.latest = key;
    const layout = this.kept.get(key);
    if (layout) {
      this.kept.delete(key);
      this.kept.set(key, layout);
      return { layout };
    }
    if (this.asked.has(key)) return { request: false };
    this.asked.add(key);
    return { request: true };
  }

  /** A layout arrived: kept; true when it is for the view last asked for. */
  answer(key: string, layout: FlowLayout): boolean {
    this.asked.delete(key);
    this.kept.delete(key);
    this.kept.set(key, layout);
    for (const oldest of this.kept.keys()) {
      if (this.kept.size <= this.size) break;
      this.kept.delete(oldest);
    }
    return key === this.latest;
  }
}

/**
 * Layouts made by a worker that holds the graph, so the main thread stays free meanwhile (V8e):
 * requests are numbered and answers matched by number. Without a worker, or once it fails, they
 * are made here, on the main thread.
 */
export function workerLayouts(graph: Graph, worker: LayoutWorker | null): LayoutRunner {
  const here = (options: LayoutOptions) => layoutFlow(graph, options);
  if (!worker) {
    return { layout: (options) => Promise.resolve().then(() => here(options)), close: () => {} };
  }
  interface Waiting {
    options: LayoutOptions;
    resolve: (layout: FlowLayout) => void;
    reject: (error: unknown) => void;
  }
  const waiting = new Map<number, Waiting>();
  let next = 0;
  let failed = false;
  worker.addEventListener('message', ({ data }) => {
    waiting.get(data.id)?.resolve(data.layout);
    waiting.delete(data.id);
  });
  // The worker did not load, or a layout threw there: lay out here, where an error shows.
  worker.addEventListener('error', () => {
    failed = true;
    for (const { options, resolve, reject } of waiting.values()) {
      try {
        resolve(here(options));
      } catch (error) {
        reject(error);
      }
    }
    waiting.clear();
  });
  worker.postMessage({ type: 'graph', graph });
  return {
    layout(options) {
      if (failed) return Promise.resolve().then(() => here(options));
      const id = ++next;
      return new Promise((resolve, reject) => {
        waiting.set(id, { options, resolve, reject });
        worker.postMessage({ type: 'layout', id, options });
      });
    },
    close: () => worker.terminate(),
  };
}
