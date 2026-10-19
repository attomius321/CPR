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

/**
 * Dark in both of the page's themes: Claude Code keeps its own theme whatever the terminal's
 * background, and on white its marks vanished (V21 spike). The page's dark tokens.
 */
export const TERMINAL_THEME: ITheme = {
  background: '#111113',
  foreground: '#ececf0',
  cursor: '#ececf0',
  cursorAccent: '#111113',
  selectionBackground: '#34343a',
  black: '#1c1c1f',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#a371f7',
  cyan: '#39c5bb',
  white: '#ececf0',
  brightBlack: '#6e6e76',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#bc8cff',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff',
};
