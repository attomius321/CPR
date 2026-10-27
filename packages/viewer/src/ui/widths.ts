/**
 * Widths the person gave the panels; unset, the stylesheet's. The diff's review sidebar and
 * detail panel, the shell's sidenav and a workspace's changes (V34); the Monitor's list (RM1);
 * Git's details pane (V66b).
 */
export interface Widths {
  sidebar?: number;
  panel?: number;
  sidenav?: number;
  changes?: number;
  monitor?: number;
  /** Git's details pane, on the right (V66b). */
  details?: number;
}

export type Panel = keyof Widths;

const PANELS: readonly Panel[] = ['sidebar', 'panel', 'sidenav', 'changes', 'monitor', 'details'];

export const WIDTHS_KEY = 'symbiote.viewer.widths';

/** The widths in what storage holds, leaving out anything that is not one. */
export function readWidths(stored: string | null): Widths {
  let value: unknown;
  try {
    value = JSON.parse(stored ?? '{}');
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const widths: Widths = {};
  for (const panel of PANELS) {
    const width = (value as Record<string, unknown>)[panel];
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) widths[panel] = width;
  }
  return widths;
}

/** `widths` with one panel's width changed; null forgets it (the default again). */
export function withWidth(widths: Widths, panel: Panel, width: number | null): Widths {
  const next = { ...widths };
  if (width === null) delete next[panel];
  else next[panel] = width;
  return next;
}

/** Kept in this browser for every page: how wide panels read best is the person's. */
export function loadWidths(): Widths {
  try {
    return readWidths(window.localStorage.getItem(WIDTHS_KEY));
  } catch {
    return {};
  }
}

/**
 * Keeps one panel's width, merged into what is stored: the shell, a workspace and a diff each
 * write their own panels, and none overwrites another's.
 */
export function saveWidth(panel: Panel, width: number | null): void {
  try {
    const next = withWidth(loadWidths(), panel, width);
    window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the width lasts until the page closes.
  }
}
