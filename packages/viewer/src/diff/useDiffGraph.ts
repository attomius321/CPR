// A diff's page's graph (V9): `?graph=<url>`, else `symbiote view`'s `./api/graph`; while it is
// analyzed, how that goes, read again every 500 ms; opened anew, analyzed again. Also what the
// server offers, read first.
import { useCallback, useEffect, useState } from 'react';
import type { BranchReviewInfo, Graph } from '@symbiote/core';
import { fetchGraph, startDiff } from '../history/api.js';
import type { Loaded, Pair } from '../history/commits.js';
import { browserStore, serverStore, type Store } from './store.js';

export type State =
  | { status: 'loading' }
  | { status: 'empty'; error?: string }
  /**
   * `symbiote view` with no diff here: the shell (V29a) — the sidenav with the pages and the
   * workspaces, and History, Settings, a workspace or a merge beside it.
   */
  | { status: 'shell'; repo?: string }
  /** A diff's page while it is analyzed, or once it failed or was stopped. */
  | { status: 'analyzing'; loaded: Exclude<Loaded, { kind: 'graph' }> }
  /**
   * `sources`: opened through `symbiote view`, so `/api/source` exists. `forge`: opened through
   * `symbiote pr`, which posts reviews there. `commits`: a diff of `symbiote view`, which lists
   * commits.
   * `open`: the server opens files in VS Code (`/api/open`). `files`: it gives the change's files
   * with their lines and each file's diff (`/api/files`, `/api/file`; V60).
   */
  | {
      status: 'ready';
      graph: Graph;
      sources: boolean;
      forge: Forge | null;
      store: Store;
      commits: boolean;
      open: boolean;
      files: boolean;
      /** A branch's review (V15): what it covers, and what came since the last one. */
      branchReview?: BranchReviewInfo;
    };

/** Where a review goes: a forge (`symbiote pr`), or the repository itself (a branch review, V16).
 * */
type Forge = 'github' | 'gitlab' | 'local';

interface Capabilities {
  sources: boolean;
  review: { forge: Forge } | null;
  /** `/api/state` keeps reviewed marks and drafts in the CLI's cache. */
  state?: boolean;
  /** `symbiote view`: History, and diffs analyzed when picked. */
  commits?: boolean;
  /** `symbiote view`, `symbiote pr`: `/api/open` opens a file of the change in VS Code. */
  open?: boolean;
  /** `symbiote view`, `symbiote pr`: the Files page's `/api/files` and `/api/file` (V60). */
  files?: boolean;
  /** `symbiote view`: this page is a branch's review (V15). */
  branchReview?: BranchReviewInfo;
  /** `symbiote view`: the repository's folder name (V29a). */
  repo?: string;
}

/** How often a diff's page asks how its analysis is going. */
const POLL_MS = 500;

/** Where the graph comes from: `?graph=<url>`, else `symbiote view`'s API. */
function graphUrl(): string {
  return new URLSearchParams(window.location.search).get('graph') ?? './api/graph';
}

/** What the server offers; `symbiote view` builds before this endpoint existed answer nothing. */
async function fetchCapabilities(): Promise<Capabilities | null> {
  try {
    const response = await fetch('./api/capabilities');
    return response.ok ? ((await response.json()) as Capabilities) : null;
  } catch {
    return null;
  }
}

/**
 * The page's graph or what it is meanwhile (`state`; `setState` for a graph dropped on it),
 * whether it is a diff of `symbiote view` (`inView`, with the repository's name), and `retry`,
 * which analyzes a stopped or failed pair again and reads the page anew.
 */
export function useDiffGraph() {
  const [state, setState] = useState<State>({ status: 'loading' });
  /** A diff of `symbiote view`: in the shell's sidenav and status bar (V29a), with the repository's
   * name. */
  const [inView, setInView] = useState<{ repo?: string } | null>(null);
  /** Bumped to load the page again: after "Analyze again". */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const url = graphUrl();
    const served = url === './api/graph';
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const capabilities = served ? await fetchCapabilities() : null;
      if (live && capabilities?.commits) {
        setInView(capabilities.repo ? { repo: capabilities.repo } : {});
      }
      let opened = attempt === 0;
      const poll = async (): Promise<void> => {
        const loaded = await fetchGraph(url);
        if (!live) return;
        if (loaded.kind === 'graph') {
          const { graph } = loaded;
          setState({
            status: 'ready',
            graph,
            sources: served,
            forge: capabilities?.review?.forge ?? null,
            store: capabilities?.state ? serverStore() : browserStore(graph),
            commits: !!capabilities?.commits,
            open: !!capabilities?.open,
            files: !!capabilities?.files,
            ...(capabilities?.branchReview ? { branchReview: capabilities.branchReview } : {}),
          });
        } else if (loaded.kind === 'progress' || loaded.kind === 'failed') {
          setState({ status: 'analyzing', loaded });
          if (loaded.kind === 'progress') timer = setTimeout(() => void poll(), POLL_MS);
        } else if (loaded.pair && capabilities?.commits) {
          // A diff's page opened anew (a bookmark, a restarted server): analyze it.
          if (!opened) return setState({ status: 'analyzing', loaded });
          opened = false;
          await startDiff(loaded.pair).catch(() => undefined);
          if (live) await poll();
        } else if (!capabilities?.commits) setState({ status: 'empty' });
        else
          setState({ status: 'shell', ...(capabilities.repo ? { repo: capabilities.repo } : {}) });
      };
      await poll();
    })();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [attempt]);
  const retry = useCallback((pair: Pair) => {
    void startDiff(pair)
      .catch(() => undefined)
      .then(() => setAttempt((n) => n + 1));
  }, []);
  return { state, setState, inView, retry };
}
