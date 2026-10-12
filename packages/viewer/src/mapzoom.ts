/** Below this zoom the canvas is a map: file and project names readable, symbols as blocks. */
export const MAP_ZOOM = 0.45;

/** The map's labels: the only elements that read `--cpr-zoom` (see styles.css). */
const LABELS = '.file-name, .project-frame, .project-name';

/** The zoom to write for the map's labels, or nothing: off the map no label reads it. */
export function nextMapZoom(zoom: number, written: number | undefined): number | undefined {
  return zoom < MAP_ZOOM && zoom !== written ? zoom : undefined;
}

/**
 * Keeps the zoom where the map's labels read it: a stylesheet rule aimed at them. On the page
 * root, the variable restyled every element on every zoom frame (12,788 on a large map, V8a).
 */
export function mapZoomStyle(doc: Document): { update(zoom: number): void; remove(): void } {
  const style = doc.createElement('style');
  style.textContent = `${LABELS} { --cpr-zoom: 1; }`;
  doc.head.append(style);
  const rule = style.sheet?.cssRules[0];
  let written: number | undefined;
  return {
    update(zoom) {
      const next = nextMapZoom(zoom, written);
      if (next === undefined || !(rule instanceof CSSStyleRule)) return;
      rule.style.setProperty('--cpr-zoom', String(next));
      written = next;
    },
    remove: () => style.remove(),
  };
}
