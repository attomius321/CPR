import { describe, expect, it, vi } from 'vitest';
import { askIntro, endsIntro } from '../src/intro/intro.js';

// The first-time intro (V39): `symbiote view` and `symbiote pr` say whether to show it.
const answering = (status: number, body: string) =>
  vi.fn<(path: string) => Promise<Response>>(() => Promise.resolve(new Response(body, { status })));

describe('askIntro', () => {
  it("shows it when Symbiote's server says so, asking at its absolute address", async () => {
    const ask = answering(200, '{"show":true}');
    expect(await askIntro('', ask)).toBe(true);
    expect(ask).toHaveBeenCalledWith('/api/intro');
    expect(await askIntro('?x=1', answering(200, '{"show":false}'))).toBe(false);
  });

  it('never on a ?graph= page, which it does not ask', async () => {
    const ask = answering(200, '{"show":true}');
    expect(await askIntro('?graph=graph.json', ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('not without an answer: a 404, a body of another shape, a failed request, a late one', async () => {
    expect(await askIntro('', answering(404, 'not found'))).toBe(false);
    expect(await askIntro('', answering(200, '{"show":"yes"}'))).toBe(false);
    expect(await askIntro('', answering(200, '<html>'))).toBe(false);
    expect(await askIntro('', () => Promise.reject(new TypeError('failed')))).toBe(false);
    const never = () => new Promise<Response>(() => undefined);
    expect(await askIntro('', never, 20)).toBe(false);
  });
});

describe('endsIntro', () => {
  it('ends on Escape and any key that types or acts, not on a modifier alone', () => {
    for (const key of ['Escape', 'Enter', ' ', 'a', 'j', 'ArrowDown', 'Tab']) {
      expect(endsIntro(key)).toBe(true);
    }
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']) {
      expect(endsIntro(key)).toBe(false);
    }
  });
});
