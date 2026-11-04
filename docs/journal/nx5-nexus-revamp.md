# Journal: NX5 — Nexus revamp: search by path, one ordered list, the picked repository's card

[Index](../JOURNAL.md) · [Plan](../plan/nx5-nexus-revamp.md)

## NX5 spike — three designs, the scan's cost, where a history could come from (2026-11-04, branch `feature/nx5-nexus-revamp`)

Three designs for the nexus's page were drawn as static screens in the redesign's kit
(`spikes/hive-redesign/src/kit.css`, `spikes/normal-redesign/src/normal.css`), 1440 × 900 at 1×,
dark and light, in four states each (the page, a search, a path completing, the first run), with
today's nexus on the same data as the before: A one list with columns, B a list and the picked
repository's card, C a launcher in the tab row. They went on one review page; the person picked
B, then asked that only a folder they choose be scanned. Today's nexus was shot by serving the
built nexus with its two reads answered from the designs' data (`page.route`), nothing running.

**Learned**:
- **A scan of home is cheap here**: 913 folders and 41 repositories, 5 levels, 35 ms cold and
  6–12 ms warm; depth 3 already finds 31. `~/projects` alone: 256 folders, 21 repositories,
  3–6 ms. The person chose to scan one folder of their choosing, not home.
- **MC1's records are no history**: `<cache>/views/*.json` is removed when a view stops
  (`removeViewRecord`), so only running views are there. The nexus's own logs name the Symbiotes
  it started, not those started in a terminal. NX5 keeps its own history.
- **Worktrees are mostly Symbiote's own**: this repository has 26 (`.git/worktrees`), 25 of them
  analysis checkouts in `~/.cache/symbiote/worktrees`. A repository's checkouts must leave the
  cache's out.
- **Keys in a Symbiote's frame never reach the nexus**: each Symbiote serves on its own port, so
  its frame is another origin. A launcher bound to Ctrl K (option C) would work only on the
  nexus's own page.
- **Today's page shows 9 repositories at 900 px, 4 of them twice**: a running repository is a
  Symbiote card and, in the folder listed under them, a repository card.
