// A workspace's agent session in a terminal (V21): what the panel sends to it, kept pure.
import type { ITheme } from '@xterm/xterm';

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
