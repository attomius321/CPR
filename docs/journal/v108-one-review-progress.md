# Journal: V108 — One review progress

[Index](../JOURNAL.md) · [Plan](../plan/v108-one-review-progress.md)

## V108 spike — two progresses (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

On the small fix, all 19 symbols marked reviewed on Graph left 0 of 18 files viewed on Files
([shot](../../spikes/graph-usability/shots/p10-files-none-viewed-dark.png)). Marking the refactor
takes 928 keys. The person's records hold 2 marks in 169 reviews, so this ranks low.

Not started.

## V108 — one review progress (2026-11-11, branch `feature/v108-one-review-progress`)

A file viewed and its symbols reviewed are one review: a file marked viewed at its current blob
reviews its changed symbols on Graph, and a file whose changed symbols are all reviewed reads
viewed on Files. One line on both pages says what is left, with Next; `R` marks the picked
symbol's whole file. Decisions 983–985. Built in `diff/review.ts` (`derivedMarks`, the toggles,
`progressLine`), `useReview.ts`, `change-files.ts`, `ReviewProgress.tsx`, `Sidebar.tsx`,
`FilesPage.tsx` and `useDiffKeys.ts`. `App.tsx` and `Canvas.tsx`, V109's files this round, are
untouched.

**Learned**:
- **Without `App.tsx`, the blobs had to come another way.** A file's mark is valued by its blob,
  which only `./api/files` gives, and `App.tsx` passes the Graph page's sidebar neither the files
  nor the marks. `useReview` now reads the files itself, through the read the Files page's list
  makes (one per graph, `readChangeFiles`), and gives both pages the derived marks; the sidebar
  counts files viewed from `reviewed`, which holds `file:<path>` beside the symbols, as the marks
  do (843). One request per review, as before.
- **Deriving is not enough: the toggles must keep the two meeting.** With reading alone, `r` on a
  symbol reviewed through its file's mark changed nothing (the mark still reviewed it), and `v` on
  a file viewed through its symbols changed nothing either. `r` there drops the file's mark and
  keeps the file's other symbols reviewed with marks of their own; `v` unmarks the symbols that
  alone kept it viewed.
- **"Findings not yet opened" has no record to read.** Nothing says a finding was opened, and a
  record kept for the page's life would differ after a reload. A listed finding counts as left
  while its symbol is not reviewed: on the small fix, 4 of its 6 (2 settled, V100).
- **The Graph list and the Files page can count different changes.** With `--since`, the Graph
  list leaves out what changed the same way as before; Files lists git's files. The line counts
  the whole change on both pages, so the two always agree.
- **Order of risk moves the files.** The e2e test's first draft expected Files' Next to go from
  `src/math.ts` to `src/shapes.ts`; shapes.ts has findings, so it comes first (V102). The test now
  starts from the note, last in any order.
- **A new button can be found by an old test.** `files.spec.ts` asks for the **Viewed** button by
  a name that is not exact: "Next file not viewed" matched it. The buttons are "Next file left" and
  "Next symbol left".

**Verification**: tests first. `test/review-progress.test.ts` runs on a fixture cut from the small
fix's real graph (`symbiote diff 4cbcae0c^1 4cbcae0c^2`: its 19 changed symbols, 18 files with
blobs from `git diff --raw`, 6 findings): its first run failed, the functions missing. Its 30
cases: marks by symbol, by file, mixed and stale, without blobs, each toggle, `R`, the line's
counts on both pages, Next. `e2e/review-progress.spec.ts` (3: mark on Graph and see Files, mark
on Files and see Graph, `R` on a file of 3 symbols, a file changed since) failed on its first
build, 3 of 3: no line on Files, the Graph line's old words; `R` was in that build and failed on
the words alone. `pnpm check`: 3,565 unit tests (one CLI timing test, `events.test.ts`'s stream
re-read, failed once under load and passed alone and in the next full run). `pnpm build`.
`pnpm test:e2e`: the viewer's 470 and the nexus's 32 passed, first run; after the last changes,
the 41 tests of the specs that touch the line, the marks, the targets and the page frame passed
again.

The small fix as the spike opened it, a branch review in a scratch clone served by `main`'s build
(bc24845) and this branch's: after all 19 symbols marked on Graph, Files showed 0 of 18 files
viewed on `main` and 10 of 18 here; Next and `v` on the 8 files left end in "Done: 18 files
viewed, 19 symbols reviewed" on both pages. Marking the refactor (eb807773, 464 symbols in 75 of
its 122 files) takes 243 keys on Files instead of 928. A mark's time in the page, 12 marks, median:
17 ms on both builds, on Bitwarden 737ee3f and on the refactor; their CPU profiles list the same
functions. `measure.mjs`, alternated: Bitwarden's first paint, select and mark 341/118/52 ms on
`main`, 348/109/51 here; the refactor's first paint and mark, 8 rounds on a busy machine,
1,520/91 and 1,438/99. Shots, both themes, before and after:
`docs/images/v108-one-review-progress/`.

Not verified: the app's window (Electron); every shot and timing is headless Chromium. `symbiote
pr`'s pages run the same component and store, but no e2e test marks a file there. A graph opened
from a file (no blobs) is covered by unit tests only. A person reviewing with the line: not yet.
