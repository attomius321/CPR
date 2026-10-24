# Journal: V37 — A look that is not dated: type, fields, hover, help in tooltips

[Index](../JOURNAL.md) · [Plan](../plan/v37-not-dated.md)

## V37 spike — what still looks dated, page by page (2026-10-22, branch `feature/ui-improvements`)

Asked: "the inputs, sidenav and everything looks kind of oldish...the hover style..everything",
the help texts in tooltips under a help button, "the fonts are not good inside inputs", then "check
every page for uneven spaces...and ugly styling". Audited on `main` (`7c223d4`): a Playwright spec
outside the repository drove `e2e/symbiote.ts`'s `serveWorkspaces` (three workspaces, one
reporting, usage), `serveFixture('detectors')` and `serveAgentBranch` (a review and a merge), and
took 35 states of every page, dark and light, at 1440×900 and device scale 1.

**Learned**:
- **The uneven letter gaps come from the chrome's `letter-spacing: 0.01em`.** At 1× on Linux,
  Chromium places glyphs on whole pixels: 0.13–0.14 px a letter adds up into a pixel here and
  there ("n o commits", "Noth ing", "fea ture/"). At 3× zoom, `letter-spacing: 0` evened every
  sample; `text-rendering: geometricPrecision` did too (sub-pixel positions), slightly blurrier and
  with a cost on thousands of graph labels to measure. Spacing 0 costs nothing.
- **Form controls do not inherit letter-spacing.** `font: inherit` resets the font, not
  `letter-spacing`, which Chromium's form-control style sets to `normal`: every input, textarea,
  select and button measured `normal` against the body's 0.14 px. With `inherit` alone, the gaps
  moved into the fields; with 0 everywhere, page and fields match. Two fields were also in Geist
  Mono (the start page's Branch, Settings' prompt editor).
- **The fields' 3:1 edge is what reads as old**: `#737373` on every field, the brightest line on
  most pages, with a 2 px solid ring on focus over it. A soft edge (15 % of the text, about 1.5:1)
  brightening on hover and focus was shown beside it; the person chose it (decision 246).
- **Hover and selection were 8 % and 10 % washes**: indistinguishable (Settings hovered looked
  current). Cards hovered with a third recipe, nearly invisible in light.
- **Help had grown as paragraphs** in eight places and as `title`s in two; glyphs stood in for
  icons in five (`?` `ⓘ` `▸` `▶` `←`).
- **Uneven layout**, measured: Start and Scout's content 8 px right of their title (264 / 256);
  History's head 44 → 58 px in compare mode (its instruction wraps); the merge page without a head.

**Not tested**: the person's own window (Electron on WSLg at their scale); Windows and macOS text
rendering. Screenshots kept for the after comparison.

## V37 — a look that is not dated: one text, quiet fields, help behind a "?" (2026-10-23, branch `feature/ui-improvements`)

Letter-spacing 0 everywhere but uppercase labels, and controls that inherit it; one recipe for
text fields and selects (a soft edge at rest, the 3:1 edge on hover, the focus colour and a ring on
focus, 32 px, no grip); a hover 3 points under the selection; ghost buttons for backing out; icons
for the glyphs; one head on every page; flat tabs; and one `Help` button whose tip carries every
help text that was a paragraph, a `title` or a `ⓘ` (decisions 246–250).

**Learned**:
- **A tip inside the page is the page's**: the start page's `container-type` (its container
  queries) makes a containing block for `position: fixed`, as `transform` and `backdrop-filter` do
  (V31c's trap), and scrolling panels clip. `Help` draws its tip on `document.body`.
- **A tooltip shown by a hover must let the pointer through.** The kinds' tip covers the Title
  field; with the pointer taken, V24c's test could not hover the field to close it ("subtree
  intercepts pointer events", 113 retries). A click keeps the tip and only then takes the pointer.
- **A button inside a `<label>` joins the field's name**, and its tip's text would too: Branch's
  name went into a `<label htmlFor>` of its own, the help beside it.
- **`field-sizing: content` ignores `rows`**: the rows' height came back as `min-height` in `lh`.
- **The diff's legend wrapped on `main`**: its canvas hint took a second line (32 px) from the
  canvas at 1440 px; with the hint in the bar's help the canvas draws 846 nodes in view, not 831,
  at the same positions.
- **The sidenav's card-focus test is flaky on `main` too** (`shell.spec.ts`, "a card keeps the
  focus when its workspace moves to another group"): run six times one after another, 3 of 6
  passed on `main`'s build and 4 of 6 on this branch's; in the full suite it failed once in three
  runs. Not V37's; left as found.

**Verification**: tests first, red on `main` for the right reason: `look.spec.ts`'s text test (the
body at 0.14 px, 12 controls at `normal` on History alone) and its fields test (the edge at rest
`rgb(115, 115, 115)`); `tokens.test.ts` (no `--field-line` or `--ring`; dark hover 8 against
selection 10). Written with the code, not seen red: `tips.test.ts` (6) and the help e2e.
`pnpm check` 1,271 tests (`main` 1,263). e2e 198 of 198; two earlier full runs lost 2 and 4
tests: the card-focus flake above, and three specs that read text since moved behind a help
(the worktree path, the review's verdict, the Tab order), changed to open it. Against `main`'s build, alternated, 3 rounds,
on this repository's `e659928..7c223d4` (1,975 symbols, 4,124 edges): first paint 904–942 /
896–948 ms, select 275–301 / 273–279 ms, mark reviewed 64–67 / 65–67 ms, pan 62 / 62–63 fps.
`/history` on a clone of this repository, 6 rounds
alternated: first paint 60–68 / 60–68 ms, first rows 152–259 / 157–183 ms. Screenshots of 35 states of every page, dark and light, at 1440 × 900 and 1×,
before and after. Not verified: the Electron window on WSLg; Bitwarden's graph (no clone here);
Windows and macOS rendering; real agents in the restyled pages.

Merged into main (2026-10-23) by Symbiote's merger, from the approved `76c6920`, no conflicts
(`main` had not moved since the branch).
