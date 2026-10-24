# V32 — Text one can read: a type scale, one step up

[Index](../PLAN.md) · [Journal](../journal/v32-type-scale.md)

**Status:** merged into main (2026-10-21, from branch `feature/font-too-small`, a workspace started
in Symbiote; approved in Symbiote at `eb7b076`); the person agreed to the plan: one step up, no
text-size setting for now. Its "As built" and results below.

**Problem** (asked: "The font-size is too small to read...i know i made the wrong decision. Find
a good font-size for different texts across the app. My eyes are hurting.."). V29b took the
reference's density (decision 180: "one scale: 11, 12, 13 (body), 14 and 16 px"), and V31 kept it.
Measured in `styles.css` on `main` (`bbee774`): 159 font sizes, every one a px value:

| Size | Rules | Where |
|---|---|---|
| 10 px | 8 | a symbol's and the panel's kind, key caps, sidenav counts, review and workspace marks, unchanged files on the map |
| 11 px | 29 | chips, badges, tags, section counts, category labels, menu notes, branch ages, dates |
| 12 px | 85 | buttons, menu items, search, the status bar, paths, commit authors and dates, and all code: diff rows, file paths, merge output |
| 13 px | 29 and the body | rows, nav, tabs, the thread, Settings, editors; the terminal (`AgentTerminal.tsx`) |
| 14–16 px | 12 | page and dialog titles, a symbol's name in its panel, a frame's name |

What a reviewer reads most — the change list's paths, the diff, the findings' messages, the
status bar — is 12 px or less. The desktop app's start page (N1b) copies the same sizes.

**Goal**: every text one step larger, nothing under 12 px but uppercase labels and one-glyph
marks (11 px); 14 px body, as GitHub's and Vercel's dashboards. Sizes named once, so the next
change is one line. **Unchanged**: the density (28 px rows and buttons, 44 px toolbars, the 24 px
status bar), the graph's layout (node sizes, `nodeWidth`'s estimate), the fonts, colours and
radii.

## The scale (viewer)

| Token | Value | Was | Role |
|---|---|---|---|
| `--size-caps` | 11 px | 10 | uppercase labels (a symbol's kind), one-glyph marks |
| `--size-caption` | 12 px | 10–11 | captions, chips, badges, counts, key caps, category labels |
| `--size-small` | 13 px | 12 | buttons, menu items, paths, code, the status bar |
| `--size-body` | 14 px | 13 | rows, nav, tabs, body text, editors |
| `--size-title` | 16 px | 14–16 | titles: a page's, a dialog's, a symbol's in its panel, a frame's name |

- On `:root` beside the font families, the same in both themes. Every `font-size` and `font` in
  `styles.css` uses one (or a multiple: the map's project names are `calc(2 * var(--size-body))`,
  28 px); a guard in `test/tokens.test.ts`, like the radii's.
- The terminal 14 px (xterm takes a number). The map's labels one step up too: file names 14 px,
  unchanged files 12 px, project names 28 px with the fit factor for 28 px (0.62 em a character).
- The graph's nodes grow inside their boxes: the name 14 px mono (8.6 px a character; `nodeWidth`
  counts 9.4), the signature 13 px, tags and badges 12 px, the kind 11 px; 58 px high still holds
  both lines. Long names, already cut at the 380 px width, lose a few characters: counted.
- The desktop start page: body 14 px, the rest at least 12 px, its title as it was (20 px).

## Verification

1. **Tests first**: `tokens.test.ts` — the scale's values, every size from it, no unknown token
   (red: 159 px sizes); `look.spec.ts` — no text under 12 px (11 for uppercase labels and one-glyph
   marks) on History, its row menu, Settings, the start page, a workspace's terminal and brief, a
   diff, its detail panel and findings; body and terminal 14 px (red: 13 px).
2. **Nothing else moves**: `flow.test.ts` unchanged (layout constants kept); `pnpm check`, build,
   every e2e; assertions tied to the old size (the terminal's rows) changed knowingly.
3. **Real graph**: Bitwarden `737ee3f` against `main`'s build, alternated: first paint, select,
   mark reviewed, pan fps; labels cut short as j walks 40 changes. `/history` first rows.
4. **Screenshots** before and after, 1440×900, dark and light: History, Settings, the start page,
   a workspace, a diff and its panel, the desktop start page.

**Risks**

| Risk | Mitigation |
|---|---|
| Text no longer fits a fixed height (rows, the 64 px card, key caps) | e2e and screenshots; fixed line heights reviewed |
| More labels cut short in the graph | Counted on Bitwarden against `main` |
| Fewer terminal rows | Measured; the e2e's floor changed with its reason |
| A font change slows the first paint (V29a, V29b) | No new family or file: the same variable fonts at other sizes; `/history` measured |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V32 | Text one can read | The `--size-*` scale, one step up, on every page, the graph, the terminal and the desktop start page |

**Decisions** (226–228 agreed with the person, 2026-10-21; 229 as built):

| # | Question | Decision | Why |
|---|---|---|---|
| 226 | How much larger | **One step: 14 px body, nothing under 12 px** but uppercase labels and one-glyph marks (11 px) | Asked: too small to read. Two steps (15 px body) would need 32 px rows; the person chose one |
| 227 | Where sizes live | **A `--size-*` scale on `:root`**, every size from it, guarded by a test | One line to change next time; the radii have the same guard (V31c) |
| 228 | A text-size setting | **Not now** (the person: "For the moment, no") | The scale makes it small later: a block of tokens per choice, as the theme |
| 229 | Titles (found building it) | **Stay at 16 px**; those at 14 px go to 16 | At 18 px a symbol's long name wrapped mid-word in its panel (Bitwarden's `vault-cipher-row.component.html`), and a frame's name outgrew the band `flow.ts` estimates at 10 px a character. Titles were not what was too small |

## As built (V32)

- **Five sizes, not six.** The plan's 18 px heading went: at 18 px Bitwarden's
  `vault-cipher-row.component.html` wrapped mid-word in its panel, and frame names would outgrow
  `bandWidth`'s 10 px a character. Titles at 16 px stay; those at 14 px (Settings', a
  workspace's, the start page's) go to 16 (decision 229). An agent's Markdown headings: h3 16 px,
  h4–h6 the body's 14 px, bold.
- **The close button's 18 px sized nothing**: its icon is 16 px. Dropped, not mapped.
- **The terminal keeps its columns**: xterm's cell at 14 px is the 8 px it was at 13; 148 × 44
  at 1440×900 instead of 148 × 46. `shell.spec`'s floor went from 45 rows to 43.
- **The sidenav's card stays within 64 px** at 14 px: its lines keep their 16 px line height.
- **The desktop start page** follows the scale but keeps its 20 px title and 16 px "×".
- **Commits by kind, not by region**: the stylesheet changed in one mechanical pass (157 sizes
  mapped one step up, two by hand), so the regions planned as separate commits are one.

**Results.** Tests first: `tokens.test.ts` (red: 159 px sizes) and `look.spec.ts` (red: a 13 px
body, 10–11 px chips, badges, key caps, dates). `pnpm check` 1,110 tests, e2e 172 of 172;
`flow.test.ts` unchanged. Against `main`'s build, Bitwarden `737ee3f`: first paint 332–368 ms
(`main` 355–367), select 120 ms, mark reviewed 51 ms, pan 63 fps; names cut short as j walks 40
changes 22 of 83 on both; frame bands overflowing 0 of 3 on both. `/history` first rows 161–177 ms
(`main` 166–240), first paint 64–72 ms (64–68). Not verified: the Electron app itself, other
browsers and systems, real agents in the terminal.
