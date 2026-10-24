# Journal: V13 — Compare mode

[Index](../JOURNAL.md) · [Plan](../plan/v13-compare-mode.md)

## V13 spike — compare as a mode (2026-10-13, branch `milestone/v13-compare-mode`)

Measured in Chromium on `symbiote view` (`main` at `2644214`) before planning a browse mode for the
commits page, on this repository and the Qwik and Bitwarden clones. The page opens as V9's
picker: the compare bar takes 52.6 px (1.6 rows of 32 px; Qwik and Bitwarden show 23 rows at
1440 × 900, 18 at 1280 × 720) and the pick circle 24 px of every row. A click moves the cursor and
picks, and the pick is what shows: the cursor is a 3 px grey bar, the pick a 14 % accent tint.
Clicking three rows to look at them leaves the first and the third picked, with a comparison
ready ("4d5d13d → 239e9d3 · 10 commits" on Qwik). A row clicked before `c` stays picked under its
checkout menu. Back from a diff lists the page anew (no picks kept), so a mode held in the page's
state starts over in browse mode. The errors the bar shows today (the menu's "Could not read the
branches", a later block's "Could not list commits") need a place of their own once the bar is
gone by default. The plan: browse by default, a "Compare mode" toggle (or `x`) for V9's picking,
left with Escape.

## V13 — Compare mode (2026-10-13, branch `milestone/v13-compare-mode`)

The commits page opens in a browse mode: a click selects a row, and there are no pick circles
and no compare bar. "Compare mode" in the title (or `x`, which also picks the selected row)
turns on V9's picking; the toggle, Escape or Compare leaves it, and the picks go with it. Viewer
only.

**Learned**:
- With the bar gone by default, its error slot went too: a failed `/api/refs` (a row's menu)
  would have shown nowhere. Listing and menu errors now have a line under the title; only
  "Could not compare" stays in the bar, the one place it can come from.
- A selection that replaces picking as what a click does must look like one: the cursor's 3 px
  grey bar was enough beside a pick, not alone. On HEAD's row the selection's tint covers HEAD's
  green; the badge, bold subject and ringed dot still say it is HEAD.
- `getByRole('button', { name: 'Compare' })` matches "Compare mode" too (names match by
  substring): the specs ask for `exact: true`. Adding a control whose name contains another's
  breaks locators the same way V12's button broke text assertions.
- The toggle's key hint (`x`, then `Esc`) is a `kbd` hidden from the accessible name, so the
  button keeps one name in both states.

**Verification**: tests first — the changed `commits.spec.ts` failed 9 of 11 against `main`'s
build, all on the missing toggle or error line. Now 557 unit tests (unchanged) and 64 e2e (5 new:
browse mode, the toggle and Escape with a menu taking Escape first, `x`, a scope switch keeping
the mode, an error under the title). On the Qwik and Bitwarden clones against `main`'s build,
back to back: rows wholly in view 23 → 25 at 1440 × 900 and 17 → 19 at 1280 × 720; first rows
drawn (warm, plain fonts, 5 rounds) Qwik 114 → 114 ms median, Bitwarden 146 → 139 ms; no page
errors; screenshots of both modes, light and dark, and of HEAD's row selected. Not verified:
Firefox and Safari; a back-forward cache restoring the page (Chromium lists it anew).

Merged into main (2026-10-13). `main` verified after the merge: 557 unit tests, build, 64 e2e.
