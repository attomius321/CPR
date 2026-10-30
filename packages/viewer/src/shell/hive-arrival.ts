// Hive's arrival (decision 624): as Hive mode turns on, ink bursts from the question's hexagon and
// takes the window, the look changes under it, the ink thins away, the sidenav's tendrils grow
// from their roots and a streak of light crosses the main area; then all is still. The ink is
// drawn here (`FLOOD`), the rest is `hive.css` under `data-hive-arriving`; colours are the
// classes' (`hive-ink`: Hive's dark tokens before the page has them).
import { FLOOD, floodCover, hexagon, highlight, taper } from '../ui/hive-art.js';

const SVG = 'http://www.w3.org/2000/svg';

/** Where the ink starts: a point in the window, and the hexagon's radius there, in px. */
export interface Origin {
  x: number;
  y: number;
  r: number;
}

/** Whether the person asked for less motion: then the look changes at once. */
export const lessMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** The ink: its tendrils, glossy, under its hexagon, round (0, 0) of a layer over the window. */
function drawFlood(): { layer: SVGSVGElement; ink: SVGGElement } {
  const layer = svg('svg', { class: 'hive-flood hive-ink', 'aria-hidden': 'true' });
  const fill = 'url(#hive-flood-ink)';
  const gradient = svg('radialGradient', {
    id: 'hive-flood-ink',
    cx: 0,
    cy: 0,
    r: 280,
    gradientUnits: 'userSpaceOnUse',
  });
  for (const [offset, name] of [
    [0, 'hive-flood-heart'],
    [0.5, 'hive-ink-mid'],
    [1, 'hive-ink-deep'],
  ] as const) {
    gradient.append(svg('stop', { offset, class: name }));
  }
  const defs = svg('defs');
  defs.append(gradient);
  const ink = svg('g');
  for (const tendril of FLOOD.tendrils) {
    ink.append(
      svg('path', { class: 'hive-body', d: taper(tendril), fill }),
      svg('path', {
        class: 'hive-shine',
        d: highlight(tendril, { side: 0.3, from: 0.15, to: 0.75 }),
      }),
    );
  }
  ink.append(
    svg('path', { class: 'hive-flood-core', d: hexagon(0, 0, FLOOD.hexagon), fill }),
    svg('path', { class: 'hive-flood-line', d: hexagon(0, 0, FLOOD.hexagon * 0.55) }),
  );
  layer.append(defs, ink);
  return { layer, ink };
}

/** Whether `animation` is one of the arrival's in `hive.css` (`hive-arrive-*`). */
const isArrival = (animation: Animation) =>
  animation instanceof CSSAnimation && animation.animationName.startsWith('hive-arrive');

/**
 * The ink from `from` over the window; `swap` changes the look once it covers it (at once if the
 * ink cannot be drawn). Resolves once all is still.
 */
export async function arrive(from: Origin, swap: () => void): Promise<void> {
  const root = document.documentElement;
  const { layer, ink } = drawFlood();
  const cover = floodCover([from.x, from.y], window.innerWidth, window.innerHeight);
  const at = (scale: number, turn: number) =>
    `translate(${from.x}px, ${from.y}px) rotate(${turn}deg) scale(${scale})`;
  let swapped = false;
  try {
    document.body.append(layer);
    await ink.animate(
      [
        { transform: at(from.r / FLOOD.hexagon, 0), opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: at(cover, 28), opacity: 1 },
      ],
      { duration: 850, easing: 'cubic-bezier(0.6, 0, 0.3, 1)', fill: 'forwards' },
    ).finished;
    root.dataset.hiveArriving = '';
    swapped = true;
    swap();
    // It thins away still turning; the tendrils and the light come under it.
    ink.animate([{ transform: at(cover, 28) }, { transform: at(cover * 1.2, 36) }], {
      duration: 650,
      easing: 'ease-out',
      fill: 'forwards',
    });
    await layer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 650,
      easing: 'ease-out',
      fill: 'forwards',
    }).finished;
    await Promise.all(
      document
        .getAnimations()
        .filter(isArrival)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  } finally {
    layer.remove();
    delete root.dataset.hiveArriving;
    if (!swapped) swap();
  }
}
