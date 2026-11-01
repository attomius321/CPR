# V87 — Readable type at VS Code's density

[Index](../PLAN.md) · [Journal](../journal/v87-readable-type.md)

**Status:** planned, approved 2026-11-01, on branch `feature/font-sizes-too-small` (a workspace
started in Symbiote, from `main` at `6aed550`). The person chose design B on 1:1 designs, kept the
terminal at 14 px ("Terminal is ok as it is now") and asked for the text-size choice.

**Problem** (asked: "The font sizes are too small.. Make please some research to make it to the
accesibility standards...but still keep its density"). V85 set VS Code's 13 px body the day before.
The person had written "My eyes are hurting" about 13–14 px on 2026-10-21 (V32's brief).

| What | Today (`main` at `6aed550`) |
|---|---|
| Type (`--size-caps / caption / small / body / title`, code) | 11 / 11 / 12 / 13 / 16, code 13; terminal 14 |
| Rows, icon buttons (`--height-row`) | 22 px |
| Controls (`--height-control`) | 26 px |
| Text in `--faint` (line numbers, counts, a path's separators) | 4.05–4.58:1 |
| Line heights in px | 37, sized for V61's scale; V85 changed 4 |
| The person's screens | 27-inch, 2560 × 1440, Windows at 100 % (96 DPI); the app full-window at zoom 0: one CSS px is 0.233 mm |

**Research** (sources in the journal):

| Source | What it asks | Today |
|---|---|---|
| WCAG 2.2 AA, 2.5.8 Target size | A target 24 × 24 px, or spaced so 24 px circles on undersized targets do not meet another target | 22 px rows and icon buttons fail |
| WCAG 2.2 AA, 1.4.3 Contrast | Text 4.5:1 | `--faint` text 4.05–4.58:1 |
| WCAG 2.2 AA, 1.4.4 Resize text | Text to 200 %; no minimum size | the app's zoom (20 % steps) |
| Windows 11's type guidance | Body 14 px, caption 12; minimum 12 px regular, 14 px semibold | 11 px captions, chips, counts |
| Apple's macOS guidelines | Body 13 pt, minimum 10 pt | 13 |
| APCA (WCAG 3's draft) | Body text 14 px at Lc 90; our body Lc 97, dark `--muted` Lc 56 | 13 px body |
| Legge & Bigelow 2011 | Reading slows sharply under ~0.2° of x-height (0.15–0.3°) | 0.154° at 60 cm on the person's screen |

Geist's x-height is 0.532 em (measured in Chromium), Helvetica's, so the guides apply as written.

**Goal.** Design B on every page: 15 px body, nothing under 12 px, 24 px targets, the density of
V85 otherwise; a text-size choice the person makes in Settings without a branch; WCAG 2.2 AA's
target size and text contrast met and checked by tests.

**Unchanged**: the graph's type (V32's, decisions 438 and 715: node widths are estimated from it),
the terminal's 14 px, the colours, the fonts, the page frame's margins (`--page-pad`, `--page-gap`,
`--card-pad`), the title bar's 38 px.

## Part 1 (V87a): design B

| Token | V85 | V87 |
|---|---|---|
| `--size-caps / caption / small / body / title` | 11 / 11 / 12 / 13 / 16 | **12 / 13 / 14 / 15 / 18** |
| `--size-code` | 13 | **14** |
| `--height-row` | 22 | **24** |
| `--height-control / tall / tab / bar` | 26 / 28 / 30 / 34 | **28 / 30 / 32 / 36** |
| `--height-top` | 40 | 40 |
| `--card-head / --page-head` | 35 / 36 | **37 / 40** |

- Git's rows follow `--height-row` (`ROW_HEIGHT` in `history/GraphCell.tsx`, 24).
- **Line heights follow their size**: each `line-height: Npx` becomes
  `calc(var(--size-…) + Kpx)`, K the leading it has at B's size; a guard in `tokens.test.ts`
  refuses a line height in px. At B every line is what it is today or what V61 had.
- **Text 4.5:1**: text coloured `--faint` takes `--muted`, but disabled controls (exempt) and
  marks that are not text (a separator, a chevron, an icon).
- The guards' scale and density values take B's; the floor becomes 12 px.

## Part 2 (V87b): targets 24 px

An e2e check of WCAG 2.5.8 on every page of `page-frame.spec.ts`'s list: every visible target (a
button, a link outside a sentence, an input, a select, a `role=tab|option|row|menuitem`) is
24 × 24 px, or its 24 px circle meets no other target and no other undersized target's circle.
The geometry is a pure function with unit tests (`e2e/targets.ts`, the rule's own figures:
20 × 20 px buttons 10 px apart fail; 18 px menu items fail; 20 px tall buttons with 4 px above and
below pass). Each target that fails is fixed by its token, or by its spacing.

## Part 3 (V87c): the text-size choice

Settings → Appearance, under Theme: **Text size** — Compact, Default, Large.

| | caps | caption | small | body | title | code |
|---|---|---|---|---|---|---|
| Compact (design A) | 12 | 12 | 13 | 14 | 17 | 14 |
| **Default (B)** | 12 | 13 | 14 | 15 | 18 | 14 |
| Large | 13 | 14 | 15 | 16 | 19 | 15 |

- Only the text: heights, margins, the graph and the terminal stay. 16 px in a 24 px row is the
  largest that fits: a larger step would be a density change.
- Kept as the theme is: `symbiote.viewer.text-size` in this browser, set on `<html>`
  (`data-text-size`, absent for Default) by `index.html`'s script before the first paint, followed
  across tabs; the app keeps it across runs (`CHOICES` in `packages/desktop/src/state.ts`).
- `shell/text-size.ts` reads and changes it, as `shell/theme.ts` does the theme.

## Verification

1. **Tests first** (red): the scale, the density, the floor, the px line-height guard
   (`tokens.test.ts`); the target geometry (unit); the text-size store (unit); the choice in
   Settings (e2e: chosen, kept after a reload, before the first paint, the graph's sizes kept).
2. **E2E**: the target-size check on every page; `page-frame.spec.ts` and the specs on tokens.
3. **Every page, both themes, Hive on and off, 1x** at 2560 × 1354 (the person's window) and
   1440 × 900, at each text size: Git and its panes, Start, a workspace's tabs, History, Alpha
   Ceph/Nucleus, Skills, Monitor, Settings, a diff's Files and Graph; text zoomed 3× for uneven
   gaps; nothing clipped at Large.
4. **WCAG 1.4.4**: the app's zoom at 200 % (level 4) on Git, Settings and a workspace.
5. **First paint** of `/git` against `main`'s build, alternated, 3 rounds.
6. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| Fixed widths sized for 13 px text (time columns, steppers, chips) cut words at 15–16 px | screenshots at Large; widths from the text, or truncation with a tip |
| A box with a px height under 28 (chips 16–20 px) clips at Large | the screenshots at Large; heights from the line |
| The target check finds many small targets (help buttons, chips' close buttons) | fixed by spacing first (the rule allows it), size where spacing cannot |
| e2e checks on numbers | they measure tokens since V85; the rest moved to tokens |
| Another branch takes V87 or 760–766 | checked again before reporting ready |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V87a | Design B | the scale, the heights, Git's rows, line heights from sizes, `--faint` text, guards |
| V87b | Targets | the WCAG 2.5.8 check on every page and its fixes |
| V87c | Text size | Settings → Appearance's choice, before the first paint, kept by the app |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 760 | The type scale | **12 / 13 / 14 / 15 / 18, code 14; nothing under 12 px** | the person chose B on 1:1 designs; Windows' minimum 12 px; 15 px nears the critical print size on their screen |
| 761 | The density | **V85's, but rows 24, controls 28, tall 30, tabs 32, bars 36, card heads 37, the page's head 40** | WCAG 2.5.8's 24 px; 52 commits in view against 56 (V61: 44) |
| 762 | The terminal | **14 px, as V85** | the person: "Terminal is ok as it is now" |
| 763 | The text-size choice | **Compact 14 / Default 15 / Large 16, text only; kept like the theme, before the first paint, by the app too** | the person asked; the size is theirs to tune (WCAG 1.4.4's spirit) without a branch |
| 764 | Line heights | **Each its size plus a leading; px refused** | a choice changes sizes: a fixed line clips or crowds |
| 765 | `--faint` text | **`--muted` for text; `--faint` for disabled controls and marks** | WCAG 1.4.3: 4.05–4.58:1 under 4.5 |
| 766 | Target size | **WCAG 2.5.8 checked on every page by an e2e test** | V85's 22 px rows failed it unseen |
