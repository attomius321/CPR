// When a frame is given its Symbiote's address (fix/first-time-symbiote-from-nexus, decision
// 625): once the page's own browser reaches it. The nexus's server finds a Symbiote from inside
// WSL, where its port answers as it listens; a browser on Windows reaches that port only once WSL
// forwards it, 18–858 ms later, and a frame refused once shows the browser's error until it is
// loaded again.

/** How the page asks whether an address answers, and waits. */
export interface Reach {
  /** Whether `url` answers this browser within `within` ms. */
  answers(url: string, within: number): Promise<boolean>;
  wait(ms: number): Promise<void>;
  now(): number;
}

/** How often an address is asked again, and for how long, in ms. */
const EVERY = 500;
const WITHIN = 10_000;

/**
 * Whether `url` answers this browser: asked every 500 ms, for 10 s at most. False then, and the
 * frame shows the browser's own error, as it did before.
 */
export async function reached(url: string, reach: Reach): Promise<boolean> {
  const until = reach.now() + WITHIN;
  for (;;) {
    const left = until - reach.now();
    if (left <= 0) return false;
    if (await reach.answers(url, left)) return true;
    await reach.wait(EVERY);
  }
}

/**
 * Whether `url` answers this browser: any answer, a refusal too; only a request that reaches
 * nothing fails. A HEAD without CORS, its answer read nowhere: the Symbiote serves its page from
 * memory.
 */
export async function answers(url: string, within: number): Promise<boolean> {
  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(within),
    });
    return true;
  } catch {
    return false;
  }
}

/** This browser's `Reach`. */
export const browserReach: Reach = {
  answers,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};
