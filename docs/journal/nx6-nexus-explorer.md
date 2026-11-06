# Journal: NX6 — Nexus on a fixed port, home as an explorer, open or `git init` a selected folder

[Index](../JOURNAL.md) · [Plan](../plan/nx6-nexus-explorer.md)

## NX6 spike — home, Windows' drives, a repository with no commit (2026-11-05, branch `feature/nx6-nexus-explorer`)

A breadth-first scan with NX5's rules and no depth or folder limit, on this PC's home and WSL's
drives; `main`'s `symbiote view` in a fresh `git init` repository, its API and pages in Chromium.

**Learned**:
- **Home is small; its depth is not**: 2,780 folders, 42 repositories, 73 ms warm and 195 ms
  cold, 15 levels; the repositories at levels 2, 3 and 5 only. NX5's 5 levels read 1,690 of the
  folders. `~/go`, Go's module cache, is 1,312 of them with no repository.
- **Windows' drives are slow under WSL**: all of C: had read 52,511 folders after 30 s and found
  1 repository; `C:\Users\anton` 25,546 folders, 18 s, 3; D: 8,755 folders, 6.8 s, 7. Not scanned.
- **A repository with no commit serves**: `/api/status` answers `head: null`; Overview, Git and
  History draw; Monitor answers 409 "no commit to read at HEAD: commit something first", drawn
  red; Start a workspace says "No branch to start from". Nothing crashes.
- **A fixed port inside the system's random range could be taken by a Symbiote**: Linux hands out
  32768–60999 here, Windows and macOS 49152–65535; 7347 is below all of them.

## NX6 — the port, home's tree, `git init` (2026-11-05, branch `feature/nx6-nexus-explorer`)

The nexus serves on 7347 and opens the running one when the port is a nexus's (NX6a); home is
scanned at the start and on ⟳, every folder kept (NX6b); a plain folder is offered `git init`
behind the server's guards (NX6c); the list draws home as a tree, searches every folder, and asks
before `git init` (NX6d). Decisions 923–929.

**Learned**:
- **A running repository is listed twice**: under Running and in its place in the tree. The
  pick, kept by path, jumped back to the first row on ↓ from the second. It now keeps its place
  and which of its path's rows it is (`pick.ts`).
- **A `.git` git rejects looked like a plain folder** to `git rev-parse`: `init.ts` would have
  offered `git init` over it. NX2's e2e of a broken repository caught it; such a folder is now
  started, and the CLI says why.
- **The main test scanned the person's home**: `run` took `homedir()`. `NexusContext.home` gives
  tests their own.
- **The light screenshots were dark**: the nexus takes its theme from the viewer's
  `localStorage` key (`symbiote.viewer.theme`), not the browser's colour scheme.
- **A `pkill` by the nexus's command line would reach other runs**: `--no-open --port 0` is what
  every spec runs. Stop a nexus by the PID whose environment names your cache.

**Verification**: tests first for the port, the scan, `init.ts`'s guards, the tree, Home's rows and
the pick (red, then green; `init.test.ts` was written with its module, run after); `pnpm check`
3,412 tests; the nexus's e2e 32 pass, `app.spec.ts` included; the viewer's 430 of 431 in the full
run, `changes.spec.ts`'s V43 test passing alone (untouched here); the real home scanned in
115–142 ms; screens of 9 states in both themes.

Not verified: Symbiote's window opened on a running nexus by a second start (unit-tested with a
fake window only); a home that hits the 20,000-folder limit (unit-tested with a small limit).

Merged into main (2026-11-06).
