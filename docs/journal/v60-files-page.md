# Journal: V60 — A Files page in the review, the default

[Index](../JOURNAL.md) · [Plan](../plan/v60-files-page.md)

## V60 spike — what a review shows of a change, and whose diff a file page should draw (2026-10-26, branch `feature/simpler-reviewe`)

Asked for a second, simpler page in the review, the default: the changed files on the left as in
a workspace, a file's diff on a click, comments on its lines. Read on `main` (`00d88e1`): the
diff's page (`diff/App.tsx`), its detail panel's diff and comments (`DetailPanel.tsx`,
`comments.ts`), a workspace's changes panel (`ChangesPanel.tsx`, V29d, V43), the server's per-diff
routes and a branch review's verdict (`server.ts`, `server-requests.ts`, `reviews.ts`). Measured
on the last 8 merges into `main` and on Bitwarden `737ee3f`.

**Learned**:
- **A third of a change has no symbol**: 54 of the 185 files of the last 8 merges (44 Markdown,
  10 PNG); 7 of Bitwarden `737ee3f`'s 31 files are templates, symbols only with the Angular
  plugin. A review shows none of them, and no comment can go on them: a comment always names a
  symbol (`parseLocalReview`).
- **The graph already lists every changed file** (`files`, git's name-status with renames), and
  `/api/source` already serves both sides of each: the list needs no analysis change.
- **jsdiff is fast but not git**: `diffLines` took 16 ms at most a file on the 185, but on a
  README rewrite counted +247 −1126 where git's numstat says +281 −1160. A list showing git's
  counts beside jsdiff's rows would disagree; the page draws git's diff.
- **git with the whole file as context is cheap**: `--unified=2147483647` is one hunk of the
  whole file, ~10 ms even for a 1.6 MB, 46,216-line `package-lock.json`. The viewer folds it to
  3 lines of context itself, so a fold's size is exact, the last one included, with one request.
- **Forges take comments in their own hunks only**: GitHub's `line`/`side` and GitLab's
  `new_line` or `old_line` (`packages/forge`); an unchanged line on GitLab needs both. Under
  `symbiote pr` only added and removed lines take one.

## V60 — a review opens on its files: a file's diff, comments on its lines (2026-10-26, branch `feature/simpler-reviewe`)

A diff's page has two pages, **Files** (the default) and **Graph**, switched in its bar or with
`g`. Files lists every changed file as a workspace's changes panel does, with git's lines
(`GET ./api/files`), and shows the one picked: git's diff of it with the whole file as context
(`GET ./api/file`, core's `fileDiff`), folded in the viewer to 3 lines around each change. A
click on a line writes a comment there; it names the innermost symbol holding the line, none
outside every symbol (`symbol` optional in a verdict's comments). Decisions 431–436.

**Learned**:
- **`test/files.test.ts` is taken**: the viewer's guard on file names that collide on macOS. A
  `Write` of a new test by that name replaced it; it was restored from git before anything was
  committed. The module is `diff/file-diff.ts`, its test `file-diff.test.ts`.
- **Two tabs named Files**: the page switch's and the list's (`Files 2`). Tests scope them (the
  `Files` navigation, `.page-switch`); a person reads them in two places, the bar and the list.
- **59 of 279 e2e tests opened a diff and expected the graph**: 20 specs open a diff by its
  address (19 through `graphPage(url)`, look.spec with `?view=graph`), 3 reach one from History
  (`showGraph(page)`). The tests of the review tab alone passed unchanged: it is on both pages.
- **A comment on a line in a fold would be hidden**: the rows with comments, the one being written
  on and the one asked for from the review tab are drawn, folds or not (`foldRows`'s `pinned`).

**Verification**: tests first, red for the right reason (core 6, CLI 7, viewer 6 and the new
module's file); `pnpm check`
1,829 tests; e2e 279 of 279 (`files.spec` new; 59 tests moved to the Graph page). Bitwarden
`737ee3f`, served by this build: the first diff drawn 155–167 ms after navigation, a file's diff
17 ms a click (median; at most 26 ms, 345 rows); its parent `0cb1967`, a 1.6 MB lockfile: drawn
in 118–124 ms, 26 of its 46,216 lines shown. Screenshots of both pages, dark and light, read.

Not verified: GitLab's comments from the Files page; a real agent's workspace; macOS and Windows;
a diff over 5 MB in a browser; a moved head under a line comment without a symbol in a browser
(unit-tested).
