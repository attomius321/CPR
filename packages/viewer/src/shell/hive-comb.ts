// Hive's honeycomb as the app's background (V85, decisions 701–707): the arrival's shutter, kept.
// Its tiles' outlines as one SVG path (`combPath`, pure), and where its lattice is: the arrival's
// at the swap (`layComb`), else the window's middle as the tab first drew it. Kept for the tab
// (`sessionStorage`), so a page opened from another (a commit's review is a new document) or a
// reload draws the same tiles: nothing moves under the person's eyes. `HiveComb.tsx` draws it.
import type { Point } from '../ui/hive-art.js';

/** How far inside its tile a hexagon is etched, in px: the shutter's (`hive-draw.ts`). */
export const ETCH_INSET = 1.5;

/** The tiles' outlines, each a hexagon a point up `ETCH_INSET` inside its tile, as one path. */
export function combPath(centres: readonly Point[], r: number): string {
  const e = r - ETCH_INSET;
  const corners = Array.from({ length: 6 }, (_, k) => {
    const a = ((k * 60 - 90) * Math.PI) / 180;
    return [e * Math.cos(a), e * Math.sin(a)] as const;
  });
  const n = (v: number) => Math.round(v * 100) / 100;
  return centres
    .map(
      ([x, y]) =>
        corners.map(([dx, dy], k) => `${k ? 'L' : 'M'}${n(x + dx)} ${n(y + dy)}`).join('') + 'Z',
    )
    .join('');
}

/** A lattice's centre and its tiles' radius, in the window's px. */
export interface CombOrigin {
  x: number;
  y: number;
  r: number;
}

/** Where the tab keeps its lattice (`sessionStorage`: this tab only, gone with it). */
export const COMB_KEY = 'symbiote.viewer.hive-comb';

/** The tab's lattice, if it has a whole one. Storage may be refused (a private window): none. */
function kept(): CombOrigin | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(COMB_KEY) ?? 'null') as Partial<CombOrigin>;
    const { x, y, r } = value ?? {};
    return [x, y, r].every((n) => typeof n === 'number' && Number.isFinite(n)) && r! > 0
      ? { x: x!, y: y!, r: r! }
      : null;
  } catch {
    return null;
  }
}

let laid: CombOrigin | null = kept();
const listeners = new Set<() => void>();

/**
 * Lays the honeycomb on `origin`: the arrival's shutter's, so it opens onto the same tiles; `null`
 * forgets it (Hive off).
 */
export function layComb(origin: CombOrigin | null): void {
  if (origin === laid) return;
  laid = origin;
  try {
    if (origin) sessionStorage.setItem(COMB_KEY, JSON.stringify(origin));
    else sessionStorage.removeItem(COMB_KEY);
  } catch {
    // Not kept: this document still draws it.
  }
  for (const listener of listeners) listener();
}

/** Where the honeycomb is laid for this tab; `null` before (it is then centred on the window). */
export const laidComb = (): CombOrigin | null => laid;

/** Calls `listener` when the honeycomb is laid anew; returns the unsubscribe. */
export function onComb(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
