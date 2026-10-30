# Journal: Fix — pinned Symbiotes on Symbiotes, the folders under them

[Index](../JOURNAL.md) · [Plan](../plan/nx4-pinned-folders.md#fix-pinned-symbiotes-on-symbiotes-the-folders-under-them-fixnexus-pinned-symbiotes)

## Fix — pinned Symbiotes on Symbiotes, the folders under them (2026-10-30, branch `fix/nexus-pinned-symbiotes`)

The person: "I would like to see the pinned Symbiotes in Symbiotes tab of nexus...Also i don't
like the Folders...Put them in Symbiotes page. It is redundant". Read their `nexus.json` and the
nexus's lines in their logs (read only), then NX3's and NX4's plans and the page. Planned first;
the person's OK: "Go for it". Decisions 626–628.

**Learned**:
- **"Pinned Symbiotes" were pinned repositories.** The person's two pins were Starknet and
  Symbiote, and the 9 Symbiotes the nexus started that day were those two (7 and 2). They pinned
  `projects` twice and unpinned it within 1.5 s each time. A pinned repository is a Symbiote to
  start; a pinned folder is a place to go.
- **"Repositories in" and Folders showed the same cards.** Folders opens in the folder of the
  newest running Symbiote, which is the folder "Repositories in" listed first. With the folders
  under the cards, it went.
- **A listing told the page it moved before it took the pins**: the folders were drawn once with
  no pins, and the next drawing was skipped, its key (the listing, the pins inside it) unchanged.
  Two e2e specs caught it; the pins are taken first and are in the key now.
- **A nexus started by a spec without a home would list the person's**: Symbiotes lists a folder
  as it opens. `startNexus` gives one of its own by default.
- **`main` moved under the branch.** fix/first-time-symbiote-from-nexus (decision 625) was merged
  while this one was built. It changed the frames' code and added a spec opening Symbiotes from
  `#folders:`: merged in without a conflict, and its spec passes on the one page as it is.

**Verification**: tests first: 5 unit tests and 8 e2e specs red on main's build, for the reasons
planned (a function missing, Folders' tab still in the row, no pinned card). After: the nexus's
unit tests 111 → 113, `pnpm check` (2,477 tests), `pnpm build`, the nexus's 20 e2e specs (3 in
Symbiote's window under Xvfb). `pnpm test:e2e`'s viewer run: 351 of 352, the other
(`workspaces.spec.ts:458`, a box read null) passing 3 of 3 alone; no viewer change here. Reading
a pinned repository's branch costs 0.3–1.0 ms for the person's two pins. 16 screenshots at 1×,
dark and light, 1440 and 800 px.

Not verified: macOS and Windows outside WSL; the person's WSLg window (Xvfb only); a pinned
repository on `/mnt/c` started from its card; a reader test of the README's section.
