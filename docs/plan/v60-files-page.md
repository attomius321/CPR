# V60 — A Files page in the review, the default

[Index](../PLAN.md) · [Journal](../journal/v60-files-page.md)

**Status:** in progress (2026-10-26), on branch `feature/simpler-reviewe` (a workspace started in
Symbiote, from `main` at `00d88e1`); the plan OK'd by the person ("Ok") with its three defaults:
the pages named Files and Graph, unchanged lines commented on a branch review, every review
opening on Files.

**Problem** (asked: "We need a second page in the review, a much simpler that the current graph.
This would be the default page. Should display the file changes, like in workspaces on the left,
and on the page, by clicking the file, you should have the capacity to see the changes, and leave
comments at specific lines"). A diff's page (`/diff/<pair>/`, a branch review's
`/review/<branch>/`, `symbiote pr`) is the graph: a diff is shown only for one symbol, in its
detail panel, and a comment goes only on a +/− line of a symbol. Measured on `main` (`00d88e1`):

| What | Measured |
|---|---|
| What the page shows of a change | The graph of symbols; a diff only per symbol, in its panel |
| Files of the last 8 merges into `main` with no symbol (`git diff --name-only -M` of each) | **54 of 185 (29 %)**: 44 Markdown, 10 PNG; none can be seen or commented in a review |
| Bitwarden `737ee3f` (31 files) | 7 Angular templates: symbols only with `--plugin angular` |
| Where a comment can go | A +/− line of a symbol's diff; a comment always names a symbol (`parseLocalReview` refuses one without) |
| jsdiff's `diffLines` (the viewer's) on those 185 files, both sides from `git show` | 16 ms at most a file; **1 file of 185 counted otherwise than git** (a README rewrite: +247 −1126, git +281 −1160) |
| `git diff --unified=2147483647 -M` of one file (the whole file as context) | ~10 ms, Bitwarden's 1.6 MB `package-lock.json` (46,216 lines) included; 0–10 ms for its sources |

**Goal**: a review opens on a Files page: the changed files on the left, drawn as a workspace's
changes panel draws them; a click on one shows its diff; a click on a line of the diff writes a
comment there, one of the review's. The graph stays, one click or `g` away. **Unchanged**: the
graph page and everything on it, the graph JSON, the analysis, a review's verdicts for comments
that name a symbol.

## The page switch (`packages/viewer/src/diff/App.tsx`)

- The bar gets a segmented switch, **Files | Graph**, after the review's summary. Files opens
  first; `g` switches; the address keeps the choice (`?view=graph`; Files has no parameter), so
  a reload stays. The API stays relative (`./api/…`): a query does not change where it goes.
- Graph's own toggles (Only changes since, Focus, Context, Type references) and its legend show
  on Graph only; the bar's help gives the page's own keys.
- A graph opened with no server (`?graph=<url>`, a file dropped on the page) opens on Graph: there
  is no diff to show (`scripts/viewer/measure.mjs` stays as it is).

## The Files page (`packages/viewer/src/diff/FilesPage.tsx`, `FilesPage.css`, `files.ts`)

- **On the left, the changed files**, every file of the graph's `files` (Markdown, images, files
  left out of the analysis too), in git's order, each row the workspace panel's: status letter,
  name, folder, `+a −r` (or `binary`). The row is exported from `workspaces/ChangesPanel.tsx`,
  with its label and hover given by its user. The open file is marked (`aria-current`); `j`/`k`
  open the next and previous file. Tabs above the list: **Files** (with its count) and **Review**
  (the review tab as today: the comments, the summary, the verdict, Finish), the latter only
  where the page takes a review. The list is as wide as dragged (`Resizer`, kept in `widths.ts`
  as `files`).
- **On the right, the open file's diff**: a head with its path (`old → new` for a rename), what
  changed, `+a −r`, and Open in VS Code where the server opens files (`o`; Ctrl/⌘+click on a line
  opens that line). One column of rows, both line numbers, the colours of a symbol's diff (the
  `.code` rows of `DetailPanel.css`). Unchanged runs fold to 3 lines of context around each change
  (git's own hunks); a fold says "N unchanged lines" and opens on a click. A binary file, a
  rename without edits or a change of mode only gets a sentence in place of rows.
- **Comments**: a click on a line opens a comment box under it; Ctrl/⌘+Enter adds, Esc closes.
  The comments already on a line are drawn under it, each with Delete. They are the review's
  drafts (`useReview`): the Review tab lists them, Finish (or Submit, under `symbiote pr`)
  records them; one written on the Graph page shows here at its line, and the other way round.

## What a file's diff is (`packages/core/src/git/file-diff.ts`, `packages/cli/src/server.ts`)

- **git's**, not the browser's: `git diff --no-color --no-ext-diff --unified=2147483647 -M <from>
  <head> -- <previousPath> <path>`, from the graph's `revisions.from` to its head — the whole file
  as one hunk, which the viewer parses and folds (`files.ts`, pure). The `+a −r` beside a name is
  then exactly what its diff shows (decision 286's rule), which jsdiff missed on 1 file of 185,
  and the folds are git's hunks.
- `GET ./api/files`: the graph's `files`, each with git's lines (`listLineCounts`, one
  `git diff --numstat -M` of the pair; `binary` when git says so), read once per graph.
- `GET ./api/file?path=<path>`: that file's diff as text. A path not in the graph's `files` 404s;
  a diff over 5 MB 413s (the page offers VS Code). `/api/capabilities` gains `files: true`.
- Both under `symbiote view` (each diff and branch review) and `symbiote pr` (the same repository
  its sources are read from). A graph without a server has neither: the Files page lists its
  files without lines and says the diff shows when it is opened with `symbiote view`.

## Where a comment goes (`packages/viewer/src/diff/comments.ts`, `packages/cli/src/reviews.ts`)

- **Which lines**: on a branch review, every line shown; an unchanged line is commented on its
  head side. Under `symbiote pr`, only added and removed lines: the forge takes comments inside its
  own hunks only, and GitLab needs both line numbers for an unchanged one.
- **The symbol it names**: the innermost symbol of the graph that holds the line on its side (a
  node's `head` or `base` range in that file). Such a comment is about that symbol as today's are:
  it follows it to its new lines, goes to the summary when it changes, and shows in its panel.
- **A line outside every symbol** (Markdown, JSON, a top-level line) names none. Its draft keeps
  the head it was written at; when the page's head is another, it goes into the summary, quoted
  with its path and line, not onto a line that may have changed.
- **A verdict's comment** (`VerdictComment`, core): `symbol` becomes optional, present unless the
  comment is on a line outside every symbol. `parseLocalReview` takes a comment with a line and no
  symbol (its path and line checked as now) and refuses one with neither; the verdict's text for
  an agent reads `path:line` alone; `symbiote/AGENTS.md`'s words (`prompts.ts`) say `symbol` is
  there when the line is in one.

## Verification

1. **Tests first** (red before): core `file-diff.test.ts` — a modified, added, deleted, renamed
   (with and without edits), binary, mode-only, CRLF and no-newline-at-end file; CLI
   `server.test.ts` — `/api/files` and `/api/file` (200, 404, 405, 413), capabilities;
   `server-requests.test.ts`, `reviews.test.ts` — a line comment without a symbol taken, one with
   neither refused, the verdict's text; the viewer's `files.test.ts` — the parser, the folds (gaps,
   context, merged hunks, a fold opened), the side and symbol of a line's comment, the lines that
   take one under a forge; `comments.test.ts` — a file draft refreshed (same head kept, another
   head into the summary), `toReview` and `toLocalReview` with file drafts.
2. **e2e** `files.spec.ts`: a branch review opens on Files; a `.ts` and a `.md` change listed with
   their lines; the `.md` diff; a comment on one of its lines, in the Review tab, finished: the
   verdict file has `path`, `line`, `code` and no `symbol`; a comment inside a function names it;
   `g`, the switch and a reload; under `symbiote pr` an unchanged line takes no click and the
   posted review's comment; no page errors. The specs that check the graph open `?view=graph`
   (`serveFixture`, `servePullRequest`, the reviews opened from History).
3. `pnpm check`, `pnpm build`, `pnpm test:e2e`; `viewer-check`: Bitwarden `737ee3f` served by
   `symbiote view`, a file shown (fetch, parse, draw) and its lockfile change; both pages at
   1440×900, scale 1, dark and light; the other pages looked over for uneven spaces.
4. No analysis change (core gains a git reader; the graph JSON as it is): no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| The page is lines, against "review decisions, not lines" | The person's ask; the graph one key away; a comment names its symbol whenever a symbol holds the line |
| A huge file freezes the page | Diffs over 5 MB not sent; at most 2,000 rows drawn before Show all |
| About 20 e2e specs open a diff and expect the graph | They open `?view=graph`: their address only |
| Drafts saved before V60 | Each names a symbol: refreshed as today |
| A forge refusing a comment's line | Under `symbiote pr`, only added and removed lines, as the graph's panel |

**Order**: core's reader and the routes; the verdict's optional symbol; the viewer's pure logic;
the page and its switch; e2e; real graphs; docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V60 | A Files page in the review, the default | `fileDiff`, `/api/files`, `/api/file`, the switch, the page, line comments without a symbol, e2e, docs |

**Proposed decisions** (431, 433's lines and the names the person's, by their OK):

| # | Question | Decision | Why |
|---|---|---|---|
| 431 | What a review opens on | **A Files page, then Graph a switch (and `g`) away; `?view=graph` keeps Graph on reload; a graph with no server opens on Graph** | The person's ask; with no server there is no diff to show |
| 432 | Whose diff a file shows | **git's, from the graph's `from` to its head, the whole file as context, folded in the viewer to 3 lines; its lines git's numstat** | What a row counts is what its diff shows (286); jsdiff differed on 1 file of 185; git takes ~10 ms on a 1.6 MB lockfile |
| 433 | Which lines take a comment | **Every line shown on a branch review (an unchanged one on its head side); added and removed lines only under `symbiote pr`** | A forge takes comments inside its own hunks only |
| 434 | The symbol a line's comment names | **The innermost symbol holding the line on its side; none outside every symbol (`symbol` optional in a verdict); such a draft goes to the summary once the head moves** | Keeps a comment about its symbol where there is one; precise beats complete where there is none |
| 435 | The list | **The workspace changes panel's rows, every file of the graph in git's order, tabs Files and Review** | "like in workspaces"; one row for both |
| 436 | Limits | **A diff over 5 MB is not sent; 2,000 rows drawn before Show all** | A page stays responsive on generated files |

**Not in V60 (later)**: the files shown while the analysis runs (the page waits for it, minutes
on Bitwarden); findings on the Files page; a file marked viewed; search in the list; a
side-by-side view; images drawn.
