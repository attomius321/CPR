import { describe, expect, it } from 'vitest';
import { frameOf, frameOptions } from '../src/frame.js';

describe('the window frame (N1d)', () => {
  it("is Symbiote's own on Linux, the system's on macOS and Windows", () => {
    expect(frameOf('linux')).toBe('own');
    expect(frameOf('darwin')).toBe('system');
    expect(frameOf('win32')).toBe('system');
  });

  it('on Linux: a transparent window, its corners and buttons drawn by the page', () => {
    // Electron rounds a frameless window there only with client-side decorations, and draws no
    // overlay buttons on a transparent one (the N1d spike).
    for (const light of [false, true]) {
      expect(frameOptions('linux', light)).toEqual({
        titleBarStyle: 'hidden',
        transparent: true,
        backgroundColor: '#00000000',
      });
    }
  });

  it("on Windows: the system's buttons over the title bar, in the style's colours", () => {
    expect(frameOptions('win32', false)).toEqual({
      titleBarStyle: 'hidden',
      backgroundColor: '#05080f',
      titleBarOverlay: { color: '#0f1626', symbolColor: '#eaeef7', height: 38 },
    });
    expect(frameOptions('win32', true)).toEqual({
      titleBarStyle: 'hidden',
      backgroundColor: '#ffffff',
      titleBarOverlay: { color: '#f6f8fc', symbolColor: '#0b1220', height: 38 },
    });
  });

  it("on macOS: its own buttons at the left, on the page's background", () => {
    expect(frameOptions('darwin', false)).toEqual({
      titleBarStyle: 'hidden',
      backgroundColor: '#05080f',
      trafficLightPosition: { x: 14, y: 12 },
    });
  });
});
