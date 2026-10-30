// The nexus page's pure part (NX1b): its tabs from each read of the running Symbiotes, the open
// one in the address, the words, and (fix/nexus-pinned-symbiotes) Symbiotes' cards with the pins.
// The page's DOM is `main.ts`'s.
import type { Pin } from '../pins.js';
import type { Symbiote } from '../symbiotes.js';
import { FOLDERS } from './folders-tab.js';

/** A tab of the row: a Symbiote, running or stopped. A folder is one tab. */
export interface Tab {
  root: string;
  name: string;
  branch: string | null;
  head: string | null;
  changed: number;
  started: string;
  /** Where it serves; null once it stopped. */
  url: string | null;
}

const byName = (a: Tab, b: Tab) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root);

/**
 * The tabs after a read: one per running Symbiote, by name. One that stopped keeps its tab,
 * marked stopped, if it was opened (`opened`, by folder), until it is closed or serves again;
 * one never opened just leaves.
 */
export function nextTabs(
  previous: readonly Tab[],
  listed: readonly Symbiote[],
  opened: ReadonlySet<string>,
): Tab[] {
  const running = listed.map((s): Tab => ({
    root: s.root,
    name: s.name,
    branch: s.branch,
    head: s.head,
    changed: s.changed,
    started: s.started,
    url: s.url,
  }));
  const roots = new Set(running.map((tab) => tab.root));
  const stopped = previous
    .filter((tab) => !roots.has(tab.root) && opened.has(tab.root))
    .map((tab) => ({ ...tab, url: null }));
  return [...running, ...stopped].sort(byName);
}

/** The tabs without a stopped one: a running one stays, since the next read lists it again. */
export function closeTab(tabs: readonly Tab[], root: string): Tab[] {
  return tabs.filter((tab) => tab.root !== root || tab.url !== null);
}

/** The address's hash for the open tab: its folder; none for the list. */
export function hashOf(root: string | null): string {
  return root === null ? '' : `#${encodeURIComponent(root)}`;
}

/**
 * The open tab from the address's hash: a Symbiote's folder, or null for Symbiotes, the list, with
 * or without a folder browsed under it (`#folders:<path>`, Folders' address before decision 626).
 */
export function selectedFrom(hash: string): string | null {
  const text = hash.replace(/^#/, '');
  if (text === '' || text === FOLDERS || text.startsWith(`${FOLDERS}:`)) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** The window's title: the open Symbiote and its checkout, then the nexus. */
export function titleOf(tab: Tab | undefined): string {
  if (!tab) return 'Symbiote nexus';
  if (tab.url === null) return `${tab.name}, stopped — Symbiote nexus`;
  return `${tab.name} · ${checkoutText(tab)} — Symbiote nexus`;
}

/** What is checked out: the branch, the commit of a detached HEAD, or no commit yet. */
export function checkoutText(tab: Pick<Tab, 'branch' | 'head'>): string {
  if (tab.branch !== null) return tab.branch;
  return tab.head ? `detached at ${tab.head.slice(0, 7)}` : 'no commits';
}

/** The tracked files changed and not committed, as git counts them. */
export function changesText(changed: number): string {
  if (changed === 0) return 'no changes';
  return `${changed} ${changed === 1 ? 'file' : 'files'} changed`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** Since when a Symbiote runs: the time today, the day this year, else the date. */
export function sinceText(started: string, now: Date): string {
  const date = new Date(started);
  if (started === '' || Number.isNaN(date.getTime())) return '';
  const day = `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}`;
  if (date.getFullYear() !== now.getFullYear()) return `since ${day}, ${date.getFullYear()}`;
  if (date.getMonth() !== now.getMonth() || date.getDate() !== now.getDate()) {
    return `since ${day}`;
  }
  return `since ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** A card on Symbiotes (decision 627): a running Symbiote, pinned or not, or a pinned repository. */
export type SymbioteCard =
  { kind: 'running'; tab: Tab & { url: string }; pinned: boolean } | { kind: 'pinned'; pin: Pin };

/**
 * Symbiotes' cards: the pinned repositories first, in the order pinned, each a running Symbiote's
 * card while one serves it; then the other running Symbiotes, by name. A pinned folder, or a pin
 * whose folder is gone, is a place (decision 628).
 */
export function symbiotesShown(tabs: readonly Tab[], pins: readonly Pin[]): SymbioteCard[] {
  const running = tabs.filter((tab): tab is Tab & { url: string } => tab.url !== null);
  const pinned = pins.filter((pin) => pin.repository);
  const roots = new Set(pinned.map((pin) => pin.path));
  return [
    ...pinned.map((pin): SymbioteCard => {
      const tab = running.find((t) => t.root === pin.path);
      return tab ? { kind: 'running', tab, pinned: true } : { kind: 'pinned', pin };
    }),
    ...running
      .filter((tab) => !roots.has(tab.root))
      .map((tab): SymbioteCard => ({ kind: 'running', tab, pinned: false })),
  ];
}
