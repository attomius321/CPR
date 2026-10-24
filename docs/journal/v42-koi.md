# Journal: V42 — Koi: Symbiote's colours from its intro, and what still looks old

[Index](../JOURNAL.md) · [Plan](../plan/v42-koi.md)

## V42 spike — the intro's colours, and the palette tried on today's pages (2026-10-24, branch `feature/ui-improvements-v2`)

Asked: "a revamp of the UI. Still looks old. And i want to change the color palette. Will use the
colors from the intro video with the fishes. Grab some colors: primary, secondary etc." Read on
`main` (`e380fef`): the intro's images (`koi-bg.webp`, `koi-white.webp`, `koi-black.webp`) and the
512 px icon, decoded with ffmpeg and bucketed by colour; then today's pages screenshotted at
1440×900, dark and light, with and without the candidate tokens injected as a stylesheet.

**Learned**:
- **The intro is two hues**: near-black navy water (the tile's centre `#05080f`, its body
  `#081828`, a rim lit `#334781`) and the koi's blue light — the black koi's glow `#2858b0`–
  `#3060b8`, vivid pixels averaging `#427cd3`–`#4c82d2`, the white koi's halo `#a8c0e8`, its shade
  `#c8d1e1` and body `#e8e8f8`. No warm colour but the black koi's few orange fringe pixels.
- **The koi blue sits on today's moved/info blue**: hue 220° against `#4493f8`'s 214°. With the
  koi blue as an accent, a moved node or an agent working would read as selected; moved goes cyan.
- **A navy chrome keeps V31's steps**: canvas `#060a12` to chrome `#0f1626` is 1.10:1 (V31's
  `#0a0a0a`/`#171717`); every text, state and line rule of `tokens.test.ts` passes in both themes
  (muted 6.19:1, `--faint` 3.71:1, lines 1.31:1; light: muted 5.27:1, lines 1.21:1). White on the
  koi primary `#3c6fd6` is 4.73:1; on the light `#2f62cc` 5.62:1.
- **The koi S reads at 24 px**: rendered from the icon at 20, 24 and 28 px on the new chrome, it is
  an S from 24 px; V39 kept the graph glyph because it does not at 16.
- **Colours outside the tokens**: the app's window and title bar (`frame.ts`), its start page (its
  own copy of the tokens), and the terminal's theme (`terminal.ts`).
- **What the style itself calls dated is still on one page**: the diff sidebar's Changes /
  Findings, underlined tabs with a 2 px rule.

## V42 — Koi: Symbiote's colours from its intro (2026-10-24, branch `feature/ui-improvements-v2`)

The palette is the intro's: the canvas the tile's abyss (`#05080f`), the chrome its deep water
(`#0f1626`), the text the white koi (`#eaeef7`, muted `#9aa5be`), the primary the koi's blue
(`#3c6fd6`, white text) and one accent, the white koi's halo (`#7a9ee8`), for what a person acts
with: focus, the current page, the selection, the selected node, a link under the pointer. Light
takes the same hues on white. Moved and info leave blue to the accent for cyan. The koi S
replaces the graph glyph as the mark; the diff sidebar's underlined tabs become a segmented
control. Decisions 279–284.

**Learned**:
- **V31's step from content to chrome is a hard edge**: the planned canvas `#060a12` sat 1.097:1
  under the chrome and failed the step's test (≥ 1.10); the tile's own centre `#05080f` gives 1.11.
- **No state needed a new value**: on navy surfaces every state and lane still passes 3:1 (lowest
  `--removed` 3.33:1, `--lane-4` 3.37:1 on `--raised`). Darker and bluer surfaces barely move the
  luminance a state is measured against.
- **A blue primary cannot lighten on hover**: every blue lighter than `#3c6fd6` takes white under
  4.5:1 (`#4375dc` 4.36:1). The hover is a step darker, and a test holds white at 4.5:1 on both.
- **A selection in a colour needs a different test**: "washes of the text 3 points apart"
  (V37) cannot compare a 5 % wash of the text with a 16 % wash of the accent. The test now lays
  both over `--bg` and `--side` and asks the selection to stand further from its ground.
- **A lit edge on the primary shows on every `.button`**, ghost ones too (a white line along the
  top of Cancel): the ghost variant resets `box-shadow`.
- **Blue made a second primary visible**: "Copy for the agent" beside "Merge into" had been two
  near-white buttons; in blue it read as two main actions. It is secondary now.
- **The koi S at 24 px is an image, not an icon**: the app's icon cropped to its tile (the 512 px
  file has 39 px of transparent margin) and drawn at 48 px for 24; sharp at 1× in both themes.

**Verification**: tests first, red for the right reason: `tokens.test.ts` 8 of 28 (the koi's
values, `--accent` missing, a selection that was a wash of the text), `frame.test.ts` 2 of 4 (the
window's colours); the accent's guard and the primary-hover test written with the code.
`pnpm check` 1,380 tests. e2e 216 of 217: `shell.spec`'s card-focus test, flaky on `main` since
V37, failed once and passed 6 of 6 alone. Against `main`'s build, alternated, on this repository's
`e659928..7c223d4` (1,975 symbols, 4,124 edges), 3 rounds: first paint 873–885 / 874–906 ms, select
189–237 / 170–256 ms, mark reviewed 48–80 / 52–85 ms, pan 63–65 / 62–63 fps, the same 846 nodes and
10,392 elements. `/history`, 8 rounds: first contentful paint median 64 / 64 ms, first rows 133 /
139 ms. CSS +653 bytes, the mark 6,149 bytes. Screenshots of 27 states of every page, dark and
light, 1440×900 at 1×, before and after, no page errors; the app's start page in both themes.

Not verified: Bitwarden's graph (no clone here); the person's own window (Electron on WSLg at
their scale); macOS and Windows rendering; a real agent's output in the restyled terminal. The
README's screenshots are from V25 and were not retaken.

## Fix — the sidenav's card-focus test pressed its keys before the second card was listed (2026-10-24, branch `feature/ui-improvements-v2`)

`shell.spec`'s "a card keeps the focus when its workspace moves to another group" had been flaky
since V37 (3 of 6 on `main` then; V38: 3 of 8 failed alone) and stopped Symbiote's merger's checks
of V42 (216 of 217). Asked whether the intro caused it: no, the e2e servers run with
`SYMBIOTE_INTRO=off`, and it failed on `main` the day before V39.

**Learned**: a copy of the test logging every focus change and key failed 7 of 88 times on 8
parallel workers (25 of 25 passed on one): in each failure ArrowDown reached the first card with
**1 card** in the sidenav, and no focus moved. The test waits for the second start page to close,
then presses `h`, `w` and ArrowDown; under load the sidenav lists the second workspace a moment
later, and ArrowDown on the only card rightly stays there. Not the app: the two workspaces stay in
one group in a stable order (sampled every 25 ms for 6 s after the start, 4 runs), and a focused
card that is redrawn gets its focus back. Chromium 153 fires `blur` on a removed focused element,
on the detached node: React's handler on the list never sees it.

**Verification**: the test waits for both cards before its keys. On 8 workers: 4 of 64 failed
before, 0 of 64 after.
