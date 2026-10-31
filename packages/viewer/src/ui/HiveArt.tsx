import { useEffect, useRef } from 'react';
import { lessMotion } from '../shell/hive-arrival.js';
import { JOIN_SECONDS, questionScene, STILL_AT } from './hive-art.js';
import { Painter, paint, readPalette } from './hive-draw.js';

/**
 * Runs `frame` on each animation frame, at most `fps()` a second, while `going()`; the canvas
 * says `data-moving` meanwhile (tests read it). Returns what stops it.
 */
function animate(
  canvas: HTMLCanvasElement,
  frame: (seconds: number) => void,
  fps: () => number,
  going: () => boolean,
): () => void {
  canvas.dataset.moving = '';
  let last = performance.now();
  let id = 0;
  const stop = () => {
    cancelAnimationFrame(id);
    delete canvas.dataset.moving;
  };
  const tick = (now: number) => {
    if (now - last >= 1000 / fps() - 2) {
      frame(Math.min(0.05, (now - last) / 1000));
      last = now;
      if (!going()) return stop();
    }
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return stop;
}

/**
 * The Hive question's head (decisions 665, 666): a circuit board whose traces route in and land on
 * the Hive Mind as it boots, then carry packets in and orders out while the dialog is open: 60
 * frames a second for the join, 30 after, nothing once it closes. With reduced motion, the joined
 * board drawn once.
 */
export function HiveJoining() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const painter = new Painter(readPalette(canvas));
    const scene = questionScene();
    const draw = (t: number) =>
      paint(canvas, ctx, scene.width, scene.height, 1, (c) => painter.question(c, scene, t));
    if (lessMotion()) {
      draw(STILL_AT);
      return;
    }
    let t = 0;
    return animate(
      canvas,
      (seconds) => {
        t += seconds;
        draw(t);
      },
      () => (t < JOIN_SECONDS ? 60 : 30),
      () => true,
    );
  }, []);
  return <canvas ref={ref} className="hive-joining hive-art" aria-hidden="true" />;
}
