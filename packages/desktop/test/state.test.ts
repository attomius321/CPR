import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHOICES, configDir, placeWindow, readState, writeState, type Area } from '../src/state.js';

const dir = mkdtempSync(join(tmpdir(), 'cpr-desktop-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('configDir', () => {
  it("follows each system's place for settings", () => {
    expect(configDir({ XDG_CONFIG_HOME: '/x/config' }, 'linux', '/home/a')).toBe('/x/config/cpr');
    expect(configDir({}, 'linux', '/home/a')).toBe('/home/a/.config/cpr');
    expect(configDir({}, 'darwin', '/Users/a')).toBe('/Users/a/Library/Application Support/cpr');
    expect(configDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\cpr',
    );
  });
});

describe('readState and writeState', () => {
  it('reads back what it wrote: the window, the zoom, the choices', () => {
    const file = join(dir, 'state.json');
    const state = {
      window: { x: 10, y: 20, width: 1200, height: 800, maximized: true },
      zoom: 1,
      choices: { 'cpr.viewer.theme': 'light', 'cpr.viewer.sidenav': 'rail' },
    };
    writeState(file, state);
    expect(readState(file)).toEqual(state);
  });

  it('starts empty from a missing, broken or foreign file', () => {
    expect(readState(join(dir, 'missing.json'))).toEqual({ choices: {} });
    writeFileSync(join(dir, 'broken.json'), '{ nope');
    expect(readState(join(dir, 'broken.json'))).toEqual({ choices: {} });
    writeFileSync(join(dir, 'array.json'), '[1, 2]');
    expect(readState(join(dir, 'array.json'))).toEqual({ choices: {} });
  });

  it('keeps only what it knows: sane sizes, a zoom in range, the viewer’s own choices', () => {
    const file = join(dir, 'odd.json');
    writeFileSync(
      file,
      JSON.stringify({
        window: { x: 'a', width: 20, height: 1e9, maximized: 'yes' },
        zoom: 99,
        choices: {
          'cpr.viewer.theme': 'dark',
          'cpr.viewer.widths': 7,
          'cpr.review.abc': '{}',
          other: 'x',
        },
      }),
    );
    expect(readState(file)).toEqual({ choices: { 'cpr.viewer.theme': 'dark' } });
  });

  it('keeps the recent repositories: absolute paths, ten at most (N1b)', () => {
    const file = join(dir, 'recent.json');
    const recent = Array.from({ length: 12 }, (_, i) => `/r/${i}`);
    writeFileSync(file, JSON.stringify({ recent: ['relative', 7, ...recent] }));
    expect(readState(file)).toEqual({ recent: recent.slice(0, 10), choices: {} });
  });

  it('writes whole files only, never a half one beside the old', () => {
    const file = join(dir, 'whole.json');
    writeState(file, { choices: { 'cpr.viewer.theme': 'dark' } });
    writeState(file, { choices: { 'cpr.viewer.theme': 'light' } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      choices: { 'cpr.viewer.theme': 'light' },
    });
  });

  it("names the viewer's five choices", () => {
    expect([...CHOICES].sort()).toEqual([
      'cpr.viewer.changes',
      'cpr.viewer.sidenav',
      'cpr.viewer.sidenav.diff',
      'cpr.viewer.theme',
      'cpr.viewer.widths',
    ]);
  });
});

describe('placeWindow', () => {
  const primary: Area = { x: 0, y: 0, width: 1920, height: 1040 };
  const right: Area = { x: 1920, y: 0, width: 1280, height: 1000 };

  it('opens a first window at 1440×900, centred on the main screen', () => {
    expect(placeWindow(undefined, [primary], primary)).toEqual({
      x: 240,
      y: 70,
      width: 1440,
      height: 900,
      maximized: false,
    });
  });

  it('fits a first window to a small screen', () => {
    const small: Area = { x: 0, y: 0, width: 1280, height: 680 };
    expect(placeWindow(undefined, [small], small)).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 680,
      maximized: false,
    });
  });

  it('puts a window back where it was, on whichever screen', () => {
    const saved = { x: 2000, y: 50, width: 1100, height: 900, maximized: false };
    expect(placeWindow(saved, [primary, right], primary)).toEqual(saved);
    expect(placeWindow({ ...saved, x: 100, maximized: true }, [primary, right], primary)).toEqual({
      ...saved,
      x: 100,
      maximized: true,
    });
  });

  it('brings a window back from a screen that is gone, keeping its size', () => {
    const saved = { x: 2000, y: 50, width: 1100, height: 900, maximized: false };
    expect(placeWindow(saved, [primary], primary)).toEqual({
      x: 410,
      y: 70,
      width: 1100,
      height: 900,
      maximized: false,
    });
  });
});
