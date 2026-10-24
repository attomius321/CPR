# Journal: R1 — Receiver-aware references ✅

[Index](../JOURNAL.md) · [Plan](../plan/r1-receiver-aware-references.md)

## R1 — Receiver-aware references (2026-10-02)

**What landed** (branch `milestone/r1-receiver-aware-references`, merged into main after review)
- `incomingTs` judges every reference to a class member by the class of the object it is read
  from (`x` in `x.m`, the class for `this`): the member's class or a subclass → use; an ancestor
  class or interface → **possible** use; unrelated (a sibling) → dropped; unknown (`any`, no
  receiver) → kept. Union and intersection types count if any part relates; `this` and
  constrained type parameters stand for their constraint.
- Declarations the search returns: a subclass's direct override → `overrides` edge to the
  member; any other (the base declaration, a sibling's own `ngOnInit`) → dropped.
- `outgoingTs` adds the member's own `overrides` edges: to the base class member, to the interface
  (interface members are not nodes), or to a package member (`@angular/core#OnInit.ngOnInit`).
- Graph schema 0.4.0: edge kind `overrides`, edge flag `possible` (every site possible). The
  viewer's detail panel labels such neighbours "· possible".

**Golden graphs**: one real change — `Tool.use → Pen.use (reference)`, the abstract base method
listed as *using* its implementation, became `Pen.use → Tool.use (overrides)`.

**Before/after** on 29 comparisons (6 commits each of ky, zod, vite; the Angular app's 8 commits
and 3 experiments): 957 → 932 edges, 29 dropped, 4 `overrides` added, 2 marked possible, **0
findings changed**. Every dropped edge was inspected: ky's sibling error classes' own `name`
declarations (7), and the Angular app's sibling `ngOnInit` declarations (2 × 11). zod and vite
were unaffected in these ranges.

**Not done**: templates, `.symbioteignore` location, `interfaces/` matching, decorator-only changes
(see the Angular trial above).
