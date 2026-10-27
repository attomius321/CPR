// What waits for the person (N2): counted once for the window's title and the app's icon. Pure.
import type { McpAsk, MergeEntry, ScoutState } from '@symbiote/core';
import { workspaceGroups } from '../workspaces/workspaces.js';
import type { WorkspacesState } from '../workspaces/useWorkspaces.js';
import { asksBy } from './asks.js';

/** What waits, by where the sidenav marks it. */
export interface Waiting {
  /** Workspaces in Waiting for you: a question, a permission, a plan to read. */
  workspaces: number;
  /** Merges that need the person: a question, a resolution to review, conflicts left. */
  merges: number;
  /** Scout: its own ask, or a dialog in its terminal (its link's amber band, V59). */
  scout: boolean;
  /** Scribe: a dialog in its terminal. */
  scribe: boolean;
  /** Asks of agents through `symbiote mcp` (MC1), in the ask bar; Scout's count as Scout. */
  asks: number;
}

type Read = Pick<WorkspacesState, 'list' | 'reviews' | 'merges' | 'scout' | 'scribe'>;

/** Whether Scout waits on the person: its ask on the page, or a dialog in its terminal (MC1). */
export const scoutWaiting = (scout: ScoutState | null, asks: readonly McpAsk[]): boolean =>
  asksBy(asks, 'scout') || scout?.conversation?.state === 'needs-you';

/** The merges that need the person: `needs-you`, whichever it is (`mergeLabel`). */
export const mergesWaiting = (merges: readonly MergeEntry[]): number =>
  merges.filter((entry) => entry.state === 'needs-you').length;

/** Whether Scribe waits on the person: a dialog in its terminal (V59). */
export const scribeWaiting = (scribe: ScoutState | null): boolean =>
  scribe?.conversation?.state === 'needs-you';

/** What waits for the person, from what the page read and the open asks. */
export function whatWaits(read: Read, asks: readonly McpAsk[]): Waiting {
  return {
    workspaces: workspaceGroups(read.list?.workspaces ?? [], read.reviews).waiting.length,
    merges: mergesWaiting(read.merges?.merges ?? []),
    scout: scoutWaiting(read.scout, asks),
    scribe: scribeWaiting(read.scribe),
    asks: asks.filter((ask) => ask.by.via === 'mcp').length,
  };
}

/** How many things wait: "(3) History · repo — Symbiote", and the dot on the app's icon. */
export const waitingCount = (waiting: Waiting): number =>
  waiting.workspaces +
  waiting.merges +
  (waiting.scout ? 1 : 0) +
  (waiting.scribe ? 1 : 0) +
  waiting.asks;
