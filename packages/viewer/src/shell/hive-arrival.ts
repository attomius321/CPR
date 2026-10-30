// Hive's arrival (decision 632): as Hive mode turns on, the question's Hive Mind grows to the
// middle of the window while a blackout closes on it from every edge; the look changes under the
// cover, the Mind flares, and a boom from it tears the ink back to the edges. Then a streak of
// light crosses the main area; then all is still. The Mind and the blackout are drawn here
// (`hive-art.ts`, `hive-draw.ts`), the streak is `hive.css`'s under `data-hive-arriving`.
import { arrivalScale, arrivalScene } from '../ui/hive-art.js';
import { Painter, paint, readPalette } from '../ui/hive-draw.js';

/** Where the arrival starts: the question's Hive Mind, its middle in the window and its size. */
export interface Origin {
  x: number;
  y: number;
  /** The question's art's size against its drawing's (520 px wide). */
  scale: number;
}

/** Whether the person asked for less motion: then the look changes at once. */
export const lessMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Whether `animation` is one of the arrival's in `hive.css` (`hive-arrive-*`). */
const isArrival = (animation: Animation) =>
  animation instanceof CSSAnimation && animation.animationName.startsWith('hive-arrive');

/**
 * The Mind and the blackout from `from`; `swap` changes the look in the frame first drawn covering
 * the whole window, or at once if they cannot be drawn. Resolves once all is still.
 */
export async function arrive(from: Origin, swap: () => void): Promise<void> {
  const root = document.documentElement;
  let swapped = false;
  const canvas = document.createElement('canvas');
  canvas.className = 'hive-flood hive-art';
  canvas.setAttribute('aria-hidden', 'true');
  try {
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const painter = new Painter(readPalette(canvas));
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scene = arrivalScene({ width, height, at: [from.x, from.y], scale: from.scale });
    const scale = arrivalScale(width, height, window.devicePixelRatio || 1);
    canvas.dataset.moving = '';
    await new Promise<void>((resolve, reject) => {
      let last = performance.now();
      const frame = (now: number) => {
        try {
          scene.step(Math.min(0.05, (now - last) / 1000));
          last = now;
          paint(canvas, ctx, width, height, scale, (c) => painter.arrival(c, scene));
          if (scene.covered && !swapped) {
            // This frame covers the window: the look changes under it, shown with it.
            swapped = true;
            root.dataset.hiveArriving = '';
            swap();
          }
          if (scene.done) resolve();
          else requestAnimationFrame(frame);
        } catch (failed) {
          reject(failed instanceof Error ? failed : new Error(String(failed)));
        }
      };
      requestAnimationFrame(frame);
    });
    canvas.remove();
    await Promise.all(
      document
        .getAnimations()
        .filter(isArrival)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  } finally {
    canvas.remove();
    if (!swapped) swap();
    delete root.dataset.hiveArriving;
  }
}
