// The folder typed in the list's field, in the address (NX2b's `#folders:<path>`, decision 626; a
// typed folder since NX5, decision 910): a reload keeps it. Pure: `main.ts` reads and writes it.

/**
 * The folder browsed in the address, `#folders:<path>` (Folders' tab before decision 626): a
 * Symbiote's tab is its root, always absolute.
 */
export const FOLDERS = 'folders';

/** The address's hash for Symbiotes with a folder browsed. */
export function foldersHash(path: string | null): string {
  return path === null ? '#folders' : `#folders:${encodeURIComponent(path)}`;
}

/** The folder browsed in the address's hash; null for none (or a Symbiote's tab). */
export function folderFromHash(hash: string): string | null {
  const text = /^#folders:(.+)$/.exec(hash)?.[1];
  if (text === undefined) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
