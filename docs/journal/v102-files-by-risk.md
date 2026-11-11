# Journal: V102 — Files in order of risk

[Index](../JOURNAL.md) · [Plan](../plan/v102-files-by-risk.md)

## V102 spike — Files opens on a docs file (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

On 30 of the last 30 merges into `main`, Files opens on a file that is not code (`docs/JOURNAL.md`,
`README.md`, a skill). The top finding's file sits at a median position of 28 (5 to 111), and Files
shows no finding ([shot](../../spikes/graph-usability/shots/p07-files-opens-on-docs-dark.png)).

## V102 — files in order of risk (2026-11-11, branch `feature/v102-files-by-risk`)

The Files page now lists the files with listed findings first, worst severity first and then
the most of each. Other code comes next, then tests, then every other file, with git's order
inside each group. While the change is analyzed, the list stays in git's order. When the graph
arrives, the list reorders and the file open stays open. Each row counts its findings in the
worst severity's colour, as a graph card does. Decisions 973–974.

**Learned**:
- **`fileOf` is not a node's file.** The plan pointed at `fileOf` and `countFindings` in
  `graph/flow.ts`. The first is a node's signature line; the second is private and counts
  settled changes too. `fileFindings` reads a finding's file from its symbol's side, as
  `changeList` does, and a removed symbol of a renamed file finds its row by the old path.
- **App resets the open file on every new graph, after the page's own effects.** Keeping
  `openFile` by path was not enough. The file read while the change was analyzed jumped to the
  riskiest when the graph arrived: to `src/zoo.ts` in the e2e test, with the fix taken out.
  The fix stays out of `App.tsx`, where V101 works: the Files page holds the file by path while
  analyzed, and opens it again once App has reset it.
- **"While analyzed" is not an address.** `?view=files` means nothing (`diffView` reads only
  `graph`). The Files page is reached during the analysis by **Read the files**, and the e2e
  test opens it that way.
- **The order changes no other list.** `useReviewFiles` returns the order, so `j`/`k`, the
  arrows and "3 of 5" follow it without changes to `useDiffKeys`. A workspace's Changes panel
  keeps git's order, because `FileRow` is not changed.
- **Of the spike's 30 merges, 4 still open on a docs file**, and they change no code: a
  journal index, a spike's write-up, an audit and the README's remake.

**Verification**: tests first. On a stub that kept git's order, 9 of the 10 tests in
`test/file-order.test.ts` failed. The tenth checks that nothing moves when nothing should. Two of
the tests read V100's real findings of the feature and the small fix
(`test/fixtures/findings/`). `e2e/files-order.spec.ts` (3 tests, a new fixture
`test/fixtures/files-by-risk` whose 2 warnings are in the last path) failed on `main`'s build: git's
order, and no count once the graph arrived. With `useKeptOpen` taken out, its 2 analysis tests
failed. All pass now. `e2e/files.spec.ts` follows the new order. `pnpm check`: 3,502 unit tests.
`pnpm build`. `pnpm test:e2e`: 455 of the viewer's 456 passed, `page-frame.spec.ts` and
`targets.spec.ts` among them, and the nexus's 32. The one failure, `large-graph.spec.ts:155`, walks
the Graph page, which this change does not touch. It failed with the machine's load average at 24
from other workspaces, and passed alone 5 of 5 and with its file. A real `symbiote view` of `main` and of this branch,
each in a scratch clone with its own cache, 2560 × 1440, both themes. The feature opened on
`CLAUDE.md` (its warning's file 49th) and now opens on `pages.ts`, 1 of 55, with 4 counts. The
small fix opened on `docs/JOURNAL.md` and now opens on `workspace-agent.ts`. Over the spike's 30
merges, made again with this branch's CLI: 0 of 30 opened on code or a file with a finding, and
26 of 30 do now. On the 18 with a listed finding, the file it opens on had sat at median 33rd (8th
to 90th). Order and counts: 0.4 ms on 137 files. Shots: `docs/images/v102-files-by-risk/`.

Not verified: the app's window (Electron); every shot is headless Chromium. A change re-analyzed
while its Files page is open (new commits on a workspace's branch) was not run; it takes the same
path as the first analysis.
