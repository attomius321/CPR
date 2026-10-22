import { describe, expect, it } from 'vitest';
import {
  cellRange,
  droppedFiles,
  followsLink,
  isPasteKey,
  keySender,
  lineText,
  linkHint,
  linkTarget,
  MAX_IMAGE_BYTES,
  pastedImages,
  terminalLinks,
  verdictLine,
  wrappedRows,
  type Cell,
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

describe('paths and links in a terminal (V37)', () => {
  /** Each link as [its text in the row, what it opens, line, column]. */
  const links = (text: string) =>
    terminalLinks(text).map((link) => [
      text.slice(link.start, link.end),
      link.kind === 'web' ? link.url : link.path,
      ...(link.kind === 'path' && link.line !== undefined ? [link.line] : []),
      ...(link.kind === 'path' && link.column !== undefined ? [link.column] : []),
    ]);

  it('finds the paths Claude Code and Codex print (rows from the V37 spike)', () => {
    expect(links(' ● Update(packages/app/src/math.ts)')).toEqual([
      ['packages/app/src/math.ts', 'packages/app/src/math.ts'],
    ]);
    expect(links('   - cube (new): packages/app/src/math.ts:12')).toEqual([
      ['packages/app/src/math.ts:12', 'packages/app/src/math.ts', 12],
    ]);
    expect(links('   - README.md: /home/a/spike/repo/README.md')).toEqual([
      ['README.md', 'README.md'],
      ['/home/a/spike/repo/README.md', '/home/a/spike/repo/README.md'],
    ]);
    expect(links(' • Added cube to packages/app/src/math.ts (packages/app/src/math.ts).')).toEqual([
      ['packages/app/src/math.ts', 'packages/app/src/math.ts'],
      ['packages/app/src/math.ts', 'packages/app/src/math.ts'],
    ]);
    expect(links('   └ Read math.ts')).toEqual([['math.ts', 'math.ts']]);
    expect(links(' ● Bash(ls /home/a/repo/README.md && realpath')).toEqual([
      ['/home/a/repo/README.md', '/home/a/repo/README.md'],
    ]);
  });

  it('reads a line and column the way tools print them', () => {
    expect(links('❯ packages/cli/test/terminal.test.ts:392:20')).toEqual([
      ['packages/cli/test/terminal.test.ts:392:20', 'packages/cli/test/terminal.test.ts', 392, 20],
    ]);
    expect(links('packages/cli/test/scout.test.ts(132,9): error TS2739: Type')).toEqual([
      ['packages/cli/test/scout.test.ts(132,9)', 'packages/cli/test/scout.test.ts', 132, 9],
    ]);
    expect(links('see src/a.ts#L12 and src/b.ts:3-9, then src/c.ts:7:')).toEqual([
      ['src/a.ts#L12', 'src/a.ts', 12],
      ['src/b.ts:3-9', 'src/b.ts', 3],
      ['src/c.ts:7', 'src/c.ts', 7],
    ]);
    expect(links('    at run (file:///home/a/x.js:10:5)')).toEqual([
      ['file:///home/a/x.js:10:5', '/home/a/x.js', 10, 5],
    ]);
    expect(links('`~/notes/a b.md` and "./src/a.ts"')).toEqual([
      ['~/notes/a', '~/notes/a'],
      ['b.md', 'b.md'],
      ['./src/a.ts', './src/a.ts'],
    ]);
    expect(links('[src/a.ts] src/routes/[id]/index.tsx')).toEqual([
      ['src/a.ts', 'src/a.ts'],
      ['src/routes/[id]/index.tsx', 'src/routes/[id]/index.tsx'],
    ]);
    expect(links('C:\\Users\\a\\x.ts:3 and src\\b.ts')).toEqual([
      ['C:\\Users\\a\\x.ts:3', 'C:\\Users\\a\\x.ts', 3],
      ['src\\b.ts', 'src\\b.ts'],
    ]);
  });

  it('finds web addresses, without the punctuation around them', () => {
    expect(links('   - xterm.js (https://xtermjs.org)')).toEqual([
      ['xterm.js', 'xterm.js'],
      ['https://xtermjs.org', 'https://xtermjs.org'],
    ]);
    expect(
      links('PR: https://github.com/a/b/pull/12. See https://en.wikipedia.org/wiki/A_(b), ok'),
    ).toEqual([
      ['https://github.com/a/b/pull/12', 'https://github.com/a/b/pull/12'],
      ['https://en.wikipedia.org/wiki/A_(b)', 'https://en.wikipedia.org/wiki/A_(b)'],
    ]);
    // An address's path is not a path of the folder.
    expect(links('<http://localhost:5173/src/a.ts>')).toEqual([
      ['http://localhost:5173/src/a.ts', 'http://localhost:5173/src/a.ts'],
    ]);
  });

  it('takes no word, number or version for a path', () => {
    for (const text of [
      'Read 2 files, listed 1 directory (ctrl+o to expand)',
      'v0.11.0 and 1.2.3 and 3.5',
      '[Image #1] [Image #2]',
      '✻ Churned for 8s · done 11:53 PM',
      '~ . .. / ... -- and/',
      'a:b ftp://x/y.ts',
    ]) {
      expect(links(text), text).toEqual([]);
    }
  });

  /** A row of narrow cells, as xterm.js reads them; an empty cell reads ''. */
  const row = (text: string, cols = text.length): Cell[] =>
    Array.from({ length: cols }, (_, i) => ({ chars: text[i] ?? '', width: 1 }));

  it("reads rows xterm.js wrapped as one line, and where each character's cell is", () => {
    const { text, at } = lineText([row('ab'), row('c', 3)]);
    expect(text).toBe('abc  ');
    expect(at.slice(0, 3)).toEqual([
      { row: 0, x: 0, width: 1 },
      { row: 0, x: 1, width: 1 },
      { row: 1, x: 0, width: 1 },
    ]);
  });

  it('counts a wide character as two cells: the links after it stay under their text', () => {
    // '⏺' drawn two cells wide, its second cell empty (width 0).
    const cells: Cell[] = [{ chars: '⏺', width: 2 }, { chars: '', width: 0 }, ...row(' a.ts')];
    const { text, at } = lineText([cells]);
    expect(text).toBe('⏺ a.ts');
    const [link] = terminalLinks(text);
    expect(cellRange(at, link!, 7)).toEqual({ start: { x: 4, y: 8 }, end: { x: 7, y: 8 } });
    // A wide character at the end of a link: its range ends after both its cells.
    const wide = lineText([[...row('a/'), { chars: '界', width: 2 }, { chars: '', width: 0 }]]);
    expect(cellRange(wide.at, { start: 0, end: 3 }, 1)).toEqual({
      start: { x: 1, y: 2 },
      end: { x: 4, y: 2 },
    });
  });

  it('gives a range across the rows a link was wrapped onto', () => {
    const { text, at } = lineText([row('see src/'), row('a.ts now')]);
    const [link] = terminalLinks(text);
    expect(text.slice(link!.start, link!.end)).toBe('src/a.ts');
    // Rows 10 and 11 of the buffer (0-based), 1-based in the range.
    expect(cellRange(at, link!, 10)).toEqual({ start: { x: 5, y: 11 }, end: { x: 4, y: 12 } });
  });

  it("finds a row's line in the buffer: the rows before it and after it that xterm.js wrapped", () => {
    const lines = [
      { isWrapped: false, cells: row('one') },
      { isWrapped: false, cells: row('two ') },
      { isWrapped: true, cells: row('three') },
      { isWrapped: true, cells: row('four') },
      { isWrapped: false, cells: row('five') },
    ];
    const buffer = {
      getLine: (y: number) => {
        const line = lines[y];
        return (
          line && {
            isWrapped: line.isWrapped,
            length: line.cells.length,
            getCell: (x: number) => {
              const cell = line.cells[x];
              return cell && { getChars: () => cell.chars, getWidth: () => cell.width };
            },
          }
        );
      },
    };
    // Row 3 (1-based, as xterm.js asks) is the second of three.
    const found = wrappedRows(buffer, 3);
    expect(found.first).toBe(1);
    expect(lineText(found.rows).text).toBe('two threefour');
    expect(wrappedRows(buffer, 1).rows).toHaveLength(1);
    expect(wrappedRows(buffer, 9).rows).toEqual([]);
  });

  it("reads an agent's own link (OSC 8): a file, VS Code's address of one, or a web address", () => {
    expect(linkTarget('file:///home/a/repo/src/a%20b.ts')).toEqual({
      kind: 'path',
      path: '/home/a/repo/src/a b.ts',
    });
    expect(linkTarget('vscode://file/home/a/repo/src/a.ts:12:3')).toEqual({
      kind: 'path',
      path: '/home/a/repo/src/a.ts',
      line: 12,
      column: 3,
    });
    expect(linkTarget('cursor://file/C:/w/a.ts:4')).toEqual({
      kind: 'path',
      path: 'C:/w/a.ts',
      line: 4,
    });
    expect(linkTarget('https://xtermjs.org')).toEqual({ kind: 'web', url: 'https://xtermjs.org' });
    for (const uri of ['javascript:alert(1)', 'mailto:a@b.c', 'ftp://x/y', 'not a uri']) {
      expect(linkTarget(uri), uri).toBeNull();
    }
  });

  it('follows a link on Ctrl+click, ⌘+click on macOS (where Ctrl+click is the menu)', () => {
    const click = { ctrlKey: false, metaKey: false };
    expect(followsLink(click, false)).toBe(false);
    expect(followsLink({ ...click, ctrlKey: true }, false)).toBe(true);
    expect(followsLink({ ...click, metaKey: true }, false)).toBe(false);
    expect(followsLink({ ...click, metaKey: true }, true)).toBe(true);
    expect(followsLink({ ...click, ctrlKey: true }, true)).toBe(false);
  });

  it('says what a link opens, and the keys that open it', () => {
    expect(linkHint({ kind: 'path', path: 'src/a.ts', line: 3 }, false)).toEqual({
      what: 'Open in VS Code',
      keys: 'Ctrl+click',
    });
    expect(linkHint({ kind: 'web', url: 'https://xtermjs.org' }, true)).toEqual({
      what: 'Open https://xtermjs.org',
      keys: '⌘+click',
    });
  });
});
