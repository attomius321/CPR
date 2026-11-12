// The address a frame of the nexus opens a Symbiote at (SC1, decision 930): its own, with a one-time
// open token in the fragment, which the framed page trades for its page key. The nexus asks the
// Symbiote for the token with the bridge key from the Symbiote's record (the user's file, read
// here alone). A Symbiote from before SC1 has neither: framed at its bare address, as before.
import { recordKey } from './registry.js';

/** How long the nexus waits for a Symbiote's token. */
const TIMEOUT_MS = 2000;

/** `symbiote`'s address for a frame: with an open token when it gives one, else bare. */
export async function frameAddress(
  cache: string,
  symbiote: { url: string; pid: number },
): Promise<string> {
  const key = recordKey(cache, symbiote.pid);
  if (!key) return symbiote.url;
  try {
    const res = await fetch(new URL('api/session/open', symbiote.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', 'x-symbiote-key': key },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return symbiote.url;
    const { token } = (await res.json()) as { token?: unknown };
    return typeof token === 'string' && token !== '' ? `${symbiote.url}#k=${token}` : symbiote.url;
  } catch {
    return symbiote.url;
  }
}
