# Journal: V6 — A graph you can navigate

[Index](../JOURNAL.md) · [Plan](../plan/v6-navigable-graph.md)

## V6 — A graph you can navigate (2026-10-02, branch `milestone/v6-navigable-graph`)

Reported on a real project: "I can't navigate through it" — not slowness. Measured on Bitwarden
with the Angular plugin: one commit with 86 changed symbols drew 1,288 symbols in 509 boxes, as
a 9,470 × 85,468 px strip; every selection and reviewed mark re-ran the whole layout (1.2–1.8 s).

**Learned**
- 94 % of the drawn symbols were unchanged neighbours, mostly from a few hubs: one changed enum
  with 390 users, a constructor with 385 dependencies, templates using ~100 things each. The top
  five hubs brought 733 of 1,202 neighbours; most changed symbols have 5 or fewer. Grouping a
  side with more than 8 into one node cut the view to 168 symbols + 29 groups.
- The strip came from dagre stacking every disconnected part in one column; packing clusters
  into rows fixes that, but a large change is mostly one connected cluster (57 of 59 boxes), so
  its overview can't be read at text size anyway. Hence a map mode instead of more layout work:
  file names readable at any zoom, click to zoom in.
- The layout memo depended on `selected` and `reviewed`: fixed by splitting layout from
  decoration, which also keeps everything still while reviewing.
- Bugs found in the browser, not in unit tests: the selection half under the detail panel (the
  pan ran before the canvas narrowed); an opened group off screen; file names on the map
  catching clicks meant for the box below. Tests that counted nodes in the page broke once only
  on-screen nodes are drawn — the minimap still draws them all.

**Verification**: viewer unit tests 44/44, e2e 14/14, typecheck, lint; Bitwarden graphs measured
before and after in Chromium (first paint 4.0 → 0.65 s, mark reviewed 1.2 s → 72 ms, page
elements 22,966 → 3,937 on `737ee3f`), screenshots of the map, a zoomed file and a selection.

Merged into main (2026-10-03).
