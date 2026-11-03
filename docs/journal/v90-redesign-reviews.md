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
