// What the nexus page reads (NX5, NX6; decision 925): the running Symbiotes every 2 s, what the
// nexus knows when they change, home's tree when its scan's time changes.
import type { RepositoriesAnswer, TreeAnswer } from '../repositories.js';
import type { Symbiote } from '../symbiotes.js';
import { listView } from './list-view.js';
import { nextTabs } from './tabs.js';
import { treeOf } from './tree.js';
import type { PageState } from './state.js';
import { folderName } from './home-view.js';

/** How often the running Symbiotes are read again. */
const READ_EVERY = 2000;

/** The page's reads over its state. */
export function nexusReads(
  state: PageState,
  {
    render,
    select,
    setQuery,
    list,
  }: {
    render: () => void;
    select: (root: string | null, options?: { focusFrame?: boolean }) => void;
    setQuery: (value: string, options?: { fromField?: boolean }) => void;
    list: ReturnType<typeof listView>;
  },
) {
  /** Reads what the nexus knows besides the running Symbiotes (NX5): pins, history, the scan. */
  function readKnown(): Promise<void> {
    state.readingKnown ??= (async () => {
      try {
        const res = await fetch('/api/repositories', { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        state.known = (await res.json()) as RepositoriesAnswer;
        if (state.known.scan && state.known.scan.at !== state.tree?.at) await readTree();
        if (state.asked !== null) {
          setQuery(folderName(state.asked, state.known.home));
          state.asked = null;
        }
      } catch (error) {
        state.problem = `What the nexus knows could not be read: ${(error as Error).message}`;
      }
      render();
    })().finally(() => {
      state.readingKnown = null;
      // Home's first scan runs: asked again until it answers.
      if (state.known && !state.known.scan) setTimeout(() => void readKnown(), 500);
    });
    return state.readingKnown;
  }

  /** Reads home's tree (decision 926): once per scan, when its time changes. */
  async function readTree(): Promise<void> {
    try {
      const res = await fetch('/api/tree', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const answer = (await res.json()) as { tree: TreeAnswer | null };
      state.tree = answer.tree ? treeOf(answer.tree) : null;
    } catch (error) {
      state.problem = `Home's folders could not be read: ${(error as Error).message}`;
    }
  }

  /** Reads the running Symbiotes once and draws what changed. */
  async function refresh(): Promise<void> {
    try {
      const res = await fetch('/api/symbiotes', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const { symbiotes } = (await res.json()) as { symbiotes: Symbiote[] };
      state.tabs = nextTabs(state.tabs, symbiotes, state.opened);
      const key = symbiotes
        .map((s) => s.root)
        .sort()
        .join('\n');
      if (key !== state.runningKey) {
        state.runningKey = key;
        void readKnown();
      }
      state.failure = null;
      const first = !state.readOnce;
      state.readOnce = true;
      // A tab asked for by the address that is not there (any more): the list.
      const gone = state.selected !== null && !state.tabs.some((t) => t.root === state.selected);
      if (gone) select(null);
      else render();
      if (first && state.selected !== null) state.frames.get(state.selected)?.focus();
      else if (first) list.field.focus();
    } catch (error) {
      state.failure = `The running Symbiotes could not be read: ${(error as Error).message}`;
      render();
    }
  }

  async function read(): Promise<void> {
    await refresh();
    setTimeout(() => void read(), READ_EVERY);
  }

  return { readKnown, refresh, read };
}
