# Journal: Fix — two e2e flakes, two product races

[Index](../JOURNAL.md)

## Fix — a starting agent is at work; a page's own read never puts back an older state (2026-11-10, branch `fix/e2e-flakes`)

Two viewer e2e tests failed only in full runs, under load: `shell.spec.ts:134` (the sidenav keys:
after `w` the first card was focused, then it was no longer first; 2 of 4 full runs on the
refactor/cli-services merge) and `workspaces.spec.ts:2303` (after Land, a fast-forward merge
stayed "Queued: … (main moved: fast-forwarding again from its tip)" for the test's 12 s; finding
S9 of the improvement audit). Neither test was wrong: each showed a race in the product.

**Learned**:
- **The cards do not sort by their agent's last action.** The sidenav groups them (Waiting for
  you, To review, Not running, Working), each group in the order the workspaces were started. A
  card moves only when its group changes.
- **A workspace being started read as "No agent".** `launch()` writes the record before
  `claude --bg` runs, because the session's first hooks look for it; the record says
  `agent: null` until `--bg` returns. A read meanwhile listed the workspace with a red "No agent:
  give it the prompt" in **Not running**, above Working. So did a read that began during the
  launch and finished after it: its record or its `claude agents` list was from before the
  session was listed (the stream reads the workspaces in 0.1–1 s under load). The start page
  closes only when its request returns, so the test's keys came after the launch, in that second
  window: `w` focused "Add clamp" in Not running, and the next read moved it below "Add a half
  function" in Working. The focus followed the card, as designed (the test at line 217 checks
  it). The product was wrong, not the test: every new workspace flashed "No agent".
- **The fix keeps the launches, not a clock.** The workspaces service keeps the Claude Code
  launches under way and, for each that ended, a count of ends (`workspace-launches.ts`). A list
  marks the count when it begins. An agent not listed, with no error, whose launch is under way or
  ended after that mark, is `working`. A read that began after the launch ended says what it did
  before: the session gone is "Not running".
- **The merge was not stuck in the merger: the page put an older state back.** After Land the
  page reads the five parts itself (`reloadWorkspaces`). Its `/api/merges` answered "Queued" while
  the drain ran; its `/api/workspaces`, slower under load, held the answer back until after the
  stream had pushed "Cannot fast-forward". Then the older answer replaced the pushed one. The
  stream sends only what changed since it last sent, so nothing corrected it, not even the 60 s
  safety read. A page's own read now never replaces a part the stream pushed after that read
  began (`useWorkspaces.ts`).
- **The other suspect, a drain skipped, could not be ruled out from a passing run.** `kick()`
  swallowed a drain's error (its lock, the queue's file) without a word. It now goes to
  `symbiote view`'s log ("merger stopped"); any read of the merges or action kicks again. The page's race explains the
  stall alone, and was red at once; no full run here failed it, so no drain error was seen.
- **A slow `--bg` alone did not fail line 134** (3 of 3 passed at 1.5 s): the start page waits for
  the start's answer, so the keys came after the launch. The window it hit is the read that spans
  the launch's end, which the unit test pins down.

**Verification**: tests first, each red for the right reason on main's code:
- `shell.spec.ts` "a workspace whose agent is still starting is at work, never "No agent"": the
  fake Claude Code's new `slowStarts(1_500)` holds `--bg` as under load; a MutationObserver
  records every card's group while the second workspace starts. Red: 3 records of "Not running:
  Add clamp … No agent: give it the prompt".
- `workspaces.spec.ts` "a page's own read after Land never puts back what the stream already
  moved on from": `page.route` holds the page's `/api/merges` answer (it said `queued`) until
  the pushed "Cannot fast-forward" shows, then gives it. Red: the row back on "Queued: … (main
  moved: fast-forwarding again from its tip)", the brief's text.
- `workspaces.test.ts`: an agent being launched lists as `working`; a list whose sessions were
  read before the launch ended and answered after it too (red without the read's mark: `no-agent`);
  after the launch, a session gone is `not-running` as before.
- `merges.test.ts`: a lock that cannot be taken is told to `onError` once, the entry stays
  queued, and the next kick lands it (red: no error told).
- The e2e harness keeps each served view's `logs/` and `state/` with
  `SYMBIOTE_E2E_KEEP=<folder>`, for a flake seen once in a full run.
- Five full `pnpm test:e2e` runs (viewer 438 tests, then nexus 32), headless, without
  `WAYLAND_DISPLAY`; runs 3–5 with 16 extra busy CPUs (32 cores):

  | Run | Load average (1 min, at end) | Viewer | Nexus |
  |---|---|---|---|
  | 1 | 9.7 | 438 passed (3.0 min) | 32 passed |
  | 2 | 8.0 | 438 passed (2.9 min) | 32 passed |
  | 3 | 23.9 | 437 passed, 1 failed (3.4 min) | 32 passed |
  | 4 | 25.2 | 438 passed (3.7 min) | 32 passed |
  | 5 | 23.6 | 438 passed (3.7 min) | 32 passed |

  Neither `shell.spec.ts:134` nor `workspaces.spec.ts:2303` failed. Run 3's failure is
  `settings.spec.ts:765` (the advisor's Settings: `advisor.claude.effort` still in the config 15 s
  after Home cleared it, three saves in a row at load 24). This branch does not touch that code; it
  passed 20 of 20 alone. Not fixed here.
- The two tests and the two new ones, `--repeat-each 12 --workers 8` with the same extra load
  (load average 27): 48 of 48.
- `pnpm check` (3,456 unit tests) and `pnpm build` pass.
