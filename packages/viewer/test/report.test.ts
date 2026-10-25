import { describe, expect, it } from 'vitest';
import { pageErrorOf, PER_MINUTE, REPEAT_MS, reporter, type PageError } from '../src/ui/report.js';

/** A reporter on a clock the test moves, its timers run as the clock passes them. */
function harness() {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const sent: PageError[] = [];
  const report = reporter({
    send: (error) => sent.push(error),
    now: () => now,
    later: (run, ms) => void timers.push({ at: now + ms, run }),
  });
  const pass = (ms: number) => {
    now += ms;
    for (const timer of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
  };
  return { report, sent, pass };
}

const error = (msg: string): PageError => ({ level: 'error', msg, page: '/history' });

describe('reporter', () => {
  it('sends an error at once, and the same again within the window once, with its count', () => {
    const { report, sent, pass } = harness();
    report(error('boom'));
    report(error('boom'));
    report(error('boom'));
    expect(sent).toEqual([error('boom')]);
    pass(REPEAT_MS);
    expect(sent).toEqual([error('boom'), { ...error('boom'), repeated: 2 }]);
    // After the window it is new again.
    report(error('boom'));
    expect(sent).toHaveLength(3);
  });

  it('tells errors apart by their message and first frame', () => {
    const { report, sent } = harness();
    report(error('a'));
    report(error('b'));
    report({
      ...error('a'),
      err: { name: 'Error', message: 'a', stack: 'Error: a\n    at f (x.js:1:1)' },
    });
    expect(sent).toHaveLength(3);
  });

  it('sends at most PER_MINUTE a minute, then says how many it dropped', () => {
    const { report, sent, pass } = harness();
    for (let i = 0; i < PER_MINUTE + 5; i++) report(error(`error ${i}`));
    expect(sent).toHaveLength(PER_MINUTE);
    pass(60_000);
    report(error('later'));
    expect(sent.at(-1)).toEqual({ ...error('later'), dropped: 5 });
  });
});

describe('pageErrorOf', () => {
  it('reads an Error: its message, name and stack', () => {
    const thrown = new TypeError('x is undefined');
    const made = pageErrorOf(thrown, '/history', '\n    at HistoryPage');
    expect(made).toMatchObject({
      level: 'error',
      msg: 'x is undefined',
      page: '/history',
      err: { name: 'TypeError', message: 'x is undefined' },
      componentStack: '\n    at HistoryPage',
    });
    expect(made.err?.stack).toContain('TypeError: x is undefined');
  });

  it('reads anything else thrown or rejected as its text', () => {
    expect(pageErrorOf('plain words', '/')).toEqual({
      level: 'error',
      msg: 'plain words',
      page: '/',
    });
    expect(pageErrorOf(undefined, '/').msg).toBe('undefined');
    expect(pageErrorOf({ reason: 1 }, '/').msg).toBe('{"reason":1}');
  });

  it('keeps a message, a stack and a component stack short', () => {
    const long = new Error('m'.repeat(5000));
    long.stack = 's'.repeat(20_000);
    const made = pageErrorOf(long, '/', 'c'.repeat(20_000));
    expect(made.msg.length).toBeLessThanOrEqual(1000);
    expect(made.err?.message.length).toBeLessThanOrEqual(1000);
    expect(made.err?.stack?.length).toBeLessThanOrEqual(8000);
    expect(made.componentStack?.length).toBeLessThanOrEqual(4000);
    // Within what the server takes.
    expect(JSON.stringify(made).length).toBeLessThan(32 * 1024);
  });
});
