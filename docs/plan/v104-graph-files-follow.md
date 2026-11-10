# V104 — Graph and Files follow the pick

[Index](../PLAN.md) · [Journal](../journal/v104-graph-files-follow.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v104-graph-files-follow` in its
own workspace; written by the graph usability spike (`spike/graph-usability`). Not started.

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
