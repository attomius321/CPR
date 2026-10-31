# D2c — Is the review graph right, and does it lead to the problems? (spike)

[Index](../PLAN.md) · Journal: none yet

**Status:** proposed (2026-10-31) from the D2 spike; not started. It reuses D2's 51 graphs and can
run on branch `spike/review-precision`. Decision numbers are given when it is planned.

**Question** (asked: "we don't check also the review graph? only the pull requests?"). On real
merged pull requests, are the graph's edges right, which users does it miss, and does it lead a
reviewer to the problems reviewers actually found?

**Why**: the graph is the part of Symbiote no competitor offers, and D2 measured only its findings.
D2 hints at the graph's gaps without counting them: wrong orphans came from edges it lacks (members
used by the inline template of an unexported component, which the Angular plugin never shims; an
`export { default as nn } from` re-export), and wrong `signature-changed` warnings from how users
were classified, not from wrong edges.

## Scope: the code people wrote

The 51 D2 graphs hold 543 changed symbols, 5,032 context symbols of the repository's own code, and
544 package nodes (exports of dependencies a symbol uses: `@angular/core` 116, Node 66, `rxjs` 65,
`@angular/router` 47 …); vite's are 34 % package nodes. 880 of the 8,146 edges (11 %) go into
packages or unknown targets; 261 of those are package calls a pull request added or removed. The
viewer draws package nodes grouped by package (`packages/viewer/src/graph/flow.ts:864`). Files
under `node_modules`, `*.d.ts`, `*.min.js` and `generated/`, `fixtures/`, `__snapshots__/` are
already never analyzed (1 node of the 6,133 sat in a generated file).

So the review graph shows only the repository's own code (proposed decision 1, below), and D2c
measures that graph.

## What is measured

1. **Edges right** (precision): about 100 edges between repository symbols with at least one end
   changed, drawn with a seed, by project and kind (D2's graphs: reference 3,503, call 1,861,
   type-reference 1,245, new 390, call through a base type 108, extends 96, overrides 39,
   reference through a base type 17, implements 7; Angular template edges as their own stratum).
   Each: is it a real use at that site, of that kind?
2. **Users missed** (recall): about 50 changed symbols, drawn with a seed. An independent search
   of the repository at head (the name across `.ts`, `.js`, templates and stylesheets, read by
   hand) gives the real users; compare with the graph's incoming edges and count misses by cause
   (template, dynamic access, re-export, untyped JavaScript, other).
3. **Leads to the problem**: for each of D2's 85 AI comments worth reading, its 4 later fixes and
   its 3 findings worth reading — does the place sit on a node of the graph (changed or context),
   and is the relation the problem involves an edge? Example: Bitwarden #22260's
   `NullInjectorError` needs "`VaultNextComponent`'s template renders `vault-items-table`, which
   injects `VaultBatchBarService`". AI comments were made on earlier heads; they are matched by
   symbol, and D2b's runs give those heads' graphs where it matters.
4. **Size**: nodes and edges per pull request once package nodes are gone; context symbols per
   changed symbol; the largest graphs (Bitwarden up to 1,092 context symbols) — how many nodes a
   reviewer would open.

**Scoring**: the agent scores every item with its evidence; the person scores a blind sample of
about 30 (20 edges or users, 10 "leads to" items), with a note required on each, and the answer
timings are checked before agreement is computed (D2's sample took 65 seconds for 35 items).

**Cost**: no new analysis runs while the job's graphs last (a copy is kept in the worktree's
ignored `coverage/d2-graphs/`; `analyze.mjs` rebuilds them in about 20 minutes). Scoring about half
a day for the agent, about 20 minutes for the person.

**What it decides**: if edges are right and the problems sit on the graph, the graph is the part
to sell, and findings should point into it. If problems sit off the graph (templates, dependency
injection, configuration, workflows), the measured list of what is missing is the next milestone.

**Risks**

| Risk | Mitigation |
|---|---|
| The independent search shares Symbiote's blind spots | Name search across every text file, templates included, read by hand. |
| "On the graph" is too generous for big graphs | Report whether the spot is a changed symbol, a context symbol one hop away, or further. |
| Earlier heads differ from the final one | Match by symbol; use D2b's head graphs where needed. |

**Proposed decisions** (numbered when planned):

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | What does the review graph show? | **Only the repository's own code.** Package nodes and the edges into them leave the canvas; they stay in the graph JSON for types and for finding users. | The person: "the graph should include only code that is written by people". D2: as many package nodes as changed symbols; a third of vite's graph. |
| 2 | What of a change in what a symbol calls in a package? | **A line on the symbol** ("now calls `fs.rmSync`", "no longer calls `takeUntil`"), from the added and removed edges into packages (261 in D2). | A new or dropped dependency call is a reviewer's question; the unchanged ones are not. |
| 3 | What does D2c score? | **Repository code only**: edges into packages are not scored; "leads to" asks about nodes and edges of the repository's code. | Matches decision 1. |
| 4 | How is the person's sample taken? | **A note on each item, timings checked first.** | D2's sample (65 seconds, no notes) could not confirm or refute the agent's scores. |

**Not in D2c**: the viewer change of decisions 1–2 (its own workspace; `flow.ts`, no graph schema
change); recall of whole graphs (a sample only); findings (D2, D3).
