# Journal: V90 — Redesign step 3: a review's pages

[Index](../JOURNAL.md) · [Plan](../plan/v90-redesign-reviews.md)

## V90 spike — today's review pages against the proofs (3 November 2026, branch `feature/redesign-reviews`)

Read the proofs 03, 04, 10 and 07 and `normal.css` against `c99afc6`'s viewer and server.

**Learned**:
- **`./api/files` waits for the graph**: it joins git's numstat with `graph.files` for each
  file's status, so the loading page needs it served from the pair (core's `listChangedFiles`
  already gives statuses).
- **A workspace already gives what the loading page shows**: `/api/workspaces/changes` lists the
  commits since the review's base and the files, `/api/workspaces/thread` the full report,
  `/api/workspaces` the brief. Only a branch or a pair that is no workspace's needs the server's
  files.
- **React Flow 12 draws each edge in its own `<svg>` with its `zIndex`**, beside the nodes'
  stacking (`getElevatedEdgeZIndex`, `@xyflow/system` 0.0.83): an edge with a z-index above the
  selected node's (1000 + its depth) is drawn over every node, and only that edge renders again.
- **Symbiote records no file as viewed**: the review's `marks` hold symbol fingerprints only.
- **A finding records one `message`**: the proof's title and "why" are one sentence today.

## V90 — a review's pages: opening, Graph, Files (3 November 2026, branch `feature/redesign-reviews`)

Opening a review shows the six steps with their times and what needs no graph; graph nodes carry
a mark for their kind and one count of findings, the picked symbol's calls drawn above the nodes;
the Files page is one card with files viewed by their version. Decisions 835–847.

**Learned**:
- **React Flow already lifted the picked symbol's calls**: on `main`'s build the selected node's
  edges sat at z 1000 and the other nodes at 0–1 (`elevateNodesOnSelect` with nested nodes). What
  was missing was the pointer: `elementFromPoint` on a lifted call hit the call, so a node under it
  lost its click. The fix is a class with no pointer and an explicit z-index, one edge object each.
- **A head that reads the workspaces on every diff costs first paint**: Bitwarden 315 → 333 ms in
  3 of 3 rounds; `main` reads them only on a review. Rendered for a review alone: 318 → 306 ms.
- **A mark inside the change list's button renamed every symbol**: specs and screen readers found
  "~piece10x"; the mark sits beside the button now.
- **The redesign moves e2e assertions in 11 spec files** (14 changed with the new tests): the Files
  page's Review tab (21 tests clicked it), the `n/m` count on Changes, badges, the legend's words,
  the panel's width. Each failure read before its spec was changed; none was a behaviour lost.
- **README screenshots**: `docs/images/review.png` and `review-files.png` show the old pages; they
  are out of date once this merges (not retaken here).
- **The tokens test keeps `--you` for the person's turn**: the picked node's ring is the
  selection's `--accent`; the review's bar, the verdict picked and the file being reviewed are
  `--you`.

**Verification**: tests first, each red for the right reason (unit: 8 analysis-steps, 2 core git,
server files during analysis, 3 flow, 2 detail, 4 review marks; e2e: `analyzing.spec.ts` 9, the
picked-calls test, the Files page's viewed/Edit/Ctrl+Enter test, all failing on `main`'s build).
`pnpm check` 2,950 tests; `pnpm build`; `pnpm test:e2e`. Speed against `main`, alternated:
Bitwarden 737ee3f (Angular), 5 rounds, medians: first paint 318 → 306 ms, select 105 → 105,
mark reviewed 50 → 50, pan 63 → 63 fps; the r1 set's 25 graphs, 3 rounds: first paint 4,084 →
4,075 ms in all, select 1,827 → 1,829, mark 840 → 838. Audit at 1×, both themes: Bitwarden fitted,
picked and as a map (several projects, summaries), no findings, a small graph, `symbiote pr`,
failed, stopped, queued, the large text size; it found a finding's long names breaking out of
their card, a kind said twice, a key cap wrapping a button, and two labels wrapping at the large
size, all fixed.

Screenshots beside the proofs (dark and light), main's build and the audit:
<https://claude.ai/artifact/KefHn7qSvi3gmp6WR4SLz6> (private to its owner until shared); their
specs and the storefront fixture in the ignored `packages/viewer/coverage/v90/`.

Not verified: a real workspace's loading page with a running agent (the e2e routes its report and
commits); Codex reports there; the desktop window.

Merged into main (2026-11-03).
