# V37 — A look that is not dated: type, fields, hover, help in tooltips

[Index](../PLAN.md) · [Journal](../journal/v37-not-dated.md)

**Status:** merged into main (2026-10-23, from branch `feature/ui-improvements`, a workspace started
in Symbiote; approved in Symbiote at `76c6920`); the plan and decisions 246–248 confirmed by the
person ("1. B 2. Yes 3. Your recommandation"). The audit is in the journal ("V37 spike"); as built
and results under "As built (V37)" below.

**Problem** (asked: "the inputs, sidenav and everything looks kind of oldish...the hover
style..everything. You should keep the colors, i like them...but the elements are not that nice.
And the help texts should be in a tooltip, under a help button. The fonts are not good inside
inputs...seems different..fonts of the pages"; then "check every page for uneven spaces...and ugly
styling"). Audited on `main` (`7c223d4`): 35 states of every page, dark and light, at 1440×900 and
device scale 1 (what the person's WSLg window draws), with `e2e/symbiote.ts`'s fake agent:

| What | Measured |
|---|---|
| Uneven gaps between letters, every page | "n o commits", "fea ture/rename", "Noth ing", "half  function": the chrome's `letter-spacing: 0.01em` (0.13–0.14 px) on Linux's whole-pixel glyph positions. At 3× zoom, `letter-spacing: 0` evens them; `text-rendering: geometricPrecision` too, blurrier and with a cost to measure |
| Text in controls unlike the page's | Every input, textarea, select and button computes `letter-spacing: normal` (Chromium's form-control default; `font: inherit` does not reset it) against the page's 0.14 px; the start page's Branch and Settings' prompt editor in Geist Mono |
| Text fields | A 1 px `--edge` (#737373, 3.78:1) on every field, the brightest line on most pages; focus adds a 2 px solid ring over it; textareas show the resize grip; heights 34 px (Title, Branch) beside 28 px selects |
| Hover | A row's hover (8 % wash) and the current page (10 %) look the same; the sidenav's cards hover with another recipe (`--raised` 40 %, barely visible in light), and the picked card adds a border and a shadow; History's cursor row is boxed by a bright line |
| Glyphs as icons | "?" in a bordered circle (Settings, History), "ⓘ" (the start page's kinds), "▸" (submenus), "▶" (the Thread's prompt), "←" ("← History", "← All prompts") |
| Heads | Start and Scout: the content 8 px right of the page's title (x 264 against 256); Start's Cancel and Clear bare text beside a grey Start; History in compare mode: the instruction wraps the head from 44 to 58 px; a stopped workspace says "Stopped" twice; the merge page has no head at all |
| Tabs and panels | A workspace's Terminal / Thread / Brief as folder tabs (in light, a black tab on white chrome); its changes column in capitals (COMMITS, FILES, NOT COMMITTED); the diff's "Used by" a bulleted list; the zoom buttons three loose icons; the minimap over nodes when the detail panel is open; the review tab's key strip on three lines ("Esc" and "close" apart) |
| Sidenav | The needs-you count a solid amber square beside round grey counts; a 6-line paragraph when there is no workspace |
| Help on the page | Settings: each prompt's description, Scout Effort's paragraph; Scout's lede and its keys; the review's verdict paragraph; the Thread's "To answer it, open its terminal"; the empty sidenav's paragraph; compare mode's instruction; the diff's key strip and its "click a symbol for details…"; two help texts only in a `title` (the start page's Effort and Codex's Sandbox) |

What causes it: V31 restyled tokens, surfaces and controls one by one, and kept V29b's
letter-spacing and V31's 3:1 field edge; help grew as paragraphs where each feature was added.

**Goal**: the same colours, in controls and states that read as current: one text in the page and
its fields, quiet field edges that answer hover and focus, a hover that is not the selection, icons
for glyphs, one head on every page, and the help behind a "?" that shows it as a tooltip. What must
not change: colours (surfaces, states, lanes), behaviour, keys, roles and names (but the help's
text, now in a tooltip), the graph's layout (node sizes, `layoutFlow`), the fonts and their cost,
the map's timings.

## Type

- `letter-spacing: 0` on `body` (the graph has had it since V29b): even gaps at 1×, and the page and
  its fields alike. Controls take `letter-spacing: inherit` with `font: inherit`.
- Mono only for what is literal (SHAs, code, paths shown as code): the Branch field and Settings'
  prompt editor (prose with `{placeholders}`) in Geist.

## Fields (decision 246)

- One rule for every text field and select: 32 px (28 px in a toolbar: History's filter), 8 px
  radius, `--input-bg`; at rest a soft edge, a new translucent `--field-line` (15 % of the text,
  about 1.5:1); on hover `--edge` (3:1, tested); on focus `--focus` and a 3 px ring
  (`--ring`, 30 % of `--focus`) in place of the 2 px outline.
- Textareas without the grip: `field-sizing: content` between a minimum (their rows today) and a
  maximum, then scroll.
- Checkboxes and radios keep `--edge` (a control that is only its edge); their focus takes the ring.

## Hover and selection (decision 250)

- Dark `--hover` 8 % → 5 % of the text, so a hover is lighter than the selection (10 %); light
  keeps 5 % (lower vanishes on white, tokens.md).
- One recipe for rows and cards: hover `--hover`, the picked `--selected` with no border or
  shadow; History's cursor an inset ring in `--selected-line`, not a bright box.

## Sidenav

- Counts one style (round, `--raised`; needs-you its state's tint, not a solid fill); group
  headings 13 px 600 in `--muted` with their dot; idle icons stroke 1.75, the current page's 2.25.
- No workspace: one line and the help button with the paragraph's text.

## Heads, buttons, icons

- Start: Cancel and Clear ghost buttons; Start and Scout's content aligned with the title.
- Glyphs to lucide icons in `icons.tsx`: `CircleHelp` (help), `ChevronRight` (submenus, the
  Thread's prompt), `ArrowLeft` (the ways back).
- A stopped workspace's head says it once; the merge page gets the 44 px head the other pages have.

## Tabs and panels

- A workspace's Terminal / Thread / Brief as a segmented control (`role="tab"` kept).
- Section headings in sentence case (the changes column); "Used by" and "Uses" as plain rows.
- Zoom buttons in one floating card; the minimap moved clear of the detail panel; the review tab's
  key strip without breaks inside an entry.

## Help in tooltips (decisions 247, 248)

- `Help.tsx` becomes the one help button: a 24 px ghost icon button (`CircleHelp`); hover (after
  300 ms) or focus shows the help, a click keeps it open until a click elsewhere or Escape. The
  text is a popover (`--panel`, `--line`, 10 px radius, `--shadow-floating`, 13 px, at most 320 px
  wide) placed `position: fixed` from the button's box and kept 8 px inside the window (a pure
  `placeTip` in `src/tips.ts`, unit-tested), so a scrolling panel cannot clip it. `role="tooltip"`
  and `aria-describedby` while shown; the text stays in the page for screen readers.
- Moved behind it: Settings' page help, each prompt's description and Scout Effort's paragraph
  (beside their titles); the start page's kinds (`ⓘ`), Effort's and Codex's Sandbox's `title`s, and
  the worktree's path (beside Branch, 248); Scout's lede and keys; the review's verdict paragraph;
  the Thread's "To answer it…"; the empty sidenav's paragraph; compare mode's instruction (in
  History's help); the diff's key strip and "click a symbol for details…" (a help button in the
  diff's bar; the colour legend stays, 247).
- Stays on the page: states, warnings, errors, notices, loading lines, placeholders, empty states'
  one line.

## Verification

1. **Tests first** (red on `main`): `look.spec.ts` — every visible control has the body's font
   family and letter-spacing (today `normal` against 0.14 px, and two fields in Geist Mono); text
   fields one height; a field's edge at rest is not `--edge` and its focus is a ring; History's
   page shows no help text until its button is hovered, focused or clicked, then a `tooltip`
   linked by `aria-describedby`, closed by Escape. `tokens.test.ts` — the hover differs from the
   selection; `--field-line` and `--ring` in all three theme blocks. `tips.test.ts` — `placeTip`.
2. **Nothing else changes**: `pnpm check` (`flow.test.ts` untouched); e2e, with the specs that read
   moved help text opening the help first.
3. **Real graph**: Bitwarden `737ee3f` (`viewer-check`), first paint, select, mark reviewed, pan fps
   and labels cut short against `main`'s build; `/history` first rows.
4. **Screenshots**: the audit's 35 states × 2 themes after, beside the before ones; 3× crops of text.
5. **Cost**: first paint and pan within ±10 % of `main`.

**Risks**

| Risk | Mitigation |
|---|---|
| A soft edge hides a field (WCAG 1.4.11 asks 3:1 for a control's boundary) | Every field has a visible label; `--edge` (3:1) on hover, `--focus` and a ring on focus; the person chose it (246) |
| Help out of sight is help not read | Only explanation moves; states, warnings and errors stay; the button next to what it explains |
| Letter-spacing 0 changes text widths and cuts | Narrower, not wider; the graph already at 0; labels cut counted on Bitwarden |
| `field-sizing` unsupported | Chromium 123+ (the window is Electron 44); elsewhere the rows' height, as today |
| A restyle hides a behaviour change | CSS and markup; roles and names kept; e2e |

**Order**: type, then fields, hover and sidenav, heads and panels, then the help button and its
moves; screenshots and timings at the end.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V37 | A look that is not dated | Type; fields; hover; sidenav; heads, icons, tabs, panels, the merge head; the help button and help texts behind it; the `symbiote-style` skill |

**Decisions** (246–248 confirmed by the person; 249–250 in the plan they approved):

| # | Question | Decision | Why |
|---|---|---|---|
| 246 | A text field's edge | **Soft at rest (about 1.5:1), `--edge` (3:1) on hover, `--focus` and a ring on focus** (confirmed: "B") | The bright edge was the inputs' dated look; previews of both shown first. It gives up V31's 3:1 at rest |
| 247 | The diff's key strip and canvas hint | **Behind a help button in the diff's bar; the colour legend stays** (confirmed) | The brief asks help in tooltips; 216 had left them for later |
| 248 | The start page's worktree path | **In Branch's help** (confirmed) | A long mono path under the field was the start page's noisiest line |
| 249 | The chrome's letter-spacing | **0** (was 0.01em) | 0.13–0.14 px rounds into uneven gaps at 1× on Linux; the fields used 0 |
| 250 | Hover and selection | **Dark hover 5 % (was 8 %); selection 10 %; light unchanged** | 8 and 10 % looked alike |

**Not in V37 (later)**: drawn tooltips for icon buttons' `title`s (13 e2e read them); a command
palette; new colours.

## As built (V37)

- **Tracking off everywhere, not only on the body**: the titles' −0.01em and the nav's −0.025em
  round into the same uneven gaps; only uppercase labels keep theirs.
- **The tip is drawn on the page's body** (a portal), not fixed inside the page: the start page's
  `container-type` makes a containing block for `position: fixed`, and the main area clips. Tests
  find tips by role or id, not inside a region.
- **A tip shown by a hover lets the pointer through**; a click keeps it and it takes the pointer.
  The kinds' tip covers the Title field, and moving there must reach the field (the V24c test
  hovers it).
- **Help buttons are in the Tab order** before the field they explain (Branch, Effort): focus shows
  the help. A help button sits beside a `<label htmlFor>`, not in it, or it joins the field's
  name.
- **A workspace's tabs are flat buttons on a strip**, the picked one `--selected`, as they already
  were in Symbiote's title bar (N1c), not a segmented track: the tablist is the strip itself.
- **The minimap is smaller** (160 × 112 against React Flow's 200 × 150) rather than moved: its
  corner is React Flow's; it covers less of the canvas beside the detail panel.
- **The Thread's line is an action**, not help: "To answer, open its terminal." (the button e2e
  uses keeps its name).
- **Found by the audit and fixed with the rest**: a workspace's mark in History and the branches
  panel (a box drawn in its tone) is a round tint; the zoom buttons' hover went darker than the
  others (a translucent wash over the canvas), now opaque; Settings' placeholder list is headed
  "Placeholders", how to insert one in the prompt's help.
- **Kept**: the merge page's branch chips keep their sides' colours (a state its regions use);
  native `title`s on icon buttons.
- **Tests first, with two exceptions**: `tips.test.ts` was written with `placeTip` and the help e2e
  after `Help.tsx`; neither was seen red.

**Results.** Tests first, red on `main` for the right reason: `look.spec.ts`'s text test (the body
at 0.14 px and 12 controls at `normal` on History alone), its fields test (the edge at rest
`rgb(115, 115, 115)`), `tokens.test.ts` (no `--field-line`, `--ring`; dark hover 8 against 10).
`pnpm check` 1,271 tests (`main` 1,263); e2e 198 of 198. Specs changed where text moved
behind a help (the worktree's path, the review's verdict, History's compare instruction read
there), where names changed ("Back to History", "All prompts"), and the Tab order (two help
buttons). Against `main`'s build, alternated, 3 rounds, on a real graph of this repository
(`e659928..7c223d4`, V31 to V36: 1,975 symbols, 4,124 edges, 343 files; no Bitwarden clone here):

| What | `main` | V37 |
|---|---|---|
| First paint | 904–942 ms | 896–948 ms |
| Select · mark reviewed | 275–301 · 64–67 ms | 273–279 · 65–67 ms |
| Pan | 62 fps | 62–63 fps |
| Nodes drawn in view | 831 | 846 |
| `/history` first paint · first rows (6 rounds) | 60–68 · 152–259 ms | 60–68 · 157–183 ms |

The 15 more nodes are a taller canvas: on `main` the legend wrapped its hint onto a second line
(32 px); node positions are the same. Screenshots of 35 states of every page, dark and light, at
1440 × 900 and 1×, before and after, and five help tips open.

Not verified: the Electron window on WSLg (the person's); Bitwarden's graph; Windows and macOS
text rendering; real agents in the restyled pages.
