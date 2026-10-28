# V71 — The analyzing page in Symbiote's style, on the start page's ground

[Index](../PLAN.md) · [Journal](../journal/v71-analyzing-page.md)

**Status:** ready for review (2026-10-27), on branch `feature/review-analyzing-loading`. Its "As
built" and results below.

**Problem** (asked: "The review analyzing loading page is old...adhere to the current style, and
make it prettier.. maybe use the start a workspace background"). A diff's or a review's page,
while its pair is analyzed (`diff/DiffProgress.tsx`, V9, V25), is the one page V61's style never
reached. Screenshotted on `main` (`88cb800`) at 1440×900, dark and light, its states served by a
routed `api/graph`:

| What | Today | The style (V61–V69) |
|---|---|---|
| Layout | one line of text 12 % from the top, 720 px wide, on the bare ground | a head on the ground, cards under it (rule 2); Start: the S lit in the head, the arcs behind |
| Progress | "Analyzing a1b2c3d → e4f5a6b — finding references · 14 s": one phase of six, in words | the merge log's steps (V69): each a row with its state's dot |
| A review | the two SHAs only, though the page knows the branch (`capabilities.branchReview`) | the review page's head: "Review of feature/x" |
| Stop | the violet primary | the primary marks the page's main action; backing out is quiet |
| Back | a link beside the button, off its centre line | Start's head actions: buttons with icons, 36 px |
| Failed | the stack in `--error` red mono, on the ground | the merge page's state chip (a tint, its icon); text in `--text` |
| Its CSS | three rules in `history/HistoryPage.css` | a part beside its component |

**Goal**: the page drawn as Start and Merge are, its ground the start page's arcs over the whole
main area with one turning while the analysis runs; a review named by its branch. **Kept**: the
page's routes, its polling (500 ms), Stop's and Analyze again's requests, `role="status"` with
"Analyzing a1b2c3d → e4f5a6b" for a diff (`commits.spec.ts`), "Back to Git" / "Back to
Workspaces" (`backLink`), the start page's look (its arcs move to a shared part, unchanged), and
"Loading graph…" before the first answer (drawing the S there would flash it before every
analyzed graph).

## Design

- **The ground** (`ui/ground.css`, new, before the pages' parts): the start page's arc recipe —
  a 1 px `--ground-arc` ring with its soft glow inside and out — on a `.ground` layer (absolute,
  under the content, clipped, no pointer events). `StartPage.tsx` draws `ground start-ground`;
  its placements stay in `StartPage.css`. The analyzing page's arcs are centred on its card and
  span the main area ("visible on the full page", the person): an orbit 800 px across that clears
  the card (its half-diagonal is ~340 px), a double ring 1,120 px across with its outline 40 px
  inside (Start's right pair), and Start's top-left ring.
- **The turning ring**: on the orbit, a comet — a conic gradient masked to a 2 px ring, its head
  the arcs' violet at full strength — a turn every few seconds, only its `transform` animated (the
  compositor turns it). Still and hidden when the analysis failed or was stopped; still under
  `prefers-reduced-motion`. It is the ground's, not a state: the state is the running step's dot.
- **The card** (`diff/DiffProgress.tsx`, `diff/DiffProgress.css`, new): centred in the main area,
  560 px at most (16 px gutters narrower), `--panel`, a `--line` hairline, 14 px radius as Start's
  cards. Its head: the S at 48 px lit as Start's, the title (`--size-title`, 600) and its line
  (`--muted`, `--size-small`), and at the right a chip — the elapsed seconds while it runs
  (a quiet chip, tabular figures), Failed (a `--removed` tint with `AlertIcon`) or Stopped (a
  neutral one with `StoppedIcon`), as the merge page's state chip (V69). A hairline under it.
- **The title**: a diff "Analyzing a1b2c3d → e4f5a6b"; a review "Reviewing **feature/x**" and its
  line "into main · first review · a1b2c3d → e4f5a6b" (the review page's words, `ReviewOf`).
  `useDiffGraph` keeps `capabilities.branchReview` on the analyzing state.
- **The steps** while it runs: the pipeline's six phases (`AnalysisPhase`, in its order) as rows,
  the merge log's recipe (V69): Check out both sides, Load the base, Load the head, Extract
  symbols, Find references, Look for findings. Each starts with the sidenav's state dot: done the
  green dot, running the cyan comet (working's, V53), to come an empty ring; the running one's
  name in `--text` at 500, the others regular. Queued: a row "Waiting for 2 other analyses" with
  the comet above the six, all to come. A phase not reported yet (`null`): the first step runs.
  A pure `analysisSteps(phase, queued)` in `diff/analysis-steps.ts` decides the marks.
- **Failed**: under the head, the error in a well (`--input-bg`, a hairline, 8 px radius, mono,
  `--text`, 40 % of the window at most, scrolled). **Stopped**: "Its analysis was stopped." in
  `--muted`.
- **The buttons** (the person: "make the buttons prettier consistent with the design"): at the
  card's foot, right-aligned, as Start's head actions — 36 px, 16 px padding, a 14 px icon. While
  it runs: back (`BackIcon` and the page's name, `button ghost`) and Stop (`StoppedIcon`,
  `button secondary`). Failed or stopped: back and Analyze again (`ResetIcon`, the primary).
  `BackLink` takes a class, so the bar's link stays as it is.
- **The live region**: `role="status"` on the head's words and an off-screen line with the
  running step, so a reader hears the phase change; the seconds outside it (today they were read
  out every second).

## Verification

1. **Tests first**, red before the change:
   - `test/analysis-steps.test.ts`: queued, `null`, each phase, an unknown phase.
   - `e2e/analyzing.spec.ts`, its states served by a routed `api/graph` on `serveCommits`: a diff
     running (the title, five marks before the running step, `aria-current="step"` on Find
     references, the seconds chip, Stop and Back to Git as buttons, the orbit's comet turning);
     queued; a review (`capabilities.branchReview`: "Reviewing feature/x", "into main"); failed
     (the Failed chip, the error in `--text`, Analyze again primary); stopped; reduced motion
     (the comet still).
   - `commits.spec.ts` as it is: "Analyzing a → b" in the status, Stop goes back to Git.
2. `pnpm check` (tokens: radii, sizes, the accent's roles), `pnpm build`, `pnpm test:e2e`.
3. **Screenshots** from a script outside the repository: every state at 1440×900, 1920×1080,
   900×800 (the sidenav a drawer) and 390×844, dark and light; Start before and after (the same
   pixels); a diff's ready page (the bar unchanged). Letter-spacing 0 on the page; at 1× for
   uneven gaps.
4. No graph, layout or analysis change: no Bitwarden timings, no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| The arcs read as noise in light | `--ground-arc` is already fainter there (V63); screenshots in both themes |
| A turning layer costs frames on a slow machine | only `transform` animates; one element; still under reduced motion |
| Moving Start's arcs changes Start | its placements stay; screenshots compared before and after |
| A long branch name widens the card | the title wraps (`overflow-wrap: anywhere`); never a smaller size |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V71 | The analyzing page in the style | the shared ground, the card, the steps, the buttons, a review's name |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 502 | The analyzing page's ground | **The start page's arcs, one recipe in `ui/ground.css`; here centred on the card, over the whole main area** | the person's "use the start a workspace background", "visible on the full page" |
| 503 | What moves while it runs | **A comet turning on the arcs' orbit; still when it ended or under reduced motion** | the person's yes to a turning ring; compositor-only |
| 504 | How progress shows | **The six phases as the merge log's rows, the sidenav's state dots: done green, running cyan, to come an empty ring** | one phase in words hid how far it was; states keep their colours, the accent its roles |
| 505 | The buttons | **Start's head actions: 36 px with icons; Stop secondary, back ghost, Analyze again the primary** | the person's "buttons prettier consistent with the design"; stopping is not the page's main action |
| 506 | A review being analyzed | **"Reviewing ‹branch›", "into ‹into› · ‹pair›" under it** | the person's pick; the page already knows the branch |

**Not in V71 (later)**: each step's own time (the page polls every 500 ms; short phases are never
seen); "Loading graph…" before the first answer.

## As built (V71)

- **The arcs** (decision 502): the plan kept Start's top-left ring on this page beside the centred
  ones; screenshotted at 1440×900 it crossed the 1,120 px pair at the top left, lines over lines.
  The page has three centred rings instead, none crossing another: the 800 px orbit lit inside as
  Start's top-left ring is (its radial fill), Start's right pair at 1,120 px, and a 1,560 px ring
  at 60 % that only a wide window shows (1920×1080: its sides). The layer is `.ground` with
  `.ground-ring` inside it; Start's element is `ground start-ground`, its placements as they were.
- **The comet** (decision 503): a turn in 7 s; its head's light 12 px at 45 % of the primary (22 px
  at 55 % read as a blot at 1440×900). Two pseudo-elements of the orbit, the tail masked to its
  2 px; only `transform` animates.
- **Stop's icon**: lucide's circle-stop (`StopIcon`, new), not `StoppedIcon`, the sidenav's
  Stopped group's pause circle, which the Stopped chip keeps.
- **`reviewSince`**: the review page's words ("first review", "2 commits since your last review")
  moved from `ReviewOf` into `DiffProgress.tsx`, used by both.
- **The time chip** has no icon: the seconds alone, tabular figures. Failed and Stopped have theirs.

**Results.** Tests first, red for the right reasons (`analysis-steps.test.ts`: no module;
`analyzing.spec.ts` 6 of 6: no `.analysis-card`), then green. `pnpm check`: 2,013 of 2,013;
`pnpm build`; `pnpm test:e2e`: 329 of 329. A real analysis of this repository's `88cb800~40..88cb800` on
`symbiote view`: the page marked each phase in order — checkout 0.3 s, base 0.6, head 2.7,
symbols 4.1, references 5.1, findings 13.7 — and opened the graph at 14.4 s, no page errors. Screenshots of the six states (and a review's
two) at 1440×900, 1440×1080, 1920×1080, 900×800 and 390×844, dark and light; letter-spacing 0 on
the page's 31 elements (21 when failed); both buttons 36 px on one centre line (the old link sat
off the button's). Start's main area at 1440×900 against `main`'s: identical but for `main`'s
SHA in its Source note (`main` moved to `a2a9151`) and the status bar's live usage numbers.

Not verified: the desktop app's window (its title bar is over the page, nothing in it changed);
Firefox and Safari (`mask`, `conic-gradient` and `@container` are in both); a queued analysis and
a review in a real run (routed in the tests and the screenshots); the frame rate with the comet
turning on a slow machine (one composited element; not measured).
