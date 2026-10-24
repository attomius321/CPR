# V25 — Workspaces first, History beneath

[Index](../PLAN.md) · [Journal](../journal/v25-workspaces-home.md)

**Status:** merged into main (2026-10-19, from branch `milestone/v25-workspaces-home`): V25a–c. Decisions
135–140 confirmed by the user before V25a ("always keep workspaces as the first page"; the kind
kept "because they are indeed a feature").

**Problem** (asked: "I don't like the commits page name … and that we still work with commits,
this app is one abstraction higher than git branches … it works with worktrees, and I call a
worktree a workspace"). Measured on `main` (`d604c2d`):

| What | Today |
|---|---|
| `symbiote view` with no revisions opens on | `/`, the commits page; Workspaces is the second tab (`/workspaces`) |
| The tabs | "Commits · Workspaces" (`PageTabs.tsx`) |
| A diff's way back | "← Commits" (`BackToCommits`), even when it was opened from a workspace |
| "commits page" in user text | README 6 times, `symbiote view --help` once, the page's heading "Commits" |
| "feature" in code (`feature`, `features`, `Feature…`, `feature…`) | 1,949 matches: core 48 + 52 tests, cli 486 + 545, viewer 459 + 153, e2e 206 |
| Files named for features | 12 (`FeaturesPage.tsx`, `features.ts` ×3, `useFeatures.ts`, `StartFeatureDialog.tsx`, …) |
| The API | `/api/features…`, 30 uses in the viewer and the server |
| On disk | `symbiote/features/<branch>.json`, described as "Features" in the `symbiote/AGENTS.md` Symbiote writes |
| e2e that open `/` and expect the commits page | 54 of 90 `goto` calls |

What causes it:
- V10a made the history the first page, before workspaces existed (V18). V18b added
  workspaces as a second tab, and V24 changed what they are called on screen but not in the code.
- The word "feature" now means two things: a workspace (code, API, disk) and one of V24's five
  kinds of work (`WorkKind 'feature'`, the `feature/` branch prefix).

**Goal**: `symbiote view` opens on **Workspaces**. The repository's history is still there, called
**History**, at `/history`. "Workspace" is the word everywhere: on screen, in the code, in the API
and on disk. "Feature" is left only for the kind of work. Unchanged: `symbiote view <base> [head]`
still opens on that comparison, `symbiote diff` and `symbiote pr` are untouched, graph JSON is untouched,
and old addresses and old workspace records keep working.

## Pages and addresses (viewer, server)

- `/` is Workspaces. `/history` is the history page (today's commits page, behavior unchanged).
  The tabs read **Workspaces · History**, in that order, and the needs-you count stays on
  Workspaces.
- Old addresses keep working: `/workspaces` and `/features` are rewritten to `/` with
  `history.replaceState`, keeping search and hash (`&thread` links keep working). A bare `/` saved
  before V25 meant the commits page; it now opens Workspaces, which is the point of the change.
- The server serves the page at `/history` (beside `/workspaces` and `/features`). `/api/history`
  is the API and is unaffected (exact-path routing).
- A diff's way back names where it came from: "← History" or "← Workspaces", kept in the diff
  page's history state. With no state (a bookmark, a reload) it is "← History".
- The workspaces page's empty state ("No workspaces yet …") gains **Start a workspace** (n) and a
  link to History. Keys on History are unchanged.
- `symbiote view --help` and the README say "History" and describe Workspaces as the first page.
  `docs/images/commits.png` is retaken as `history.png`.

## One word in the code (cli, core, viewer)

- Rename the workspace meaning of "feature" to "workspace": files (`FeaturesPage.tsx` →
  `WorkspacesPage.tsx`, `features.ts` → `workspaces.ts` in each package, `useFeatures`,
  `FeatureMark`, `FeatureStarter`, `StartFeatureDialog` → `StartWorkspaceDialog`), types
  (`Features` → `Workspaces`, `FeatureRecord`…), the page state (`'features'` → `'workspaces'`,
  `'commits'` → `'history'`), CSS classes, and `CommitsPage` → `HistoryPage`.
- Keep `WorkKind 'feature'`, the `feature/` prefix and every string about the kind. The rename is
  done symbol by symbol (TypeScript's rename), not by a text replace. A guard test lists the
  remaining `feature` identifiers outside kind code and fails on new ones.
- API: `/api/workspaces…`. The viewer and the server ship in one package and one process, so
  `/api/features…` is not kept as an alias.
- `@symbiote/core` exports: the renamed types are exported under their new names only. No other
  package outside this repository imports them (the plugins import graph types only).

## Records on disk

- Workspaces are kept in `symbiote/workspaces/<branch>.json` (and the cache fallback's `workspaces/`).
- When a repository is opened and `symbiote/features/` exists but `symbiote/workspaces/` does not, Symbiote moves
  it with one `rename` (atomic on one filesystem). If both exist, it reads `symbiote/workspaces/` and
  leaves the old folder, with a note in `/api/workspaces`' `note`. Nothing is copied, so records
  are not duplicated.
- `symbiote/AGENTS.md`, which Symbiote writes, says "Workspaces" and `symbiote/workspaces/<branch>.json`.
  Threads (`symbiote/threads/`) and reviews (`symbiote/reviews/`) do not move.

## Verification

1. **Tests first** (red before): server, `/history` serves the page and `/workspaces` and
   `/features` still serve it; viewer unit, the page chosen for each address and the back link's
   label; core/cli, the move of `symbiote/features/` (only old, only new, both, neither, a cache-only
   repository); `AGENTS.md`'s text; the guard test on `feature` identifiers.
2. **e2e**: the 54 `goto('/')` calls that mean the history go to `/history`; new specs:
   `symbiote view` opens on Workspaces, the empty state's two actions, the tabs' order and count,
   "← Workspaces" from a workspace's review and "← History" from a compare, and the old
   addresses. All of today's 113 pass.
3. **Nothing else changes**: graph goldens untouched (no analysis change, so no
   `regression-check`). `symbiote diff`/`symbiote pr` output byte-identical on this repository's last five
   merges.
4. **Real use**: this repository's two workspaces (`symbiote/features/`, 2 records) moved on the first
   start and listed as before. A workspace started before V25 and still running gets a reply and is
   cleaned up. The same with a Codex one.
5. **Viewer**: `viewer-check`, screenshots of Workspaces (empty and with two) and History, light
   and dark, at 1440, 900 and 390 px. First paint of `/` is no slower than today's `/workspaces`.

**Risks**

| Risk | Mitigation |
|---|---|
| The rename catches the kind "feature" (`feature/` branches, the Feature kind's line) | Symbol renames, not text; V24's kind tests and e2e unchanged and green; the guard test |
| An agent running during the move reads `symbiote/features/<branch>.json` | Its brief is in its prompt; the record is only re-read by Symbiote. Tested: a running workspace across the move |
| Two `symbiote view` processes on one repository both try the move | `rename` fails for the second (target exists), which then reads the new folder; tested |
| People expect `/` to be the history (bookmarks, muscle memory) | The History tab is one click or `h`; the README's first lines say it |
| A 1,949-match rename makes a large, hard-to-review diff | V25b is its own commit with no behavior change: tests unchanged except for names |

**Order**: V25a first (the visible change, on today's names), then V25b (renames only, all tests
green before and after), then V25c (disk).

## Milestones

| # | Milestone | Output |
|---|---|---|
| V25a | Workspaces home, History | `/` Workspaces, `/history` History; tabs "Workspaces · History"; old addresses rewritten; a back link to where the diff came from; the empty state's Start and History; `h` to History; help, README, screenshots |
| V25b | One word in the code | Files, types, state, CSS and API renamed from features to workspaces and from commits page to history; the kind "feature" kept; the guard test |
| V25c | Records on disk | `symbiote/workspaces/`, a one-time move of `symbiote/features/`, `AGENTS.md`'s text |

**Decisions** (135–140 confirmed; 141 made while building):

| # | Question | Decision | Why |
|---|---|---|---|
| 135 | The history page's name | **History** | It is the repository's history (every branch, the commit graph). "Branches" is git's own word, and every workspace already has a branch. "Repository" would cover workspaces too |
| 136 | The first page | **Workspaces, also when there are none** | The empty state starts one or links to History. Workspaces are the unit Symbiote works in, so a first run shows that |
| 137 | `/api/features` alias | **None** | The viewer and the server are always the same version (one process) |
| 138 | Old records | **Move `symbiote/features/` once, with `rename`** | Reading both forever would keep the old word in the code. A copy would leave two sources |
| 139 | "feature" as a kind | **Kept** | It is the kind most branches are (V24). Renaming it would change branch prefixes people already use |
| 140 | A key for History | **`h`** (the tabs' keys: `w` Workspaces, `h` History) | Neither is bound on either page today (checked: no handler for `h` or `w` in `packages/viewer/src`) |
| 141 | `symbiote/config.json`'s `features` section | **Now `workspaces`; `features` still read when `workspaces` is not there** | It is the person's file, which Symbiote cannot move as it moves its records. Like the old addresses, the old name keeps working |

**Not in V25 (later)**: a workspace's own history (its commits drawn alone, in its panel), and
starting a workspace from a History branch that has none.

## As built (V25)

- **The way back from a diff** is read from the page's `document.referrer`, not from history
  state as planned. A diff is opened with `location.assign` (History's Compare, a workspace's
  Review), so the opening page cannot leave state on it. The referrer outlives a reload, and is
  empty for a bookmark (then "← History"). `src/pages.ts` holds the rule, unit-tested.
- **The empty state** has no Start button of its own. The page header's "Start a workspace" is right
  above it, and a second one broke strict locators in 4 specs. It says "Start a workspace above
  (n)" and links to History.
- **A workspace's branch link** went to `/?branch=` (History, when History was at `/`). That address
  now picks a workspace, so it goes to `/history?branch=`. Found by reading the code, not a test.
- **The rename** was done by a script on TypeScript's syntax tree, not by text: identifiers, module
  paths, `/api/features…`, CSS classes, comments and test titles (1,437 edits; 12 files renamed;
  `CommitsPage` → `HistoryPage`; page states `'workspaces'` and `'history'`). What it got wrong and
  was put back: three objects keyed by kind (typecheck found them), one more in a test (`toEqual`
  ignores an undefined key, so only reading the diff found it), the fixtures' git branch named
  `feature` (`shas.feature` in 4 test files), and comments on the Feature kind. `/api/features`
  without its leading slash in one spec was missed by both passes; e2e found it.
- **"Workspace" is taken twice more** in the code: npm/pnpm workspaces (`core/src/workspace.ts`) and
  Angular workspaces in the plugin. Different files and no shared names, so left as they are.
- **The commits list's CSS classes** (`commits-*`) are kept: they name the list, which History still
  is.
- **Moving the records**: `workspacesFolder` in `thread.ts`, since the agent's hook (a process of its
  own, Node modules only) reads the records too. An agent running across the upgrade can fire its
  hook before any `symbiote view`; then the hook moves them. On Linux `rename` replaces an empty
  `symbiote/workspaces/`, so "both" means both hold something.
- **The list's note is now shown** on Workspaces (`.workspaces-note`). The plan put the "old folder
  left" note in the API only. The cache note (why workspaces are not in `symbiote/`) was never shown
  either; now it is.

**Results.** Tests first, red before: server 1, viewer unit 4 (`pages.test.ts`), CLI help 1, config
1, the move 3, the hook 1, the list 1, `AGENTS.md` 1, the guard test 1 (red with a new `featureCount`), e2e 2
(the pages, old addresses and keys; the note). 801 unit tests (788 on `main`), 114 of 114 e2e.
Matches of `feature` in code and tests: 1,949 → 565, mostly `feature/…` branch names and the kind
in tests; 5 identifiers in `src`, all listed by the guard test. In Chromium on throwaway
repositories: Workspaces with two workspaces, empty, and History, light and dark at 1440 and 390 px,
no page errors. First paint, same server, 5–9 rounds back to back: `main`'s `/workspaces` 109 ms,
V25's `/` 109 ms; `main`'s `/` (commits) 60 ms, V25's `/history` 60 ms. History at 390 px is cramped
(its help wraps into a narrow column, Compare mode is cut), the same on `main`. On a repository whose
two records were in `symbiote/features/`, the built CLI's hook moved them and recorded its event,
`symbiote view` listed both in 40 ms, and a `symbiote/features/` made again showed the note. README's History
screenshot retaken (`history.png`). `symbiote diff` on this repository's last 5 merges, `main`'s build
and this one: the same graph JSON but for `stats.durationMs` (within ±4 %). Not verified: a real Claude Code or Codex session running across
the move (the hook was run by hand with a recorded event); Windows, where `rename` onto an existing
folder fails even when it is empty (then the old folder is reported left); the README's Workspaces
screenshot (`features.png`, three real agents) is not retaken and still shows the old tab order.
