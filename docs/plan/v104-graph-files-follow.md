# V104 — Graph and Files follow the pick

[Index](../PLAN.md) · [Journal](../journal/v104-graph-files-follow.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v104-graph-files-follow`
(the plan written by the graph usability spike, `spike/graph-usability`).

**Kind** feature (milestone) · **Branch** `feature/v104-graph-files-follow` · **Size** S–M ·
**Depends on** none · **Rank** 6 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**:
1. **From Graph to Files**: `g` with a symbol picked opens its file on Files, with its first
   changed row in view. A removed or moved symbol opens its deleted rows, in the file they were
   deleted from.
2. **A link in the panel**: "Show its lines" under the symbol's file does the same.
3. **From Files to Graph**: `g` picks the symbol that holds the last line clicked or commented on
   Files (`symbolAt`), and the canvas shows it.

**Where to look**:
- `packages/viewer/src/diff/App.tsx`: `showPage` (:115), `openDraft` (:160). `openDraft` already
  opens a comment's line on Files (`setOpenFile`, `setFileFocus`); this reuses it.
- `src/diff/useDiffKeys.ts:75` (`g`).
- `src/diff/FilesPage.tsx`: `focus` (`FileFocus`, a row key `head:<n>` or `base:<n>`) and the
  folds (a row inside a fold opens it).
- `src/diff/comments.ts:61` (`symbolAt`); `src/diff/DetailPanel.tsx` (the panel's file line).

**Out of scope**: the order of Files (V102); comments themselves.

**Done when**:
- e2e both ways: pick on Graph, press `g`, the changed row is in view on Files; click a line on
  Files, press `g`, its symbol is picked on Graph.
- On the refactor's merge (eb807773), `g` from its warned, moved symbol shows its deleted row
  (base line 106) in the file it left.

## Problem (the spike's G8)

In 5 of 5 walks, `g` from a picked symbol showed whatever file Files had open: a docs file. The
symbol's file was at position 5 to 48 in the list. Getting to its lines took a read of the list, a
click, sometimes a scroll of the list, and a scroll to the line. On the refactor, the warned symbol
had moved: its first changed line was a deleted one that the file Files opened did not show
([shot](../../spikes/graph-usability/shots/p08-g-forgets-the-symbol-dark.png)). Nothing on Files
leads to a line's symbol on Graph.

**Goal**: one key between a symbol and its lines, both ways.

## Design

- **The target row**: a pure `firstChangedRow(node, files)` in `src/diff/file-diff.ts`: the head
  file and the first changed head line, or for a removed or moved symbol the base file
  (`previousPath` where renamed) and its first deleted line. It returns a `FileFocus`.
- **`g` on Graph**: with `selected`, `showPage('files')` also sets the open file and the focus,
  as `openDraft` does. Without a pick, `g` behaves as today.
- **`g` on Files**: the page keeps the last row clicked or commented (`symbolAt` of its line). On
  `g`, that symbol becomes `selected`; the pick's view rules then apply (V99 if built).

## Verification

1. Unit (red first): `firstChangedRow` for an added, a modified, a removed and a moved symbol.
2. e2e: both directions on the `callers` fixture; a removed symbol's deleted row in view.
3. The refactor's moved symbol, by hand, with a shot.

**Risks**

| Risk | Mitigation |
|---|---|
| `g` no longer returns to the file the reviewer was reading | Only with a symbol picked; Esc clears the pick first |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 977 | What `g` shows | **From Graph with a pick: the symbol's first changed row on Files (deleted rows, in their file, for a removed or moved symbol); from Files: the symbol holding the last line clicked or commented, picked on Graph** | In 5 of 5 walks `g` showed an unrelated docs file |
| 978 | A symbol's lines from the panel | **"Show its lines" under the symbol's file, doing what `g` does** | The panel is where the reviewer reads the change |

## As built

Built as planned, decisions 977–978, with the changes below. Tests first: on stubs, 9 unit
tests in `test/file-diff.test.ts` failed. `e2e/follow.spec.ts`, on a new fixture
(`test/fixtures/graph-files-follow`), failed 4 of its 5 tests on the build before the change:
Files stayed on `src/convert.ts`, a clicked line had no mark, and the panel had no button. The
fifth (no pick: `g` goes back to the file read) passed before and after.

- **The first changed row needs the file's rows.** A graph node has its lines on each side, not
  which of them changed. So the plan's `firstChangedRow(node, files)` is two pure functions in
  `diff/file-diff.ts`. `symbolFocus(node, files)` gives the file and the symbol's lines there, a
  new kind of `FileFocus`. `firstChangedRow(rows, lines)` gives the row once the Files page has
  read the file's diff.
- **A modified symbol shows its first added row.** Git pairs lines by their text, not by symbol.
  On the fixture, git put `area`'s two old lines at the top of the file, 84 rows above its new
  ones, under the table added above it. The first changed row of either side was line 1. So the
  row is the first added one in its head lines (the plan's "first changed head line"). Else it
  is the first removed one in its base lines: a removed symbol, or a change that only removes
  lines. Else it is its first row: a context symbol, or a change of formatting only.
- **"Moved" is "its old lines in another listed file"**: a symbol moved to another file,
  renamed and changed or not. A symbol moved or renamed inside its file shows as a modified one,
  because its removed and added rows are in that file. When the file it left is not listed, it
  shows in its head file.
- **Which file.** A renamed file is found by its old path. A copy's old path is not the
  symbol's, because the source file still exists. A symbol in no listed file, such as a context
  symbol of an unchanged file or a package, has no lines there: `g` shows Files as it was left,
  and the panel has no button.
- **The page switch does what `g` does.** Its tabs' tooltip names `g`. A click on the tab of the
  page shown changes nothing.
- **Files to Graph.** With a graph, every row takes a click, with or without a review. Without
  one, the click only marks the row. The mark is the box a comment's row already had
  (`.anchored`). The line counts while its file is shown (`anchorKey`, read when `g` is
  pressed), and leaving the page forgets it (`showPage`). A first version cleared it in an
  effect when the file changed. The e2e test caught `g` running before React had run that
  effect: it picked the line's symbol from a file no longer shown. **Edit** on a comment counts
  as a click on its line.
- **The row shown** is centred and boxed, as a comment's line from the review tab is.
- **Past 2,000 rows.** A row asked for past the first 2,000 drawn draws every row
  (`foldsDrawn`). Otherwise the row is not there to show. This also holds for a comment's line
  opened from the review tab.
- **"Show its lines" is a button**, drawn like **Open in VS Code** beside it (`.open-editor`,
  with its key `g`). It comes first in the panel's actions (`.panel-actions`), where the file's
  diff is served. At the panel's 336 px the two buttons take a line each.
- **The keys' help.** The Graph page's key list is in `Sidebar.tsx`, which V105 works in. So
  each page's help paragraph says what `g` does with a pick or a clicked line (`App.tsx`), and
  the lists still say "files" and "graph".
- **`useKeptOpen` is gone** (V102). A new graph resets the open file only when it replaces
  another one, such as a dropped file: the first graph keeps the file read while the change was
  analyzed. Meanwhile App holds the Files page's first file by path while Files is shown. Taking
  out the first half fails both of `files-order.spec.ts`'s analysis tests, and the second half
  one of them.
- `e2e/targets.spec.ts` now also measures the detail panel with a symbol picked. No state of
  the spec had the panel open.

## Results

`main` (f790c0c) against this branch, as a real `symbiote view` serves each change. Each runs in
a scratch clone with its own cache, both themes. The refactor is the merge the spike walked,
`eb807773^1..eb807773^2`, at 2560 × 1440, 1x. The fixture is the e2e test's, at 1440 × 900.

| Change, symbol picked | `main`: `g` shows | V104: `g` shows |
|---|---|---|
| The refactor (122 files), `version`: moved from `main.ts` to `command-context.ts`, 2 warnings | `command-context.ts`, file 1 of 122, from its first line; no row marked | `packages/cli/src/main.ts`, file 29 of 122, its deleted line 106 centred and marked |
| The fixture (4 files), `area`: changed under 84 added lines | `src/convert.ts`, file 1 of 4 | `src/shapes.ts`, file 2 of 4, its head line 86 in view and marked |
| The fixture, `perimeter`: removed | `src/convert.ts`, the file open, as for any pick | `src/shapes.ts`, its deleted line 5 in view |
| The fixture, `toCentimetres`: moved to `src/convert.ts` | `src/convert.ts`, the file open | `src/units.ts`, its deleted line 7 in view |

On `main` the refactor opened on `command-context.ts` because V102 puts the riskiest file first,
and `version`'s warnings are there. Its new line 13 is in that view by chance, unmarked. Its
deleted line, the one the warnings are about, is in `main.ts`, 29th in the list.

Shots of the refactor after `g` from `version`, 2560 × 1440, 1x
([before](../images/v104-graph-files-follow/refactor-g-before-dark.png),
[after](../images/v104-graph-files-follow/refactor-g-after-dark.png); light:
[before](../images/v104-graph-files-follow/refactor-g-before-light.png),
[after](../images/v104-graph-files-follow/refactor-g-after-light.png)), and its panel's head
([before](../images/v104-graph-files-follow/panel-before-dark.png),
[after](../images/v104-graph-files-follow/panel-after-dark.png); light:
[before](../images/v104-graph-files-follow/panel-before-light.png),
[after](../images/v104-graph-files-follow/panel-after-light.png)).
