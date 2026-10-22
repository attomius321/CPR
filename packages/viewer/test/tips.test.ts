import { describe, expect, it } from 'vitest';
import { placeTip, TIP_GAP, TIP_MARGIN } from '../src/tips.js';

const view = { width: 1440, height: 900 };
const tip = { width: 320, height: 120 };

describe('placeTip (V37)', () => {
  it('puts the tip under its button, left edges aligned', () => {
    const button = { left: 300, top: 10, width: 24, height: 24 };
    expect(placeTip(button, tip, view)).toEqual({ left: 300, top: 34 + TIP_GAP, above: false });
  });

  it('keeps the tip inside the window at the right', () => {
    const button = { left: 1400, top: 10, width: 24, height: 24 };
    expect(placeTip(button, tip, view).left).toBe(1440 - 320 - TIP_MARGIN);
  });

  it('keeps the tip inside the window at the left', () => {
    const button = { left: 2, top: 10, width: 24, height: 24 };
    expect(placeTip(button, tip, view).left).toBe(TIP_MARGIN);
  });

  it('opens above a button near the bottom when the tip fits there', () => {
    const button = { left: 300, top: 860, width: 24, height: 24 };
    expect(placeTip(button, tip, view)).toEqual({
      left: 300,
      top: 860 - TIP_GAP - 120,
      above: true,
    });
  });

  it('stays under the button when neither side has the room but under has more', () => {
    const button = { left: 300, top: 40, width: 24, height: 24 };
    const tall = { width: 320, height: 860 };
    expect(placeTip(button, tall, view)).toMatchObject({ top: 64 + TIP_GAP, above: false });
  });

  it('opens above when neither side has the room but above has more', () => {
    const button = { left: 300, top: 800, width: 24, height: 24 };
    const tall = { width: 320, height: 860 };
    expect(placeTip(button, tall, view)).toEqual({ left: 300, top: TIP_MARGIN, above: true });
  });
});
