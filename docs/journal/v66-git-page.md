# Journal: V66 — Git: History renamed, a commit's details, changes, branches and remotes

[Index](../JOURNAL.md) · [Plan](../plan/v66-git-page.md)

## V66 spike — what git costs for a commit's details, a search and the status (2026-10-27, branch `feature/history-feature`)

Read History's page, its plans' "later" lists (V9, V10, V10b, V11, V13) and the header's CSS;
timed git on this repository (891 commits) and on Bitwarden's blobless regression clone (43,138).

**Learned**:
- **The scrollbar beside the header is the sticky header**: `.commits-title` is `position: sticky`
  inside `.commits-scroll`, which scrolls, so the track spans the card. Settings, Skills and the
  Monitor share the class but scroll beneath it.
- **Line counts cost a fetch on a blobless clone**: `git show --numstat` took 565–940 ms on
  Bitwarden (3 ms once fetched), `--name-status` 1 ms; on this full clone both take 2–9 ms. The
  pane asks for names first, lines after.
- **A search is half a second on Bitwarden**: `git log --all -i --grep` 451 ms, every subject and
  author 671 ms; it is the server's work, the rows mapped by the listing.
