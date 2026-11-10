# Journal: Refactor — layoutFlow in its phases

[Index](../JOURNAL.md)

## layoutFlow's phases as functions (2026-11-09, branch `refactor/layout-flow`)

Asked to keep refactoring after `chore/dedupe-helpers`. `layoutFlow` (`packages/viewer/src/graph/flow.ts`)
was the safest of the long functions the survey found: 378 lines with 64 branches, pure, and
covered by `flow.test.ts`. It is now 108 lines that call its phases in order. Each phase is a pure
function of 14 to 45 lines, moved word for word.

**Learned**:
- **The phases were already marked.** Each had a comment, and the extracted functions keep those
  comments as their doc comments: `neighboursOf`, `summarize`, `drawnSymbols`, `summarySpans`,
  `fileBoxes`, `summaryEdgesOf`, `layoutBoxes`, `projectFrames`, `placedInFrames`, `placeBoxes`,
  `projectNodesOf`, `symbolNodesOf`, `symbolEdge` and `fileEdgesOf`. The `Box`, `Frame` and
  `Summary` shapes are named.
- **Two node lists stay inline.** The file nodes and the summary nodes each read six of the
  layout's maps. A function with six parameters would read worse than the 20-line mapping.
- **Order is the layout.** Node order comes from Maps filled in insertion order, and dagre's
  placement depends on the order of nodes and edges. So the code moved without changes: no loop
  merged, no Map rebuilt.
- **For V96**: its plan cites `flow.ts:389-414`, "frames sized and packed". That code is now
  `placeBoxes`, and the frame padding is still `FRAME_PAD` and `LIGHT_FRAME_PAD`.

**Verification**:
- A comparison script loaded `flow.ts` from `main`'s export and from the branch, through Node's
  type stripping. It ran `layoutFlow` on five real graphs: Bitwarden `737ee3f` (1,419 symbols, 23
  projects, Angular plugin), Symbiote's last 40 commits (8,128 symbols, 38,172 edges, 9
  projects), a small Symbiote change (3 projects), zod `f448c44d` and Qwik `bdbd08290`. Each graph
  ran under six option sets: default, no context, type references, every summary expanded, one
  symbol's neighbourhood, and the last three together. All 30 layouts serialized to the same JSON,
  Maps and Sets included, after every step. A one-pixel change to `GROUP_PAD` made all six of a
  graph's layouts differ, so the comparison sees a change that small.
- After each step: the viewer's typecheck, and `flow.test.ts` with `layouts.test.ts` (43).
- Time: medians of 7 alternated runs after a warm-up. Bitwarden took 40.3 ms on `main` and 37.2 ms
  on the branch; Symbiote's 40 commits took 1,857 ms and 1,809 ms. The same, within noise.
- `pnpm check` passes: 245 test files, 3,428 tests. `pnpm build` passes. E2E: the viewer's 436 and
  the nexus's 32 pass.
- Not run: the `viewer-check` skill's screenshots. The layouts are the same JSON, so the pictures
  are too; their time is measured above.

Merged into main (2026-11-10).
