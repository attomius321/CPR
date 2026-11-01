# Journal: V87 — Readable type at VS Code's density

[Index](../JOURNAL.md) · [Plan](../plan/v87-readable-type.md)

## V87 plan — the research and three designs (2026-11-01, branch `feature/font-sizes-too-small`)

The person found V85's 13 px too small a day after choosing it on mockups, and asked for the
accessibility standards' answer at the same density, then designs in Hive and normal mode before
any work. Three designs (today, A: 14 px body, B: 15 px body) were screenshotted at the person's
own window, 2560 × 1354 at 1x, over a `git archive` build in the job's tmp whose Git row height and
terminal size read a global, on a scratch clone of this repository, the sidenav answered with the
person's real workspace list (one read of their running view's `/api/workspaces`, `/api/reviews`,
`/api/merges`). The person chose B, the terminal as it is, and the text-size choice.

**Learned**:
- **The person's pixel is small**: two 27-inch screens at 2560 × 1440, Windows at 100 % (96 DPI),
  the app full-window at zoom 0 (`~/.config/symbiote/app/state.json`). One CSS px is 0.233 mm,
  12 % under the 96-dpi px the guides assume: 13 px body is 0.154° of x-height at 60 cm, at the
  bottom of the critical print size's range (0.15–0.3°, 0.2° typical). VS Code's 13 px is macOS's
  13 pt, mostly drawn on 2× screens.
- **WCAG sets no minimum font size**; what it does ask, V85 failed twice: 22 px rows and icon
  buttons under 2.5.8's 24 px targets (stacked rows' 24 px circles overlap: a wide row does not
  help), and `--faint` text at 4.05–4.58:1 under 1.4.3's 4.5.
- **Windows' minimum is 12 px regular** ("Text smaller than these sizes and weights are illegible
  in some languages"); V85's captions, chips and counts were 11.
- **Geist's x-height is 0.532 em**, Helvetica's (measured with a canvas in Chromium), so APCA's
  and the guides' sizes apply to it unchanged.
- **Dark `--muted` passes WCAG 2 at 8.5:1 and is weak by APCA** (Lc 56; light Lc 81): WCAG 2's
  ratio flatters light text on dark. Not changed: APCA is a draft.
- **An init script's `<style>` on `documentElement` is dropped by the parser**: a design's tokens
  went in from a `MutationObserver` that appends to `document.head`.
- **V85 changed four line heights**; the other 33 in px were set for V61's scale, which B nearly
  is, so B fits them; the text-size choice needs them to follow their sizes.

**Sources**: [WCAG 2.2, Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html);
[Typography in Windows 11](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography);
[Apple HIG, Typography](https://developer.apple.com/design/human-interface-guidelines/typography);
[APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html);
[Legge & Bigelow 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264). The designs:
`https://claude.ai/artifact/SbY6qQ3mMJ3KVJkHBwcfHW` (private).

## V87a, V87b — design B and the target check, built (2026-11-01, branch `feature/font-sizes-too-small`)

The scale 12 / 13 / 14 / 15 / 18, code 14; rows 24, controls 28, tall 30, tabs 32, bars 36, card
heads 37, the page's head 40; Git's rows 24; every line height from its size; `--faint` text
`--muted`; WCAG 2.2's 2.5.8 checked on every page (decisions 760, 761, 764–766).

**Learned**:
- **Most line heights were V61's**: of 37 `line-height`s in px, V85 had changed four; the rest
  were sized for 12 / 13 / 14 / 15 / 17, which B nearly is. Made `calc(var(--size-…) + K)` with
  V61's leading, they are unchanged at B and follow the text size.
- **The `font` shorthand hides line heights**: five rules set `…/20px` in it, which a guard on
  `line-height:` alone passed; the guard reads the slash now (with a `calc()`'s spaces: the first
  regex cut it at the first space).
- **A target check by roles misses Git's rows**: commit rows are elements with a handler and no
  role. The first version found 48 targets on Git and passed `main`'s 22 px rows; with the
  outermost element that shows a pointer it finds 59 there, and fails 35 on `main`'s build, 1 on
  the branch (a row's 20 px menu).
- **A flex row squeezes a fixed square**: the commit menu, 24 px wide, was 21 at Large, where the
  row's words are wider: `flex: none`.
- **A link's target can grow without moving its line**: padding and an equal negative margin give
  the sidenav card's branch link a 24 px box on its 20 px line.
- **WCAG's own exceptions cover two cases honestly**: a diff's line-number buttons are sized by the
  code's line (inline), and a card's name button does what a click on the card does
  (equivalent). Both are named in `e2e/targets.ts` rather than fixed by growing every code line or
  card line.

**Verification**: tests first (red: the scale, the density, the floor, px line heights, `--faint`
text; then the shorthand); `pnpm check` 2,679 tests. The first full e2e run: 370 of 376, the six
failures checks on V85's numbers (28 px buttons, 26 px fields, the title at x 50, cards from 60,
35 px heads), moved to V87's. A run of the changed specs and Git's, workspaces' and the targets':
91 of 92; the one (a sidenav card's name box compared before and after a hover) moved 18 px
under load and passed 3 of 3 alone.

## V87c — Settings' text size, built (2026-11-01, branch `feature/font-sizes-too-small`)

Appearance's Text size (decision 763): Compact 14 px body (design A), Default 15 (B), Large 16;
`shell/text-size.ts`, `data-text-size` set by `index.html`'s script before the first paint, the
app keeping `symbiote.viewer.text-size` across runs.

**Learned**:
- **The app forgets a choice it does not list**: each run's server is a new origin with empty
  storage, and the app puts back only `CHOICES` (`packages/desktop/src/state.ts`); without the
  key there, the text size would have lasted one run in the window.
- **16 px is the largest text the density holds**: 16 px at 1.45 is 23 px, inside a 24 px row;
  Large's step stops there (a larger one changes the heights, which the person kept).
- **A label column in px wraps at a larger size**: Settings' names (104 px) and Start's
  (`--start-name`, 124 px) wrapped "Commit details" at 15 px and "Branch name" at Large; both
  follow `--size-body` now. Found on the screenshots, not by a test.
- **Restart the view after a build, and check it is the new one**: a SIGINT left the old
  `symbiote view` holding its port for a while, the new one exited with EADDRINUSE, and a round of
  screenshots came from the build before; the served stylesheet's text tells which.

**Verification**: tests first (red: no `text-size` module, no `data-text-size` blocks, five app
choices); `pnpm check` 2,690 tests; `look.spec.ts` (chosen, kept before the first paint, a row's
height kept, the graph's scale kept, Default unmarks) and `targets.spec.ts` at each size, a
review's Graph included; `pnpm test:e2e` 379 of 380 viewer (the honeycomb's diff head read an
empty colour under load; 3 of 3 alone), 20 of 20 nexus. Screenshots of every page at 2560 × 1354
and 1440 × 900, both themes, Hive on and off, Default; Large and Compact in dark; the app's 200 %
on Git, Settings and Start. First contentful paint of `/git` against `main`'s build, alternated,
15 loads each, two runs: 72 / 76 and 72 / 72 ms (main / V87).

Not verified: the person's own window (WSLg, their GPU); a workspace's page with a live agent's
terminal at Large (the terminal stays 14 px by design); Bitwarden's graph (the graph's type is
unchanged).
