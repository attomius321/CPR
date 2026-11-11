// Lays out views of one graph off the main thread (V8e): the canvas stays usable meanwhile.
import type { Graph } from '@symbiote/core';
import { layoutOf, type LayoutMessage, type LayoutReply } from './layouts.js';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LayoutMessage>) => void) | null;
  postMessage(reply: LayoutReply): void;
};

let graph: Graph | undefined;
scope.onmessage = ({ data }) => {
  if (data.type === 'graph') graph = data.graph;
  else if (graph) scope.postMessage({ id: data.id, layout: layoutOf(graph, data.options) });
};
