// The intro's run (V39), a chunk of its own: the engine, its rig and its images load only when it
// plays. The koi swim in and form the S (4.2 s), the drop's ring spreads (HOLD_MS), the overlay
// fades (FADE_MS) with the sound. Any key but a modifier, or a click, ends it at once.
import { KoiIntro, type KoiIntroAssets, type KoiRig } from './koi-intro.js';
import { endsIntro } from './intro.js';
import aux from './koi-aux.webp';
import bg from './koi-bg.webp';
import black from './koi-black.webp';
import caustics from './koi-caustics.webp';
import white from './koi-white.webp';
import rig from './koi-rig.json';

const ASSETS: KoiIntroAssets = { bg, white, black, aux, caustics };
/** The formed S stays this long: the drop's ring, and its sound. */
const HOLD_MS = 900;
/** The overlay's fade: `.intro[data-state='leaving']`'s transition. */
const FADE_MS = 450;
/** Whatever happens (a hidden tab stops its frames), the intro is gone by then. */
const LONGEST_MS = 12_000;
/** A lost WebGL context not back by then ends the intro (Chromium gives one back after 1 s). */
const RESTORE_MS = 2_000;

/**
 * Plays the intro in `overlay` (put up by `startIntro`) and removes it at the end. Without WebGL,
 * or an image failing, it is removed at once. Sound from the start: the app lets its window play
 * it; a browser plays it once the page may (after a click or a key on it).
 */
export function playIntro(overlay: HTMLElement): Promise<void> {
  return new Promise((done) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let intro: KoiIntro | null = null;
    let over = false;
    let again = true;
    const timers: number[] = [];

    const remove = () => {
      for (const timer of timers) window.clearTimeout(timer);
      intro?.destroy();
      overlay.remove();
      done();
    };
    const leave = (fade: boolean) => {
      if (over) return;
      over = true;
      window.removeEventListener('keydown', onKey, true);
      overlay.removeEventListener('pointerdown', onPointer);
      intro?.setSound(false);
      if (!fade || reduced) return remove();
      overlay.dataset.state = 'leaving';
      timers.push(window.setTimeout(remove, FADE_MS));
    };
    // The key that ends it does nothing else: the page beneath gets the next one.
    const onKey = (event: KeyboardEvent) => {
      if (!endsIntro(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      leave(true);
    };
    const onPointer = () => leave(true);
    window.addEventListener('keydown', onKey, true);
    overlay.addEventListener('pointerdown', onPointer);
    timers.push(window.setTimeout(() => leave(true), LONGEST_MS));

    /** The koi on a canvas of their own, from the start. */
    const start = () => {
      const canvas = document.createElement('canvas');
      overlay.append(canvas);
      let lost = false;
      // Chromium's GPU process, finding no GL, starts again in software and loses the contexts it
      // made, even before the engine listens (Xvfb, a VM). Taken, a context comes back a second
      // later: the koi start again then, on a new canvas, once; a second loss ends the intro.
      canvas.addEventListener(
        'webglcontextlost',
        (event) => {
          if (over) return;
          if (!again) return leave(false);
          again = false;
          lost = true;
          event.preventDefault();
          intro?.destroy();
          intro = null;
          overlay.dataset.state = 'loading';
          const late = window.setTimeout(() => leave(false), RESTORE_MS);
          timers.push(late);
          canvas.addEventListener('webglcontextrestored', () => {
            window.clearTimeout(late);
            canvas.remove();
            if (!over) start();
          });
        },
        { once: true },
      );
      KoiIntro.create(canvas, rig as KoiRig, ASSETS, {
        // Without Web Audio it plays silent; any other error ends it.
        onError: (error) => {
          if (error.code !== 'audio-unavailable') leave(false);
        },
      })
        .then(async (made) => {
          if (over || lost) return made.destroy();
          intro = made;
          intro.setSound(true);
          overlay.dataset.state = 'playing';
          await intro.play();
          if (over) return;
          overlay.dataset.state = 'formed';
          timers.push(window.setTimeout(() => leave(true), HOLD_MS));
        })
        .catch(() => {
          // A run given up for a lost context: the next one plays.
          if (!lost) leave(false);
        });
    };
    start();
  });
}
