# Journal: V61 — The black theme of the mockup, the new S, bigger text

[Index](../JOURNAL.md) · [Plan](../plan/v61-complete-revamp.md)

## V61 spike — the mockup's colours against today's (2026-10-26, branch `feature/complete-revamp`)

The person's mockup (1586×992) is the README's workspace screenshot (`docs/images/workspace.png`,
1440×900) redrawn at 1.1×: the same workspaces, plan and panels. Its colours were read with a
small PNG decoder (Node's zlib, no image library in the repository): the most common colour of
each region, then the darkest, brightest and most saturated pixels of its text and controls.

**Learned**:
- **The mockup is compressed**: one flat region holds four to ten neighbouring colours (`#0d1015`,
  `#0e1015`, `#0e1115`…). The tokens are the region's most common colour, rounded to the palette's
  steps, not a single pixel.
- **The primary's text is dark**: "Respond" is `#020214` on `#7d68fd`. White on that violet is
  4.01:1, under the 4.5 `tokens.test.ts` asks; the dark text is 4.89. V42's rule (a darker hover,
  as white needs) turns around: the hover is lighter.
- **History's first lane** (`#b66dff`) is 1.09:1 from the new violet accent: a branch would read as
  selected.
- **The mockup's text is larger than today's**: its body lines are 26 px apart at 1.1×, 23.6 at 1×
  (today 20.3, 14 px at 1.45); nav rows 35.5 px apart at 1× (today 34).
- `palette-check.mjs` with the sampled values: every rule passes (text 15.24, muted 7.53, accent
  5.96, faint 4.05, edge 3.16, line 1.21 at their lowest).

## V61 — the mockup's black theme on every page, the new S, bigger text (2026-10-26, branch `feature/complete-revamp`)

Built as planned (decisions 437–440) and one more (445): the tokens and the type scale first
(`tokens.test.ts` red, then `base.css`), the hand-kept copies (the terminal, the merge log, the
desktop window, its start page), the icon from the person's image, then the shell and every page
as cards with line tabs. Decision 445: the diff sidebar's Changes / Findings are the mockup's
line tabs too, a segmented control kept for a mode (Files / Graph, a theme).

**Learned**:
- **`git mv` stages at once**: the two images renamed for the mark landed in the tokens commit
  (`920f179`), so that commit alone references `koi-mark.png` and does not build; `199f806` and
  every later commit do. The commits were pushed before it showed, and a review must not see them
  rewritten.
- **A border on React Flow's container moves its origin** a pixel from its box; the canvas's card
  edge is an outline drawn inside (`outline-offset: -1px`).
- **Gutters move every threshold measured in a page's width.** The changes panel showed from a
  1,200 px workspace: the wider sidenav left 1,176 at 1440, and it vanished (now 1,100). Skills'
  pane was 878 px at 1440, under the 880 where its checks go beside the text (now 860). A resizer
  between two cards is the gutter (`margin: 0`, 8 px), not a handle over a shared border.
- **A bigger font finds every fixed width set for the old one**: Activity's 48 px time column
  ("11:02 PM" ran into its mark), Scout's 300 px stepper ("Defaultlow"), the workspace head's
  state column at 900 px (its time ran under the buttons), a sidenav card 74 px (72 after its
  padding, then 72.00003 from the agent's mark on its line's baseline: its lines are now 18 px
  high). Each was found in a screenshot or an e2e test, not by reading the CSS.
- **The terminal pays for the bigger type**: Geist Mono at 15 px is a 9 × 19 px cell (8 × 18 at
  14). Beside the changes panel at 1440 × 900: 97 columns and 49 % of the window (110 and 56 %
  before); without it 127 × 40 (148 × 44).
- **A severity badge stretched to a wrapped rule** (a grid item, `align-self: stretch`): a tall
  amber blob on Bitwarden's findings, on `main` too; it keeps to its line now.
- **History's first lane went blue, so the merge page's branch side did not stay on it**: next to
  the target's cyan it read as the same side; it takes lane 4's magenta.
- **Decision numbers collide even after a check**: LG2 (`feature/grafana-dashboard`, merged into
  `main` meanwhile) read this plan's 437–440 and took 441–444; V61's fifth decision, first
  numbered 441, is 445. The message of `66d24cc` still says 441.

**Verification**: tests first — `tokens.test.ts` (the dark palette, the violet, the 15 px scale,
the graph keeping V32's) and `frame.test.ts` red, then green. `pnpm check`: 1,873 of 1,873.
`pnpm build`. `pnpm test:e2e`: 288 of 288 on the second run; the first found 16 failures, each a
measure of the old look (five fixed in the CSS, the rest updated with their reason). Contrast
(`palette-check.mjs`, the lowest over the four backgrounds): dark text 15.24, muted 7.53, accent
5.96, faint 4.05, edge 3.16, line 1.21; dark words on the primary 4.89, on its hover 5.77; light
accent 5.71, white on its primary 6.65. Bitwarden `737ee3f` (`measure.mjs`, three rounds,
alternated with `main`'s build from `git archive`): first paint 312 / 311 ms (medians, branch /
`main`), select 104 / 104 ms, mark reviewed 33 / 33 ms, pan 63 / 63 fps, the same 269 nodes, 135
edges and 3,151 page elements. Screenshots at 1440 × 900, 1×, dark and light, before and after:
History (empty, with commits, its row menu), Start, Scout, Skills, Monitor, Settings, a
workspace's four tabs, one to review, the folded rail, 900 px, a diff's Files and Graph with a
symbol open; the desktop app's window and start page under Xvfb.

Not verified: the icon in Windows' taskbar through WSLg and an installed launcher (it keeps the
old icon until `symbiote app install` runs again); macOS; the README's screenshots, which still
show the koi's look (they were staged by hand on a `cart` repository with real merges, a job of
its own).
