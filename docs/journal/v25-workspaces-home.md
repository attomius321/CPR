# Journal: V25 — Workspaces first, History beneath

[Index](../JOURNAL.md) · [Plan](../plan/v25-workspaces-home.md)

## V25 spike — what "workspaces first" touches (2026-10-19, branch `milestone/v25-workspaces-home`)

Asked: the commits page's name, and that Symbiote still starts from commits when it works one level
higher, in worktrees the person calls workspaces. Measured on `main` (`d604c2d`):

- `/` is the commits page (V10a, before workspaces existed). Workspaces is the second tab at
  `/workspaces` (V18b; `/features` redirects there). A diff's way back is always "← Commits".
- On screen, workspaces are already called workspaces (V24). Underneath they are still
  "features": 1,949 matches in code and tests, 12 file names, `/api/features` (30 uses),
  `symbiote/features/<branch>.json`, and the "Features" section of the `symbiote/AGENTS.md` Symbiote writes.
  Since V24 "feature" is also one of the five kinds of work (`WorkKind`, the `feature/` prefix), so
  a text replace would break the kinds. The rename has to go symbol by symbol.
- `repository.features` is set on every `symbiote view` (`main.ts`), so Workspaces can always be the
  first page. Its empty state exists already ("No workspaces yet …") but has no action.
- 54 of the e2e's 90 `goto` calls open `/` and expect the commits page.
- `h` and `w` are not bound on either page.

Planned as V25 (PLAN.md): Workspaces at `/`, History at `/history`, then the rename, then the
records on disk.

## V25 — Workspaces first, History beneath (2026-10-19, branch `milestone/v25-workspaces-home`)

`symbiote view` opens on Workspaces (`/`). The repository's history is History (`/history`), and in
code, the API and on disk a workspace is a workspace. "Feature" is left for the kind of work.

Learned:
- **A rename across 1,949 matches needs the syntax tree and then a person.** The script renamed
  identifiers, strings it knew (module paths, API paths, CSS classes), comments and test titles.
  Typecheck caught three objects keyed by kind. It could not catch a kind key in a test's
  `toEqual` (`workspace: undefined` passes, since `toEqual` ignores undefined keys) or a fixture's
  git branch named `feature` (`shas.feature` → `shas.workspace` typechecks, because both sides were
  renamed). Only reading the diff found those. A guard test now lists the 5 `feature` identifiers
  left in `src`.
- **Moving the root address moves its query too.** `/?branch=` meant "History at this branch" and
  now means "Workspaces, this one picked". The workspace's branch link still pointed at History's
  old form. No test covered it; reading every `href` did.
- **The referrer, not history state, says where a diff came from.** Diffs are opened with
  `location.assign`, so the page that opens one cannot leave state on it. `document.referrer`
  survives a reload and is empty for a bookmark.
- **The hook can be the first reader.** An agent started before the upgrade fires its hook (its own
  process, `thread.ts`) before anyone opens `symbiote view`, so the hook moves `symbiote/features/` too.
  `rename` replaces an empty target folder on Linux, so "both folders" means both hold records.
- **Interleaved timings mislead.** Measured round-robin, History's first paint looked 108 ms
  against `main`'s 59 ms. Measured alone, each order, 9 rounds: 60 ms both. An occasional
  ~110 ms run showed on both builds.

Verification: tests first (red before) for the pages and back link, `/history`, the help, the
config's old name, the move (old, new, both, neither, two readers), the hook, the list,
`AGENTS.md`, the guard test and the note; 801 unit tests, 114 of 114 e2e. Chromium on throwaway
repositories, light and dark, 1440 and 390 px, no page errors. First paint: `/` 109 ms like
`main`'s `/workspaces`, `/history` 60 ms like `main`'s `/`. The built CLI moved two old records
from its hook, listed them in 40 ms and showed the note for a leftover `symbiote/features/`. Not
verified: a real agent session across the move; Windows; the README's Workspaces screenshot.

Merged into main (2026-10-19): V25a–c, no conflicts (`main` had not moved since the branch
started). `main` verified after the merge: 801 unit tests, lint, typecheck, build, 114 of 114 e2e.
