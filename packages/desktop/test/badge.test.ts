import { describe, expect, it } from 'vitest';
import { DOT, onWaiting, readWaiting, withDot } from '../src/badge.js';

/** A `side`×`side` image, premultiplied BGRA: opaque blue, its top-right `clear`×`clear` clear. */
function icon(side: number, clear = 0): Uint8Array {
  const pixels = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (x >= side - clear && y < clear) continue;
      pixels.set([255, 0, 0, 255], (y * side + x) * 4);
    }
  }
  return pixels;
}

const at = (pixels: Uint8Array, side: number, x: number, y: number) => {
  const i = (y * side + x) * 4;
  return [...pixels.slice(i, i + 4)];
};
// BGRA, as Electron's bitmaps are.
const AMBER = [0x2a, 0xb3, 0xf5, 255];
const RING = [0x0e, 0x0b, 0x09, 255];
const BLUE = [255, 0, 0, 255];

describe("the taskbar icon's dot (N2)", () => {
  const side = 100;
  const cx = DOT.x * side;
  const cy = DOT.y * side;

  it('is amber at its centre, in a dark ring, at the top-right', () => {
    const dotted = withDot(icon(side), side, side);
    expect(at(dotted, side, Math.floor(cx), Math.floor(cy))).toEqual(AMBER);
    // Between the dot's edge and the ring's.
    const ring = Math.floor(cy - (DOT.radius + DOT.ring / 2) * side);
    expect(at(dotted, side, Math.floor(cx), ring)).toEqual(RING);
    expect(cx).toBeGreaterThan(side / 2);
    expect(cy).toBeLessThan(side / 2);
  });

  it('leaves the rest of the icon as it was, and the icon given untouched', () => {
    const plain = icon(side, 10);
    const dotted = withDot(plain, side, side);
    const outer = (DOT.radius + DOT.ring) * side;
    let changed = 0;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const far = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > outer + 1;
        if (far) expect(at(dotted, side, x, y)).toEqual(at(plain, side, x, y));
        else if (at(dotted, side, x, y).join() !== at(plain, side, x, y).join()) changed++;
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(plain).toEqual(icon(side, 10));
    // The bottom-right, where WSLg puts its own mark, and the S's middle: as they were.
    expect(at(dotted, side, 90, 90)).toEqual(BLUE);
    expect(at(dotted, side, 50, 50)).toEqual(BLUE);
  });

  it('is opaque where the icon was clear', () => {
    const dotted = withDot(icon(side, 40), side, side);
    expect(at(dotted, side, Math.floor(cx), Math.floor(cy))).toEqual(AMBER);
  });

  it('has smooth edges: between amber and its ring only on the dot’s rim', () => {
    const dotted = withDot(icon(side), side, side);
    let blended = 0;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const red = at(dotted, side, x, y)[2] as number;
        if (red <= RING[2]! || red >= AMBER[2]!) continue;
        blended++;
        const off = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - DOT.radius * side);
        expect(off).toBeLessThan(1);
      }
    }
    expect(blended).toBeGreaterThan(20);
  });

  it('is about 38 % of the icon across: 9 px on a 24 px taskbar icon', () => {
    expect(DOT.radius * 2).toBeCloseTo(0.38, 2);
    // Its ring stays on the icon.
    expect(DOT.x + DOT.radius + DOT.ring).toBeLessThanOrEqual(1);
    expect(DOT.y - DOT.radius - DOT.ring).toBeGreaterThanOrEqual(0);
  });
});

describe('what the page says waits (N2)', () => {
  it('is a whole number from 0 to 999', () => {
    for (const count of [0, 1, 3, 999]) expect(readWaiting(count)).toBe(count);
    for (const wrong of [-1, 1000, 1.5, Number.NaN, Infinity, '2', null, undefined, {}]) {
      expect(readWaiting(wrong)).toBeUndefined();
    }
  });
});

describe('what a new count does to the window (N2)', () => {
  it('puts the dot on while anything waits, and takes it off when nothing does', () => {
    expect(onWaiting(0, 1, true)).toEqual({ icon: 'dot', blink: false });
    expect(onWaiting(1, 0, true)).toEqual({ icon: 'plain', blink: false });
    expect(onWaiting(1, 2, true)).toEqual({ blink: false });
    expect(onWaiting(2, 1, false)).toEqual({ blink: false });
    expect(onWaiting(0, 0, false)).toEqual({ blink: false });
  });

  it('blinks when more waits while the person is in another window', () => {
    expect(onWaiting(0, 1, false)).toEqual({ icon: 'dot', blink: true });
    expect(onWaiting(1, 2, false)).toEqual({ blink: true });
    expect(onWaiting(1, 0, false)).toEqual({ icon: 'plain', blink: false });
  });
});
