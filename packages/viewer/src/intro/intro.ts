// The first-time intro (V39): two koi form the S over the first page a person opens. Symbiote's
// server says whether to show it (`/api/intro`, a record in Symbiote's config folder: browser
// storage is per origin, and each run has a port of its own). The engine, its rig and its images
// are a chunk of their own (`play.ts`), loaded only when it plays.

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-symbiote': '1' };

/** How long the page waits for the answer: no longer than it waits for its fonts. */
export const INTRO_WAIT_MS = 1_000;

/** Keys that only change another key: pressed alone they do not end the intro. */
const MODIFIERS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Super',
  'Hyper',
  'Fn',
  'FnLock',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Symbol',
  'SymbolLock',
]);

/**
 * Whether this page shows the intro: Symbiote's server answers `{ show }`. A `?graph=` page (a
 * graph file, the measure scripts) never asks; no answer within `waitMs` is no intro.
 */
export async function askIntro(
  search: string,
  ask: (path: string) => Promise<Response> = (path) => fetch(path),
  waitMs = INTRO_WAIT_MS,
): Promise<boolean> {
  if (new URLSearchParams(search).has('graph')) return false;
  const answer = (async () => {
    try {
      const response = await ask('/api/intro');
      if (!response.ok) return false;
      return ((await response.json()) as { show?: unknown } | null)?.show === true;
    } catch {
      return false;
    }
  })();
  const late = new Promise<false>((resolve) => setTimeout(() => resolve(false), waitMs));
  return Promise.race([answer, late]);
}

/** Whether a key ends the intro: Escape or any key but a modifier alone. */
export function endsIntro(key: string): boolean {
  return !MODIFIERS.has(key);
}

/**
 * Puts the intro over the page at once (its background, before the page's first render), then
 * plays it once its chunk is in. `record`: the first time, Symbiote's server keeps that it was
 * seen (as soon as it shows: a reload in the middle does not start it again).
 */
export function startIntro({ record }: { record: boolean }): void {
  if (document.querySelector('.intro')) return;
  const overlay = document.createElement('div');
  overlay.className = 'intro';
  overlay.dataset.state = 'loading';
  overlay.setAttribute('role', 'img');
  overlay.setAttribute('aria-label', 'Symbiote: two koi form the S');
  document.body.append(overlay);
  if (record) {
    void fetch('/api/intro', { method: 'POST', headers: WRITE_HEADERS, body: '{}' }).catch(
      () => undefined,
    );
  }
  import('./play.js').then(({ playIntro }) => playIntro(overlay)).catch(() => overlay.remove());
}
