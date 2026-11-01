import { describe, expect, it } from 'vitest';
import { crowded, type Target } from '../e2e/targets.js';

/** `count` boxes of `width` × `height`, `gap` apart, in a row (`across`) or a column. */
function boxes(count: number, width: number, height: number, gap: number, across = true): Target[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `t${i}`,
    x: across ? i * (width + gap) : 0,
    y: across ? 0 : i * (height + gap),
    width,
    height,
  }));
}

// V87b (decision 766): WCAG 2.2's 2.5.8, on the cases its Understanding page draws.
describe('crowded targets (WCAG 2.2, 2.5.8)', () => {
  it('passes targets of 24 × 24 px and more, side by side', () => {
    expect(crowded(boxes(4, 24, 24, 0))).toEqual([]);
    expect(crowded(boxes(4, 24, 24, 0, false))).toEqual([]);
  });

  it('fails 20 × 20 px targets with no space between them; passes them 4 px apart', () => {
    expect(crowded(boxes(3, 20, 20, 0))).toHaveLength(3);
    expect(crowded(boxes(3, 20, 20, 4))).toEqual([]);
  });

  it('fails menu items 18 px high, stacked; passes them at 24 px', () => {
    expect(crowded(boxes(5, 160, 18, 0, false))).toHaveLength(5);
    expect(crowded(boxes(5, 160, 24, 0, false))).toEqual([]);
  });

  it("fails a list's 22 px rows however wide: no 24 px square fits in one", () => {
    expect(crowded(boxes(3, 300, 22, 0, false))).toEqual([
      't0 (300 × 22)',
      't1 (300 × 22)',
      't2 (300 × 22)',
    ]);
  });

  it('passes a row of wide 20 px buttons with 4 px above and below', () => {
    const row = boxes(3, 60, 20, 0).map((b) => ({ ...b, y: 4 }));
    const above = { name: 'above', x: 0, y: -24, width: 180, height: 24 };
    const below = { name: 'below', x: 0, y: 28, width: 180, height: 24 };
    expect(crowded([...row, above, below])).toEqual([]);
  });

  it('passes one small target alone; fails it inside or against another target', () => {
    const small = { name: 'close', x: 100, y: 100, width: 16, height: 16 };
    expect(crowded([small])).toEqual([]);
    const tab = { name: 'tab', x: 40, y: 96, width: 80, height: 24 };
    expect(crowded([small, tab])).toEqual(['close (16 × 16)']);
  });
});
