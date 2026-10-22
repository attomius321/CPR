// A workspace's agent session in a terminal (V21): what the panel sends to it, and the paths and
// links in what it prints (V37), kept pure.
import type { IBufferRange, ITheme } from '@xterm/xterm';

/**
 * The line "Send the verdict" types into the agent's input: the verdict's first line and where
 * the review is. Not the whole text: a paste reaches the agent as `<pasted_content>`, and lines
 * typed with backslash-Enter keep their backslashes (V21 spike).
 */
export function verdictLine(text: string): string {
  const lines = text.trim().split('\n');
  const first = lines[0] ?? '';
  const where = lines.findLast((line) => line.startsWith('The review: '));
  return where && where !== first ? `${first} ${where}` : first;
}

/**
 * Sends keys with one write at a time; keys typed while one is on its way go in the next write,
 * together and in order (a key to its echo: 22 ms in the spike).
 */
export function keySender(
  send: (data: string) => Promise<void>,
  failed: (error: Error) => void = () => {},
): (data: string) => void {
  let waiting = '';
  let busy = false;
  const next = () => {
    if (busy || waiting === '') return;
    const data = waiting;
    waiting = '';
    busy = true;
    send(data)
      .catch((error: unknown) => failed(error as Error))
      .finally(() => {
        busy = false;
        next();
      });
  };
  return (data) => {
    waiting += data;
    next();
  };
}

/** The kinds of image Claude Code and Codex attach from a pasted path (V36). */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * Most an image for the agent may weigh: the server's limit (`MAX_IMAGE_BYTES` in the CLI's
 * terminal.ts), checked before the page reads the file.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** What a paste carries, as the page reads it. */
interface Clipboard {
  getData(type: string): string;
  files: ArrayLike<File>;
}

/**
 * The images a paste attaches for the agent (V36): the clipboard's, unless it holds text, which
 * xterm.js pastes as before. A copied spreadsheet range or web page carries an image too, and was
 * text to the person.
 */
export function pastedImages(clipboard: Clipboard | null): File[] {
  if (!clipboard || clipboard.getData('text/plain') !== '') return [];
  return Array.from(clipboard.files).filter((file) => IMAGE_TYPES.has(file.type));
}

/** A drop's files (V36): the images to attach, in their order, and the others. */
export function droppedFiles(files: ArrayLike<File>): { images: File[]; others: File[] } {
  const all = Array.from(files);
  return {
    images: all.filter((file) => IMAGE_TYPES.has(file.type)),
    others: all.filter((file) => !IMAGE_TYPES.has(file.type)),
  };
}

/**
 * Whether a key is the browser's paste rather than the agent's (V36): Ctrl+V off macOS, where
 * xterm.js would send ^V for the agent to read its own machine's clipboard, not the one the page
 * sees. The V key by its place, as xterm.js reads it, whatever letter the layout gives. On macOS ⌘V
 * pastes, and Ctrl+V stays the agent's.
 */
export function isPasteKey(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  mac: boolean,
): boolean {
  return (
    !mac &&
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.code === 'KeyV' || event.key.toLowerCase() === 'v')
  );
}

/** What a link in a terminal opens (V37): a file the agent printed, or a web address. */
export type LinkTarget =
  { kind: 'path'; path: string; line?: number; column?: number } | { kind: 'web'; url: string };

/** A link in a row's text: what it opens, from `start` to `end` (UTF-16 offsets). */
export type TerminalLink = LinkTarget & { start: number; end: number };

/** A web address, to its first space or a character no address has. */
const WEB = /\bhttps?:\/\/[^\s"'`<>{}|\\^]+/g;
/** A run of text that may be a path: it ends at a space or a character paths rarely have. */
const WORD = /[^\s"'`<>|(){},;*?!&=]+/g;
/** A path and where in it: `:12`, `:12:5`, `:12-20`, `#L12`, `#L12C5`. */
const POSITION =
  /^(.+?)(?::(\d+)(?:[:.](\d+))?(?:-\d+(?::\d+)?)?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)?$/;
/** A file's name with an extension: one with a letter (not `1.2.3`). */
const NAMED = /^[\w.@+~-]*\.[\w-]*[A-Za-z][\w-]*$/;
/** Characters left out of a link at its end. */
const TRAILING = /[.,;:!?]+$/;

/** Brackets around a whole word (`[src/a.ts]`), but not a route's (`src/[id]/a.ts`). */
function unbracketed(word: string): { text: string; from: number } {
  let text = word;
  let from = 0;
  for (;;) {
    const open = (text.match(/\[/g) ?? []).length;
    const close = (text.match(/\]/g) ?? []).length;
    if (text.startsWith('[') && (open > close || wraps(text))) {
      text = text.slice(1);
      from += 1;
      if (open <= close) text = text.slice(0, -1);
    } else if (text.endsWith(']') && close > open) text = text.slice(0, -1);
    else return { text, from };
  }
}

/** Whether `[` at the start closes only at the end. */
function wraps(text: string): boolean {
  if (!text.endsWith(']')) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') depth -= 1;
    if (depth === 0) return i === text.length - 1;
  }
  return false;
}

/** A web address without what closes the sentence: `.` at its end, a `)` it did not open. */
function trimmedUrl(url: string): string {
  let text = url.replace(TRAILING, '');
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    while (text.endsWith(close) && text.split(close).length > text.split(open).length) {
      text = text.slice(0, -1).replace(TRAILING, '');
    }
  }
  return text;
}

/**
 * Whether a printed word is worth asking about as a path: with a folder in it (not ending in one),
 * or a file's name with an extension. Never a web address, `~`, `.` or `..` alone. The server
 * says which are files (V37).
 */
function isPathLike(path: string): boolean {
  if (/^[a-z][\w+.-]*:\/\//i.test(path) || /^[~.]*$/.test(path.replace(/[\\/]/g, ''))) {
    return false;
  }
  if (/[\\/]$/.test(path)) return false;
  return /[\\/]/.test(path) || NAMED.test(path);
}

/** A path with where in it (`a.ts:12:5`), as found in a word; a `file://` address's path too. */
function pathAt(word: string): Omit<Extract<LinkTarget, { kind: 'path' }>, 'kind'> | null {
  const file = /^file:\/\//i.test(word);
  const match = POSITION.exec(file ? word.slice('file://'.length) : word);
  if (!match) return null;
  const [, text = '', line = match[4], column = match[5]] = match;
  let path = text;
  if (file) {
    try {
      path = decodeURIComponent(text);
    } catch {
      return null;
    }
  }
  if (!isPathLike(path)) return null;
  return {
    path,
    ...(line === undefined ? {} : { line: Number(line) }),
    ...(column === undefined ? {} : { column: Number(column) }),
  };
}

/**
 * The paths and web addresses in a row of an agent's terminal (V37), in order: web addresses
 * first (their own paths are not files), then the words that may be paths, with the line and
 * column printed after them — `:12:5`, `#L12`, or a compiler's `(12,5)`. Brackets, quotes and the
 * punctuation of a sentence around them are left out.
 */
export function terminalLinks(text: string): TerminalLink[] {
  const found: TerminalLink[] = [];
  let rest = text;
  for (const match of text.matchAll(WEB)) {
    const url = trimmedUrl(match[0]);
    const start = match.index;
    found.push({ kind: 'web', url, start, end: start + url.length });
    rest = rest.slice(0, start) + ' '.repeat(match[0].length) + rest.slice(start + match[0].length);
  }
  for (const match of rest.matchAll(WORD)) {
    const { text: word, from } = unbracketed(match[0].replace(TRAILING, ''));
    const at = pathAt(word);
    if (!at) continue;
    const start = match.index + from;
    let end = start + word.length;
    // A compiler's place: `src/a.ts(12,5): error`.
    const place = at.line === undefined ? /^\((\d+)(?:,(\d+))?\)/.exec(text.slice(end)) : null;
    if (place) {
      end += place[0].length;
      at.line = Number(place[1]);
      if (place[2] !== undefined) at.column = Number(place[2]);
    }
    found.push({ kind: 'path', ...at, start, end });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** A cell of a terminal's row as xterm.js reads it: '' when empty, width 0 after a wide one. */
export interface Cell {
  chars: string;
  width: number;
}

/** Where a character of a line is: its row in the line, its cell (0-based), and its width. */
export interface CellAt {
  row: number;
  x: number;
  width: number;
}

/** Rows read as one line of text, an empty cell a space, and where each character is. */
export function lineText(rows: readonly (readonly Cell[])[]): { text: string; at: CellAt[] } {
  let text = '';
  const at: CellAt[] = [];
  rows.forEach((cells, row) => {
    cells.forEach((cell, x) => {
      // The second cell of a wide character: its text is the first's.
      if (cell.width === 0) return;
      const chars = cell.chars === '' ? ' ' : cell.chars;
      for (let i = 0; i < chars.length; i += 1) at.push({ row, x, width: cell.width });
      text += chars;
    });
  });
  return { text, at };
}

/**
 * The cells of `text.slice(start, end)` in the buffer, as xterm.js ranges them: 1-based, its end
 * the last cell (both of a wide character's). `first`: the buffer row of the line's first row,
 * 0-based.
 */
export function cellRange(
  at: readonly CellAt[],
  { start, end }: { start: number; end: number },
  first: number,
): IBufferRange {
  const from = at[start] ?? { row: 0, x: 0, width: 1 };
  const to = at[end - 1] ?? from;
  return {
    start: { x: from.x + 1, y: first + from.row + 1 },
    end: { x: to.x + to.width, y: first + to.row + 1 },
  };
}

/** A terminal's buffer, as much of it as the link finder reads. */
export interface BufferRows {
  getLine(y: number):
    | {
        isWrapped: boolean;
        length: number;
        getCell(x: number): { getChars(): string; getWidth(): number } | undefined;
      }
    | undefined;
}

/** Most rows one line is read across: a path is never that long. */
const MAX_WRAPPED = 20;

/**
 * The line row `y` (1-based, as xterm.js asks for links) is part of: it and the rows xterm.js
 * wrapped it from and onto. `first`: the buffer row of its first row, 0-based.
 */
export function wrappedRows(buffer: BufferRows, y: number): { first: number; rows: Cell[][] } {
  let first = y - 1;
  if (!buffer.getLine(first)) return { first, rows: [] };
  while (first > 0 && buffer.getLine(first)?.isWrapped && y - 1 - first < MAX_WRAPPED) first -= 1;
  let last = y - 1;
  while (buffer.getLine(last + 1)?.isWrapped && last - first < MAX_WRAPPED) last += 1;
  const rows: Cell[][] = [];
  for (let i = first; i <= last; i += 1) {
    const line = buffer.getLine(i);
    const cells: Cell[] = [];
    for (let x = 0; x < (line?.length ?? 0); x += 1) {
      const cell = line?.getCell(x);
      cells.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 });
    }
    rows.push(cells);
  }
  return { first, rows };
}

/** Editors whose addresses open a file (`vscode://file/<path>:<line>:<column>`). */
const EDITOR_FILE = /^(?:vscode|vscode-insiders|cursor|windsurf):\/\/file(\/.*)$/i;

/**
 * Where an agent's own link (OSC 8) goes, when Symbiote follows it (V37): a `file://` address or
 * an editor's address of a file opens the file; `http(s)` the address; anything else nothing.
 */
export function linkTarget(uri: string): LinkTarget | null {
  const editor = EDITOR_FILE.exec(uri);
  if (editor) {
    // `/C:/w/a.ts` on Windows.
    const at = pathAt((editor[1] ?? '').replace(/^\/(?=[A-Za-z]:)/, ''));
    return at && { kind: 'path', ...at };
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'web', url: uri };
  if (url.protocol !== 'file:') return null;
  const at = pathAt(`file://${url.pathname.replace(/^\/(?=[A-Za-z]:)/, '')}`);
  return at && { kind: 'path', ...at };
}

/** Whether a click follows a link (V37): Ctrl+click, ⌘+click on macOS (Ctrl+click: the menu). */
export function followsLink(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>, mac: boolean): boolean {
  return mac ? event.metaKey : event.ctrlKey;
}

/** The hint over a link: what it opens, and the keys that open it. */
export function linkHint(target: LinkTarget, mac: boolean): { what: string; keys: string } {
  return {
    what: target.kind === 'web' ? `Open ${target.url}` : 'Open in VS Code',
    keys: mac ? '⌘+click' : 'Ctrl+click',
  };
}

/**
 * Dark in both of the page's themes: Claude Code keeps its own theme whatever the terminal's
 * background, and on white its marks vanished (V21 spike). Black, as the reference's (V29b).
 */
export const TERMINAL_THEME: ITheme = {
  background: '#000000',
  foreground: '#e6e6e9',
  cursor: '#e6e6e9',
  cursorAccent: '#000000',
  selectionBackground: '#3a3a42',
  black: '#1f1f23',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#a371f7',
  cyan: '#39c5bb',
  white: '#e6e6e9',
  brightBlack: '#6e6e76',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#bc8cff',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff',
};
