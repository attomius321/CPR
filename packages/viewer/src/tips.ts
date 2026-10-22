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
