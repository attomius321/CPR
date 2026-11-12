// The page key (SC1, decision 930): what the page sends with each write and with the Confirm's
// reads (`x-symbiote-key`). Symbiote opens the page at an address whose fragment holds a one-time
// token (`#k=…`, never sent to a server); the page takes it out of the address at once and trades
// it for the key (`POST /api/session`). The key is kept in this origin's storage, which another
// port's page cannot read, so a reload or a second tab of this Symbiote writes too. A tab opened
// without a token, and with no key kept, reads and cannot write: it says so ("Open from
// Symbiote").
import { readStored, writeStored } from './stored.js';

const KEY = 'symbiote.viewer.key';

/** Said on `window` when the server refused a write for want of the page key. */
export const KEY_REFUSED_EVENT = 'symbiote:key-refused';

/** The token in a fragment (`k=…`, among `&`-separated parts), and the fragment without it. */
export function splitToken(hash: string): { token: string | null; hash: string } {
  const parts = hash
    .replace(/^#/, '')
    .split('&')
    .filter((part) => part !== '');
  const at = parts.findIndex((part) => part.startsWith('k='));
  if (at < 0) return { token: null, hash };
  const token = parts[at]?.slice(2) || null;
  parts.splice(at, 1);
  return { token, hash: parts.length > 0 ? `#${parts.join('&')}` : '' };
}

/** Whether `response` is a refusal for want of the page key (the server's header says so). */
export function isKeyRefusal(response: Response): boolean {
  return response.status === 403 && response.headers.get('x-symbiote-refused') === 'key';
}

let key: Promise<string | null> | undefined;

/**
 * The page key: traded once for the address's token, else the one kept. Started by the page's
 * first script (`main.tsx`), before anything reads the address.
 */
export function pageKey(): Promise<string | null> {
  key ??= takeKey();
  return key;
}

async function takeKey(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const { token, hash } = splitToken(window.location.hash);
  if (token === null) return readStored(KEY);
  // Out of the address before anything else reads it, shows it or keeps it in the history.
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`);
  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ k: token }),
    });
    if (response.ok) {
      const traded = ((await response.json()) as { key?: unknown }).key;
      if (typeof traded === 'string') {
        writeStored(KEY, traded);
        return traded;
      }
    }
  } catch {
    // No server to trade with: the key kept, if any.
  }
  // A token used already (a reload of the address Symbiote opened): the key kept from its trade.
  return readStored(KEY);
}

/** Tells the page that a write was refused for want of the key: it says "Open from Symbiote". */
export function noteKeyRefusal(response: Response): void {
  if (isKeyRefusal(response) && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(KEY_REFUSED_EVENT));
  }
}
