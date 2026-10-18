import { describe, expect, it } from 'vitest';
import { keySender, verdictLine } from '../src/terminal.js';

describe('verdictLine', () => {
  it("is the verdict's first line and where the review is, as one line", () => {
    const text = [
      'Address this review of the branch feature/x (ada, at 1a2b3c4): changes requested.',
      '',
      'Keep the old name.',
      '',
      'src/a.ts:3 · half',
      '    return a / 2;',
      'Round it.',
      '',
      'The review: cpr/reviews/feature/x/ada.json; how to act on it: cpr/AGENTS.md.',
      '',
    ].join('\n');
    expect(verdictLine(text)).toBe(
      'Address this review of the branch feature/x (ada, at 1a2b3c4): changes requested. ' +
        'The review: cpr/reviews/feature/x/ada.json; how to act on it: cpr/AGENTS.md.',
    );
  });

  it('is the first line alone when the text says nothing of where the review is', () => {
    expect(verdictLine('Approved the branch x at 1a2b3c4: merge 1a2b3c4 into main.\n')).toBe(
      'Approved the branch x at 1a2b3c4: merge 1a2b3c4 into main.',
    );
  });
});

describe('keySender', () => {
  it('sends one write at a time; what is typed meanwhile goes next, together, in order', async () => {
    const sent: string[] = [];
    const pending: (() => void)[] = [];
    const send = keySender((data) => {
      sent.push(data);
      return new Promise<void>((resolve) => pending.push(resolve));
    });
    send('h');
    send('e');
    send('l');
    expect(sent).toEqual(['h']);
    pending.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual(['h', 'el']);
    send('l');
    send('o');
    pending.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual(['h', 'el', 'lo']);
    pending.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    send('!');
    expect(sent).toEqual(['h', 'el', 'lo', '!']);
  });

  it('says when a write fails, and goes on with the next keys', async () => {
    const sent: string[] = [];
    const failed: string[] = [];
    let fail = true;
    const send = keySender(
      (data) => {
        sent.push(data);
        return fail ? Promise.reject(new Error('no such terminal')) : Promise.resolve();
      },
      (error) => failed.push(error.message),
    );
    send('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toEqual(['no such terminal']);
    fail = false;
    send('b');
    expect(sent).toEqual(['a', 'b']);
  });
});
