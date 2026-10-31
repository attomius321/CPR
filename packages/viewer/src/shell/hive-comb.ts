// Hive's honeycomb as the app's background (V85, decisions 701–707): the arrival's shutter, kept.
// Its tiles' outlines as one SVG path (`combPath`, pure), and where its lattice is: the arrival's
// at the swap (`layComb`), else the window's middle. `HiveComb.tsx` draws it.
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

let laid: CombOrigin | null = null;
const listeners = new Set<() => void>();

/**
 * Lays the honeycomb on `origin`: the arrival's shutter's, so it opens onto the same tiles; `null`
 * forgets it (Hive off).
 */
export function layComb(origin: CombOrigin | null): void {
  if (origin === laid) return;
  laid = origin;
  for (const listener of listeners) listener();
}

/** Where the arrival laid the honeycomb; `null` before (it is then centred on the window). */
export const laidComb = (): CombOrigin | null => laid;

/** Calls `listener` when the honeycomb is laid anew; returns the unsubscribe. */
export function onComb(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
