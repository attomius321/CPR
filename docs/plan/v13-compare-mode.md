# V13 — Compare mode

[Index](../PLAN.md) · [Journal](../journal/v13-compare-mode.md)

**Status:** merged into main (2026-10-13, from branch `milestone/v13-compare-mode`). As built and
results: "As built — V13" below.

**Problem** (asked: "i would like the default mode to not be 'Pick two to compare them, or one
against its parent' -- there should be an active mode 'Compare mode' that trigger that state on
commits list"). Since V10–V11 the commits page is a small git client: every branch as a graph,
checkout from a row's menu, HEAD marked. It still opens as V9's picker, though. The help line
starts "Pick two to compare them, or one against its parent". Every row has a pick circle. A bar
under the rows says "Pick two commits, or one to compare with its parent" beside a disabled
Compare. And a click on a row picks it. Measured in Chromium on `symbiote view` (`main` at
`2644214`), the page as it opens:

| Repo | Window | Rows in view | Compare bar | Pick column, every row | Three rows clicked to look at them | A row clicked, then `c` |
|---|---|---|---|---|---|---|
| Symbiote | 1440 × 900 | 22 (the title on two lines: a long branch name) | 52.6 px | 24 px | 2 picked: "d67a5d6 → d175ee5 · 5 commits" | the menu opens; the row stays picked |
| Qwik | 1440 × 900 / 1280 × 720 | 23 / 18 | 52.6 px (1.6 rows) | 24 px | 2 picked: "4d5d13d → 239e9d3 · 10 commits" | the same |
| Bitwarden | 1440 × 900 / 1280 × 720 | 23 / 18 | 52.6 px | 24 px | 2 picked: "389f204 → db4a0eb · 4 commits" | the same |

- A click does two things: it moves the cursor (the row `c` and Enter act on) and it picks.
  Clicking rows to look at them, or to choose one to check out, leaves picks behind and a
  comparison ready. Three clicks leave the first and the third picked (a third pick replaces
  the second: V9's rule).
- The cursor is drawn as a 3 px grey bar; the pick as a 14 % accent tint. So what a click
  visibly does is pick, not select.
- Two of the help line's three parts are about picking; the checkout key comes last.
- Back from a diff lists the page anew (measured: no picks kept). A mode kept in the page's
  state starts over the same way.

**Goal**: the commits page opens in a browse mode. A click selects a row (the cursor), and
nothing about picking shows: no pick circles, no compare bar. A "Compare mode" toggle in the
title (or `x`) turns on today's picking state: the circles, the bar with its label, Clear and
Compare, and V9's rules (two picks, the older the base; one picked alone against its parent).
The toggle again, Escape, or Compare leaves it, and the picks are cleared. Checkout (menu, `c`),
the scopes, the HEAD chip and the arrows work the same in both modes. Diff pages, the server,
`symbiote diff` and `symbiote pr` do not change.

## Browse mode (the default)

- A click on a row moves the cursor there and picks nothing. j/k move it; `c`, right-click and
  "⋯" open its menu, as today; Enter does nothing.
- Rows have no pick column: `.commit-pick` is not drawn (24 px back to the subject). There is no
  compare bar (52.6 px back to the list: Qwik at 1440 × 900 shows 25 rows instead of 23).
- The cursor is now the selection, so it must show: in browse mode the cursor row gets an accent
  bar on the left and a light accent tint, distinct from HEAD's green tint. Checked in
  screenshots, light and dark, on HEAD's row and another.
- The help line: "j/k move · c checks out · x picks to compare".
- Errors the bar showed ("Could not read the branches" from a row's menu, "Could not list
  commits" for a later block) move to a line under the title (`role="alert"`, next to the
  checkout notice), in both modes. In browse mode there is no bar to show them.

## Compare mode

- The toggle: a button "Compare mode" in the title, after the scopes, with `aria-pressed`.
  Pressed, it is filled in the accent colour; not pressed, outlined in it, like V12's "Open in
  VS Code" (a link-styled control went unseen there). Its title: "Pick commits to compare (x)".
- On: the page gets the class `comparing`; rows get their pick column; the bar appears with
  "Pick two commits, or one to compare with its parent", then the label ("a1b2c3d → e4f5a6b ·
  12 commits"), Clear and Compare. A click picks and moves the cursor, `x` picks the cursor's
  row, Enter compares: V9's rules, unchanged (`pick`, `comparison` in `src/commits.ts`). The help
  line: "Pick two to compare them, or one against its parent · x picks, Enter compares, Esc
  leaves".
- `x` in browse mode turns compare mode on and picks the cursor's row. So `x`, Enter still
  compares a commit with its parent from the keyboard, as since V9.
- Off: the toggle, Escape (when no menu or confirmation is open: they take Escape first), or
  Compare (the page then leaves for the diff). The picks are cleared.
- Where the state lives: `comparing` in `CommitsPage`, above the `History` generation. A scope
  switch or a relisting after a checkout keeps the mode; the picks are cleared, as today. It is
  not in the URL: a reload, "← Commits" and a new `symbiote view` open in browse mode. The back link's
  title changes from "Pick other commits" to "Back to the commits".

## Code

- `src/CommitsPage.tsx`: `CommitsPage` holds `comparing` and hands it to `History` with a setter.
  `History`'s click handler and the `x`/Enter/Escape keys branch on it; the bar renders only
  when comparing; errors render under the title. `CommitRow` draws `.commit-pick` only when
  comparing.
- `src/styles.css`: `.compare-mode` (the toggle), `.commits.comparing`, the browse mode's
  cursor style, `.commits-error`. These class names are not taken yet (checked).
- No server, core or graph change; `src/commits.ts` unchanged.

## Verification

1. **E2E** (red first), in `e2e/commits.spec.ts`: the page opens in browse mode: no
   `.commit-pick`, no compare bar, no "Pick two" in the help line. A click moves the cursor and
   picks nothing (three clicks: 0 picked). "Compare mode" pressed: circles, the bar, V9's label;
   two clicks pick a pair; Escape leaves and clears; the toggle leaves. `x` from browse mode
   turns it on with the cursor's row picked, then Enter compares (the existing keyboard test,
   unchanged). A scope switch keeps the mode and clears the picks. The existing tests that click
   to pick ("picks two commits…", "stops an analysis", "compares one commit…") press "Compare
   mode" first. `history.spec.ts` (an arrow moves the cursor, nothing picked) and
   `checkout.spec.ts` pass unchanged.
2. **Nothing else changes**: `pnpm check` (the `commits.ts` unit tests unchanged); every other
   e2e spec. No analysis code changes, so no `regression-check` run.
3. **Viewer** (`viewer-check`): screenshots of Qwik's commits page in both modes, light and
   dark (the selection beside HEAD's tint, the toggle pressed and not); rows in view at 1440 ×
   900 and 1280 × 720 against the Problem table.
4. **Cost**: first rows drawn on Qwik and Bitwarden within the noise of `main`'s (V10a: 102–133
   ms, plain fonts). The page draws the same rows, with one element fewer per row.

**Risks**

| Risk | Mitigation |
|---|---|
| Comparing takes one more click with the mouse: the toggle, the picks, Compare | The keyboard keeps two keys (`x`, Enter). A one-step "this commit against its parent" from browse mode (double-click) is left as an open choice: V12 removed the per-row button because every row had it. |
| A click that picked for three milestones now only selects | The toggle is a visible button; the help line names `x`. |
| Errors shown in the bar vanish with it | They move to a line under the title, in both modes. |
| The cursor's grey bar is too faint for a selection | A browse-mode selection style; screenshots light and dark beside HEAD's tint. |
| A browser that restores the page from its back-forward cache brings compare mode back, with its picks | Measured: Chromium lists the page anew on Back. Either way the page is usable. |

**Order**: one step, viewer only: the e2e changes (red), then the page and its styles, then
README.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V13 ✅ | Compare mode | Browse mode by default (a click selects; no circles or bar; errors under the title), the "Compare mode" toggle, `x` turning it on, Escape leaving it; e2e; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 65 | What the commits page does by default | **Browse: a click selects a row (the cursor); no pick circles, no compare bar** | Asked. Measured: three clicks to look at rows leave a pair picked and a comparison ready; a click before `c` picks too; the bar and circles take 52.6 px and 24 px a row. |
| 66 | How compare mode starts and ends | **The title's "Compare mode" toggle, or `x` (which also picks the cursor's row); the toggle, Escape or Compare end it, clearing the picks** | Asked for a mode. `x` keeps V9's two keys for a commit against its parent. |
| 67 | What the mode survives | **A scope switch and a relisting after a checkout (picks cleared, as today); not a reload, "← Commits" or a new `symbiote view`** | The default is browse; picks never survived a new generation either. |

**Not in V13 (later)**: a one-step compare from browse mode (double-click a row: the commit
against its parent); what the selection could show beside the list (a commit's message and
files, V10's "later"); the mode kept in the URL; Shift+click to pick a range.

## As built — V13

- As planned, in `src/CommitsPage.tsx` and `src/styles.css`; `src/commits.ts`, the server and
  core unchanged. `comparing` lives in `CommitsPage`; `History` leaves the mode through
  `stopComparing` (picks and the bar's error cleared). The row's click handler is `onClick`
  (was `onPick`): it moves the cursor, and picks only when comparing.
- The toggle shows its key: "Compare mode `x`", and "`Esc`" when on (a `kbd` hidden from the
  accessible name, so the button is "Compare mode" in both states).
- Errors: listing and menu errors under the title (`.commits-error`, `role="alert"`); "Could not
  compare" stays in the bar (`compareError`), the only place it can come from.
- HEAD's row selected: the selection's accent tint replaces HEAD's green tint; HEAD stays clear
  from its solid badge, bold subject and ringed dot (screenshots, light and dark).
- Clear (in the bar) still clears the picks and stays in compare mode.

**Results (V13)**. Tests first: against `main`'s build the changed `commits.spec.ts` failed 9 of
11 (the toggle and the error line missing; the two tests that do not pick passed). Now 557 unit
tests (unchanged) and 64 e2e (5 new: browse mode, the toggle with Escape and a menu taking
Escape first, `x` turning the mode on, a scope switch, an error under the title; 3 existing tests
turn compare mode on before picking). Real repositories (Chromium, 1440 × 900 unless said;
`main`'s build from a worktree, run back to back):

| | Qwik `main` / V13 | Bitwarden `main` / V13 |
|---|---|---|
| Rows wholly in view, 1440 × 900 | 23 / 25 | 23 / 25 |
| Rows wholly in view, 1280 × 720 | 17 / 19 | 17 / 19 |
| First rows drawn, warm server, plain fonts (5 rounds, alternating): median (range) | 114 (112–117) / 114 (107–127) ms | 146 (142–148) / 139 (114–144) ms |
| Page errors (both modes, light and dark) | — / 0 | — / 0 |

Not verified: Firefox and Safari; a browser that restores the page from its back-forward cache
(Chromium here lists it anew on Back, so compare mode does not come back).
