// The change's files as git gives them, with their lines and blobs (`./api/files`; V60, V90): read
// once per graph, for the Files page's list and for the review's marks (V108, decision 983).
import type { Graph, ReviewFile } from '@symbiote/core';

const reads = new WeakMap<Graph, Promise<ReviewFile[] | null>>();

/**
 * The files of `graph`'s change from the server that serves it, read once per graph; null when it
 * gives none. A failed read is tried again the next time it is asked for.
 */
export function readChangeFiles(graph: Graph): Promise<ReviewFile[] | null> {
  let read = reads.get(graph);
  if (!read) {
    read = fetchChangeFiles();
    reads.set(graph, read);
    void read.then((files) => {
      if (!files) reads.delete(graph);
    });
  }
  return read;
}

/** The page's `./api/files`: also the pair's, while it is analyzed (V90, decision 847). */
export function fetchChangeFiles(): Promise<ReviewFile[] | null> {
  return fetch('./api/files')
    .then((response) => (response.ok ? (response.json() as Promise<ReviewFile[]>) : null))
    .catch(() => null);
}
