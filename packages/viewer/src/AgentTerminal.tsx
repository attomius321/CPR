import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { WorkspaceTerminalOpened } from '@symbiote/core';
import { postJson } from './http.js';
import { keySender, TERMINAL_THEME } from './terminal.js';
import { holdReads } from './useWorkspaces.js';

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-symbiote': '1' };
/** The bundled mono (V29b), as styles.css names it. */
const MONO = "'Geist Mono Variable', monospace";
/** The body's size (`--size-body`, V32): xterm takes a number, not a token. */
const FONT_SIZE = 14;

/** A write to a terminal (`…/in`, `…/resize`, `…/close`): no answer but its status. */
export async function toTerminal(id: string, action: string, body: unknown): Promise<void> {
  const response = await fetch(`/api/terminals/${id}/${action}`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(body),
    // A close sent while the page goes still reaches the server.
    keepalive: action === 'close',
  });
  if (!response.ok) throw new Error(await response.text());
}

/** An open terminal: its ID, to type into it, and a way to give it the keys again. */
export interface OpenedTerminal {
  id: string;
  focus(): void;
}

/**
 * A workspace's agent session as its agent draws it: `claude attach` (V21), or Codex's TUI joined
 * to its app server (V27b), on the server in a pseudo-terminal, drawn by xterm.js (its own chunk,
 * loaded when a terminal first opens) and fitted to its box. The agent keeps hosting the session:
 * closing this hangs up only the client. While it is open the list is read every 5 s, since what
 * is typed here may start a turn. `onOpened` gives the open terminal (to type into it), `onEnded`
 * says it ended. `url`: where it is opened — a workspace's (`branch`), or Scout's (V35).
 */
export function AgentTerminal({
  branch,
  url = '/api/workspaces/terminal',
  onOpened,
  onEnded,
}: {
  branch?: string;
  url?: string;
  onOpened: (opened: OpenedTerminal | null) => void;
  onEnded: (why: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [trust, setTrust] = useState(false);
  // The latest callbacks, without opening the terminal again when they change.
  const told = useRef({ onOpened, onEnded });
  told.current = { onOpened, onEnded };

  useEffect(() => {
    const release = holdReads();
    let gone = false;
    let id: string | null = null;
    let events: EventSource | null = null;
    let term: Terminal | null = null;
    let observer: ResizeObserver | null = null;
    let resizing: ReturnType<typeof setTimeout> | undefined;
    const ended = (why: string) => {
      events?.close();
      told.current.onOpened(null);
      told.current.onEnded(why);
    };
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css'),
        // xterm measures its cell from the font it is given: loaded first, or the columns the
        // agent is told would be counted with the fallback's width.
        document.fonts.load(`${FONT_SIZE}px ${MONO}`),
      ]);
      const element = box.current;
      if (gone || !element) return;
      term = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: MONO,
        fontSize: FONT_SIZE,
        cursorBlink: true,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      const opened = await postJson<WorkspaceTerminalOpened>(url, {
        ...(branch === undefined ? {} : { branch }),
        cols: term.cols,
        rows: term.rows,
      });
      setTrust(opened.trusted === false);
      if (gone) {
        void toTerminal(opened.id, 'close', {}).catch(() => {});
        return;
      }
      const shown = term;
      const terminal = (id = opened.id);
      told.current.onOpened({ id: terminal, focus: () => shown.focus() });
      events = new EventSource(`/api/terminals/${terminal}`);
      let connected = false;
      // A dropped stream reconnects and gets what was printed again: drawn anew.
      events.addEventListener('open', () => {
        if (connected) shown.reset();
        connected = true;
      });
      events.addEventListener('out', (event) => {
        shown.write(JSON.parse((event as MessageEvent<string>).data) as string);
      });
      events.addEventListener('exit', () => ended('exited'));
      events.addEventListener('error', () => {
        if (events?.readyState === EventSource.CLOSED) ended('lost');
      });
      const send = keySender(
        (data) => toTerminal(terminal, 'in', { data }),
        (failed) => setError(failed.message),
      );
      shown.onData((data) => {
        // Codex's trust question is the first thing in its terminal: a key answers it (V27b).
        setTrust(false);
        send(data);
      });
      shown.onResize(({ cols, rows }) => {
        clearTimeout(resizing);
        resizing = setTimeout(() => {
          toTerminal(terminal, 'resize', { cols, rows }).catch(() => {});
        }, 100);
      });
      observer = new ResizeObserver(() => fit.fit());
      observer.observe(element);
      shown.focus();
    })().catch((failed: unknown) => {
      if (!gone) setError((failed as Error).message);
    });
    return () => {
      release();
      gone = true;
      clearTimeout(resizing);
      observer?.disconnect();
      events?.close();
      term?.dispose();
      if (id) void toTerminal(id, 'close', {}).catch(() => {});
      told.current.onOpened(null);
    };
  }, [branch, url]);

  return (
    <div className="agent-terminal">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {trust && (
        <p className="hint terminal-trust">
          Codex asks first whether you trust this {branch === undefined ? 'folder' : 'worktree'}.
          Your answer is saved in your Codex configuration; Symbiote does not answer for you.
        </p>
      )}
      <div ref={box} className="agent-terminal-screen" />
    </div>
  );
}
