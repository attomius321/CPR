# Journal: NX2 — Open a Symbiote from the nexus, in any folder of this PC

[Index](../JOURNAL.md) · [Plan](../plan/nx2-open-from-folders.md)

## NX2 spike — this PC's folders, and a `symbiote view` started by another process (2026-10-28, branch `feature/symbiote-nexus-upgrades`)

Asked to choose the folder a `symbiote view` starts in, from the nexus, seeing the PC's folders.
Read: the nexus (NX1's server, registry, page), `symbiote view`'s start and stop
(`packages/cli/src/main.ts`), the viewer's write checks (`server.ts`'s `writable`), the desktop
app's start page (its system folder dialog), the Monitor page's crumbs. Measured on this machine
(WSL2): a folder's listing with its repositories marked (a script in the job's folder:
`readdir`, then a `stat` of each folder's `.git`), three runs each; `symbiote view --no-open`
from main's build (`e980dde`) in a throwaway repository with a cache of its own, from its start to
its record and to its address; then a spike: a parent starting it detached with its output in a
file, exiting once the record appeared.

**Learned**:
- **Listing is cheap everywhere here**: 2–6 ms for home and `~/projects` (46 folders, 16
  repositories), 3 ms for `/mnt/c` over WSL's 9p, 38 ms for `System32` (4,950 entries). No cache
  or paging needed; a cap of 1,000 rows keeps a huge folder's page small.
- **`symbiote view` writes its record when its address is printed**: 216–223 ms, record and
  address within 2 ms of each other. The record (NX1's contract) is what the nexus waits on.
- **Detached, it outlives its starter**: in a session of its own (pgid = sid = pid), still
  answering `/api/status` after the parent exited; a terminal's Ctrl+C to the nexus does not
  reach it. SIGTERM stops it in ~11 ms and its record goes.
- **Its output must not be a pipe to the nexus**: once the nexus exits, a write to a closed pipe
  is an EPIPE error on the CLI's stdout. A file takes it.
- **Outside a repository it fails fast and says why**: exit 1 in 217 ms,
  `symbiote: not inside a git working tree: <path>` as its last line.
- **Worktrees have a `.git` file**: a `stat` of `<folder>/.git` marks both kinds.

Not verified in the spike: macOS's places (`/Volumes`), a repository on `/mnt/c` served (git over
9p is slower), a start on a large repository.

## NX2 — Folders, Open Symbiote, Stop and Start again (2026-10-28, branch `feature/symbiote-nexus-upgrades`)

Built after the person's OK, with their answers: a Folders tab, Symbiotes started from the nexus
outliving it, Stop for every Symbiote, folders only (decisions 539–543). NX2a: the listing, the
places, starting and stopping, the server's three routes. NX2b: the Folders tab, Open Symbiote,
Stop's question, Start again. NX2c: the spec in Symbiote's window, screenshots, numbers, docs.

**Learned**:
- **The CLI's own error is the best message**: outside a repository, or in a folder whose `.git`
  git does not take, `symbiote view` prints `symbiote: not inside a git working tree: <path>`
  and exits in about 220 ms. The nexus shows its last `symbiote:` line instead of checking
  anything itself.
- **A start is done when its record appears**: the record (NX1's contract) is written as the
  address is printed, so the nexus waits on one file and never parses the CLI's output.
- **A page's newest request must win**: the screenshot script typed a folder while Up was on its
  way; the typed one failed and Up's answer, older, was dropped. Kept: the person's last action
  decides what is shown.
- **Focus can fall out of the tab**: Enter on the last folder of a branch opened an empty folder,
  its rows went, and focus went to the page's body, where Backspace reaches no listener. Up now
  takes the focus when a folder has no folders.
- **A button cannot hold a button**: Stop at the end of a row of Symbiotes made the row a
  wrapper of two buttons; NX1's specs, which count `.nexus-row`, did not change.

**Verification**: tests first (red: no modules; the routes 404 and 405), the nexus's unit tests
46 → 80; `pnpm check` passes (2,165 tests); e2e: the whole suite passes (`pnpm test:e2e`: the
viewer's 336 specs in 5.1 min, then the nexus's 14 in 16.1 s: 5 new Folders specs, 1 new in
Symbiote's window under Xvfb). A real run with curl on the built nexus: a start answered in
262 ms, a plain folder gave the CLI's error, a request from another origin 403, the started
Symbiote served on after the nexus's Ctrl+C, and a new nexus stopped it in 66 ms. On a 300-deep
clone of this repository, Open Symbiote showed the Git page's first row 487–608 ms after the
click; a listing of `~/projects` took 5–6 ms, of `System32` 44–47 ms. Screenshots at 1×, dark and
light, 1440 and 800 px: every state of Symbiotes, Folders, Stop's question and a stopped tab.
`git diff --stat` touches `packages/nexus`, the docs, the README and `CLAUDE.md` only. No analysis
change: no regression-check.

Not verified: macOS and Windows outside WSL; the person's WSLg window (Xvfb only); a repository on
`/mnt/c` opened (git over 9p); a Symbiote stopped while an agent works in its terminal; a reader
test of the README's section by a fresh reader.

