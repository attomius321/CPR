# Journal: V79 — Workspace cards one can read

[Index](../JOURNAL.md) · [Plan](../plan/v79-workspace-cards.md)

## V79 spike — the sidenav's cards measured, three layouts tried (2026-10-29, branch `feature/workspaces-card-revamp`)

The person's running Symbiote (`main` at `b3e8c03`) in headless Chromium at 1440 × 900, 1×, its
`/api/workspaces`, `/api/reviews`, `/api/merges` and merge checks answered by Playwright's
`page.route` with a mock list: nine workspaces, one in each state (plan ready, a question, ready
for review with a conflict, changes requested, stopped, failed, two working — Claude Code and
Codex —, merged) with the person's real titles and branches, and a merge at work. Three layouts
were injected as CSS (`addStyleTag`) and a few cloned nodes, nothing in the repository changed:
A (the same three rows with air), B (four rows, the kind on the branch's row), C (the name and its
time; the state; the kind and the facts as icons; the branch only when it says more). The
screenshots went to the person on a page with the plan.

**Learned**:
- **What was cut**: 5 of 9 names, 6 of 9 state lines and 4 of 9 branches (measured by
  `scrollWidth` against `clientWidth`). A feature's chip is 57 px of the name's 229 px row; the
  facts came after the agent's action on one line and never showed on a working card.
- **The branch repeats the name**: in 95 of the person's 103 workspace records the branch is what
  `proposeBranch` makes of the kind and the title (Python over `symbiote/workspaces/**/*.json`,
  read only). The 8 others: a numbered `-2`, branches typed at the start, a workspace started from
  an existing branch, four records from before titles. The person kept the branch on every card.
- **B cut the branch further**: the kind chip on the branch's row left it 150 px. C's meta row
  with the time on it overflowed the card at 264 px with "1 conflict" (25m ran past the edge):
  the time moved to the name's row, and the meta row wraps when its facts do not fit.
- **Measure content, not the list**: the list is `flex: 1`, so its `scrollHeight` includes the
  empty space under the cards in a tall window; the cards' heights summed are the measure (807 px
  today, 1,204 px for C at 264, 1,074 at 300).
- **A `symbiote view` serves the `dist/` it started with**: a rebuild needs a restart to be seen
  (the viewer's CLAUDE.md says so; met again measuring the headings). A server started with
  `cd <scratch> && … &` from a script that `cd`s back first runs in the worktree: start it from a
  script that `cd`s itself (it ran a second there and wrote nothing; `symbiote/config.json` is
  tracked and was unchanged).

## V79 — workspace cards in four rows, names whole, facts as icons; the sidenav 300 px (2026-10-29, branch `feature/workspaces-card-revamp`)

The person's answers to the plan's three choices: the branch on every card, a wash behind each,
300 px at first. Tests first (`4d98d51`, red: 9 of 11 e2e and the unit tests), then the cards
(`2439850`), then what the full e2e run found (`46ff79b`). Decisions 576–581 and 585 (582 in
`46ff79b`, until `main` gave 582–584 to MC2).

**Learned**:
- **A line height set on a child wins its row**: the branch's link had `font: …/18px`, so its row
  was 18 px in a 20 px rhythm and the card 2 px short of the plan's 140. The rows' heights logged
  from inside the e2e test (a `console.log` of each child's top and height) found it at once.
- **A 1 px transparent border** on every card (left from before V37's flat cards) made each card
  2 px taller than its rows: gone.
- **`-webkit-line-clamp` needs a block**: the name is a button and the state a `<p>` in flex rows;
  each is `display: -webkit-box` with `overflow: hidden`, and the dot moves to the first line with
  `align-items: flex-start` and a 7.5 px top margin ((22 − 7) / 2). A one-line ellipsis passes a
  `scrollHeight` check: test `scrollWidth` too.
- **36 px of sidenav reach every page**: the full run failed 7 of 340, none in the cards. The Start
  page's run column lost 13 px and one card's line wrapped (12 px past 1440 × 1000); the terminal 4
  to 5 columns; Git's HEAD row its last 23 px of subject. Run the whole suite after a width change,
  not the specs one changed.
- **The wash in the rail** made a column of grey lozenges behind the dots: the rail keeps the dots
  alone. A selector `:not(:hover, .picked)` keeps the hover's and the open card's.
- **The facts' words in one place**: `workspaceFacts` gives the head its sentence and the card its
  numbers; the e2e test reads the card's facts by their accessible names (`getByRole('img', { name:
  '1 commit' })`), which also checks what a screen reader says.

**Verified**: `pnpm check` (2,248 unit tests, 2 new); `pnpm build`; `pnpm test:e2e` (the
viewer's 340 and the nexus's 15 pass, after a first run of 7 failures, all from the 300 px width);
screenshots of every page with the sidenav (Git, Skills, Monitor, Settings, Start), the folded
rail and the 390 px drawer, dark and light, on the mock list served by Playwright routes over the
branch's own `symbiote view` in a scratch repository; groups' headings measured over the cards'
dots and names. Timings against `main`'s build, alternated: Git's first paint 213 → 211 ms (median of 7);
Bitwarden `737ee3f` first paint 309 → 316 ms, select 106 → 105 ms, pan 63 fps both (8 rounds).
Mark reviewed is 50 or 67 ms on either build, a frame's rounding. Not verified: the person's own
workspaces on the branch's build (their running Symbiote serves `main`'s), the desktop window
(the cards are the page's; `title-bar.spec.ts` passes), a real screen reader on the facts.

`main` merged in (V77's History link, V78, MC2; only the plan index and the journal's list
conflicted, rows appended at one place, both kept): `pnpm check` 2,271 unit tests, `pnpm test:e2e`
342 and the nexus's 15 pass on the merged tree.
