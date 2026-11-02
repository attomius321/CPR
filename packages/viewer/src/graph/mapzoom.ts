/** Below this zoom the canvas is a map: file and project names readable, symbols as blocks. */
export const MAP_ZOOM = 0.45;

/** The map's labels: the only elements that read `--symbiote-zoom` (see styles.css). */
const LABELS = '.file-name, .project-frame, .project-name';

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
  style.textContent = `${LABELS} { --symbiote-zoom: 1; }`;
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
