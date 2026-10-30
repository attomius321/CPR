# Journal: NX4 — Pinned folders in the nexus

[Index](../JOURNAL.md) · [Plan](../plan/nx4-pinned-folders.md)

## NX4 spike — how the person uses the nexus, and what Folders offers to come back to (2026-10-30, branch `feature/pinned-in-symbiote-nexus`)

Asked for "pinned" in the nexus, with no more said. Read NX1–NX3's plans and journals and the
page (`src/page/`). Then the person's logs (`~/.cache/symbiote/logs`, 2026-10-28 to 30) for the
nexus's runs and the Symbiotes it started and stopped, and `folders()` over their folders, run
with `node --experimental-strip-types`. The first plan pinned Symbiotes as tabs in the row; to its
questions the person answered "Folders", "Wait for my start" and "As you wish", and the plan was
rewritten for pinned folders before any code.

**Learned**:
- **Nothing the person chooses is kept**: 14 runs of the nexus in three days, each on a new port,
  so a page's own storage (per origin) would start empty at each. Pins belong in Symbiote's
  settings folder, beside `hive.json`.
- **The same folders, again and again**: of 10 Symbiotes started from the nexus, 9 were in
  `~/projects/Symbiote`. With nothing running, Folders' places are Home, `/`, `C:` and `D:`;
  `projects` is a place only while a Symbiote in it runs, and `Symbiote.worktrees` never is.
- **Most stops are restarts**: 6 of 7 stops from the nexus were followed by a start of the same
  repository 4–22 s later. Not NX4's; a Restart button is left for later.
- **A Symbiote costs 229 MB** resident here: nothing a pin shows starts by itself.
