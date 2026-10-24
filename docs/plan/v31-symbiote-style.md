# V31 — Symbiote's style, beyond its colours

[Index](../PLAN.md) · [Journal](../journal/v31-symbiote-style.md)

**Status:** V31a, V31b and V31c merged into main (2026-10-21, from branch
`milestone/v31-symbiote-style`): their "As built" and results below. Confirmed by the person ("Yes";
V31c: "Continue with v31c"; the merge and decisions 212–217: "yes").

**Problem** (asked: "The interface still not feel well...feel oldish with a new look"). V29b took
the reference's tokens and Geist; the rest of the look is older than its colours. Measured on
`main` (`e659928`) at 1440×900, against a reference app's style guide, tokens and primitives:

| What | Symbiote today | The style |
|---|---|---|
| Surfaces | Page `#0b0b0c`, sidenav `#111113`, panels `#161618`: 1.04 and 1.09:1 from the page; toolbars on the page's colour | Canvas `#0a0a0a`, sidebar, title bar and cards `#171717` (1.10:1): chrome lifted, content darkest |
| Accent | Blue (`--moved`) on 49 lines: 2 the moved kind, 12 states (working, "since", the current lane), 35 accent: links, selection, picks, cursors, pressed toggles, Settings' changed marks | None: selection a 10 % wash of the text and a brighter border; focus ring grey; colour for state only |
| Checkboxes | Native, `accent-color` blue: 6 (the diff's Focus, Context, Type references, Only since; the change list; the start page) | Drawn: 16 px, 4 px radius, filled in the primary colour when checked |
| Side bars | A 3 px coloured left border on 8 rules (findings, notices, drafts, merges, the commit cursor's inset) | None: a dot, an icon or a tinted badge |
| Chips and badges | 4 px boxes with a border; History's branch refs blue mono; HEAD solid green; findings' severities 16 % tint, weight 600 | Chips `secondary` without a border; badges round, 10 % tint, 25 % border, weight 500 |
| Radii | 4 px ×29, 6 px ×28, 8 px ×6, 2/3/12/999 px | 8 px controls and rows, 10 px dialogs and popovers, 11 px menus, 14 px cards, round badges |
| Mono | 29 rules, branch names in the sidenav and History | Literal text only |
| Glyphs as controls | `←` `▸` `▾` `⋯` `?` and letters beside nav entries | lucide icons; keycaps on hover or in tooltips |

What causes it:
- V29b changed tokens and density, by design "the look only"; controls, states and selection kept
  V6–V28's patterns, which came from GitHub's.
- `--moved` doubled as the accent from V6 on: every new selected or pressed state reached for it.
- The light theme kept V6's warm `#f7f7f5`; the style's is white with grey chrome.

**Goal**: Symbiote has one style, rule by rule (the `symbiote-style` skill): lifted neutral chrome around
the darkest content, colour for state only, drawn controls, soft geometry. What must not change:
behaviour, roles and names (every e2e selector but the look spec's colours), layouts (node sizes,
`layoutFlow`'s output), the fonts and their cost, contrast floors, the map's timings.

## Tokens

- The skill's `tokens.md`: dark `--bg #0a0a0a`, `--side`/`--panel #171717`, `--raised #262626`,
  `--line #2a2a2a`, `--text #fafafa`, `--muted #a1a1a1`; light white with `#fafafa` chrome;
  git-decoration colours for the diff kinds (VS Code's), status colours for severities. Every
  tested token passes `tokens.test.ts`'s floors (`palette-check.mjs`); 11 values were moved to the
  nearest neutral that passes.
- New tokens, translucent where they need to be: `--hover`, `--selected`, `--selected-line`,
  `--primary`, `--primary-text`, `--input-bg`, `--shadow-lift`, `--shadow-floating`, menus',
  dialogs' and the overlay's.
- `--moved` is a state: kept for the moved kind and the states named above; every accent use moves
  to the neutral tokens. A unit test lists the rules allowed to use it.

## V31a — the tokens and the shell

- Sidenav: pages as 32 px rows (13 px, 500; idle `--muted`, icon `--faint`; current `--selected`),
  group headers with round counts, cards with a 10 px radius, hover and current per the skill;
  branch names in sans.
- Page heads (History's, a workspace's, Settings', the start page's) and the diff's bar on `--side`;
  their height stays 44 px (decision 213).
- Status bar segments; usage bars neutral until the warning threshold (green said "fine" in a
  state colour).
- Base controls everywhere: `.button` primary in `--primary`, secondary, ghost; 8 px radius; text
  fields with `--input-bg`; checkboxes drawn (`appearance: none`, the `<input>` kept: roles, labels
  and selectors unchanged); segmented controls (History's scope, Appearance, the kind);
  the "?" a ghost icon button; thin neutral scrollbars; letter-spacing 0.01em and antialiasing on
  the chrome, 0 on the graph (node widths are estimated from characters).

## V31b — the diff page

- Bar: diff counts as coloured numbers, "23 files" a chip, findings a round badge; "← History" a
  ghost link with an icon.
- Sidebar: line tabs in the text colour; findings without side bars (a round
  severity badge leads); rows' selection and the j/k cursor neutral; the key strip's keycaps.
- Canvas: project frames and file boxes on the skill's radii; a selected symbol's ring in the text
  colour (box-shadow, no size change); summary nodes' hover neutral; zoom controls and minimap as
  one floating card; no shadows, blur or transitions on nodes.
- Detail panel: diff lines on tinted grounds (16/30 % added, 18/32 % removed), findings as the
  sidebar's, buttons and keycaps as the shell's.
- The legend stays where it is (decision 216).

## Verification

1. **Tests first** (red on `main`): `tokens.test.ts` with the style's values; a guard that `--moved` is
   used only by the listed state rules (35 accent uses fail today), none of the 8 coloured side
   bars, no `accent-color`; `look.spec.ts`'s page colours (`rgb(10, 10, 10)`, white) and the
   sidenav lifted above the main area.
2. **Nothing else changes**: `pnpm check` (layout tests untouched), e2e 167 of 167 with no
   selector changed outside `look.spec.ts`.
3. **Real graphs**: Bitwarden `737ee3f` (`measure.mjs`), first paint, select, mark reviewed and
   pan fps against `main`'s build, three runs each; labels cut short as j walks 40 changes.
4. **Screenshots**: the shell with three workspaces, History, Settings, Start, and the V30b diff
   (map, a selection, findings), dark and light at 1440×900, before and after, to the person.
5. **Cost**: first paint and pan within ±10 % of `main`; `/history` first rows unchanged.

**Risks**

| Risk | Mitigation |
|---|---|
| A restyle of 5,165 lines hides a behaviour change | CSS and class names only; e2e unchanged but for the look spec's colours; V31a and V31b on their own commits |
| Neutral selection is harder to see than blue | `--selected` 10 % wash plus `--selected-line`; the j/k cursor an inset ring; screenshots in both themes; the person judges |
| New diff-kind colours confuse a reviewer used to GitHub's | Same hues (green, red, amber, blue), new tones; the legend shows them |
| Letter-spacing widens labels | 0 on the graph; labels cut counted as V29b did |
| Drawn checkboxes lose a native affordance | The `<input>` stays: keyboard, label clicks, screen readers as before |

**Order**: tokens and their tests, then V31a (shell and controls, which every page uses), then
V31b; screenshots after each.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V31a | The tokens and the shell | The style's tokens in both themes, `--moved` a state only; sidenav, page heads, status bar; buttons, fields, checkboxes, segmented controls, scrollbars |
| V31b | The diff page | Bar, sidebar, findings, canvas chrome, detail panel |
| V31c | History, Settings, a workspace, menus and dialogs | History's refs and HEAD, row menus as glass menus, confirmations as floating dialogs, the thread and changes column; after the person has seen V31a–b |

**Decisions** (212–217 confirmed by the person, 2026-10-21):

| # | Question | Decision | Why |
|---|---|---|---|
| 212 | Native checkboxes: toggle buttons or drawn? | **Drawn** (`appearance: none` on the `<input>`) (confirmed) | The style's checkbox; roles, labels and the 6 controls' selectors stay; toggle buttons would change roles in 4 specs |
| 213 | Page heads 36 px as the reference's title bar, or V29b's 44? | **44 px** (confirmed) | The reference's 36 px strip is its title bar, which Symbiote's window already has (N1c); heads align with the branches panel's |
| 214 | What `--moved` may colour | **The moved kind and states** (working, "since", the current lane) (confirmed) | Colour is for state; 35 of 49 uses were accent |
| 215 | Light theme's page | **White, chrome `#fafafa`** (confirmed) | V6's warm `#f7f7f5` is the one light value not from the reference |
| 216 | The legend and key strip into a "?" | **Not in V31** (confirmed) | Moves information; the look only |
| 217 | Diff kinds' colours | **Git-decoration colours** (VS Code's) (confirmed) | Their tones on the new surfaces; same hues as today |

**Not in V31 (later)**: Tailwind or shadcn (a new dependency for a look plain CSS gives); a
tooltip component (titles stay); a command palette; moving the legend (216).

## As built (V31a–b)

- **Hover and selection**: the dark theme gives the sidenav and the panels one colour
  (`#171717`), so 13 hover and selected rules painted with `--panel` or `--raised` would not have
  shown; they use `--hover` and `--selected`. A `--lifted` token draws the segmented control's
  choice above its track in both themes.
- **Links**: the text's colour, underlined on hover, for `.link`; links in Markdown
  and hints stay underlined. Settings' placeholders are insert buttons that looked like links:
  drawn as code chips.
- **Settings' "changed" marks** take `--modified`, not a neutral: "changed from Symbiote's" is a state.
- **Symbols**: the plan's canvas list kept the side bar; the guard against side bars reached it.
  A symbol's kind is a 9 % ground and a 55 % edge of its colour; the 2 px the bar took went to
  padding, so labels keep their width (21 of 75 cut on Bitwarden, as on `main`).
- **Side bars outside the diff** (History's compare cursor, what an agent waits on, merges) went
  in V31b with the guard: a ring, a warning tint, a tone dot.
- **Two e2e besides the look spec** read a colour: `app.spec.ts` (the window's buttons take
  `--side`: new values) and `angular-v11.spec.ts` (a symbol's colour read from its left border:
  now its tone, compared with the legend's as before).
- **Left for V31c** (built since, below): 13 rules on the old 6 px radius, History's solid HEAD
  badge and mono branch names, the kind picker, menus and dialogs.

**Results.** Tests first, red on `main`: 7 unit (the style's values in both themes, the new tokens,
`--moved` in 29 accent rules, `accent-color`, 7 side bars) and 3 e2e (`look.spec.ts`'s colours, the
lifted chrome). `pnpm check` 1,075 tests; e2e 168 of 168. Against `main`'s build, alternated:

| What | `main` | V31 |
|---|---|---|
| Bitwarden `737ee3f`, first paint (3 runs) | 266–272 ms | 268–272 ms |
| select · mark reviewed · pan | 74 ms · 34 ms · 63 fps | 73–89 ms · 33 ms · 63 fps |
| Page elements | 3,134 | 3,134 |
| Labels cut short as j walks 40 changes | 21 of 75 | 21 of 75 |
| `/history` first rows (5 runs) | 93–122 ms | 93–96 ms |

Screenshots, dark and light at 1440×900, before and after: the shell with three workspaces,
History, Settings, Start, and the V30b diff (the map, a selection, findings). Not verified: Windows
and macOS rendering (antialiasing, scrollbars); Symbiote's Electron window beyond its e2e; real agents
in the restyled workspace.

## As built (V31c)

- **History**: refs are names in the text's font on raised chips (SHAs stay mono); HEAD's badge
  and title chip take the success tint, the badge's edge an inset shadow so every badge keeps
  one height; the two rules that drew marks light on the solid badge are gone. The branches
  panel's and a workspace head's branch names in sans.
- **Menus**: a glass. The blur sits on a `::before` layer behind the items: on the menu
  itself, `backdrop-filter` made it the containing block of its `position: fixed` submenu, which
  opened off screen (y 1,467 in a 900 px window; 10 checkout, review and merge e2e tests failed).
  Faded in by opacity only: a scale would change the boxes the menus measure to stay in the
  window. Items 12 px, weight 450.
- **Dialogs**: a dimmed, blurred backdrop, a glass and a shadow; Cancel a ghost button (backing
  out stays quiet). The target's chip in the heading is aligned by hand: `.ref`
  hides its overflow, which puts an inline block's baseline at its bottom edge.
- **Selects**: a field with lucide's chevron, drawn from a token per theme (a data URI cannot read
  a colour token).
- **Radii**: every `border-radius` on one scale (0, 4, 8, 10, 11, 14 px, round, or `inherit`):
  14 declarations moved; a unit test keeps it.

**Results (V31c).** Tests first, red: the radius scale (14 off), and in the look spec History's
names in the text's font, HEAD a tint, the menu's glass. `pnpm check` 1,076 tests; e2e 169 of 169.
Against `main`'s build, 5 rounds alternated with V31b's: Bitwarden first paint 265–289 (`main`),
257–296 (V31b), 261–295 ms (V31c); select 74, 72–74, 73–88 ms; mark reviewed 33, 33–34, 33–34 ms;
`/history` first rows 92–121 → 93–96 ms. A first run read select at 88–106 ms on V31c; five
alternated rounds put it at `main`'s. Screenshots before and after, dark and light: History, a
row's menu and submenu, a confirmation dialog, a workspace's thread, Start, Settings.

## As built (the name)

- **Symbiote's own style** (asked: no reference app's name in documents or branch names, "It is our
  own style from now"): the skill is `symbiote-style` (it was merged into main under another
  name, renamed here), the branch `milestone/v31-symbiote-style`, and no document, comment or test
  names the reference app. Commit messages already on `main` keep their words.
