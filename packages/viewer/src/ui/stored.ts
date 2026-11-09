// A person's choice kept in this browser (a fold, Focus, the theme): `localStorage`, which a
// browser may block (it throws then, even on reading `window.localStorage`) and the unit tests'
// Node does not have.

/** The choice kept under `key`, or null: never kept, blocked, or no browser. */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps `value` under `key`; where storage is blocked the choice lasts until the page closes. */
export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: nothing is kept.
  }
}
