import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, posix, win32 } from 'node:path';

/** The viewer's own choices, kept in the page's storage, that the app keeps across runs. */
export const CHOICES = [
  'cpr.viewer.theme',
  'cpr.viewer.sidenav',
  'cpr.viewer.sidenav.diff',
  'cpr.viewer.changes',
  'cpr.viewer.widths',
] as const;

/** How many recent repositories are kept. */
export const RECENT = 10;

/** Where the window was. */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** What the app remembers between runs (`<config>/app/state.json`). */
export interface AppState {
  window?: WindowState;
  /** Chromium's zoom level: 0 is 100 %, each step 20 %. */
  zoom?: number;
  /** Repositories opened from the app (N1b), the latest first. */
  recent?: string[];
  /**
   * The viewer's choices. Each run's server has a port of its own, so a new origin with empty
   * storage: the app puts them back before the page's scripts run.
   */
  choices: Record<string, string>;
}

/** CPR's folder for settings on this system. */
export function configDir(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  home: string,
): string {
  if (platform === 'win32') {
    return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), 'cpr');
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'cpr');
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, '.config'), 'cpr');
}

/** The remembered state; a missing, broken or foreign file reads as nothing remembered. */
export function readState(file: string): AppState {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { choices: {} };
  }
  if (!isRecord(value)) return { choices: {} };
  const window = readWindow(value.window);
  const zoom = value.zoom;
  const recent = Array.isArray(value.recent)
    ? value.recent
        .filter((repo): repo is string => typeof repo === 'string' && repo.startsWith('/'))
        .slice(0, RECENT)
    : [];
  return {
    ...(window ? { window } : {}),
    ...(typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= -8 && zoom <= 9
      ? { zoom }
      : {}),
    ...(recent.length > 0 ? { recent } : {}),
    choices: readChoices(value.choices),
  };
}

/** Writes the state whole: a new file renamed over the old, so a reader never sees half. */
export function writeState(file: string, state: AppState): void {
  mkdirSync(dirname(file), { recursive: true });
  const next = `${file}.${process.pid}.tmp`;
  writeFileSync(next, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(next, file);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isSize = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 20_000;
const isPlace = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 100_000;

function readWindow(value: unknown): WindowState | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, width, height, maximized } = value;
  if (!isSize(width) || !isSize(height) || typeof maximized !== 'boolean') return undefined;
  const placed = isPlace(x) && isPlace(y);
  return {
    ...(placed ? { x: x as number, y: y as number } : {}),
    width: width as number,
    height: height as number,
    maximized,
  };
}

/** The viewer's choices in `value`: known keys with text only. */
export function readChoices(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const choices: Record<string, string> = {};
  for (const key of CHOICES) {
    const choice = value[key];
    if (typeof choice === 'string' && choice.length <= 4096) choices[key] = choice;
  }
  return choices;
}

/** A screen's area for windows. */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FIRST = { width: 1440, height: 900 };

/**
 * Where the window opens: where it was, if enough of it is still on a screen; else centred on
 * the main screen, with its size (1440×900 the first time), never larger than the screen.
 */
export function placeWindow(
  saved: WindowState | undefined,
  areas: readonly Area[],
  primary: Area,
): Required<WindowState> {
  const maximized = saved?.maximized ?? false;
  if (saved?.x !== undefined && saved.y !== undefined) {
    const placed = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
    if (areas.some((area) => overlap(placed, area))) return { ...placed, maximized };
  }
  const width = Math.min(saved?.width ?? FIRST.width, primary.width);
  const height = Math.min(saved?.height ?? FIRST.height, primary.height);
  return {
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
    maximized,
  };
}

/** Enough of the window on the area to grab it: 100×50 px. */
function overlap(window: Area, area: Area): boolean {
  const width = Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x);
  const height =
    Math.min(window.y + window.height, area.y + area.height) - Math.max(window.y, area.y);
  return width >= 100 && height >= 50;
}
