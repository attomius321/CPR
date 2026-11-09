// The text size (V87c, decision 763): Settings' Appearance moves the type scale a step either side
// of the default, for this browser; only the text, not the heights. index.html's inline script
// sets it before the first paint, as the theme (`theme.ts`); this module reads and changes it.
import { useSyncExternalStore } from 'react';
import { writeStored } from '../ui/stored.js';

export type TextSize = 'compact' | 'default' | 'large';

/** The choices, smallest first. */
export const TEXT_SIZES: readonly TextSize[] = ['compact', 'default', 'large'];

/** Where the choice is kept (index.html's script reads the same key; the app keeps it too). */
export const TEXT_SIZE_KEY = 'symbiote.viewer.text-size';

/** The size for what storage holds: the default unless compact or large was chosen. */
export function textSizeOf(stored: string | null | undefined): TextSize {
  return stored === 'compact' || stored === 'large' ? stored : 'default';
}

/** Marks <html> for `size`: `data-text-size`, absent for the default (`ui/base.css`). */
function mark(size: TextSize): void {
  const root = document.documentElement;
  if (size === 'default') delete root.dataset.textSize;
  else root.dataset.textSize = size;
}

const listeners = new Set<() => void>();

/** Shows `size` now and keeps it for this browser's next pages. */
export function setTextSize(size: TextSize): void {
  mark(size);
  writeStored(TEXT_SIZE_KEY, size);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Chosen in another tab: followed here.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TEXT_SIZE_KEY) return;
    mark(textSizeOf(event.newValue));
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const current = (): TextSize => textSizeOf(document.documentElement.dataset.textSize);

/** The text size shown, updated when the person changes it. */
export function useTextSize(): TextSize {
  return useSyncExternalStore(subscribe, current);
}
