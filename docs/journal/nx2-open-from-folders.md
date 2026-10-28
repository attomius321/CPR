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
