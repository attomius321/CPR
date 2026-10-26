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
