// The folders' listings and repositories' checkouts the nexus page reads (decisions 914, 916):
// kept with when they were read, read again once old, the page drawn again when one comes.
import type { Folder, FoldersAnswer } from '../folders.js';
import type { Pin } from '../pins.js';
import type { Found } from '../scan.js';
import type { PageState } from './state.js';

/** How long a folder's listing or a repository's checkouts are taken as they were read. */
const FRESH_FOR = 10_000;

/** The listings' reads over the page's state; `render` draws the page again when one comes. */
export function listingReads(state: PageState, render: () => void) {
  /** Folders' listings and repositories' checkouts read, with when. */
  const listings = new Map<string, { answer: FoldersAnswer | { error: string }; at: number }>();

  const checkoutsRead = new Map<string, { checkouts: Found[] | null; at: number }>();

  const reading = new Set<string>();

  /**
   * A folder's folders as its listing read them (a folder of the tree the scan did not read, opened):
   * undefined until read. Never asks: `readOpened` does, for the opened ones.
   */
  function folderListing(path: string): Folder[] | undefined {
    const read = listings.get(path)?.answer;
    return read && !('error' in read) && read.path === path ? read.folders : undefined;
  }

  /** The folders listings read, by path: whether each is a repository, for the tree's rows. */
  function listedFolders(): Map<string, Folder> {
    const out = new Map<string, Folder>();
    for (const path of state.openFolders) {
      for (const folder of folderListing(path) ?? []) out.set(folder.path, folder);
    }
    return out;
  }

  /** The tree's opened folders the scan did not read: listed now (a folder, never deeper, 916). */
  function readOpened(): void {
    if (!state.tree) return;
    const read = new Set(state.tree.all);
    for (const path of state.openFolders) {
      if (!read.has(path) || state.tree.unread.has(path)) listingOf(path);
    }
  }

  /** A folder's listing as read (and read again once old); null while it is read. */
  function listingOf(folder: string): FoldersAnswer | { error: string } | null {
    const read = listings.get(folder);
    if (!read || Date.now() - read.at > FRESH_FOR) void readListing(folder);
    return read?.answer ?? null;
  }

  async function readListing(folder: string): Promise<void> {
    const key = `list ${folder}`;
    if (reading.has(key)) return;
    reading.add(key);
    try {
      const res = await fetch(`/api/folders?path=${encodeURIComponent(folder)}`, {
        cache: 'no-store',
      });
      const answer = (await res.json()) as (FoldersAnswer & { pinned?: Pin[] }) | { error: string };
      listings.set(folder, { answer, at: Date.now() });
    } catch (error) {
      listings.set(folder, { answer: { error: (error as Error).message }, at: Date.now() });
    } finally {
      reading.delete(key);
    }
    render();
  }

  /** A repository's checkouts as read (and read again once old); undefined while they are read. */
  function checkoutsOf(path: string): Found[] | null | undefined {
    const read = checkoutsRead.get(path);
    if (!read || Date.now() - read.at > FRESH_FOR) void readCheckouts(path);
    return read?.checkouts;
  }

  async function readCheckouts(path: string): Promise<void> {
    const key = `checkouts ${path}`;
    if (reading.has(key)) return;
    reading.add(key);
    try {
      const res = await fetch(`/api/checkouts?path=${encodeURIComponent(path)}`, {
        cache: 'no-store',
      });
      const checkouts = res.ok ? ((await res.json()) as { checkouts: Found[] }).checkouts : null;
      checkoutsRead.set(path, { checkouts, at: Date.now() });
    } catch {
      checkoutsRead.set(path, { checkouts: null, at: Date.now() });
    } finally {
      reading.delete(key);
    }
    render();
  }

  /** The entries of a folder as the card lists them; undefined while read, null when unreadable. */
  function entriesOf(folder: string): Folder[] | null | undefined {
    const read = listingOf(folder);
    if (!read) return undefined;
    if ('error' in read || read.path !== folder) return null;
    return read.folders;
  }
  return { folderListing, listedFolders, readOpened, listingOf, checkoutsOf, entriesOf };
}

export type Listings = ReturnType<typeof listingReads>;
