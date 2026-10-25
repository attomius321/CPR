import { useEffect, useRef, useState } from 'react';
import type { IBufferRange, ILink, Terminal } from '@xterm/xterm';
import type { WorkspaceTerminalOpened } from '@symbiote/core';
import { fileBase64, postJson } from '../ui/http.js';
import { ImageIcon } from '../ui/icons.js';
import {
  cellRange,
  droppedFiles,
  followsLink,
  IMAGE_ACCEPT,
  isPasteKey,
  keySender,
  lineText,
  linkHint,
  linkTarget,
  MAX_IMAGE_BYTES,
  pastedImages,
  terminalLinks,
  TERMINAL_THEME,
  TERMINAL_FONT,
  TERMINAL_FONT_SIZE,
  wrappedRows,
  type LinkTarget,
} from './terminal.js';
import { holdReads } from './useWorkspaces.js';
import { tip } from '../ui/tip.js';

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-symbiote': '1' };
/** Where ⌘V pastes and Ctrl+V stays the agent's (V36). */
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const ONLY_IMAGES = 'Only images can be attached: PNG, JPEG, GIF or WebP.';
/** A printed path the server did not find is asked about again after this (V38): it may be new. */
const RECHECK_MS = 5_000;
/** Most paths asked about at once: the server's limit. */
const MAX_PATHS = 50;
/** The style's tooltip: shown once the pointer stays (V38), not while it crosses the screen. */
const HINT_DELAY_MS = 400;

/** The hint over a link (V38): what it opens and its keys, by the pointer, above its row. */
interface Hint {
  what: string;
  keys: string;
  top: number;
  /** From the terminal's left edge, or its right one when the pointer is in its right half. */
  left?: number;
  right?: number;
  below: boolean;
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

/**
 * An open terminal: its ID, to type into it, a way to give it the keys again, and files to attach
 * as a drop does (the images; anything else is said), the keys given back after.
 */
export interface OpenedTerminal {
  id: string;
  focus(): void;
  attach(files: File[]): void;
}

/** The size the last terminal drawn was fitted to: a new shell opens at it (V45). */
let lastSize = { cols: 80, rows: 24 };
export const lastTerminalSize = (): { cols: number; rows: number } => lastSize;

/**
 * A workspace's agent session as its agent draws it: `claude attach` (V21), or Codex's TUI joined
 * to its app server (V27b), on the server in a pseudo-terminal, drawn by xterm.js (its own chunk,
 * loaded when a terminal first opens) and fitted to its box. The agent keeps hosting the session:
 * closing this hangs up only the client. While it is open the list is read every 5 s, since what
 * is typed here may start a turn. `onOpened` gives the open terminal (to type into it), `onEnded`
 * says it ended. `url`: where it is opened — a workspace's (`branch`), or Scout's (V35). An image
 * pasted (Ctrl+V too, off macOS), dropped or given to `attach` (`AttachImages`) is saved by the
 * server and its path pasted, which the agent attaches to the message being typed (V36). A path it prints to a file in its folder, a web
 * address and its own links (OSC 8) are links: Ctrl+click (⌘ on macOS) opens the file in VS Code
 * at the line printed, or the address in a new tab (V38). `id`: a terminal already open, read and
 * typed into as it is (a workspace's shell, V45): leaving does not close it, and the list is not
 * read more often for it.
 */
export function AgentTerminal({
  branch,
  url = '/api/workspaces/terminal',
  id: kept,
  onOpened = () => {},
  onEnded,
}: {
  branch?: string;
  url?: string;
  id?: string;
  onOpened?: (opened: OpenedTerminal | null) => void;
  onEnded: (why: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [trust, setTrust] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);
  // The latest callbacks, without opening the terminal again when they change.
  const told = useRef({ onOpened, onEnded });
  told.current = { onOpened, onEnded };

  useEffect(() => {
    const release = kept === undefined ? holdReads() : () => {};
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
        document.fonts.load(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT}`),
      ]);
      const element = box.current;
      const area = root.current;
      if (gone || !element || !area) return;
      term = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: TERMINAL_FONT,
        fontSize: TERMINAL_FONT_SIZE,
        cursorBlink: true,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      lastSize = { cols: term.cols, rows: term.rows };
      const opened: WorkspaceTerminalOpened =
        kept === undefined
          ? await postJson<WorkspaceTerminalOpened>(url, {
              ...(branch === undefined ? {} : { branch }),
              cols: term.cols,
              rows: term.rows,
            })
          : { id: kept };
      setTrust(opened.trusted === false);
      if (gone) {
        if (kept === undefined) void toTerminal(opened.id, 'close', {}).catch(() => {});
        return;
      }
      // An open terminal was sized by whoever read it last: this box's size, then what it prints.
      if (kept !== undefined) {
        void toTerminal(kept, 'resize', { cols: term.cols, rows: term.rows }).catch(() => {});
      }
      const shown = term;
      const terminal = (id = opened.id);
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
                data: await fileBase64(image),
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
      // A drop's files, or a picker's: the images attached, anything else said.
      const give = (files: ArrayLike<File>) => {
        const { images, others } = droppedFiles(files);
        if (images.length > 0) attach(images, others.length > 0 ? ONLY_IMAGES : null);
        else setError(ONLY_IMAGES);
      };
      told.current.onOpened({
        id: terminal,
        focus: () => shown.focus(),
        attach: (files) => {
          give(files);
          shown.focus();
        },
      });
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
        give(event.dataTransfer?.files ?? []);
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
      // Paths and web addresses it prints (V38). Which paths are files of its folder, as the server
      // answered: kept, a path not found asked again after RECHECK_MS.
      const answers = new Map<string, { file: Promise<boolean>; at: number }>();
      const filesOf = async (paths: string[]): Promise<Set<string>> => {
        const now = Date.now();
        const ask = [...new Set(paths)]
          .filter((path) => {
            const known = answers.get(path);
            return !known || now - known.at > RECHECK_MS;
          })
          .slice(0, MAX_PATHS);
        if (ask.length > 0) {
          const asked = postJson<{ files: string[] }>(`/api/terminals/${terminal}/paths`, {
            paths: ask,
          }).then(({ files }) => new Set(files));
          for (const path of ask) {
            const file = asked.then((files) => files.has(path));
            // A file stays one; a failed answer is asked again.
            answers.set(path, { file, at: now });
            file.then(
              (yes) => yes && answers.set(path, { file, at: Infinity }),
              () => answers.delete(path),
            );
          }
        }
        const found = await Promise.all(
          paths.map((path) => answers.get(path)?.file.catch(() => false) ?? Promise.resolve(false)),
        );
        return new Set(paths.filter((_, i) => found[i]));
      };
      const follow = (target: LinkTarget) => {
        if (target.kind === 'web') {
          window.open(target.url, '_blank', 'noopener,noreferrer');
          return;
        }
        const { path, line, column } = target;
        toTerminal(terminal, 'open', {
          path,
          ...(line === undefined ? {} : { line }),
          ...(column === undefined ? {} : { column }),
        }).then(
          () => setError(null),
          (failed: unknown) => {
            if (!gone) setError((failed as Error).message);
          },
        );
      };
      let hinting: ReturnType<typeof setTimeout> | undefined;
      const showHint = (event: MouseEvent, target: LinkTarget, range: IBufferRange) => {
        const screen = element.querySelector('.xterm-screen');
        if (!screen) return;
        const frame = area.getBoundingClientRect();
        const drawn = screen.getBoundingClientRect();
        const row = range.start.y - 1 - shown.buffer.active.viewportY;
        const height = drawn.height / shown.rows;
        const top = drawn.top - frame.top + row * height;
        const x = event.clientX - frame.left;
        const below = top < 40;
        const next: Hint = {
          ...linkHint(target, MAC),
          top: below ? top + height + 4 : top - 4,
          below,
          ...(x < frame.width / 2 ? { left: x } : { right: frame.width - x }),
        };
        clearTimeout(hinting);
        hinting = setTimeout(() => setHint(next), HINT_DELAY_MS);
      };
      const hideHint = () => {
        clearTimeout(hinting);
        setHint(null);
      };
      // The agent's own links (OSC 8): files and web addresses, without xterm.js's confirm().
      shown.options.linkHandler = {
        allowNonHttpProtocols: true,
        activate: (event, uri) => {
          const target = linkTarget(uri);
          if (target && followsLink(event, MAC)) follow(target);
        },
        hover: (event, uri, range) => {
          const target = linkTarget(uri);
          if (target) showHint(event, target, range);
        },
        leave: hideHint,
      };
      const provider = shown.registerLinkProvider({
        provideLinks(y, callback) {
          const { first, rows } = wrappedRows(shown.buffer.active, y);
          const { text, at } = lineText(rows);
          const found = terminalLinks(text)
            .map((link) => ({ link, range: cellRange(at, link, first) }))
            .filter(({ range }) => range.start.y <= y && range.end.y >= y);
          const paths = found.flatMap(({ link }) => (link.kind === 'path' ? [link.path] : []));
          if (found.length === 0) {
            callback(undefined);
            return;
          }
          void filesOf(paths)
            .catch(() => new Set<string>())
            .then((files) => {
              const links = found
                .filter(({ link }) => link.kind === 'web' || files.has(link.path))
                .map(({ link, range }): ILink => ({
                  range,
                  text: text.slice(link.start, link.end),
                  decorations: { pointerCursor: true, underline: true },
                  activate: (event) => {
                    if (followsLink(event, MAC)) follow(link);
                  },
                  hover: (event) => showHint(event, link, range),
                  leave: hideHint,
                }));
              callback(links.length > 0 ? links : undefined);
            });
        },
      });
      const unlistenDrops = unlisten;
      unlisten = () => {
        unlistenDrops();
        provider.dispose();
        clearTimeout(hinting);
      };
      shown.onResize(({ cols, rows }) => {
        lastSize = { cols, rows };
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
      if (id && kept === undefined) void toTerminal(id, 'close', {}).catch(() => {});
      told.current.onOpened(null);
    };
  }, [branch, url, kept]);

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
      {hint && (
        <p
          className={`terminal-link-hint${hint.below ? ' below' : ''}`}
          role="tooltip"
          style={{ top: hint.top, left: hint.left, right: hint.right }}
        >
          <span>{hint.what}</span>
          <kbd>{hint.keys}</kbd>
        </p>
      )}
    </div>
  );
}

/**
 * Images for an open terminal's agent from the system's file picker, as a drop gives them. On WSL
 * no drop from Windows reaches Symbiote's window (WSLg has no drag and drop, microsoft/wslg#84),
 * and no file copied there: the picker reaches Windows' files under `/mnt`.
 */
export function AttachImages({ into }: { into: OpenedTerminal }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Attach images"
        {...tip('Attach images to the message\nPNG, JPEG, GIF or WebP')}
        onClick={() => input.current?.click()}
      >
        <ImageIcon />
      </button>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) into.attach(files);
          // The same file picked again is a change.
          event.target.value = '';
        }}
      />
    </>
  );
}
