import { createContext, useContext } from 'react';
import type { Route } from './pages.js';

/** What the status bar says after an action: a start, a checkout, a copy, an error. */
export interface Notice {
  text: string;
  warning?: string;
  /** Text the person may copy from it: a workspace's prompt when no agent took it (V18). */
  copy?: string;
  /** Said as an error (`role="alert"`). */
  error?: boolean;
}

/** What the shell (V29a) gives the pages it shows, and a diff's page under `cpr view`. */
/** What a page asks before it is left with something not saved (CPR's own dialog, N1c). */
export interface LeaveGuard {
  question: string;
  detail: string;
}

export interface Shell {
  /** What the main area shows; null on a diff's page, which is no route of the shell's. */
  route: Route | null;
  /** Shows a route in the main area, in place, with a new history entry (or `replace`). */
  navigate(route: Route, options?: { replace?: boolean }): void;
  /** Says something in the status bar; null clears it. */
  notify(notice: Notice | null): void;
  /** Opens "Start a workspace" (`/start`, V30a): at a commit, or at the default branch's tip. */
  startWorkspace(sha?: string): void;
  /**
   * What to ask before the main area shows something else (unsaved changes), or null: the page
   * is left in place, so the browser's own question on leaving does not come.
   */
  setLeaveGuard: (guard: LeaveGuard | null) => void;
}

export const ShellContext = createContext<Shell | null>(null);

/** The shell the page is shown in; null outside it (a diff's page, `cpr pr`). */
export function useShell(): Shell | null {
  return useContext(ShellContext);
}
