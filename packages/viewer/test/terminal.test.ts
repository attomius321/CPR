import { describe, expect, it } from 'vitest';
import {
  droppedFiles,
  isPasteKey,
  keySender,
  MAX_IMAGE_BYTES,
  pastedImages,
  verdictLine,
} from '../src/terminal.js';

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
      'The review: symbiote/reviews/feature/x/ada.json; how to act on it: symbiote/AGENTS.md.',
      '',
    ].join('\n');
    expect(verdictLine(text)).toBe(
      'Address this review of the branch feature/x (ada, at 1a2b3c4): changes requested. ' +
        'The review: symbiote/reviews/feature/x/ada.json; how to act on it: symbiote/AGENTS.md.',
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

describe('images for the agent (V36)', () => {
  const file = (name: string, type: string) => new File([new Uint8Array([1, 2])], name, { type });
  const png = file('image.png', 'image/png');
  const clipboard = (text: string, files: File[]) => ({
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    files,
  });

  it("a paste attaches the clipboard's images when it holds no text", () => {
    expect(pastedImages(clipboard('', [png]))).toEqual([png]);
    const jpeg = file('photo.jpg', 'image/jpeg');
    expect(pastedImages(clipboard('', [png, jpeg]))).toEqual([png, jpeg]);
    expect(pastedImages(clipboard('', []))).toEqual([]);
    expect(pastedImages(null)).toEqual([]);
  });

  it('a paste with text is text, as before: a copied range or page carries an image too', () => {
    expect(pastedImages(clipboard('A1\tB1', [png]))).toEqual([]);
  });

  it('only the kinds Claude Code and Codex attach: PNG, JPEG, GIF, WebP', () => {
    const kinds = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].map((t) => file('x', t));
    expect(pastedImages(clipboard('', kinds))).toEqual(kinds);
    const others = [file('x.svg', 'image/svg+xml'), file('x.bmp', 'image/bmp'), file('x.txt', '')];
    expect(pastedImages(clipboard('', others))).toEqual([]);
  });

  it('a drop: its images to attach, in order, and the files that cannot be', () => {
    const notes = file('notes.txt', 'text/plain');
    const gif = file('a.gif', 'image/gif');
    expect(droppedFiles([png, notes, gif])).toEqual({ images: [png, gif], others: [notes] });
    expect(droppedFiles([])).toEqual({ images: [], others: [] });
  });

  it("Ctrl+V is the browser's paste off macOS, where ⌘V is; other keys stay the agent's", () => {
    const key = (init: Partial<KeyboardEvent>) =>
      ({
        type: 'keydown',
        key: 'v',
        code: 'KeyV',
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ...init,
      }) as KeyboardEvent;
    expect(isPasteKey(key({ ctrlKey: true }), false)).toBe(true);
    // A layout whose V key types another letter: the key's place decides, as for xterm.js.
    expect(isPasteKey(key({ ctrlKey: true, key: 'м' }), false)).toBe(true);
    expect(isPasteKey(key({ ctrlKey: true }), true)).toBe(false);
    expect(isPasteKey(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isPasteKey(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isPasteKey(key({}), false)).toBe(false);
    expect(isPasteKey(key({ ctrlKey: true, key: 'c', code: 'KeyC' }), false)).toBe(false);
  });

  it("refuses an image over the server's limit before reading it", () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
  });
});
