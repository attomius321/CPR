# Journal: E1 — Decisions and their ripples (measured)

[Index](../JOURNAL.md) · [Plan](../plan/e1-explained-changes.md)

## E1 spike — decisions and their ripples (2026-10-04, branch `milestone/e1-explained-changes`)

Asked what would make Symbiote disruptive, the leading idea was to verify the mechanical part of a
change (a rename and its call sites, moves, a new argument at every call, the same edit repeated)
so a reviewer reads only the decisions. Measured before planning; it does not hold for typical
changes. Nothing in Symbiote changed; the scripts are in `spikes/e1-ripples`.

**Learned**
- Typical changes are decisions. On 165 unique changes (pinned sets, the latest commits of five
  repos, commits titled refactor/rename/move), 20 % of changed symbols but 5.4 % of diff lines are
  verifiable; without one large rename (Qwik `f7ed58cfc`, 72 % of its symbols), 2.8 % of lines.
  "Refactor" commits restructure code: 1.3 % of their lines.
- Symbiote's move matching found 29 of the 66 renamed symbols in Qwik `f7ed58cfc`: a renamed symbol
  often mentions its own name or others renamed with it (`EbFallback` → `CatchFallback` with
  `"eb-fallback"` ids inside), so its body changes and it shows as removed + added. Renames inferred from the change itself (moved
  names, renamed folders, pairs equal under their name difference) found them; one change may
  rename a word two ways, so every way must be tried.
- The biggest class was not ripples but the same edit repeated across files (148 symbols): one
  feature adding a key to 40 locale files, a prop changed in 24 files.
- Verified symbols are many and small: grouping them would shorten the change list by a fifth and
  the reading by a twentieth.
- Traps: a raw scanner misreads JSX text (an apostrophe starts a string) — tokens must come from
  the AST, as Symbiote's hashes do; a commit list grepped by message matches bodies too (`perf:` commits
  "mentioning a refactor"), so filter subjects; one feature reverted and re-applied counted three
  times until changes were deduplicated.

**Verification**: precision audit of 40 verified symbols drawn at random (moves left out): all
mechanical, none hiding a real change. The script ran on every comparison without an error.
Not verified: recall (how many mechanical changes the rules miss beyond member renames, seen in
Qwik `f7ed58cfc`); changes outside these five repositories.

Merged into main (2026-10-12).
