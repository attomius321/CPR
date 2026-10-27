# Journal: V66 — Search the branches to start from

[Index](../JOURNAL.md) · [Plan](../plan/v66-start-from-search.md)

## V66 spike — how many branches Start from lists (2026-10-27, branch `feature/start-workspace-source-start-from`)

Counted the names Start from offers on this repository (`startBranches`: local branches, then
the remotes' names with no local branch): 54 local and 123 only on `origin`, 177 entries in one
native select. At V33 (2026-10-22) there were 102. The person also saw the select's "Only on a
remote" optgroup label unseen in the dark theme.

**Learned**:
- **The select's list is the browser's**: neither a filter nor the group's colour can be set on
  it from the page (`select` has the light `--text` and a 4 % `--input-bg`; the optgroup label
  takes the text's colour over the list's own ground). A list drawn by the page fixes both.
- **The page leaves on Escape** (`StartPage`'s `onKeyDown`): a list open on it must stop its own
  Escape.
