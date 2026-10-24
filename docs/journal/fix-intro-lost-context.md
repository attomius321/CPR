# Journal: Fix — the intro's koi on a lost WebGL context: a blank tile for 5 s

[Index](../JOURNAL.md)

## Fix — the intro's koi on a lost WebGL context: a blank tile for 5 s (2026-10-23, branch `fix/intro-lost-context`)

Asked: "The last feature merge broke the app - intro motion." In the person's window (WSLg's X11,
2560×1392) the intro played its 5.6 s with sound over a white tile with a broken-image mark, then
the page came as usual (60 fps, no page error). V39 had not verified its frames in that window.

**Learned**:
- **Chromium's GPU process fails first, then starts again in software**, on WSLg and on an Xvfb
  alike ("Exiting GPU process due to errors during initialization"), and the WebGL contexts made
  on the first one are lost: 70–110 ms after they are made, given back 1,004 ms after the loss, if
  the page took it (`preventDefault`). Starting the GPU process earlier (`app.getGPUInfo`) does
  not avoid it: 12 of 12 probes still lost theirs.
- **The engine listens for a loss only once its images are in** (its constructor). A loss before
  that is taken by nobody, the context never comes back, and nothing says so: the overlay runs
  its course over a dead canvas. A loss after it ends the intro at once (`play.ts`). Which one
  happens is a race with the page's load: in the app without the fix, 2 of 4 runs on the
  person's display lost the intro's context.
- **`app.disableHardwareAcceleration()` on WSL costs nothing**: every GPU feature status the same
  as with it on (compositing and raster were software already; WebGL SwiftShader's), and no
  context lost in 3 of 3 probes, nor in the app.
- The app's intro test passed on a dead canvas: it checked the canvas is visible and the window
  audible, not what the window shows.

**Fixed**: on WSL the app does not ask for hardware GL (`packages/desktop/src/gpu.ts`). Anywhere a
context is lost (Xvfb on CI, a VM, a GPU reset), `play.ts` takes the loss from the canvas's
start: the koi are hidden (`data-state='loading'`) and start again on a new canvas once it is
back, once; not back in 2 s (`RESTORE_MS`), or lost again, the intro ends.

**Verification**: tests first, red for the right reason. `gpu.test.ts`; `intro.spec`'s two (a
context lost before the koi and given back: before, the intro ended before its S; lost
for good: before, a dead tile still up at 3.5 s); the app's intro test reads the window's pixels
at the formed S: 52 colours before (the blank tile), over 1,000 needed. `pnpm check`: 1,307 tests
in 96 files; e2e 209 of 210, the one failure `shell.spec`'s keyboard test, 5 of 5 alone (flaky
on `main`). The app's intro test without WSL's variables (as on CI's Xvfb): 3 of 3. On the
person's display: the koi at 2 s, 28,886 colours at the formed S; without the WSL fix, the two
runs that lost the context showed nothing for 1,063–1,067 ms, then the whole swim (screenshots).

Not verified: CI itself; WSLg's Wayland (the app takes X11 there); macOS, Windows, a GPU (the
fix leaves them as they were: no switch off WSL, and the loss handling only runs on a loss).

Merged into main (2026-10-23), asked: "Merge". On `main`: `pnpm check` 1,307 tests; build; e2e
208 of 210, both failures `shell.spec`'s focus tests (a card's focus, the terminal's size), which
failed alone at the same rate on `main` before the merge (`241371d`: 1 of 42 runs; after: 1 of
42, in alternated rounds).
