// Hive's arrival (V92, decision 874; supersedes 816, replaces 632's and 673's shutter): 1.4 s, as
// spikes/hive-redesign's README times it — the question's steps arm (0–0.42 s), the question folds
// into its Mind (0.39–0.53 s), Hive's look opens from it in a growing circle behind a crimson ring
// (0.56–1.18 s), the Hive pill lights (1.16–1.54 s). One View Transition carries it: the page
// before and after are its old and new root, the new one revealed through one clip-path; the
// question, its dim, the Mind, its glow and the ring are layers of their own, each moved by
// opacity and transform only (`ui/hive.css`), and nothing blurs while they move (decision 631).
// Without View Transitions the look changes at once; with reduced motion too.

/** Whether the person asked for less motion: then the look changes at once. */
export const lessMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The Mind's size, a square of the art's middle (the prototype's 128 px). */
const MIND = 128;
/**
 * The ring's own size, scaled to the circle's: a small layer, as one the window's size scaled each
 * frame lost 3-5 frames of the reveal in software, 480 px none (V92, measured in the app).
 */
const RING = 480;
/** The arrival's end: the pill's light, the last step (1.16 + 0.38 s). */
export const ARRIVAL_MS = 1540;

/** A layer of the arrival over the page, centred on the art's middle. */
function layer(className: string, x: number, y: number, size: number): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');
  element.style.left = `${x - size / 2}px`;
  element.style.top = `${y - size / 2}px`;
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  return element;
}

/** The art's middle copied once into a canvas of its own: the Mind that lifts out of it. */
function mindOf(art: HTMLCanvasElement, rect: DOMRect, x: number, y: number): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const mind = document.createElement('canvas');
  mind.className = 'hive-arrival-mind';
  mind.setAttribute('aria-hidden', 'true');
  mind.width = Math.round(MIND * dpr);
  mind.height = Math.round(MIND * dpr);
  mind.style.left = `${x - MIND / 2}px`;
  mind.style.top = `${y - MIND / 2}px`;
  // The art's own pixels per CSS pixel: it is drawn at its scene's size and stretched.
  const sx = art.width / rect.width;
  const sy = art.height / rect.height;
  mind
    .getContext('2d')
    ?.drawImage(
      art,
      (rect.width / 2 - MIND / 2) * sx,
      (rect.height / 2 - MIND / 2) * sy,
      MIND * sx,
      MIND * sy,
      0,
      0,
      mind.width,
      mind.height,
    );
  return mind;
}

/**
 * Hive's look arrives from the question (`.hq`): `swap` changes the look inside the transition,
 * the question kept until it is no longer drawn; `close` takes the question away then. Resolves
 * once all is still. Without the question, View Transitions or motion: swaps and closes at once.
 */
export async function arrive(swap: () => void, close: () => void): Promise<void> {
  const root = document.documentElement;
  const question = document.querySelector<HTMLElement>('.hq');
  const art = question?.querySelector<HTMLCanvasElement>('canvas.hive-joining');
  if (!question || !art || !document.startViewTransition || lessMotion()) {
    swap();
    close();
    return;
  }
  const rect = art.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  root.style.setProperty('--hive-mx', `${x}px`);
  root.style.setProperty('--hive-my', `${y}px`);
  // The circle's last radius: from the Mind to the window's farthest corner.
  const reach = Math.ceil(
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)),
  );
  root.style.setProperty('--hive-reach', `${reach}px`);
  root.style.setProperty('--hive-ring', String((reach * 2) / RING));
  const layers: HTMLElement[] = [];
  // The transition's own rules (`ui/hive.css`), from its first frame.
  root.dataset.hiveArrival = '';
  const transition = document.startViewTransition(() => {
    swap();
    // The question's steps arm from now, live in its own layer.
    question.classList.add('arming');
    layers.push(
      layer('hive-arrival-ring', x, y, RING),
      layer('hive-arrival-glow', x, y, MIND * 2),
      mindOf(art, rect, x, y),
    );
    document.body.append(...layers);
  });
  try {
    await transition.ready;
    root.dataset.hiveArriving = '';
    // The pill lights after the circle (1.16–1.54 s): its animation, then the transition's.
    const pill = [...document.querySelectorAll<HTMLElement>('.hive-pill')].flatMap((p) =>
      p.getAnimations({ subtree: true }),
    );
    await Promise.all([transition.finished, ...pill.map((a) => a.finished.catch(() => {}))]);
  } catch {
    // Skipped (the page hidden, another transition): the look has changed all the same.
  } finally {
    for (const element of layers) element.remove();
    question.classList.remove('arming');
    close();
    delete root.dataset.hiveArriving;
    delete root.dataset.hiveArrival;
    for (const name of ['--hive-mx', '--hive-my', '--hive-reach', '--hive-ring'])
      root.style.removeProperty(name);
  }
}
