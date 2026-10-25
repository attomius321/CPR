/** A box on the page, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far a help's tip keeps from its button, and from the window's edges. */
export const TIP_GAP = 6;
export const TIP_MARGIN = 8;

/**
 * Where a help's tip goes (V37): under its button, its left edge at the button's, kept
 * `TIP_MARGIN` inside the window; above the button when it does not fit under it and fits above
 * (or has more room there). Left-aligned rather than centred: a button near the main area's left
 * edge would otherwise put its tip over the sidenav.
 */
export function placeTip(
  button: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number; above: boolean } {
  const left = Math.max(TIP_MARGIN, Math.min(button.left, view.width - tip.width - TIP_MARGIN));
  const below = button.top + button.height + TIP_GAP;
  const roomBelow = view.height - TIP_MARGIN - below;
  const roomAbove = button.top - TIP_GAP - TIP_MARGIN;
  const above = tip.height > roomBelow && (tip.height <= roomAbove || roomAbove > roomBelow);
  const top = above ? Math.max(TIP_MARGIN, button.top - TIP_GAP - tip.height) : below;
  return { left, top, above };
}

/** Where a tooltip went: the side asked, or the other one when it did not fit there. */
export type PlacedSide = 'top' | 'bottom' | 'right' | 'left';

/**
 * Where a tooltip goes (V54): `TIP_GAP` off the side asked of its element, centred on the part of
 * the element in the window (a project frame's band can be wider than it) or, `start`, from the
 * element's left edge (a cut text's whole text, its letters over the cut ones); flipped to the
 * other side when it fits only there, or has more room there; kept `TIP_MARGIN` inside the window.
 */
export function placeTooltip(
  element: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  side: 'top' | 'bottom' | 'right' = 'top',
  align: 'center' | 'start' = 'center',
): { left: number; top: number; side: PlacedSide } {
  const within = (at: number, size: number, room: number) =>
    Math.max(TIP_MARGIN, Math.min(at, room - size - TIP_MARGIN));
  const middle = (from: number, size: number, room: number) => {
    const [start, end] = [Math.max(from, 0), Math.min(from + size, room)];
    return end > start ? (start + end) / 2 : from + size / 2;
  };
  if (side === 'right') {
    const right = element.left + element.width + TIP_GAP;
    const left = element.left - TIP_GAP - tip.width;
    const roomRight = view.width - TIP_MARGIN - right;
    const roomLeft = left + tip.width - TIP_MARGIN;
    const flip = tip.width > roomRight && (left >= TIP_MARGIN || roomLeft > roomRight);
    return {
      left: within(flip ? left : right, tip.width, view.width),
      top: within(
        middle(element.top, element.height, view.height) - tip.height / 2,
        tip.height,
        view.height,
      ),
      side: flip ? 'left' : 'right',
    };
  }
  const above = element.top - TIP_GAP - tip.height;
  const below = element.top + element.height + TIP_GAP;
  const roomAbove = element.top - TIP_GAP - TIP_MARGIN;
  const roomBelow = view.height - TIP_MARGIN - below;
  const fitsAbove = tip.height <= roomAbove;
  const fitsBelow = tip.height <= roomBelow;
  const onTop =
    side === 'top'
      ? fitsAbove || (!fitsBelow && roomAbove > roomBelow)
      : !fitsBelow && (fitsAbove || roomAbove > roomBelow);
  const left =
    align === 'start'
      ? element.left
      : middle(element.left, element.width, view.width) - tip.width / 2;
  return {
    left: within(left, tip.width, view.width),
    top: within(onTop ? above : below, tip.height, view.height),
    side: onTop ? 'top' : 'bottom',
  };
}
