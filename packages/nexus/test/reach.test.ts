import { afterEach, describe, expect, it, vi } from 'vitest';
import { answers, reached, type Reach } from '../src/page/reach.js';

const URL = 'http://127.0.0.1:41000/';

/** A browser that reaches the address from `from` ms on, on a clock of its own. */
function browser(from: number) {
  let now = 0;
  const asked: { at: number; within: number }[] = [];
  const reach: Reach = {
    answers: (url, within) => {
      expect(url).toBe(URL);
      asked.push({ at: now, within });
      return Promise.resolve(now >= from);
    },
    wait: (ms) => {
      now += ms;
      return Promise.resolve();
    },
    now: () => now,
  };
  return { reach, asked };
}

describe('reached', () => {
  it('answers at once where the browser reaches the address at once', async () => {
    const { reach, asked } = browser(0);
    expect(await reached(URL, reach)).toBe(true);
    expect(asked.map((ask) => ask.at)).toEqual([0]);
  });

  it('asks every 500 ms until the address answers: WSL forwards a new port late', async () => {
    const { reach, asked } = browser(858);
    expect(await reached(URL, reach)).toBe(true);
    expect(asked.map((ask) => ask.at)).toEqual([0, 500, 1000]);
  });

  it('gives up after 10 s, each ask held to the time left', async () => {
    const { reach, asked } = browser(Infinity);
    expect(await reached(URL, reach)).toBe(false);
    expect(asked).toHaveLength(20);
    expect(asked.at(0)).toEqual({ at: 0, within: 10_000 });
    expect(asked.at(1)).toEqual({ at: 500, within: 9_500 });
    expect(asked.at(-1)).toEqual({ at: 9_500, within: 500 });
  });
});

describe('answers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes any answer, a refusal too: only a request that reaches nothing fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    expect(await answers(URL, 500)).toBe(true);
    // Read nowhere: the browser's own request, no CORS asked of the Symbiote, nothing kept.
    expect(fetch).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ method: 'HEAD', mode: 'no-cors', cache: 'no-store' }),
    );

    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await answers(URL, 500)).toBe(false);
  });
});
