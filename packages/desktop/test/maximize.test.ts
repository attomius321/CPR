import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdMaximize, holdsMaximize, type Hold, type HeldWindow } from '../src/maximize.js';
import type { Area } from '../src/state.js';

describe('where CPR holds a maximized window itself (N1d)', () => {
  const wslg = { WSL_DISTRO_NAME: 'Ubuntu', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' };

  it("on WSLg's X11, which Electron picks there", () => {
    expect(holdsMaximize('linux', wslg)).toBe(true);
  });

  it('nowhere else', () => {
    // Electron on WSLg's Wayland: maximized windows fill the work area there.
    expect(holdsMaximize('linux', { ...wslg, XDG_SESSION_TYPE: 'wayland' })).toBe(false);
    // Another X server than WSLg's (the e2e's Xvfb), or Linux outside WSL.
    expect(holdsMaximize('linux', { WSL_DISTRO_NAME: 'Ubuntu', DISPLAY: ':99' })).toBe(false);
    expect(holdsMaximize('linux', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' })).toBe(false);
    expect(holdsMaximize('win32', wslg)).toBe(false);
    expect(holdsMaximize('darwin', wslg)).toBe(false);
  });
});

/** The right screen's work area, as WSLg's window manager maximizes into it (measured). */
const WORK: Area = { x: 2560, y: 0, width: 2560, height: 1392 };
const NORMAL: Area = { x: 2700, y: 150, width: 1200, height: 800 };

/**
 * A window on WSLg's X11, as measured: the window manager answers 10 ms after it is asked, and
 * an unmaximize 60 ms after (longer than the hold's quiet time); it ignores a size asked of a
 * maximized window; it parks a window off the screen for a moment when it shows it.
 */
class WslgWindow implements HeldWindow {
  bounds: Area;
  maximized = false;
  /** Not shown yet: WSLg maps it maximized, and its place to restore is the screen's corner. */
  opening = false;
  asked: string[] = [];
  hold!: Hold;
  private restoreTo: Area;

  constructor(bounds: Area) {
    this.bounds = bounds;
    this.restoreTo = bounds;
  }

  getBounds(): Area {
    return { ...this.bounds };
  }
  maximize(): void {
    this.asked.push('maximize');
    setTimeout(() => this.byWindowManager(), 10);
  }
  unmaximize(): void {
    this.asked.push('unmaximize');
    setTimeout(() => {
      this.maximized = false;
      this.hold.onUnmaximize();
      this.change(this.restoreTo);
    }, 60);
  }
  setBounds(bounds: Area): void {
    this.asked.push('setBounds');
    setTimeout(() => {
      if (!this.maximized) this.change(bounds);
    }, 5);
  }
  /** Maximized by the window manager, as Win+Up or a double-click on the title bar do. */
  byWindowManager(): void {
    this.restoreTo = this.opening ? { ...this.bounds, x: WORK.x, y: WORK.y } : this.bounds;
    this.opening = false;
    this.maximized = true;
    this.hold.onMaximize();
    this.change(WORK);
  }
  change(bounds: Area): void {
    this.bounds = bounds;
    this.hold.onBoundsChange();
  }
}

describe('a maximized window held by CPR on WSLg (N1d)', () => {
  let window: WslgWindow;
  let told: boolean[];
  let hold: Hold;
  let areas: Area[];

  beforeEach(() => {
    vi.useFakeTimers();
    window = new WslgWindow(NORMAL);
    told = [];
    areas = [];
    hold = holdMaximize(window, (maximized) => told.push(maximized), areas);
    window.hold = hold;
  });
  afterEach(() => {
    hold.stop();
    vi.useRealTimers();
  });

  it("Maximize fills the work area WSLg chose, as a normal window: WSLg's own is 32 px off", async () => {
    hold.maximize();
    await vi.runAllTimersAsync();
    expect(window.bounds).toEqual(WORK);
    expect(window.maximized).toBe(false);
    expect(window.asked).toEqual(['maximize', 'unmaximize', 'setBounds']);
    expect(told).toEqual([true]);
    expect(hold.maximized).toBe(true);
    expect(hold.normal).toEqual(NORMAL);
  });

  it('maximized as it opens, Restore puts it where it was, not where WSLg would', async () => {
    window.opening = true;
    hold.maximize();
    await vi.runAllTimersAsync();
    expect(window.bounds).toEqual(WORK);
    expect(hold.normal).toEqual(NORMAL);
    hold.restore();
    await vi.runAllTimersAsync();
    expect(window.bounds).toEqual(NORMAL);
  });

  it('Restore puts it back where it was', async () => {
    hold.maximize();
    await vi.runAllTimersAsync();
    expect(hold.restore()).toBe(true);
    await vi.runAllTimersAsync();
    expect(window.bounds).toEqual(NORMAL);
    expect(told).toEqual([true, false]);
    expect(hold.maximized).toBe(false);
    expect(hold.normal).toBeUndefined();
  });

  it("the window manager's own maximize (Win+Up, a double-click) is held too", async () => {
    window.byWindowManager();
    await vi.runAllTimersAsync();
    expect(window.bounds).toEqual(WORK);
    expect(window.maximized).toBe(false);
    expect(told).toEqual([true]);
    expect(hold.normal).toEqual(NORMAL);
  });

  it('once learned, a screen is filled at once: no round trip through the window manager', async () => {
    hold.maximize();
    await vi.runAllTimersAsync();
    hold.restore();
    await vi.runAllTimersAsync();
    window.asked = [];
    hold.maximize();
    await vi.runAllTimersAsync();
    expect(window.asked).toEqual(['setBounds']);
    expect(window.bounds).toEqual(WORK);
    expect(told).toEqual([true, false, true]);
    expect(areas).toEqual([WORK]);
  });

  it('moved or resized by the person, it is no longer maximized', async () => {
    hold.maximize();
    await vi.runAllTimersAsync();
    window.change({ ...WORK, x: 2600, y: 40 });
    window.change({ ...WORK, x: 2650, y: 80 });
    await vi.runAllTimersAsync();
    expect(told).toEqual([true, false]);
    expect(hold.maximized).toBe(false);
    expect(hold.restore()).toBe(false);
  });

  it('a passing move does not count: WSLg parks a window off the screen as it shows it', async () => {
    hold.maximize();
    await vi.runAllTimersAsync();
    window.change({ ...WORK, x: -32736, y: -32736 });
    await vi.advanceTimersByTimeAsync(14);
    window.change(WORK);
    await vi.runAllTimersAsync();
    expect(told).toEqual([true]);
    expect(hold.maximized).toBe(true);
  });

  it('maximized again while held, it keeps the place to restore', async () => {
    hold.maximize();
    await vi.runAllTimersAsync();
    window.byWindowManager();
    await vi.runAllTimersAsync();
    expect(window.bounds).toEqual(WORK);
    expect(told).toEqual([true]);
    expect(hold.normal).toEqual(NORMAL);
  });

  it('Restore of a window it does not hold is left to the caller', () => {
    expect(hold.restore()).toBe(false);
    expect(window.asked).toEqual([]);
  });

  it('stops with its window: nothing is asked of a closed window', async () => {
    hold.maximize();
    await vi.advanceTimersByTimeAsync(20);
    hold.stop();
    await vi.runAllTimersAsync();
    expect(window.asked).toEqual(['maximize']);
  });
});
