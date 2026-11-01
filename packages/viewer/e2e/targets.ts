// WCAG 2.2's 2.5.8 Target Size (Minimum), level AA (V87b, decision 766): a target is 24 × 24 CSS px,
// or, undersized, a 24 px circle on its box's centre meets no other target and no other undersized
// target's circle. A target is undersized when no 24 × 24 square fits in it: a 300 × 22 px row is.
// https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

/** A target's box on the page, and a name to report it by. */
export interface Target {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The size the criterion asks for. */
export const TARGET = 24;
/** Boxes are fractional: half a pixel is the page's rounding, not a smaller target. */
const SLACK = 0.5;

const undersized = (t: Target) => t.width < TARGET - SLACK || t.height < TARGET - SLACK;
const centre = (t: Target) => [t.x + t.width / 2, t.y + t.height / 2] as const;

/** How far a point is from a box (0 inside it). */
function distance(x: number, y: number, box: Target): number {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
  const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/** The targets that fail 2.5.8: undersized and too near another, named with their sizes. */
export function crowded(targets: readonly Target[]): string[] {
  const small = targets.filter(undersized);
  return small
    .filter((target) => {
      const [x, y] = centre(target);
      const nearTarget = targets.some(
        (other) => other !== target && distance(x, y, other) < TARGET / 2 - SLACK,
      );
      const nearCircle = small.some((other) => {
        if (other === target) return false;
        const [ox, oy] = centre(other);
        return Math.hypot(x - ox, y - oy) < TARGET - SLACK;
      });
      return nearTarget || nearCircle;
    })
    .map((t) => `${t.name} (${Math.round(t.width)} × ${Math.round(t.height)})`);
}

/**
 * The page's pointer targets, run in the page (`page.evaluate(collectTargets)`): buttons, links,
 * fields, tabs, options, menu items and rows that take a click. Not targets here: what is hidden,
 * disabled or off screen; a link inside a sentence (2.5.8's inline exception); the graph's canvas
 * and the Monitor's map, whose sizes are the content's and zoom (its essential exception); a
 * terminal, which draws its own. A field inside a label is the label: a click on it is the field's.
 * Two exceptions named: a line number's button is as tall as its code's line (2.5.8's inline
 * exception: "constrained by the line-height of non-target text"), and a sidenav card's name is the
 * card's own button (its equivalent exception: a click anywhere on the card does the same).
 */
export function collectTargets(): Target[] {
  const SELECTOR = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="radio"]',
    '[role="link"]',
    '[role="treeitem"]',
  ].join(', ');
  const SKIP = '.react-flow, .xterm, .monitor-map, [inert], [aria-hidden="true"]';
  const EXCEPTED = '.ln-open, .workspace-row .workspace-about';
  const seen = new Set<Element>();
  const found: Target[] = [];
  /** In a sentence: its parent has words of its own beside it. */
  const inline = (element: Element) =>
    element.tagName === 'A' &&
    [...(element.parentElement?.childNodes ?? [])].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0,
    );
  // A row that takes a click has no role (Git's commits are elements with a handler): the pointer
  // it shows says so. The outermost of a chain of them is the target.
  const pointer = (element: Element) => getComputedStyle(element).cursor === 'pointer';
  const clickable = [...document.body.querySelectorAll('*')].filter(
    (element) =>
      !element.matches(SELECTOR) &&
      pointer(element) &&
      !(element.parentElement && pointer(element.parentElement)),
  );
  for (const element of [...document.querySelectorAll(SELECTOR), ...clickable]) {
    if (element.closest(SKIP) || element.matches(EXCEPTED) || inline(element)) continue;
    if (element.matches(':disabled, [aria-disabled="true"]')) continue;
    const target = element.closest('label') ?? element;
    if (seen.has(target)) continue;
    seen.add(target);
    const style = getComputedStyle(target);
    if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
    const box = target.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    if (box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth)
      continue;
    // Under another layer (a dialog's backdrop, a pane over it): not a target now.
    const hit = document.elementFromPoint(
      Math.min(Math.max(box.x + box.width / 2, 0), innerWidth - 1),
      Math.min(Math.max(box.y + box.height / 2, 0), innerHeight - 1),
    );
    if (hit && !target.contains(hit) && !hit.contains(target)) continue;
    const label =
      target.getAttribute('aria-label') ??
      (target.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
    const classes = typeof target.className === 'string' ? target.className.trim() : '';
    found.push({
      name: `${target.tagName.toLowerCase()}${classes ? `.${classes.split(/\s+/).join('.')}` : ''} "${label}"`,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }
  return found;
}
