/** What the app was started for. */
export interface AppArgs {
  /** The address of the CPR server to show (`cpr view` passes it). */
  url?: string;
  /** The window's title until the page sets its own. */
  title?: string;
}

/**
 * Reads the app's arguments: `--url <address>` and `--title <text>`, either form. Anything else
 * (Chromium's own switches) is left alone. Only a CPR server on this machine is shown: an
 * address that is not `http` on 127.0.0.1 or localhost is dropped.
 */
export function parseAppArgs(argv: readonly string[]): AppArgs {
  const args: AppArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? split(arg) : [arg];
    if (name !== '--url' && name !== '--title') continue;
    const value = inline ?? argv[++i];
    if (value === undefined) break;
    if (name === '--title') args.title = value;
    else if (isLocalServer(value)) args.url = value;
  }
  return args;
}

function split(arg: string): [string, string] {
  const at = arg.indexOf('=');
  return [arg.slice(0, at), arg.slice(at + 1)];
}

function isLocalServer(value: string): boolean {
  const url = parse(value);
  return (
    url?.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  );
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Whether `target` loads in the window that shows `home`: the same server's pages only. */
export function staysInWindow(target: string, home: string): boolean {
  const url = parse(target);
  return url !== null && url.origin !== 'null' && url.origin === parse(home)?.origin;
}

/** The address handed to the default browser for a link that leaves CPR: web addresses only. */
export function outsideAddress(target: string): string | null {
  const url = parse(target);
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
}

/** A key as Electron's `before-input-event` reports it. */
export interface KeyInput {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export type KeyAction = 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'devtools';

/**
 * The app's own keys, taken before the page sees them: zoom and the inspector. Everything else
 * goes to the page first (the preload handles back, forward and reload where the page leaves
 * them): the agent's terminal needs Ctrl+R and Alt+arrows.
 */
export function keyAction(input: KeyInput, platform: NodeJS.Platform): KeyAction | null {
  if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return null;
  const mac = platform === 'darwin';
  const mod = mac ? input.meta : input.control;
  const other = mac ? input.control : input.meta;
  const isI = input.key.toLowerCase() === 'i' || input.code === 'KeyI';
  if (input.key === 'F12' && !mod && !other) return 'devtools';
  if (mac ? input.meta && input.alt && isI : input.control && input.shift && isI && !input.alt) {
    return 'devtools';
  }
  if (!mod || other || input.alt) return null;
  if (input.key === '=' || input.key === '+') return 'zoom-in';
  if (input.key === '-') return 'zoom-out';
  if (input.key === '0') return 'zoom-reset';
  return null;
}

/** What Electron's `context-menu` event says about the place clicked. */
export interface ContextParams {
  isEditable: boolean;
  selectionText: string;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export type ContextRole = 'cut' | 'copy' | 'paste' | 'selectAll' | 'separator';

/** A right click's menu: what text can do there, and nothing where there is no text. */
export function contextMenuRoles({
  isEditable,
  selectionText,
  editFlags,
}: ContextParams): ContextRole[] {
  if (!isEditable) return selectionText.trim() !== '' && editFlags.canCopy ? ['copy'] : [];
  const roles: ContextRole[] = [];
  if (editFlags.canCut) roles.push('cut');
  if (editFlags.canCopy) roles.push('copy');
  if (editFlags.canPaste) roles.push('paste');
  if (editFlags.canSelectAll)
    roles.push(...(roles.length > 0 ? ['separator' as const] : []), 'selectAll');
  return roles;
}
