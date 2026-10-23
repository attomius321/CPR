import { describe, expect, it } from 'vitest';
import { hardwareGlFails } from '../src/gpu.js';

describe('where Chromium never finds hardware GL, so the app does not ask it (V39 fix)', () => {
  it('on WSL, whichever display: WSLg’s X11 and Wayland, or another X server', () => {
    expect(hardwareGlFails('linux', { WSL_DISTRO_NAME: 'Ubuntu', DISPLAY: ':0' })).toBe(true);
    expect(
      hardwareGlFails('linux', { WSL_DISTRO_NAME: 'Ubuntu', WAYLAND_DISPLAY: 'wayland-0' }),
    ).toBe(true);
    expect(hardwareGlFails('linux', { WSL_DISTRO_NAME: 'Ubuntu', DISPLAY: ':99' })).toBe(true);
  });

  it('nowhere else: Linux outside WSL may have a GPU, as macOS and Windows do', () => {
    expect(hardwareGlFails('linux', { DISPLAY: ':0' })).toBe(false);
    expect(hardwareGlFails('linux', { WSL_DISTRO_NAME: '' })).toBe(false);
    expect(hardwareGlFails('win32', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe(false);
    expect(hardwareGlFails('darwin', {})).toBe(false);
  });
});
