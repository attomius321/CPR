# V42 — Koi: Symbiote's colours from its intro, and what still looks old

[Index](../PLAN.md) · [Journal](../journal/v42-koi.md)

**Status:** ready for review (2026-10-24), on branch `feature/ui-improvements-v2` (a workspace
started in Symbiote, from `main` at `e380fef`); the plan and its three choices OK'd by the person
("1. Recommended 2. Recommended 3. Recommended. OK"). As built and results under "As built (V42)"
below.

**Problem** (asked: "We need a revamp of the UI. Still looks old. And i want to change the color
palette. Will use the colors from the intro video with the fishes. Grab some colors: primary,
secondary etc. Make it look modern."). Since V31 the style is monochrome: neutral greys carry the
chrome, colour is for state only (decision 214), selection is a grey wash, and the primary
button is near-white on dark. V39 gave Symbiote a mark of its own — two koi forming an S on deep
water — and none of the app's colours come from it. Measured on `main` (`e380fef`):

| What | Measured |
|---|---|
| The intro's colours (pixels of `koi-bg.webp`, `koi-white.webp`, `koi-black.webp`, the 512 px icon) | The tile's water: centre `#05080f`, body `#081828`; its lit rim `#334781`; the black koi's glow `#2858b0`–`#3060b8` (vivid pixels average `#427cd3`–`#4c82d2`); the white koi's halo `#a8c0e8`, shade `#c8d1e1`, body `#e8e8f8` |
| Today's palette | Neutral: canvas `#0a0a0a`, chrome `#171717`, raised `#262626`, text `#fafafa`; the one colour in the chrome is the states' (`--moved`/`--info` `#4493f8`) |
| Blue today | `--moved` and `--info` `#4493f8` (hue 214°), in 16 rules of 10 stylesheets (the moved kind, "since", an agent working, the current lane); the koi's blue `#3c6fd6` is hue 220°, 6° from it |
| The primary action | `--primary` `#e5e5e5` with `#171717` text (dark), `#171717` with white (light): 8 rules |
| Dated still, by the style's own table | The diff sidebar's Changes / Findings: underlined tabs with a 2 px rule (`diff/Sidebar.css`); the brand is the graph glyph while the app's icon is the koi S |
| Colours outside the tokens | `desktop/src/frame.ts` (the window's background, the title bar's overlay), `desktop/start/start.css` (the app's start page, its own copy of the tokens), `workspaces/terminal.ts` (the terminal's theme: `#000000`, grey selection) |

The koi palette tried on today's build (the tokens injected, nothing else changed): every value
passes `tokens.test.ts`'s rules in both themes — muted text 6.19:1 at least, states 3.71:1, the
chrome 1.10:1 over the canvas (V31's step), region lines 1.31:1; white on the koi primary 4.73:1.

**Goal**: Symbiote's colours are its koi's: the chrome is their deep water, the text their pearl
and silver, and one accent — the koi's blue — marks what a person acts with (the primary action,
focus, what is checked, the current page, the selection). The states keep their colours, apart
from the moved kind and info, which leave blue to the accent. A few components the style already
calls dated are brought up to it, and the koi S becomes the sidenav's mark. **Unchanged**: fonts
and the type scale, radii and spacing, layout and behaviour, the diff kinds' green, red and
yellow, History's lanes, the graph's geometry (node sizes, `layoutFlow`) and its timings.

## The palette (`ui/base.css`; the three theme blocks)

| Role | Token | Dark | Light | From |
|---|---|---|---|---|
| Canvas | `--bg` | `#05080f` (planned `#060a12`, see As built) | `#ffffff` | the abyss (tile centre) |
| Chrome | `--side`, `--panel` | `#0f1626` | `#f6f8fc` | deep water |
| Raised | `--raised` | `#1c2539` | `#e9eef7` | |
| Lines | `--line` / `--edge` | `#232d43` / `#5f6c8c` | `#dce3ef` / `#7f8aa3` | |
| Text | `--text` / `--muted` / `--faint` | `#eaeef7` / `#9aa5be` / `#717d99` | `#0b1220` / `#56627a` / `#78839c` | pearl, silver |
| **Primary** (the action) | `--primary` / `--primary-text` | `#3c6fd6` / `#ffffff` | `#2f62cc` / `#ffffff` | the koi's blue |
| **Secondary** (the accent) | `--accent` (new), `--focus` | `#7a9ee8` | `#2f62cc` | the white koi's halo |
| Moved, info | `--moved`, `--info` | `#3fc5d6` | `#0a7d8c` | cyan: off the accent |
| Context | `--context` | `#717d99` | `#78839c` | as `--faint` |

The other states and the lanes keep their values, but where a darker or lighter canvas takes one
under 3:1 (checked by `palette-check.mjs`). Hover stays a neutral wash of the text (5 %); the
selection becomes a wash of the accent, its line the accent mixed into `--line`. Menus, dialogs
and the overlay take the water's tint.

## Where the accent goes

- The primary button (the koi blue, white text, a 1 px highlight on its top edge), the focus ring
  and a focused field's edge, checked checkboxes, radios, switches and the effort stepper.
- The current page in the sidenav (its wash and its icon), selected rows, the selected node's
  outline in the graph, a link on hover, selected text.
- Never: the diff kinds, findings, History's lanes, graph edges, states. A guard in
  `tokens.test.ts` keeps `--accent` to the selectors of these roles, as V31's keeps `--moved`.

## Components

- **The diff sidebar's tabs** (Changes, Findings): the segmented control the start page's kinds
  use, in place of underlined tabs.
- **The mark**: the koi S (the app's icon, 24 px drawn from a 48 px PNG) in the sidenav's head and
  the folded rail, in place of the graph glyph. V39 kept the glyph because the S does not read at
  16 px; rendered at 20, 24 and 28 px on the new chrome, it reads from 24.
- **The graph**: nodes and the minimap on the new surfaces through their tokens; the selected
  node's outline in the accent. No size, font, shadow, transition or blur on nodes (the map's
  rules).
- **The terminal** (`terminal.ts`): the abyss as its background (dark in both themes, as today),
  a koi-tinted selection, its blues tuned to the palette.
- **The app** (`frame.ts`, `start.css`): the window's background, the title bar and the start
  page's tokens follow the palette.
- **The rest of the audit**: every page and state, dark and light, at 1440×900 and 1×; what still
  reads as dated is fixed in this milestone if it is a restyle, and brought to the person first if
  it moves anything.
- **The style's documents**: the `symbiote-style` skill (rules 1 and 3, `tokens.md`,
  `components.md`, `palette-check.mjs`).

## Verification

1. **Tests first** (red before): `tokens.test.ts` with the palette's values, `--accent` in both
   themes at 4.5:1 on the four backgrounds, the primary's text at 4.5:1 on it, a selection that
   stands further from its background than a hover, and the accent's guard; `look.spec.ts` and
   `app.spec.ts`'s pinned colours; `frame.test.ts`'s window colours.
2. **Nothing else changes**: `pnpm check`, `pnpm build`, `pnpm test:e2e`; the layout tests
   untouched (no size changes in nodes).
3. **Every page**, before and after: History (its menus and dialogs), Start, Scout, Skills,
   Settings, a workspace's tabs and terminal, a diff and its panels, review, merge; dark and light,
   1440×900, device scale 1; text zoomed for gaps between letters.
4. **Viewer timings** (`viewer-check`): first paint, select, mark reviewed and pan against `main`'s
   build, alternated; `/history`'s first rows.
5. **The app** under Xvfb: the window and title bar colours (`app.spec.ts`).

**Risks**

| Risk | Mitigation |
|---|---|
| A blue accent reads as a state (moved, info, working) | Those move to cyan; a guard keeps the accent to its roles |
| A selection in the accent next to a hover in grey looks like two styles | Both washes; the test keeps the selection further from its background than the hover |
| The koi S blurs at 1× | Drawn from a 48 px source at 24 px; screenshots at 1× |
| The navy canvas costs the graph's contrast | Graph text and kinds are tokens checked at 3:1 and 4.5:1 |

**Order**: tokens (tests, then `base.css`); then region by region, one commit each: controls and
the shell, the diff page and the graph, History, workspaces and the terminal, the app; then the
audit's fixes and the documents.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V42a | The koi palette | Tokens in both themes, `--accent`, moved and info in cyan, the app's and the terminal's colours |
| V42b | What still looks old | The accent's roles, the diff's tabs, the koi mark, the audit's fixes, the style's documents |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 279 | Where the palette comes from | **The intro's koi and water, sampled from its images**: canvas and chrome from the tile's water, text from the white koi, primary and accent from the glow | Asked: "the colors from the intro video with the fishes … primary, secondary". Sampled, not picked by eye |
| 280 | Colour beyond state (revises 214) | **One accent, the koi blue, in named roles** (primary, focus, checked, current, selection, selected node, links on hover); states keep theirs | Asked for primary and secondary colours; a guard keeps it from becoming V31's "blue for everything" |
| 281 | Blue's states | **Moved and info in cyan** (`#3fc5d6`, light `#0a7d8c`), with what shares their hue (working, "since", the current lane) | The koi blue is 6° from today's `#4493f8`: a moved node would read as selected (the person: "Recommended") |
| 282 | The mark | **The koi S at 24 px in the sidenav and the rail**, the graph glyph gone | It reads from 24 px on the new chrome (the person: "Recommended") |
| 283 | The light theme | **Tinted too**: cool chrome, navy text, the koi blue as primary and accent | One palette in both themes (the person: "Recommended") |
| 284 | The diff sidebar's tabs | **A segmented control** | The style's table names underlined tabs as dated; the start page's kinds already use one |

**Not in V42 (later)**: a new layout for any page; the graph's node shapes and fonts (a layout
change: `nodeWidth`); the intro on the app's start page; the README's screenshots (from V25, three
restyles old).

## As built (V42)

- **The canvas is the tile's centre itself, `#05080f`**, not the planned `#060a12`: the test of
  V31's step from content to chrome (≥ 1.10:1) failed at 1.097; `#05080f` gives 1.11.
- **The states and lanes kept every value**: on the navy surfaces each still passes 3:1 (lowest
  `--removed` 3.33:1 and `--lane-4` 3.37:1 on `--raised`; light `--error` 4.19:1). Only moved,
  info and context changed.
- **Two tokens more than planned**: `--primary-hover` and `--primary-shine`. A lighter blue under
  the pointer, as most dark UIs do, takes white under 4.5:1 (`#4375dc` 4.36:1): the hover is a step
  darker (`#3466cc`, 5.36:1; light `#2856b8`, 6.74:1), tested. The shine is a 1 px inset highlight
  on the primary's top edge; a ghost button resets it.
- **"Copy for the agent" is secondary** (found in the audit): with blue primaries it stood beside
  "Merge into" or "Send to the agent" as a second primary in one panel.
- **The mark reaches the window's title bar (20 px) and the app's start page (40 px)** too, which
  drew the same graph glyph; the start page takes the palette's tokens and the primary's hover.
- **The terminal** is `#02040a`, the koi's deepest water under the canvas, in its theme and its
  CSS (the drop frame and the link hint follow).
- **The guard on `--accent` was written with the code**, not seen red: nothing used the token
  before. The token tests were red first for the right reasons (8 of 28: the values, `--accent`
  missing, a selection that was a wash of the text).

**Results.**

| What | Measured |
|---|---|
| Contrast, dark / light (lowest over the four backgrounds) | text 13.16 / 16.08, muted 6.19 / 5.27, accent 5.74 / 4.82, states 3.33 / 3.26, edge 3.45 / 3.26, lines 1.31 / 1.21; white on the primary 4.73 / 5.62, on its hover 5.36 / 6.74 |
| `pnpm check` | 1,380 tests in 100 files, green |
| e2e | 216 of 217; the one, `shell.spec`'s "a card keeps the focus when its workspace moves", is the flake V37 and V38 measured on `main`; alone 6 of 6. It then stopped the merge's checks, and was fixed on this branch: a race in the test (see the journal's fix entry), 0 of 64 failures on 8 workers against 4 of 64 before |
| A diff (this repository's `e659928..7c223d4`, 1,975 symbols, 4,124 edges), 3 rounds alternated with `main`'s build | first paint 873–885 / 874–906 ms, select 189–237 / 170–256 ms, mark reviewed 48–80 / 52–85 ms, pan 63–65 / 62–63 fps; the same 846 nodes, 341 edges and 10,392 elements drawn |
| `/history` of this repository, 8 rounds alternated | first contentful paint median 64 / 64 ms, first rows 133 / 139 ms |
| Size | JS −4 bytes, CSS +653 bytes; the mark a 6,149-byte PNG |
| Screenshots | 27 states × 2 themes at 1440×900, device scale 1, before and after (History and its menus, compare mode, Start, a workspace's three tabs, changes and menu, a report, the folded rail, Scout, Skills, Settings, a diff's changes, findings, selection and map, a review, a merge and its conflict, a phone width); no page errors |

Not verified: Bitwarden's graph (no clone here; this repository's largest range instead); the
person's own window (Electron on WSLg at their scale); macOS and Windows rendering; a real agent's
colours in the restyled terminal.
