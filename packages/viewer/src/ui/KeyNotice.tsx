import { useEffect, useState } from 'react';
import { pageHeaders, write } from './http.js';
import { CloseIcon, ShieldIcon } from './icons.js';
import { KEY_REFUSED_EVENT } from './page-key.js';

/** What "Open again" did, in words. */
type Asked = 'idle' | 'asked' | 'soon' | 'none';

const ASKED_WORDS: Record<Exclude<Asked, 'idle'>, string> = {
  asked: 'A new address is open in your browser, or printed where symbiote view runs.',
  soon: 'Asked a moment ago: look in your browser, or where symbiote view runs.',
  none: 'This Symbiote cannot open one: open it from its window or the nexus.',
};

/**
 * "Open from Symbiote" (SC1, decision 930): this tab has no page key, so it reads and cannot write
 * or answer a Confirm. Shown when the server says so as the page loads, and on a write it refused
 * for want of the key; "Open again" asks `symbiote view` for a fresh address, which it opens or
 * prints itself (never answered here).
 */
export function KeyNotice() {
  const [shown, setShown] = useState(false);
  const [asked, setAsked] = useState<Asked>('idle');

  useEffect(() => {
    // A graph file has no server (`?graph=`, the measure scripts).
    if (new URLSearchParams(window.location.search).has('graph')) return;
    let gone = false;
    void (async () => {
      try {
        const res = await fetch('/api/session', { headers: await pageHeaders() });
        if (!res.ok || gone) return;
        if (((await res.json()) as { page?: unknown }).page === false) setShown(true);
      } catch {
        // No server to ask: nothing to say.
      }
    })();
    const refused = () => setShown(true);
    window.addEventListener(KEY_REFUSED_EVENT, refused);
    return () => {
      gone = true;
      window.removeEventListener(KEY_REFUSED_EVENT, refused);
    };
  }, []);

  if (!shown) return null;
  const openAgain = async () => {
    const res = await write('/api/session/again', { body: '{}' }).catch(() => null);
    setAsked(res?.status === 204 ? 'asked' : res?.status === 429 ? 'soon' : 'none');
  };
  return (
    <div className="key-notice" role="alert">
      <ShieldIcon />
      <div className="key-notice-text">
        <strong>Open from Symbiote</strong>
        <span>
          This tab reads only. To write and answer, open it from Symbiote: its window, the nexus, or
          the address symbiote view printed.
        </span>
        {asked !== 'idle' && <span className="key-notice-said">{ASKED_WORDS[asked]}</span>}
      </div>
      <button type="button" className="button secondary" onClick={() => void openAgain()}>
        Open again
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Close"
        onClick={() => setShown(false)}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
