# Journal: Fix — a workspace ready for review in Needs you's amber, not Done's green

[Index](../JOURNAL.md)

## Fix — a workspace ready for review in Needs you's amber, not Done's green (2026-10-25, branch `fix/needs-you-workspaces-fix`)

Asked, with a screenshot of the sidenav: "why is the second workspace from the screenshot green
status?". Under the amber bell of Needs you, "Merge viewer on conflict" (Plan ready) had an amber
dot and "Logging system" (Ready for review · 1 commit) a green one: the green of Done's merged
cards.

**Cause**: `workspaceNext` puts a workspace with commits and no agent at work in Needs you with
the tone `ready` (Ready for review, review again, Approved, Changes requested, Commented). Three
stylesheets drew `ready` as `done`, in `--added`: the card's dot (`Sidenav.css`), the state in
the workspace's header (`Workspace.css`) and its mark on History's badges
(`WorkspaceMark.css`). V44 measured it ("a Needs you card's dot: amber, green, red or grey") and
left it. Now `ready` is drawn as `waiting`, in `--warning`, in all three; green is Done's only.
Failed (red) and idle (grey) keep their colours: they say more than "your turn". The tones, the
marks (● and ?), the text, the groups and History's urgency order are unchanged.

**Learned**:
- **One tone, three stylesheets**: each drawing maps the tones to tokens on its own, and all
  three had copied the same pairing. The unit test reads the three and holds each to the groups'
  own rules (`.sidenav .group-needsYou`, `.group-done`), so a change of a group's colour carries.
- **Headless Chromium can stop drawing on WSL**: midway through, `requestAnimationFrame` stopped
  firing (none in 60 s), so every click waited for a stable element and tests that had passed
  minutes before timed out at their first click. It was not the load (other sessions' e2e runs,
  load 5–9): it stayed once the load fell to 3. A probe page drew no frame with Playwright's
  defaults, nor with only `--disable-gpu`, nor with SwiftShader's WebGL, but 61 a second with
  `--disable-gpu --disable-gpu-compositing --disable-software-rasterizer`. Those flags take
  WebGL away, so the intro's tests cannot pass with them.

**Verification**: test first. `tokens.test.ts` ("draws a workspace ready for review in Needs
you's colour, never Done's") red on all three drawings (`--added` where `--warning` was
expected), then green. `shell.spec`'s new e2e (a workspace commits and finishes: its dot, its
header's state and its ● on History's badge computed in the Needs you icon's colour) red on the
dot (`rgb(129, 184, 139)` for `rgb(234, 179, 8)`), then green. `pnpm check` 1,573 tests in 113
files. e2e, with the repository's config plus those three flags (the defaults drew nothing here):
235 of 241. The 6 failures are all in `intro.spec`, whose koi need WebGL; it fails the same 6 on
`main`'s stylesheets under the same flags. Screenshots of the sidenav with Plan ready, Ready for
review and Merged cards, dark and light, 1440×900 at device scale 1, before and after; after, the
workspace's header and its mark on History's badge in both themes, all amber.

Not verified: the intro's 6 tests with WebGL (no headless WebGL on this machine during the fix);
the app's window on WSLg; macOS and Windows rendering.
