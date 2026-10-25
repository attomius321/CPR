import { describe, expect, it } from 'vitest';
import { placeTip, placeTooltip, TIP_GAP, TIP_MARGIN } from '../src/ui/tips.js';

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

describe('placeTooltip (V54)', () => {
  const small = { width: 100, height: 30 };
  const button = { left: 300, top: 400, width: 24, height: 24 };

  it('centres a tip above its element, TIP_GAP off', () => {
    expect(placeTooltip(button, small, view, 'top')).toEqual({
      left: 312 - 50,
      top: 400 - TIP_GAP - 30,
      side: 'top',
    });
  });

  it('takes the side under an element when nothing is asked: top', () => {
    expect(placeTooltip(button, small, view)).toEqual(placeTooltip(button, small, view, 'top'));
  });

  it('flips a top tip under an element at the window’s top', () => {
    const high = { left: 300, top: 6, width: 24, height: 24 };
    expect(placeTooltip(high, small, view, 'top')).toEqual({
      left: 262,
      top: 30 + TIP_GAP,
      side: 'bottom',
    });
  });

  it('keeps a bottom tip under its element (the title bar’s buttons)', () => {
    expect(placeTooltip(button, small, view, 'bottom')).toEqual({
      left: 262,
      top: 424 + TIP_GAP,
      side: 'bottom',
    });
  });

  it('flips a bottom tip above an element at the window’s bottom', () => {
    const low = { left: 300, top: 870, width: 24, height: 24 };
    expect(placeTooltip(low, small, view, 'bottom')).toMatchObject({
      top: 870 - TIP_GAP - 30,
      side: 'top',
    });
  });

  it('puts a right tip beside its element, centred on its height (the sidenav)', () => {
    const page = { left: 8, top: 100, width: 32, height: 32 };
    const two = { width: 160, height: 44 };
    expect(placeTooltip(page, two, view, 'right')).toEqual({
      left: 40 + TIP_GAP,
      top: 116 - 22,
      side: 'right',
    });
  });

  it('flips a right tip to the left at the window’s right edge', () => {
    const edge = { left: 1400, top: 100, width: 32, height: 32 };
    expect(placeTooltip(edge, small, view, 'right')).toEqual({
      left: 1400 - TIP_GAP - 100,
      top: 116 - 15,
      side: 'left',
    });
  });

  it('keeps a tip TIP_MARGIN inside the window', () => {
    const left = { left: 0, top: 400, width: 24, height: 24 };
    const right = { left: 1430, top: 400, width: 10, height: 24 };
    expect(placeTooltip(left, small, view, 'top').left).toBe(TIP_MARGIN);
    expect(placeTooltip(right, small, view, 'top').left).toBe(1440 - 100 - TIP_MARGIN);
    const top = { left: 0, top: 0, width: 32, height: 10 };
    expect(placeTooltip(top, small, view, 'right').top).toBe(TIP_MARGIN);
  });

  it('centres on the part of a wide element in the window (a project frame’s band)', () => {
    const band = { left: -500, top: 400, width: 3000, height: 30 };
    expect(placeTooltip(band, small, view, 'top').left).toBe(720 - 50);
  });

  it('starts a cut text’s tip at its left edge', () => {
    const name = { left: 120, top: 400, width: 160, height: 20 };
    expect(placeTooltip(name, { width: 400, height: 30 }, view, 'top', 'start').left).toBe(120);
  });

  it('takes the side with more room when neither fits, inside the window', () => {
    const tall = { width: 300, height: 700 };
    const high = { left: 300, top: 200, width: 24, height: 24 };
    expect(placeTooltip(high, tall, view, 'top')).toEqual({
      left: 162,
      top: 900 - TIP_MARGIN - 700,
      side: 'bottom',
    });
  });
});
