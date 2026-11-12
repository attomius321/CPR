// What the nexus page does for the person (NX2, NX4, NX6): start, stop and open a Symbiote, make a
// folder a repository first, pin, scan home again, copy a path.
import type { Pin } from '../pins.js';
import type { Running } from '../registry.js';
import type { Row } from './search.js';
import type { Tab } from './tabs.js';
import type { PageState } from './state.js';
import { confirmInit, confirmStop } from './dialog.js';
import { refusedFor } from './home-view.js';

/** A write to the nexus's server, as the viewer's are sent (decision 543). */
function post(path: string, value: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
    body: JSON.stringify(value),
  });
}

/**
 * A frame's address for the Symbiote at `url` (SC1, decision 930): with the one-time token the
 * nexus asked it for, which the framed page trades for its page key; bare when none is given (a
 * Symbiote from before SC1, or one that stopped meanwhile), where it reads but cannot write.
 */
export async function frameAddress(url: string): Promise<string> {
  try {
    const res = await post('/api/symbiotes/open', { url });
    if (!res.ok) return url;
    const answer = (await res.json()) as { url?: unknown };
    return typeof answer.url === 'string' ? answer.url : url;
  } catch {
    return url;
  }
}

/** A start's answer for a folder that is no repository: `git init` may make it one (decision 927). */
const INIT = Symbol('init');

/** The answer of a write: its JSON, or why it was refused. */
async function answerOf<T>(res: Response): Promise<T | { error: string }> {
  if (res.headers.get('content-type')?.includes('json')) return (await res.json()) as T;
  return { error: `${res.status}: ${await res.text()}` };
}

/** The person's actions over the page's state. */
export function nexusActions(
  state: PageState,
  {
    render,
    select,
    setQuery,
    refresh,
    readKnown,
  }: {
    render: () => void;
    select: (root: string | null, options?: { focusFrame?: boolean }) => void;
    setQuery: (value: string, options?: { fromField?: boolean }) => void;
    refresh: () => Promise<void>;
    readKnown: () => Promise<void>;
  },
) {
  /**
   * Starts `symbiote view` in `folder` (decision 541), or finds the one serving it, and opens its
   * tab: null once it is open, `INIT` for a folder that may be made a repository, else why not.
   * `init`: the person said yes to `git init` in it (decision 928).
   */
  async function startSymbiote(folder: string, init = false): Promise<string | typeof INIT | null> {
    let answer: { symbiote: Running } | { error: string; init?: true };
    try {
      const res = await post('/api/symbiotes', init ? { folder, init } : { folder });
      answer = res.headers.get('content-type')?.includes('json')
        ? ((await res.json()) as typeof answer)
        : { error: `${res.status}: ${await res.text()}` };
    } catch (error) {
      answer = { error: (error as Error).message };
    }
    if ('error' in answer) return answer.init ? INIT : answer.error;
    await refresh();
    select(answer.symbiote.root, { focusFrame: true });
    return null;
  }

  async function startAgain(root: string): Promise<void> {
    state.restarting.add(root);
    state.restartFailure = null;
    render();
    const why = await startSymbiote(root);
    state.restarting.delete(root);
    if (why === INIT) state.restartFailure = { root, why: `${root} is no git repository now` };
    else if (why !== null) state.restartFailure = { root, why };
    render();
  }

  /** Stops a Symbiote, after a question (decision 542): its tab, if opened, is then stopped. */
  async function stopSymbiote(tab: Tab, from: HTMLElement): Promise<void> {
    const stop = await confirmStop(tab.name);
    // Back to what asked; the card may have been drawn again meanwhile: its button of that name.
    const label = from.getAttribute('aria-label');
    const again = from.isConnected
      ? from
      : label === null
        ? null
        : document.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(label)}"]`);
    again?.focus();
    if (!stop) return;
    state.problem = null;
    try {
      const res = await post('/api/symbiotes/stop', { root: tab.root });
      if (!res.ok && res.status !== 404)
        state.problem = `${tab.name} did not stop: ${await res.text()}`;
    } catch (error) {
      state.problem = `${tab.name} did not stop: ${(error as Error).message}`;
    }
    await refresh();
  }

  /**
   * Opens a repository's or a folder's Symbiote, the person's start (decisions 619, 927): its tab
   * once it serves. A folder that is no repository is asked about first, then made one (928).
   */
  async function openSymbiote(row: Row): Promise<void> {
    state.starting.add(row.path);
    state.failures.delete(row.path);
    render();
    let why = await startSymbiote(row.path);
    if (why === INIT) {
      state.starting.delete(row.path);
      render();
      const from = document.activeElement as HTMLElement | null;
      const yes = await confirmInit(row, state);
      from?.focus();
      if (!yes) return;
      state.starting.add(row.path);
      render();
      why = await startSymbiote(row.path, true);
    }
    state.starting.delete(row.path);
    if (why === INIT) why = `${row.name} is no git repository`;
    if (why !== null) state.failures.set(row.path, why);
    // Its tab is open: back on Symbiotes the whole list shows again.
    if (why === null) setQuery('');
    else render();
  }

  /** What Enter, a double click or the card's main button does with a row (decisions 913, 927). */
  function act(row: Row): void {
    if (row.tab) {
      const root = row.tab.root;
      select(root, { focusFrame: true });
      setQuery('');
    } else if (row.missing || state.starting.has(row.path)) {
      return;
    } else if (row.repository || refusedFor(state, row.path) === null) {
      void openSymbiote(row);
    }
    // Else a folder the nexus never makes a repository (home, the top, a drive): its card says why,
    // and nothing is asked.
  }

  /** Pins or unpins a row (NX4, decision 620): kept in Symbiote's settings folder. */
  async function setPin(row: Row, pinned: boolean): Promise<void> {
    state.problem = null;
    try {
      const answer = await answerOf<{ pinned: Pin[] }>(
        await post('/api/pinned', { path: row.path, pinned }),
      );
      if ('error' in answer)
        state.problem = `${row.name} was not ${pinned ? 'pinned' : 'unpinned'}: ${answer.error}`;
      else if (state.known) state.known = { ...state.known, pins: answer.pinned };
    } catch (error) {
      state.problem = `${row.name} was not ${pinned ? 'pinned' : 'unpinned'}: ${(error as Error).message}`;
    }
    render();
  }

  /** Scans home again: the foot's button, the one way but the start (decision 925). */
  async function rescan(): Promise<void> {
    state.problem = null;
    try {
      await post('/api/scan', {});
    } catch (error) {
      state.problem = `Home was not scanned: ${(error as Error).message}`;
    }
    await readKnown();
  }

  /** Copies a row's path: the button says so for a moment. */
  function copyPath(row: Row): void {
    navigator.clipboard.writeText(row.path).then(
      () => {
        state.copied = row.path;
        render();
        setTimeout(() => {
          if (state.copied === row.path) state.copied = null;
          render();
        }, 1500);
      },
      (error: unknown) => {
        state.problem = `The path was not copied: ${(error as Error).message}`;
        render();
      },
    );
  }

  return { startAgain, stopSymbiote, openSymbiote, act, setPin, rescan, copyPath };
}
