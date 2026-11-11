import type { TextSize } from '../shell/text-size.js';

/** Below this zoom the canvas is a map: file and project names readable, symbols as blocks. */
export const MAP_ZOOM = 0.45;

/**
 * A symbol's name at zoom 1, in px: `.symbol-name` is the graph's `--size-caption`, which keeps
 * V32's 12 px inside `.react-flow` (`ui/base.css`, decision 438).
 */
export const NAME_PX = 12;

/** A name drawn smaller than this on screen is not read: a pick brings it closer (V99). */
const READABLE_PX = 11;

/** The person's body size for each of Settings' text sizes (`--size-body`, `ui/base.css`). */
const BODY_PX: Record<TextSize, number> = { compact: 14, default: 15, large: 16 };

/**
 * The reading zoom (V99, decision 967): a graph's names at the person's body size, 1.17, 1.25 or
 * 1.33. A pick that is not readable comes to it, and no fit (the first, Focus, a group's) comes
 * closer.
 */
export function readingZoom(size: TextSize): number {
  return BODY_PX[size] / NAME_PX;
}

/**
 * What a pick does to the view at `zoom` (V99, decision 966, amending 886): a name drawn under
 * 11 px comes to the reading zoom; a readable one stays where it is when it is `shown` whole, and
 * is panned to at the person's zoom when it is not.
 */
export function pickView(zoom: number, shown: boolean): 'stay' | 'pan' | 'zoom' {
  if (zoom * NAME_PX < READABLE_PX) return 'zoom';
  return shown ? 'stay' : 'pan';
}

/**
 * The map's labels: the only elements that read `--symbiote-zoom` (see map.css): the names, the
 * frames, and a symbol's findings count (V100, decision 970).
 */
export const MAP_LABELS = '.file-name, .project-frame, .project-name, .map-count';

/**
 * How long the zoom rests before the map's file names are cut to their boxes at it
 * (`--symbiote-cut`): a cut is laid out, so it is laid out once a zoom ends, not on each frame.
 */
export const CUT_REST_MS = 120;

/** The zoom to write for the map's labels, or nothing: off the map no label reads it. */
export function nextMapZoom(zoom: number, written: number | undefined): number | undefined {
  return zoom < MAP_ZOOM && zoom !== written ? zoom : undefined;
}

/**
 * Keeps the zoom where the map's labels read it: a stylesheet rule aimed at them. On the page
 * root, the variable restyled every element on every zoom frame (12,788 on a large map, V8a).
 * The zoom the file names are cut at follows once the zoom rests (`CUT_REST_MS`), at once on the
 * first look at the map: cut on every frame, the names took 1.1 ms of layout a frame on
 * Bitwarden's map (fix/hive-turn-end-flaky-tests-verdict).
 */
export function mapZoomStyle(doc: Document): { update(zoom: number): void; remove(): void } {
  const style = doc.createElement('style');
  style.textContent = `${MAP_LABELS} { --symbiote-zoom: 1; }`;
  doc.head.append(style);
  const rule = style.sheet?.cssRules[0];
  let written: number | undefined;
  let cut = false;
  let rest: ReturnType<typeof setTimeout> | undefined;
  return {
    update(zoom) {
      const next = nextMapZoom(zoom, written);
      if (next === undefined || !(rule instanceof CSSStyleRule)) return;
      rule.style.setProperty('--symbiote-zoom', String(next));
      written = next;
      clearTimeout(rest);
      const cutAt = () => rule.style.setProperty('--symbiote-cut', String(next));
      if (cut) rest = setTimeout(cutAt, CUT_REST_MS);
      else cutAt();
      cut = true;
    },
    remove: () => {
      clearTimeout(rest);
      style.remove();
    },
  };
}
