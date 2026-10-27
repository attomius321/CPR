/**
 * The dot on the window's icon while something waits for the person (N2): the viewer's amber of
 * Waiting for you (`--warning`), in a ring of its `--bg` that stands it off the S. At the icon's
 * top-right: WSLg blends its own mark over the bottom-right quarter. Its centre and sizes are
 * fractions of the icon's side; the dot is 38 % across, 9 px on a 24 px taskbar icon.
 */
export const DOT = {
  x: 0.77,
  y: 0.23,
  radius: 0.19,
  ring: 0.04,
  color: [0xf5, 0xb3, 0x2a],
  ringColor: [0x09, 0x0b, 0x0e],
} as const;

/**
 * The icon with the dot, as a new image: `pixels` is premultiplied BGRA, `width`×`height`, as
 * Electron's `nativeImage.toBitmap` gives it. The ring, then the dot, each laid over what is there
 * with its edge's pixels covered in part.
 */
export function withDot(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = Uint8Array.from(pixels);
  const side = Math.min(width, height);
  const cx = DOT.x * width;
  const cy = DOT.y * height;
  const inner = DOT.radius * side;
  const outer = inner + DOT.ring * side;
  const top = Math.max(0, Math.floor(cy - outer - 1));
  const bottom = Math.min(height, Math.ceil(cy + outer + 1));
  const left = Math.max(0, Math.floor(cx - outer - 1));
  const right = Math.min(width, Math.ceil(cx + outer + 1));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const at = (y * width + x) * 4;
      lay(out, at, DOT.ringColor, cover(outer, distance));
      lay(out, at, DOT.color, cover(inner, distance));
    }
  }
  return out;
}

/** How much of a pixel `distance` from a circle's centre the circle of `radius` covers. */
const cover = (radius: number, distance: number) =>
  Math.min(1, Math.max(0, radius - distance + 0.5));

/** Lays an opaque `rgb` over the BGRA pixel at `at`, covering `alpha` of it. */
function lay(pixels: Uint8Array, at: number, rgb: readonly number[], alpha: number): void {
  if (alpha <= 0) return;
  const [red = 0, green = 0, blue = 0] = rgb;
  const keep = 1 - alpha;
  const mix = (channel: number, value: number) => {
    pixels[at + channel] = Math.round(value * alpha + (pixels[at + channel] ?? 0) * keep);
  };
  mix(0, blue);
  mix(1, green);
  mix(2, red);
  mix(3, 255);
}

/** What the page says waits, as the app takes it: a whole number from 0 to 999, else nothing. */
export function readWaiting(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999
    ? value
    : undefined;
}

/** What a new count does to the window: its icon, when it changes, and whether it blinks. */
export interface WaitingChange {
  icon?: 'dot' | 'plain';
  blink: boolean;
}

/**
 * From `before` to `after` things waiting: the dot while any waits, the plain S when none does;
 * a blink when more waits while the window does not have the focus (the person is elsewhere).
 */
export function onWaiting(before: number, after: number, focused: boolean): WaitingChange {
  const blink = after > before && !focused;
  if (before === 0 && after > 0) return { icon: 'dot', blink };
  if (before > 0 && after === 0) return { icon: 'plain', blink };
  return { blink };
}
