import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { WorkspaceTerminalOpened } from '@symbiote/core';
import { postJson } from './http.js';
import { ImageIcon } from './icons.js';
import {
  droppedFiles,
  isPasteKey,
  keySender,
  MAX_IMAGE_BYTES,
  pastedImages,
  TERMINAL_THEME,
} from './terminal.js';
import { holdReads } from './useWorkspaces.js';

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-symbiote': '1' };
/** The bundled mono (V29b), as styles.css names it. */
const MONO = "'Geist Mono Variable', monospace";
/** The body's size (`--size-body`, V32): xterm takes a number, not a token. */
const FONT_SIZE = 14;
/** Where ⌘V pastes and Ctrl+V stays the agent's (V36). */
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const ONLY_IMAGES = 'Only images can be attached: PNG, JPEG, GIF or WebP.';

/** A file's bytes as base64, for the server. */
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // A data URL, as asked: its text after the comma.
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error(`${file.name} could not be read`));
    reader.readAsDataURL(file);
  });
}

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
 * says it ended. `url`: where it is opened — a workspace's (`branch`), or Scout's (V35). An image
 * pasted (Ctrl+V too, off macOS) or dropped is saved by the server and its path pasted, which the
 * agent attaches to the message being typed (V36).
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
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [trust, setTrust] = useState(false);
  const [dropping, setDropping] = useState(false);
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
    let unlisten = () => {};
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
      const area = root.current;
      if (gone || !element || !area) return;
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
      // Images for the agent (V36), one after another in the order given: each saved by the
      // server, its path pasted as text is, so bracketed when the agent asked for it.
      let attaching = Promise.resolve();
      const attach = (images: File[], then: string | null = null) => {
        attaching = attaching
          .then(async () => {
            for (const image of images) {
              if (image.size > MAX_IMAGE_BYTES) {
                throw new Error(`${image.name}: an image of at most ${MAX_IMAGE_BYTES >> 20} MB`);
              }
              const saved = await postJson<{ text: string }>(`/api/terminals/${terminal}/image`, {
                data: await base64(image),
              });
              if (gone) return;
              shown.paste(saved.text);
            }
            setError(then);
          })
          .catch((failed: unknown) => {
            if (!gone) setError((failed as Error).message);
          });
      };
      // Ctrl+V left to the browser: its paste comes next, with the clipboard the page sees.
      shown.attachCustomKeyEventHandler((event) => !isPasteKey(event, MAC));
      // Before xterm.js's own, which pastes the clipboard's text: empty, for a screenshot.
      const onPaste = (event: ClipboardEvent) => {
        const images = pastedImages(event.clipboardData);
        if (images.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        attach(images);
      };
      // Counted: entering the terminal's own elements leaves the one before.
      let over = 0;
      const carriesFiles = (event: DragEvent) =>
        event.dataTransfer?.types.includes('Files') ?? false;
      const onDragEnter = (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        over += 1;
        setDropping(true);
      };
      const onDragOver = (event: DragEvent) => {
        if (!carriesFiles(event) || !event.dataTransfer) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      };
      const onDragLeave = (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        over = Math.max(0, over - 1);
        if (over === 0) setDropping(false);
      };
      // A drop the page does not take would open the file in the window.
      const onDrop = (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        over = 0;
        setDropping(false);
        const { images, others } = droppedFiles(event.dataTransfer?.files ?? []);
        if (images.length > 0) attach(images, others.length > 0 ? ONLY_IMAGES : null);
        else setError(ONLY_IMAGES);
      };
      area.addEventListener('paste', onPaste, true);
      area.addEventListener('dragenter', onDragEnter);
      area.addEventListener('dragover', onDragOver);
      area.addEventListener('dragleave', onDragLeave);
      area.addEventListener('drop', onDrop);
      unlisten = () => {
        area.removeEventListener('paste', onPaste, true);
        area.removeEventListener('dragenter', onDragEnter);
        area.removeEventListener('dragover', onDragOver);
        area.removeEventListener('dragleave', onDragLeave);
        area.removeEventListener('drop', onDrop);
      };
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
      unlisten();
      observer?.disconnect();
      events?.close();
      term?.dispose();
      if (id) void toTerminal(id, 'close', {}).catch(() => {});
      told.current.onOpened(null);
    };
  }, [branch, url]);

  return (
    <div ref={root} className="agent-terminal">
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
      {dropping && (
        <p className="terminal-drop">
          <ImageIcon />
          Drop to attach
        </p>
      )}
    </div>
  );
}
