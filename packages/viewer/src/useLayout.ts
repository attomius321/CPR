import type { Graph } from '@symbiote/core';
import { useEffect, useMemo, useState } from 'react';
import type { FlowLayout, LayoutOptions } from './flow.js';
import { LayoutCache, layoutKey, workerLayouts, type LayoutRunner } from './layouts.js';

/**
 * The layout to draw for a view, made in a worker (V8e). The last one drawn stays until the one
 * asked for arrives (`pending`); a view laid out before comes back at once. `options` must keep
 * its identity while the view is the same (a memo).
 */
export function useLayout(
  graph: Graph | undefined,
  options: LayoutOptions,
): { layout: FlowLayout | undefined; pending: boolean } {
  const key = layoutKey(options);
  const cache = useMemo(() => (graph ? new LayoutCache() : undefined), [graph]);
  const [runner, setRunner] = useState<{ graph: Graph; layouts: LayoutRunner }>();
  useEffect(() => {
    if (!graph) return;
    const layouts = workerLayouts(graph, startWorker());
    setRunner({ graph, layouts });
    return () => layouts.close();
  }, [graph]);

  const [drawn, setDrawn] = useState<{ graph: Graph; layout: FlowLayout }>();
  const [failure, setFailure] = useState<{ error: unknown }>();
  if (failure) throw failure.error;
  useEffect(() => {
    if (!cache || !runner || runner.graph !== graph) return;
    const show = (layout: FlowLayout) =>
      setDrawn((current) => (current?.layout === layout ? current : { graph, layout }));
    const asked = cache.ask(key);
    if ('layout' in asked) show(asked.layout);
    else if (asked.request) {
      runner.layouts.layout(options).then(
        (layout) => {
          if (cache.answer(key, layout)) show(layout);
        },
        (error: unknown) => setFailure({ error }),
      );
    }
  }, [graph, cache, runner, key, options]);

  const kept = cache?.get(key);
  const last = drawn && drawn.graph === graph ? drawn.layout : undefined;
  return { layout: kept ?? last, pending: !kept };
}

function startWorker(): Worker | null {
  try {
    return new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}
