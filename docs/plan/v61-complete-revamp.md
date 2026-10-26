# V61 — The black theme of the mockup, the new S, bigger text

[Index](../PLAN.md) · [Journal](../journal/v61-complete-revamp.md)

**Status:** in progress (2026-10-26), on branch `feature/complete-revamp` (a workspace started in
Symbiote, from `main` at `3365699`). The person OK'd the plan with "go ahead": the four proposed
decisions below stand.

**Problem** (asked: "Make the black theme according to the following screenshots. Take elements
that persist across the app, and preserve the displayed theme. Change the current icon with the
icon i gave you … The desktop app icon should also be changed."; then: "font-size should be
bigger, a little, still too small for my eyes"). The person gave two images in
`symbiote/documents/feature/complete-revamp/`: a mockup of the workspace page (1586×992, the
README's `docs/images/workspace.png` redrawn at 1.1×) and a new mark (1254×1254, a blue-violet S
of swirls on black). Sampled from the mockup (the most common colour of each region, then the
darkest, brightest and most saturated pixels of its text and controls):

| Region | Mockup | `main` (V42) |
|---|---|---|
| Content (the thread) | `#090b0e` | `--bg` `#05080f` |
| Sidenav, top bar, the right panel | `#0d1015`, `#0c0e12`, `#0d0f14` | `--side` `#0f1626` |
| Chips, counts, icon buttons | `#15181f`–`#1c1f26` | `--raised` `#1c2539` |
| Text, secondary text | `#ffffff`/`#ecf4fe`, `#a3afc1` | `#eaeef7`, `#9aa5be` |
| The primary ("Respond") | `#7d68fd`, its text `#020214` (near black) | `#3c6fd6`, white |
| The picked tab | white, a 3 px `#7e69ee` underline, a lifted ground | a filled pill |
| The open workspace's kind chip | violet text on a violet wash | neutral chip |
| Waiting for you, the banner | an amber 1 px ring, rounded, an inner card for the workspace | an amber band |
| Status dots | amber `#f7b622`, green `#4eea8b` | `--warning`, `--added` |

The mockup also draws the main area as **rounded cards** with an 8 px gutter (the banner; the tabs
with the thread; the right panel), line tabs with a divider before "+", the mark in a ~36 px round
tile, the sidenav's fold and "+" as raised squares, counts as round chips, the composer as a
bordered field with an icon tile, nav rows ~36 px and a sidenav ~260 px wide (each at 1×).

Text today: 14 px body, 13 secondary, 12 captions (V32). The person finds it too small.

**Goal**: the mockup's dark theme on every page, not only a workspace's: the shell, the page
heads, the cards, the tabs, the controls. The new S wherever the koi S is today, the desktop app's
icon included. Text one step bigger. **Unchanged**: what each page does and where its controls
are; the graph's layout (identical to `main`'s); the light theme's surfaces; the first-time intro.

## Tokens (`ui/base.css`)

- **Dark**: `--bg #090b0e`, `--side`/`--panel #0d1015`, `--raised #171a21`, `--line #1f232c`,
  `--edge #5c6373`, `--text #edf0f5`, `--muted #a2abbc`, `--faint #737a8a`, `--accent`/`--focus
  #9886ff` (a violet light enough for text: 5.96:1 on `--raised`), `--warning #f5b32a` (the
  mockup's amber). `palette-check.mjs`: every rule passes (text 15.24, muted 7.53, accent 5.96,
  edge 3.16, line 1.21 at their lowest).
- **The primary**: `#7c68fc` with **dark text** `#0b0a1a` (4.89:1; white would be 4.01). Its
  hover is a step **lighter**, `#8a78fd` (5.77:1): the reverse of V42's rule, which held for white
  text. `tokens.test.ts` checks `--primary-text` on the primary, not white.
- **Light**: only the primary and the accent move to violet (`#5b3fd9`, white on it 6.65:1, the
  accent 5.71 at its lowest), so one brand colour in both themes.
- **History's first lane** was purple `#b66dff`, 1.09:1 from the new accent: a branch would read as
  selected. It moves to the blue the accent left (dark), its light counterpart likewise.
- The translucent tokens (hover, menus, dialogs, overlay, shadows) are tinted with the new
  neutrals, not the koi's navy.

## Type (`--size-*`)

One pixel up each: caps 12, caption 13, small 14, body 15, title 17; the terminal 15. The
graph's nodes keep today's sizes (decision 438), so their estimated widths (`nodeWidth`, 9.4 px a
character) and every layout stay `main`'s: the graph's CSS gets its own scale, equal to today's.

## Shell and every page

- **Sidenav**: 256 px by default (a width the person set is kept); the new mark in a 32 px round
  tile; nav rows 36 px; the fold button and "+" raised squares; counts round chips; Waiting for
  you a card with a 1 px amber ring and the workspace in an inner card.
- **Page heads** as the mockup's: on the chrome, icon buttons at the right, a divider before More.
- **Cards**: the main area of each page sits on the chrome as rounded cards (10 px radius, a
  hairline, an 8 px gutter): a workspace (banner, tabs with their pane, changes), History (the
  branches panel, the rows), a diff (sidebar, Files or the canvas, the detail panel), Scout,
  Skills, Monitor, Settings, Start a workspace. Resizers stay between the panels, in the gutter.
- **Tabs**: line tabs, the picked one in `--text` with a 3 px accent underline and a lifted
  ground (the accent's role "current"), a divider before "+".
- **The banner**: an amber card (wash and 1 px ring), the primary at its right.
- **The composer**: a bordered field with its icon in a raised tile.
- **Controls** (`ui/controls.css`): the primary with its dark text; everything else through the
  tokens. Menus, dialogs and tooltips only through the tokens.

## The icon

`scripts/desktop/icon.mjs` is rewritten to cut every size from the person's image
(`scripts/desktop/logo.png`, the given file unchanged) in Chromium, as it draws today (no new
dependency): the app's icon 512 px (`packages/desktop/icons/symbiote.png`: the window, the taskbar,
`symbiote app install`'s launcher), the favicon 64 px, the sidenav's mark (`ui/koi-mark.png` →
`ui/mark.png`, at 2× its size), the start page's 80 px. An installed launcher keeps the old icon
until `symbiote app install` runs again.

## Outside the tokens

Kept in step by hand: the terminal's theme (`workspaces/terminal.ts`, `AgentTerminal.css`), the
window's background and title bar (`packages/desktop/src/frame.ts` and its test), the start page's
copy of the tokens (`packages/desktop/start/start.css`).

## Verification

1. **Tests first**: `tokens.test.ts`'s expected values (red), then `base.css`; the colours pinned
   in `look.spec.ts` and `app.spec.ts`; `frame.test.ts`.
2. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
3. **Screenshots** before and after of every page and its states (History and its menus and
   dialogs, Start, Scout, Skills, Monitor, Settings, a workspace's tabs, a diff's Files and Graph
   with their panels, review, merge), 1440×900, 1×, dark and light, by a Playwright spec outside
   the repository on e2e's harness; zoomed 3× for uneven letter gaps; the workspace beside the
   mockup at the same size.
4. **viewer-check** on Bitwarden `737ee3f`: first paint, select, mark reviewed, pan fps against
   `main`'s build, alternated.
5. **The desktop app** on WSLg: the title bar's mark and the window's icon.

**Risks**

| Risk | Mitigation |
|---|---|
| Bigger text truncates more names in the sidenav and the panels | 256 px sidenav; screenshots of every page at 1440 and 900 px |
| Cards with gutters take width from dense pages (a diff's three panels) | 8 px gutters; measured on Bitwarden's graph |
| A violet accent near a state colour | Lane 1 moved; states unchanged; `tokens.test.ts`'s accent guard |
| The S does not read at 20 px in the title bar | Screenshot at 1×; a round tile behind it |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V61a | Tokens and type | `base.css`, tests, hand-kept copies |
| V61b | The icon | `icon.mjs`, the four images, the mark in the shell |
| V61c | Shell and pages | cards, tabs, banner, sidenav, page heads, region by region |
| V61d | Docs | the style skill, the journal, the README's screenshots |

**Decisions** (the plan's four, OK'd with "go ahead"):

| # | Question | Decision | Why |
|---|---|---|---|
| 437 | The light theme | **Only the primary and the accent move to violet**; its surfaces stay | The brief asks for the black theme; one brand colour in both |
| 438 | The graph's text | **Today's sizes** | The graph zooms; its layout is estimated from characters and stays `main`'s |
| 439 | The first-time intro | **Kept as it is** | The person's animation; it ends on the koi S, theirs to change |
| 440 | The primary's text | **Dark, its hover lighter** | White on the mockup's violet is 4.01:1, under 4.5 |

**Not in V61 (later)**: the intro's ending on the new S; a light theme of the mockup's own.
