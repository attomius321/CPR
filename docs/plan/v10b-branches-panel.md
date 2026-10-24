# V10b — Branches panel: every branch a click away

[Index](../PLAN.md) · [Journal](../journal/v10b-branches-panel.md)

**Status:** merged into main (2026-10-14, from branch `milestone/v10b-branches-panel`). As built
and results: "As built — V10b" below. Planned with V10 ("Branches panel" there, decision 53); refined here on today's page (V11–V17
since) and measurements.

**Problem** (asked with V10: "exactly like git extension, or gitty up … with the branch trees on
the left"; "graph + branches panel"; now "start with v10[b]"). The commits page lists every
branch's commits, but a branch can only be found by scrolling and reading badges: there is no
list of branches and no search. Branch tips sit deep in graph order. Measured on this repository
and the regression clones (every branch listed, `listRefs` as the row menu calls it):

| Repo | Local / remote branches | Remote: not in a folder / folders (deepest nesting) | Tip rows: median / p90 / deepest | Tips in the first 25 rows / 200 | Name length: median / p90 / max | `listRefs` |
|---|---|---|---|---|---|---|
| Symbiote | 14 / 62 | 1 / 5 (1) | 155 / 230 / 242 | 7 / 43 | 25 / 30 / 38 | 4–6 ms |
| zod | 1 / 154 | 103 / 13 (1) | 978 / 3,338 / 4,058 | 8 / 16 | 18 / 40 / 58 | 6–13 ms |
| vite | 1 / 88 | 42 / 14 (1) | 691 / 4,896 / 9,260 | 10 / 24 | 23 / 58 / 83 | 9–11 ms |
| Qwik | 1 / 133 | 74 / 10 (2) | 3,695 / 7,443 / 8,889 | 3 / 4 | 23 / 39 / 55 | 6–7 ms |
| Bitwarden | 1 / 1,591 | 519 / 105 (3) | 9,165 / 21,794 / 37,633 | 9 / 74 | 29 / 53 / 133 | 22–23 ms |
| CPython | 1 / 6 | 6 / 0 | 16,397 / 33,308 / 33,308 | 1 / 1 | 4 / 4 / 4 | 8–16 ms |

- Most tips are out of reach by scrolling: Bitwarden's median tip is 9,165 rows (293,000 px)
  down, Qwik's 3,695; only 4–74 tips per repository are in the first 200 rows.
- Since V11 and V15 a branch's row is where it is checked out and reviewed (c, r): reviewing an
  agent's branch starts with finding its row.
- Folders do not make a short list on their own: Bitwarden has 519 remote branches outside any
  folder, beside 105 folders. The filter is what finds a branch there.
- Names run long: a 260 px panel holds about 35 characters; half of Bitwarden's names are 29 or
  more, the longest 133.

**Goal**: a panel left of the graph lists the branches — local ones with how far each is from its
upstream, remote ones by remote and folder — with a filter on top. A click puts the cursor on
the branch's tip row, wherever it is in the history, and flashes it; from there c and r check it
out or review it as today. Reviewed branches show their mark as their badges do. Tags stay
badges on rows (decision 48). The rows, the graph, compare mode, the row menu, `symbiote view
<base> [head]`, `symbiote diff` and `symbiote pr` do not change.

## Tips' rows (core, server)

- `GET /api/history/refs?scope=…&version=…` → `{ version, branches, remotes }`: `listRefs`'s
  local and remote branches, each with `row`, its tip's row in that listing (null when the scope
  does not list it). It waits until the listing is done (tips sit deep); a stale version answers
  409, as rows and shape do. `/api/refs` (the row menu's) is unchanged.
- Server: `Histories.tips(scope, version, shas)` maps SHAs to rows from the kept order (one map
  per listing, made once).
- Core type `HistoryRefs` beside `HistoryShape`.

## The panel (viewer)

- A pure `branchTree(refs, filter)` in `src/branches.ts`:
  - **Local**: the current branch first, then by name; each with `↑2 ↓1` against its upstream
    (title: "2 commits not pushed to origin/main, 1 not pulled") or `gone` when the upstream was
    deleted.
  - **Remotes**: per remote, then folders by `/` (nested: Bitwarden has 3 levels), each with its
    count; a branch shows its last part (`milestone/v10b-…` under `milestone/` reads `v10b-…`).
    Folders start closed; remotes open. By name, folders first.
  - **Filter**: case-insensitive, on the whole name; folders with matches open, others hidden;
    counts become matches. Nothing matching: "No branch matches".
- `src/BranchesPanel.tsx`: about 260 px, its own scroll, left of the rows, the whole height
  beside the list; names cut with an ellipsis, the full name as title; a reviewed branch's mark
  (V15/V16's `reviewMarks`) after its name. Under 900 px it is hidden behind a "Branches" button
  in the title and opens over the rows; a click on a branch closes it.
- A click on a branch: the cursor on its tip row, scrolled to the middle (its details load as for
  any rows in view), the row flashes (1 s). Under "This branch", a tip not listed switches to
  every branch first, then goes there. A tip in no listing (a remote branch whose history the
  clone lacks): the entry is greyed, with a title saying so.
- `/` focuses the filter; Escape there clears it, then leaves it.

## Verification

1. **Unit** (red first): `branchTree` — the current branch first; ahead/behind and `gone`;
   folders nested by `/`, counts, closed at first; the filter (case, whole name, folders opened,
   counts, nothing matching). `Histories.tips` — rows, null for a tip not listed, waits for the
   listing, stale version. The server's `/api/history/refs` (shape of the answer, 409, defaults).
2. **E2E** (a new `serveBranches` fixture: 300 commits on `main` written with `fast-import`,
   `origin/feature/deep` forked near the bottom, `origin/fix/one` and `origin/fix/two`, a
   top-level `origin/topic`, local `wip` ahead 2 and behind 1 of `origin/wip`, local `old` whose
   upstream is gone): the panel's sections, counts and marks; a folder opened; the filter; a
   click on the deep tip puts the cursor there and it is in view; "This branch" then a remote
   branch: every branch, and the tip; `/` and Escape; under 900 px the button and the overlay;
   no sideways scroll; every existing spec passes.
3. **Real repositories** (`viewer-check`): on Bitwarden — the panel drawn with 1,591 remote
   branches (time to draw, page elements), a filter keystroke, a click to the deepest tip
   (row 37,633): the row drawn with its details, no task over 100 ms; first rows against
   `main`'s build (the panel loads after them). Screenshots of this repository (14 local, 62
   remote), light and dark, and at 900 px.
4. **Cost**: `/api/history/refs` under 150 ms on Bitwarden once listed; first rows unchanged.
5. **Nothing else changes**: no analysis code; goldens identical; `/api/refs` unchanged.

**Risks**

| Risk | Mitigation |
|---|---|
| 1,591 remote branches, 519 outside folders | Folders closed; the filter; measure drawing every entry before virtualizing anything. |
| The panel narrows the rows (260 px of 1,440) | Subjects are cut already; under 900 px the panel is a button; author and date stay in view (checked). |
| Refs move while the page is open (a fetch) | The answer carries the history's version; 409 → the page lists anew (V10a's path). |
| A tip no listing holds (a shallow clone; a remote branch never fetched) | Its entry is greyed with a title; nothing to go to. |
| Long names | Ellipsis, the full name as title; the filter matches the whole name. |

**Order**: the endpoint and `branchTree` with their tests; the panel and the click; the narrow
layout; the e2e fixture; real repositories.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V10b | Branches panel | `/api/history/refs` with tips' rows; `branchTree`; the panel (Local, Remotes by folder, filter, marks); a click to the tip; "This branch" switching; `/`; the narrow overlay. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 91 | Where tips' rows come from | **`GET /api/history/refs?scope&version`: `listRefs` with each tip's row in that listing; 409 when stale** | Rows belong to one listing; the page has the SHAs of loaded rows only, and tips sit deep (Bitwarden's median row 9,165). `/api/refs` stays the row menu's, unversioned. |
| 92 | What the panel lists, and how (refines 53) | **Local (current first, ↑/↓, gone); Remotes by remote and nested folders, closed at first; a filter on the whole name; review marks** | Asked: "the tree should be branches only". 519 of Bitwarden's 1,591 remote branches are in no folder, so the filter, not the folders, makes it short. |
| 93 | What a click does | **The cursor on the tip row, in the middle, flashed; "This branch" switches to every branch when needed; no action from the panel** | Checking out and reviewing already live on the row (c, r): one place for them. |
| 94 | Narrow windows | **Under 900 px, a "Branches" button opens the panel over the rows** | The rows need the width; V10 planned the same. |

**Not in V10b (later)**: actions from the panel (check out, review, delete, fetch); hiding
branches from the graph (checkboxes); sorting by date; tags in the panel; the panel on a diff's
page.

## As built — V10b

- **Escape leaves the filter and keeps it**, not "clears it, then leaves it" as planned: the
  viewer already has that rule for every text field (`App.tsx`), and the change list's search
  follows it. The filter is a text field like that search: a search field clears itself on
  Escape in Chromium, so the two would have behaved differently.
- **Enter in the filter goes to the first branch listed.** The e2e test first tabbed from the
  filter to the branch and landed on its remote's folder: type a few letters, then Enter.
- **The filter and the folders opened are kept by the page**, across a scope switch or a listing
  anew (a checkout); the panel draws them.
- **The panel lists branches once the shape is in**: before it, the list is as tall as the first
  rows, and a deep tip cannot be scrolled to.
- **Badges shrink.** With the panel taking 260 px, rows with two long branch badges pushed their
  author and date past the list's edge: on this repository 3 of 35 rows at 1,100 px and 8 at
  900 px (`main`: none; it clipped 3 at 800 px, by the same cause). Badges now shrink with an
  ellipsis once the subject has no room left, named in full on hover; the author can shrink, the
  date cannot. Clipped rows, measured from 800 to 1,920 px on this repository, Bitwarden and
  Qwik: 0 at every width.
- **`Histories`** keeps one SHA-to-row map per listing, shared by the shape and the tips.
- The browse-mode help gains "/ finds a branch".

**Results (V10b)**. Tests first: 6 unit tests failed before the code (`branchTree` 4, `Histories`
1, the server 1); on `main`'s build the 7 e2e tests of `branches.spec.ts` fail. Now 619 unit tests
and 82 e2e (the badges' test fails without the shrink: 1 row clipped at 1,000 px).

On the regression clones in Chromium (1440 × 900, warm server, 3 rounds):

| | This repository | Bitwarden |
|---|---|---|
| Branches (local / remote) | 14 / 63 | 1 / 1,591 |
| `/api/history/refs` | 5–6 ms | 26–28 ms |
| Panel drawn after the first rows | 8–11 ms | 44–61 ms |
| Panel entries / page elements | 23 / 524 | 628 / 2,622 |
| Filter keystrokes: animation frames over 50 ms | 0 | 0 |
| A click to the deepest tip, until its row is drawn with its details | 21 ms (row 4) | 89–94 ms (row 37,633, `origin/feature-personal-item-clone`), no frame over 50 ms |

First rows against `main`'s build, back to back on Bitwarden: 1,119–1,142 ms against
1,108–1,130 ms (both include the WSL font-layout cost V10a found). Screenshots of this repository,
light and dark at 1440 px and the overlay at 800 px; no page errors. No analysis code changed.

Not verified: Windows and macOS; Firefox and Safari; moving through the panel with arrow keys
(not built: Tab and Enter); screen readers beyond the roles given (`complementary`, folders'
`aria-expanded`).
