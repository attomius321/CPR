# V72 — One page frame: every page the whole main area, one spacing everywhere

[Index](../PLAN.md) · [Journal](../journal/v72-page-frame.md)

**Status:** merged into `main` on 2026-10-28 (built 2026-10-28), on branch `feature/layout-fixing` (a Symbiote
workspace, from `main` at `88cb800`). The person OK'd the plan ("Ok") with the three recommended
choices: 16 px from the edges and 16 between cards; the workspace's, merge's and review's heads
in two lines, as every page's; long text fills its card. Its "As built" and results are below.

**Problem** (asked: "Pages differ in margin and spacing between elements. Also, i don't like the
fact that some pages are not on full page, and in the middle...like start a workspace. Please check
each page and adhere to some standards for the layout spacing of elements."). Measured on `main`
(`88cb800`) with the e2e suite's fake workspaces, device scale 1, the main area 1,176 × 876 at
1440 × 900 and 1,656 × 1,056 at 1920 × 1080:

| Page | Cards from the edges (left / right / bottom) | Between cards | Title at x | Cards from y | Wide windows |
|---|---|---|---|---|---|
| Git | 8 / 8 / 8 | 8 | 60 | 71 | the whole area |
| A workspace | 8 / 8 / 8 | 8 | 31 | 52 | the whole area |
| A review's Files | 8 / 8 / 8 | 8 | its bar | 52 | the whole area |
| A review's Graph | 8 / 8 / 31 (the legend under the card) | 8 | its bar | 84 at 1440 (the bar wraps), 52 at 1920 | the whole area |
| Scout | 8 / 8 / 8 | – | 16 | 80 at 1440 (the head wraps), 52 at 1920 | the whole area |
| Monitor | the map ~23, the side card 8 | ~23 | 16 | 170 | the whole area |
| A merge | 16 (the log) | the steps on the ground | – | 116 | the whole area |
| Start a workspace | 16 / 16 / 57 | 16 (the run's cards 8) | 80 | 84; 156 at 1920 (72 px lower on a tall window) | 1,312 px at most, centred: 172 px of ground each side at 1920 |
| Settings | 24 / 24 / 24 | 16 | 68 | 87 | 1,400 px at most, centred: 128 px each side at 1920 |
| Skills | 24 / 24 / 24 | 16 | 68 | 87 | the whole area |

Inside the cards: the words 12, 16, 20 or 24 px in; a card's head 40 px (a workspace's tabs), 48
(Git's details) or 64 (Settings' page); a label 9 px over its field on Start, 5 on Skills, 13 on
Scout's question, and 21 or 13 px from one field to the next label; Scout's model select 28 px
high, every other 32.

**Goal**: one page frame on every page of the shell and a review: the whole main area, the same
margins and gutters, one head, cards that start and end at the same places, the same insets and
rhythm inside them. **Unchanged**: the sidenav, the status bar, the app's title bar, the graph's
nodes and layout, colours, type sizes (nothing smaller), what each page does.

## The standard

Layout tokens on `:root` in `ui/base.css` (not colours: one value for both themes):

| Token | Value | What |
|---|---|---|
| `--page-pad` | 16 px | the main area's left, right and bottom edges to the cards and the head's contents |
| `--page-gap` | 16 px | between two cards; a `Resizer` lies in it |
| `--card-pad` | 16 px | inside a card: its head's and body's contents |
| `--card-head` | 48 px | a card's head (tabs, or a title and actions), a hairline under it |
| `--field-label-gap` | 8 px | a label to its field |
| `--field-gap` | 20 px | a field to the next label |

1. **Every page fills the main area**: no `max-width` and no centring of a page, no space added
   above on a tall window.
2. **The page head** (`ui/PageHead.tsx`, `ui/page.css`): the page's icon (28 px, the accent), the
   title (`--size-title`, 600) and its "?", a muted line under it, the actions at the right; 16 px
   above and under it. The title at x 60 and the cards from y 76 on every page. Actions that do
   not fit go under the title (a narrow main area) or into the card they act on.
3. **Cards** 16 px from the area's edges and 16 apart; their contents 16 px in; a card's head 48 px.
4. **Forms**: a label 8 px over its field, 20 px from a field to the next label, controls 32 px.
5. **A page's views never move its cards**: Files and Graph, a workspace's tabs.

## Page by page

- **Start a workspace** (decisions 507, 508): the two columns fill the area (821 : 470, the run at
  least 380; one column under 1,000 px), the cards right under the head on any window; the S the
  head's two lines high (44 px; 48 before); the arcs placed for the whole width; the kinds' tabs
  the brief card's head; its contents 16 px in (24 before).
- **Settings** (509): the whole area at any width; 16 / 16; the open page 16 px in.
- **Skills** (509): 16 / 16.
- **Git**: 16 / 16; the head the standard's.
- **Scout** (510): the standard head (its compass, the title, "In <repo>, with Claude Code" its
  line, the state at the right); the model, Effort and New conversation the terminal card's head;
  the select 32 px. Its question (no terminal) a card.
- **Monitor**: the standard head (its icon, the title, the commit its line), the kinds and Colour
  its actions; the map a card as the side one, its head ← All files, the place and the legend.
- **A workspace** (511): the standard head in two lines — the kind and title, then the branch and
  its state; 16 / 16; the tabs the card's head (48); the changes 16 px in.
- **A merge** (511): the standard head — its branches' chips the title, the state and the
  commit's title its line, Land and ⋯ at the right — on the ground, no band; the steps a card
  beside the log.
- **A review** (511, 512): the bar in two lines — Review of … and the Files / Graph switch, then
  the rest; 16 / 16; the graph's Context and Type references in the canvas card's head, its legend
  at the card's foot: Files and Graph start and end at the same places.
- **Dialogs**: 16 px in, the form rhythm.

## Verification

1. **e2e first** (red on `main` for each page): `e2e/page-frame.spec.ts` — every shell page and a
   review's two views at 1440 × 900 and 1920 × 1080: cards 16 px (±1) from the main area's edges and
   from each other, the area used edge to edge, the title at one x and the cards from one y on every
   page, Files and Graph's cards at the same place, card heads 48 with their contents 16 px in, the
   form rhythm on Start, Skills, Settings, Scout's question and a dialog. The tests that pin the old
   frame are rewritten to the standard (Start's two centring tests, Settings' 1,400 px, Skills' 24 px,
   the Monitor's head) and the journal names them.
2. `pnpm check`, `pnpm build`, `pnpm test:e2e` (without `WAYLAND_DISPLAY`); `title-bar.spec.ts`:
   the app's bar still moves nothing.
3. Screenshots before and after, every page and state (Git with a commit, a file, its dialogs; a
   workspace's tabs working, ready and approved; a merge; Scout with a terminal and its question;
   Settings' entries; a review's Files, Graph and Review tab) at 1440 × 900 and 1920 × 1080, Start
   and Settings at 2560 × 1440, both themes, scale 1, text zoomed 3× for letter gaps; the measures
   before and after in the journal.
4. Narrow: 1,024 px, the drawer under 900, each page's 480 px rules.
5. `viewer-check`: first paint of `/git` and Bitwarden's graph against `main` (the canvas card
   changes size); not verified if the graph is not at hand.

## Risks

| Risk | Answer |
|---|---|
| Gutters move every threshold set in a page's width (V61): the changes panel from 1,100 px, Skills' checks beside from 960, Git's `git-body` at 1,040 | measure each at 1440 and 1280; move a threshold only with its reason |
| A workspace's terminal loses ~2 rows and 2–3 columns at 1440 × 900 (896 × 816 → 872 × ~770) | the person's choice (question 2); measured after |
| Git's rows 492 px at 1440 (516) | measured after; the branches panel folds as before |
| Long lines fill wide cards (a prompt ~150 characters at 1920, ~240 at 2560) | the person's choice (question 3) |
| Old e2e tests pin the old frame | rewritten to the standard, named in the journal |

## Milestones

| ID | What | Where |
|---|---|---|
| V72a | The tokens, `PageHead`, the failing e2e | `ui/base.css`, `ui/page.css`, `ui/PageHead.tsx`, `e2e/page-frame.spec.ts` |
| V72b | Start and Settings: the whole area | `workspaces/StartPage.*`, `settings/SettingsPage.*` |
| V72c | Git, Skills, Scout, the Monitor | `history/`, `skills/`, `scout/`, `monitor/` |
| V72d | A workspace, a merge, a review | `workspaces/Workspace.*`, `Merge*`, `diff/` |
| V72e | Cards' insides, forms, dialogs | the parts' CSS, `ui/controls.css` |

## Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 507 | Where a page stands | **The whole main area, at every width; no centring, nothing added above on a tall window** (replaces 378, 446's centring, 454's 1,312 px) | the person: "i don't like … some pages are not on full page, and in the middle" |
| 508 | The spacing | **16 px from the edges, 16 between cards, 16 in, card heads 48; a label 8 over its field, 20 to the next** (replaces V61's 8 px gutters and 458's 24 / 16) | the person's choice of three (16 / 16, Settings' 24 / 16, Git's 8 / 8); one number from the edge to the words |
| 509 | The page head | **One `PageHead`: icon, title, its line, actions; the title at x 60, the cards from y 76 on every page** | the mockups' head (V62–V64) on every page |
| 510 | Scout's model and effort | **The terminal card's head**, not the page's | the page head wrapped at 1440 (80 px); they act on the conversation in the card |
| 511 | A workspace's, a merge's and a review's head | **Two lines, as every page's** | the person's choice: one line kept the titles and cards out of line, for ~1 row of terminal |
| 512 | Long text on a wide window | **It fills its card** | the person's choice; a cap would leave ground beside it |

## As built (V72)

- **One head component.** `ui/PageHead.tsx` draws every page's head, and `ui/page.css` holds its
  rules and a card's head (`.card-head`). Each page passes its own class (`git-bar`,
  `settings-bar`, `workspace-top`, `merge-row-head`, `bar` for a review), so its own rules and its
  tests still find it. The icon sits in a 32 px square, so the S (32 px) and the 28 px icons put
  the title at the same x. The plan said the S would be 44 px: at that size Start's title stood
  16 px right of every other page's.
- **A resizer between two cards is the gap.** `Resizer` takes `gutter`: it is `--page-gap` wide,
  with its line in the middle, and the cards' container has no gap beside it. Before, a handle
  straddled the edge with `margin: -4px`, so a 16 px flex gap around it would have made 32 px.
- **Scout's choices (decision 510).** The model, the effort and (with two agents) the agent
  form the terminal card's head. The page's head keeps what Scout reads, its state and New
  conversation. Scribe's pane keeps its own `.scout-top` strip, now 48 px and 16 px in.
- **The Monitor.** The commit is the head's line, and the kinds and Colour are its actions. The
  map became a card like the list beside it: its head holds Back, the place and the legend, and
  the sentence sits under that head, in line with the folder's name.
- **A workspace.** Its head's icon is its kind's (the start page's tabs' icons), in the accent:
  the accent's role "the open workspace's kind". The state's dot moved to the line, before what
  is next.
- **A merge.** The branch and target chips are the title, and the state's chip sits beside them.
  The state's sentence and the merge commit's title share the line, which cuts them at the
  window's width; its tip has both whole. The steps became a card beside the log.
- **A review.** "Review of <branch>" (or the pull request, or the revisions) is the title. The
  line holds the rest: how the branch stands against the last review, the workspace, the commits
  compared and the counts. The graph's toggles stay in the head's actions: once the head had two
  lines they fit at 1,440 px, and a card head in the canvas would have cost it 48 px. The legend
  moved into the canvas card's foot. Without a shell (`symbiote pr`) the S is the head's icon,
  as the window's title bar. The window title is unchanged (`diffName` gives the head and
  `diffTitle` the same words).
- **Line tabs (`.tabs`, a workspace's tabs, Start's kinds) are a 48 px card head** with the first
  tab's words 16 px in. Before, their strips were 40 or 41 px and the words 21 to 23 px in.
- **Terminals and dialogs** follow the card's inset: the words 16 px in (terminals 12 before,
  dialogs 24). A dialog's fields follow the form's rhythm.
- **Start's right-hand rings are gone.** They stood in the ground beside the centred cards; the
  cards now reach the area's edge, where a ring would show through their gaps. The ring around
  the head's S stays.
- **Start's run no longer fits 1,440 × 900.** Its seven cards, 16 px apart and 16 px in, make the
  run 875 px high, 90 px more than that window's main area has under the head. With More closed
  it fits from a 1,000 px window. At 1,920 × 1,080 (the person's app is maximized) it fits.
- **Not built**: a check that every page's CSS uses the tokens. The e2e spec measures the result
  on every page instead.

**Results.** Measured as the spike was, with the e2e harness's fake workspaces (terminals on),
device scale 1, the main area 1,176 × 876 at 1440 × 900 and 1,656 × 1,056 at 1920 × 1080. Each
cell is the cards' distance from the area's left / right / bottom edges, the gap between cards,
the title's x and the cards' top y.

| Page | Before, 1440 | After, 1440 | Before, 1920 | After, 1920 |
|---|---|---|---|---|
| Git | 8/8/8, 8 and 16, x 60, y 71 | 16/16/16, 16, x 60, y 76 | as at 1440 | as at 1440 |
| Start a workspace | 16/16/21, 16, x 80, y 84 | 16/16, 16, x 60, y 76 (the body scrolls 91 px) | 172/172, 16, x 236, y 156 | 16/16, 16, x 60, y 76 |
| Scout | 8/8/8, x 16, y 80 | 16/16/16, x 60, y 76 | 8/8/8, x 16, y 52 | 16/16/16, x 60, y 76 |
| Skills | 24/24/24, 16, x 68, y 87 | 16/16/16, 16, x 60, y 76 | as at 1440 | as at 1440 |
| Monitor | the map not a card, the list 8 from the right, x 16, y 170 | 16/16/16, 16, x 60, y 76 | as at 1440 | as at 1440 |
| Settings | 24/24/24, 16, x 68, y 87 | 16/16/16, 16, x 60, y 76 | 128/128/24, 16, x 172, y 87 | 16/16/16, 16, x 60, y 76 |
| A workspace | 8/8/8, 8, x 31, y 52 | 16/16/16, 16, x 60, y 76 | as at 1440 | as at 1440 |
| A review: Files | 8/8/8, 8, its bar, y 52 | 16/16/16, 16, x 60, y 76 | as at 1440 | as at 1440 |
| A review: Graph | 8/8/31, 8, its bar, y 84 | 16/16/16, 16, x 60, y 76 | 8/8/31, 8, y 52 | 16/16/16, 16, x 60, y 76 |
| A merge | the steps on the ground, the log 16/16, y 116 | 16/16/16, 16, x 60, y 76 | as at 1440 | as at 1440 |

Inside the cards, after: every card head is 48 px with its first word or control 16 px in; a
label stands 8 px over its field and 20 px after the field before it (Start, a new skill,
Scout's question, the new-branch dialog). `e2e/page-frame.spec.ts` checks all of this, 3 tests,
red first on each part.

What it cost at 1440 × 900, as planned: Git's rows card 492 px wide (516); a workspace's
terminal 124 × 38 cells without the changes panel (127 × 40) and 93 × 38 beside it (97 columns);
the review's file 1,044 px wide (1,068); the graph's canvas 1,042 px wide with the sidenav as a
rail (1,068). Settings and Skills gained 8 px each side. Start's run needs a 1,000 px window to
fit with More closed (900 before).

Verification: `pnpm check` (2,008 unit tests; 2,013 after merging `main`'s V71); the full e2e
suite, 326 passed, without `WAYLAND_DISPLAY`; after merging V71, 331 passed and 1 failed, a test
still reading a plain diff's commits under the title (fixed: 5 of 5); screenshots of every page and state in both themes at 1440 × 900 and
1920 × 1080, Start and Settings at 2560 × 1440, and the pages at 1,024, 800 and 480 px wide.
