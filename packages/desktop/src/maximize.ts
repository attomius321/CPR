import type { Area } from './state.js';

/**
 * Whether CPR holds its maximized window itself (N1d): on WSLg's X11, whose window manager pads
 * a frameless window with an invisible 32 px margin and forgets it when it maximizes one. The
 * window lands 32 px right and down, its right end and bottom off the screen
 * (microsoft/wslg#1015); placed as a normal window it is where it is asked to be. WSLg is WSL with
 * its compositor (`WAYLAND_DISPLAY`); Electron takes its X11 unless the session says Wayland.
 */
export function holdsMaximize(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    platform === 'linux' &&
    !!env.WSL_DISTRO_NAME &&
    !!env.WAYLAND_DISPLAY &&
    env.XDG_SESSION_TYPE !== 'wayland'
  );
}

/** What the hold asks of a window: Electron's `BrowserWindow` has it. */
export interface HeldWindow {
  getBounds(): Area;
  setBounds(bounds: Area): void;
  maximize(): void;
  unmaximize(): void;
}

/** A window's maximize, held by CPR; the window's events are given to it as they come. */
export interface Hold {
  /** Maximized, as the page is told. */
  readonly maximized: boolean;
  /** Where Restore puts the window, while it is held. */
  readonly normal: Area | undefined;
  /** The page's Maximize. */
  maximize(): void;
  /** The page's Restore; false when the window is not held, and the caller restores it. */
  restore(): boolean;
  onMaximize(): void;
  onUnmaximize(): void;
  /** The window's `move` and `resize`. */
  onBoundsChange(): void;
  stop(): void;
}

/** The window's bounds still this long: the window manager is done (its answers take 10–60 ms). */
const QUIET = 50;
/** The longest wait for the window manager. */
const LONGEST = 1000;

/**
 * Holds `window` maximized as a normal window filling the work area. WSLg's window manager
 * knows the work area (the screen less the taskbar) and Electron does not, so the first
 * maximize on a screen goes through it: maximized, the area read, unmaximized, the window set to
 * the area. The area is kept in `areas` (shared by the app's windows); the next Maximize on that
 * screen sets it at once. The window manager's own maximize (Win+Up) is held the same way.
 */
export function holdMaximize(
  window: HeldWindow,
  tell: (maximized: boolean) => void,
  areas: Area[],
): Hold {
  let maximized = false;
  let normal: Area | undefined;
  /** The area the window is held to. */
  let area: Area | undefined;
  /** The round trip through the window manager, and what it found and keeps. */
  let phase: 'idle' | 'maximized' | 'unmaximizing' | 'restored' = 'idle';
  let found: Area | undefined;
  let keep: Area | undefined;
  /**
   * Where the window was when the page asked to maximize it: WSLg's own place to restore a window
   * it maps maximized (CPR opening as it was left) is the screen's corner.
   */
  let asked: Area | undefined;
  let stopped = false;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let longest: ReturnType<typeof setTimeout> | undefined;

  const say = (now: boolean) => {
    if (now === maximized) return;
    maximized = now;
    tell(now);
  };

  function hold(to: Area, from: Area): void {
    normal = from;
    area = to;
    say(true);
    window.setBounds(to);
  }

  function wait(): void {
    clearTimeout(quiet);
    quiet = setTimeout(settled, QUIET);
    longest ??= setTimeout(settled, LONGEST);
  }

  function stopTimers(): void {
    clearTimeout(quiet);
    clearTimeout(longest);
    quiet = longest = undefined;
  }

  function settled(): void {
    stopTimers();
    if (phase === 'maximized') {
      found = window.getBounds();
      phase = 'unmaximizing';
      // A size asked of a maximized window is ignored: wait for it to be unmaximized.
      longest = setTimeout(unmaximized, LONGEST);
      window.unmaximize();
    } else if (phase === 'restored' && found) {
      phase = 'idle';
      remember(areas, found);
      hold(found, keep ?? window.getBounds());
      keep = undefined;
    } else if (area && !same(window.getBounds(), area)) {
      // Moved or resized by the person; a passing move (WSLg parks a window it shows off the
      // screen for a moment) is back before this.
      area = normal = undefined;
      say(false);
    }
  }

  function unmaximized(): void {
    if (phase !== 'unmaximizing') return;
    stopTimers();
    phase = 'restored';
    wait();
  }

  return {
    get maximized() {
      return maximized;
    },
    get normal() {
      return normal;
    },
    maximize() {
      if (stopped || phase !== 'idle' || area) return;
      const here = window.getBounds();
      const known = areas.find((other) => contains(other, here));
      if (known) hold(known, here);
      else {
        asked = here;
        window.maximize();
      }
    },
    restore() {
      if (phase !== 'idle') return true;
      if (!area || !normal) return false;
      const to = normal;
      area = normal = undefined;
      say(false);
      window.setBounds(to);
      return true;
    },
    onMaximize() {
      if (stopped || phase !== 'idle') return;
      keep = normal ?? asked;
      asked = undefined;
      area = normal = undefined;
      phase = 'maximized';
      say(true);
      wait();
    },
    onUnmaximize() {
      if (!stopped) unmaximized();
    },
    onBoundsChange() {
      if (stopped || phase === 'unmaximizing') return;
      if (phase !== 'idle' || (area && !same(window.getBounds(), area))) wait();
    },
    stop() {
      stopped = true;
      stopTimers();
    },
  };
}

/** Keeps a screen's work area, in place of what was known of that screen. */
function remember(areas: Area[], area: Area): void {
  const before = areas.findIndex((other) => contains(other, area));
  if (before >= 0) areas.splice(before, 1);
  areas.push(area);
}

/** Whether `window`'s centre is on `area`. */
function contains(area: Area, window: Area): boolean {
  const x = window.x + window.width / 2;
  const y = window.y + window.height / 2;
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

function same(a: Area, b: Area): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
