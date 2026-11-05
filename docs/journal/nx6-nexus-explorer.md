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
