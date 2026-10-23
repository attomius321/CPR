/**
 * Whether Chromium never finds hardware GL here, so the app does not ask for it (V39 fix). On WSL
 * it finds none (`gl=none` on Microsoft's virtual GPU): its GPU process fails, starts again in
 * software, and the WebGL contexts made before that are lost, the intro's among them (measured on
 * WSLg's X11 and on an Xvfb: lost 70–110 ms after they are made). Without hardware acceleration it
 * starts in software at once: the same features as after the fallback, and no context lost.
 */
export function hardwareGlFails(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return platform === 'linux' && !!env.WSL_DISTRO_NAME;
}
