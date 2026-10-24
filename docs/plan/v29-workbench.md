# V29 — A workbench: pages and workspaces in a sidenav, a new look, usage at the bottom

[Index](../PLAN.md) · [Journal](../journal/v29-workbench.md)

**Status:** V29a, V29b, V29c and V29d merged into main (2026-10-20, from branch
`milestone/v29-workbench`): their "As built" and results below. Decisions 172 (Claude Code's usage from the
endpoint `/usage` reads), 178 (History) and 180 (Geist and Geist Mono) confirmed by the person
(2026-10-20); 185 made while building; the others proposed.

**Problem** (asked: "I want to focus now on UI improvements. Found this one as a reference. I like
this layout more … Love the fact that i can see the session usage for each found subscription at
the bottom"; then, on the first plan: "There is no need for workspaces page anymore. The layout is
completely changed. On sidenav, will see the available pages, and under pages, will be the
workspaces. On the right of page, will see the current selected page, which is Commits and
Settings. I want the change in styling also, to match the screenshot i gave you"; and "i don't
like the font family. Make it more modern"). The reference is a dark, dense window: a
sidebar of pages and workspaces, the agents' terminals filling the middle, and a status bar with
each subscription's 5-hour and weekly use.

Measured on `main` (`ede9e12`) in Chromium at 1440×900 unless said otherwise, with e2e's fake
Claude Code and three workspaces (`serveWorkspaces`), `serveCommits` for History and the
`callers` fixture for a diff:

| What | Today |
|---|---|
| Navigation | Tabs at the top of each page: Workspaces · History · Settings (V25, V28b) |
| Workspaces | A page of their own (`/`): a heading and help line, a 360 px list (3 workspaces in 298 px, ≈ 85 px each), the picked one's panel beside it. Not shown on History or Settings, only the needs-you count on their tab |
| The agent's terminal at 1280×720 · 1440×900 · 1920×1080 | 808×429 · 965×533 · 1,444×637 px: 38 · 40 · 44 % of the window; 33 · 41 · 49 rows. 268 px of headings, notice, links and tabs above it at every size, 66 px of hint below |
| History | A 37 px tab bar, then the 260 px branches panel and a 1,180 px commit list |
| A diff | A 39 px bar, the 300 px change list, a 1,140 px canvas, a 30 px legend |
| The font | `system-ui`: **DejaVu Sans** here (Chromium on Linux, read with `CSS.getPlatformFontsForNode`), Segoe UI on Windows, SF Pro on macOS; code DejaVu Sans Mono here. Symbiote looks different on every machine. Body 14 px; 12 sizes from 10 to 26 px in the stylesheet |
| The theme | Light, or dark when the system asks (one `prefers-color-scheme` block). The reference is dark |
| The stylesheet | 3,835 lines, 601 rules, colours almost all from 19 tokens on `:root` (2 hex colours and 6 `rgb()` outside it). Radii 4, 6, 8, 10, 12 and 999 px |
| The terminal | xterm with `ui-monospace … monospace` at 13 px on `#111113` |
| Subscription usage | Nowhere. Claude Code shows it in `/usage`, Codex in `/status`, each in its own terminal |
| e2e | 125 tests. 40 of them, in 4 specs, start from the Workspaces page (24 open `/` and expect it) |

Where usage can come from, measured on this machine (Claude Code 2.1.303 on a Pro plan, Codex
0.163 on a Go plan):

| Source | What it gives | How fresh | Cost |
|---|---|---|---|
| Codex's app server, `account/read` | Login `chatgpt`, plan `go` | Live | 3 ms |
| Codex's app server, `account/rateLimits/read` | One window: 43,200 min (30 days), 0 % used, its reset; credits | Live (asks OpenAI) | 789 ms |
| Codex's rollouts (`~/.codex/sessions/…`, `token_count`) | The same windows | As of its last turn (2 days here) | A file read |
| Claude Code's status line input, `rate_limits.five_hour`/`seven_day` (`used_percentage`, `resets_at`) | Session and weekly windows | After each answer, only where a TUI draws it | Symbiote's own `statusLine` in the agent's settings, which replaces the person's (theirs shows in today's terminal) |
| `~/.claude.json`, `cachedUsageUtilization` | 5-hour 20 %, weekly 22 %, and a `limits` list with kind, percent and reset | **16.3 h old** with a session running: written when `/usage` is opened | A file read, no secret |
| Claude Code's transcripts (`apiErrorParams.rate_limit_info`) | Which window was hit, and its reset | Only at the limit (2 of this repository's sessions) | A file read |
| `GET api.anthropic.com/api/oauth/usage` with the OAuth token Claude Code stored | What `/usage` shows, for the whole account | Live | One request, 218–355 ms (3 reads); reads a secret (`~/.claude/.credentials.json` on Linux, the Keychain on macOS). Measured once the person said yes: **59 % and 53 %** while the copy on disk said 20 % and 22 % (17.5 h old, its 5-hour window already reset); 29 keys, 3 with a value; no rate-limit headers |

What causes it:
- Symbiote grew page by page: History first (V10a), Workspaces as a second tab (V18b), made the first
  page (V25), Settings a third tab (V28b). Each page has its own heading and help line, and
  workspaces live on one page.
- The Workspaces page is a document that scrolls. The terminal came last (V21) as one block in
  the panel, and every line added since went above it.
- The look is the browser's default font and a light theme with a dark variant; nothing was
  designed after a reference.
- Symbiote reads no accounts.

**Goal**: one window, after the reference:

```
┌──────────────────┬─────────────────────────────────────────────────────────┐
│ Symbiote · repo       │ ● Add clamp  feature/add-clamp  Working   Stop ⋯ Review │
│ ◷ History      h ├─────────────────────────────────────────────────────────┤
│ ⚙ Settings     s │ Terminal │ Thread │ Brief                               │
│                  │                                                         │
│ Workspaces     + │   the agent's terminal,                                 │
│ ● Needs you 1    │   down to the status bar                                │
│   Add a half …   │                                                         │
│ ● Working 2      │   (or History, Settings, a merge:                       │
│ ▌ Add clamp      │    whatever is picked on the left)                      │
│   Document …     │                                                         │
│ ● Ready 1        │                                                         │
├──────────────────┴─────────────────────────────────────────────────────────┤
│ Started feature/add-clamp     Claude Pro 5h 20% · wk 22%   Codex Go 30d 0% │
└────────────────────────────────────────────────────────────────────────────┘
```

- **No Workspaces page.** A sidenav on the left lists the pages (History, Settings), then the
  workspaces by group (Needs you, Working, Ready for review, Merging, …) as compact cards, and
  Start (+).
- **The main area shows what is picked**: History, Settings, a workspace, or a merge. A workspace
  is one head strip, the tabs Terminal · Thread · Brief, and the terminal down to the status bar:
  at 1440×900 at least 65 % of the window and 55 rows (40 % and 41 today).
- **A status bar**: the last notice on the left; on the right, each subscription found, its plan,
  and each window its vendor reports, with a thin bar; on hover, when it resets and how old the
  number is.
- **The look of the reference**: dark by default, dense (13 px text, 28 px rows), flat, hairline
  borders, a bundled modern font pair, the same on every machine. Light stays as a choice.
- **Unchanged**: what each page does (History's graph, branches panel, compare, checkout, review
  marks; Settings' prompts; a workspace's terminal, thread, verdict, merge, clean-up), keys `h`,
  `s`, `n`, `j`/`k` and the rows' keys, graph JSON, `symbiote diff`, `symbiote pr`'s behaviour, graph layouts
  (node sizes are estimated from character counts, `flow.ts`: kept as they are).

## The shell and addresses (viewer)

- `src/Shell.tsx`: a grid of sidenav, main area and status bar, 100 vh high; the main area scrolls
  itself. `HistoryPage`, `SettingsPage`, the workspace and the merge render in the main area.
  `WorkspacesPage.tsx` goes; its list becomes `Sidenav.tsx`'s lower part, its panel
  `Workspace.tsx`, its Merging section `Merge.tsx`.
- **Sidenav** (240 px): the brand and the repository's folder name; the pages with their key;
  then "Workspaces" with its + (Start, `n`) and the groups of `workspaceGroups`, as today. A card:
  the state dot, the title on one line, the state line and its age, the kind and the branch; at
  most 64 px (85 today). The picked card is raised. Merges in progress are a group of their own.
  With no workspace: "No workspaces yet" and Start.
- **Addresses**: `/history` and `/settings` as today. A workspace keeps `/?branch=<branch>`
  (`&thread` too), the address Symbiote has already put in links (a diff's way back to its workspace,
  the thread). A merge: `/?merge=<branch>`. `/` alone opens History (`replaceState` to
  `/history`); `/workspaces` and `/features` go to `/` as since V25, and on from there.
- **Keys**: `h`, `s`, `n` as today. `w` (the Workspaces page's key) now moves the focus to the
  sidenav's workspaces, where ↑/↓ move and Enter opens. `[` collapses the sidenav to a 48 px rail
  (page icons, a state dot per workspace), remembered per browser (`localStorage`, read in a
  `try`). Below 900 px the sidenav is a drawer.
- **A diff under `symbiote view`** is in the shell too, with the sidenav as the rail unless the person
  opens it there (decision 182): the canvas keeps 1,092 of its 1,140 px at 1440. Under `symbiote pr` and
  `?graph=` there are no workspaces: no sidenav, the new look only.
- **Headings and help lines go.** Each page's help moves into a "?" in its toolbar. Notices
  ("Started …", checkout notices) go to the status bar's left side.

## The workspace in the main area (viewer)

- One head strip: state dot, title, branch, state; then Stop or Start, a ⋯ menu (Open in VS Code,
  Copy the prompt, Clean up…), Merge into ▾ when approved, and Review as the main button.
- The tabs Terminal · Thread · Brief; the brief moves from a toggle to the third tab. The tab's
  content takes the rest of the height; the terminal fits its box as it does when the panel
  changes size today (V21). The hint under it moves to the terminal tab's tooltip.
- The verdict box, the confirmations and Talk (where no terminal runs) keep their behaviour, in
  the new look.

## The look (viewer)

- **Tokens** on `:root`, after the reference: app `#0b0b0c`, sidenav and status bar `#111113`,
  panels `#161618`, raised and picked `#1f1f23`, lines `#26262b`, text `#e6e6e9`, muted `#8b8b94`,
  faint `#5d5d66`; green, amber, red and blue for state (`#3fb950`, `#d29922`, `#f85149`,
  `#58a6ff`), the lanes' six colours as today's dark ones. Light keeps today's light values,
  revised for the same density.
- **Theme** (decision 179): dark by default; Settings gains "Appearance (this browser): Dark ·
  Light · System", kept in `localStorage`, set as `data-theme` on `<html>` before the first paint
  (an inline script in `index.html`, so the page does not flash). React Flow's `colorMode` follows
  it (`"system"` today).
- **Type** (decision 180): **Geist** for text and **Geist Mono** for code, SHAs, branch names and
  the terminal, bundled from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`
  (5.3.0, OFL 1.1) and served by Symbiote, no request outside it. Variable weight, Latin 29 + 23 KB and
  Latin Extended 17 + 15 KB; a browser fetches Latin Extended only for a page that uses it.
  Stacks name the bundled font and a generic family only (`'Geist', sans-serif`, `'Geist Mono',
  monospace`), in the viewer and in xterm: every name the system lacks is a font-matching miss,
  and on Linux those held History's first rows for 850–900 ms (found in V29a: with one installed
  font, 85–107 ms). One scale: 11, 12, 13 (body), 14 and 16 px; tabular figures for numbers,
  times and percentages.
- **Density and shape**: 28 px rows and buttons, 26 px small buttons, 4/8/12/16 px spacing, 6 px
  radius (4 for chips), 1 px lines, no shadow but on menus and dialogs, a 2 px blue focus ring.
- **Icons**: about 20 inline SVG icons in `src/icons.tsx` (16 px, 1.6 stroke): pages, +, ⋯, rail,
  chevrons, the kinds, states, close. No icon library. Vendors by name, not by logo (decision 181).
- **Every page** in the new look: History (rows, badges, the graph's lanes and dots, the branches
  panel, menus, dialogs), Settings (the prompt editor), the start dialog, the workspace, the merge
  view, and the diff page (bar, change list, findings, detail panel, diff rows, comments, nodes,
  frames, edges, minimap, legend).
- **The terminal**: the bundled mono, 13 px, on black (`#000`), the reference's terminal. xterm
  measures its cell from the font: it opens after `document.fonts.load` of the mono, or its
  columns would be counted with the fallback's width.
- Contrast: text tokens at least 4.5:1 on their backgrounds, state colours and lines at least 3:1,
  in both themes; a unit test computes it from the tokens.

## Usage (cli, viewer)

- `packages/cli/src/usage.ts`: `readUsage()` answers
  `{ subscriptions: [{ agent: 'claude' | 'codex', plan, windows: [{ label, minutes, usedPercent,
  resetsAt }], at, source: 'live' | 'cached', note? }] }`. Each field is checked as it is read: both
  sources are undocumented or `[experimental]`, and a value Symbiote cannot read is left out, not
  guessed.
- **Codex**: on the connection Symbiote already has to the person's daemon (`codex.ts`, V27a):
  `account/read` (a `chatgpt` login and its `planType`; an API-key login has no windows and is not
  listed), then `account/rateLimits/read` (`primary` and `secondary`: `usedPercent`,
  `windowDurationMins`, `resetsAt`). Without a daemon (`exec` mode), the newest rollout's last
  `rate_limits`, marked `cached` with its time.
- **Claude Code** (decision 172): `GET https://api.anthropic.com/api/oauth/usage` with the access
  token Claude Code stored (`~/.claude/.credentials.json`; on macOS `security
  find-generic-password -s "Claude Code-credentials" -w`). The windows come from its `limits` list
  (`session` → 5h, `weekly_all` → wk; model-scoped weekly windows in the tooltip), else from
  `five_hour`/`seven_day`. The plan from `~/.claude.json`'s `oauthAccount` (`organizationType`
  `claude_pro` → Pro). **Read only**: Symbiote never refreshes the token. If the refresh token rotates,
  as OAuth servers commonly do (not checked), a refresh by Symbiote would sign Claude Code out. An
  expired or unreadable token, or a failed request, gives `cachedUsageUtilization` with its age;
  a cached window whose `resets_at` has passed is not shown (here the copy's 5-hour window had
  reset 15 h before: its 20 % said nothing about the 59 % then used).
  The token stays in the server process: never sent to the page, never logged, sent only to
  `api.anthropic.com`.
- The cached copy holds about 20 more keys under code names, one at 100 % here
  (`iguana_necktie`). Symbiote shows none of them: it cannot say what they limit.
- **Labels from the window's length**: 300 min → 5h, 10,080 → wk, 43,200 → 30d, others `<n>h` or
  `<n>d`. A fixed "5h · wk" would be wrong for the Go plan measured here.
- **Tones**: green under 80 %, amber from 80 %, red at 100 % or when a transcript says the limit
  was hit.
- **Server**: `GET /api/usage` (absolute, like the pages' other endpoints). It answers from a copy
  in memory and refreshes it in the background when it is older than 60 s, one refresh at a time; a
  429 backs off to 5 min; an error keeps the last copy and its age. `SYMBIOTE_USAGE=off` reads nothing,
  and the bar shows no usage.
- **Viewer**: `useUsage` asks every 60 s while the page is visible (`visibilitychange`), and at
  once on focus. `StatusBar.tsx` draws it.

## The branch's changes (server, viewer; last)

- A right panel in the workspace (280 px, `]` collapses it, hidden under 1,280 px): commits from
  the fork point to the tip, files changed with their added and removed lines (`git diff
  --numstat`), files not committed (`git status --porcelain` in its worktree), the review mark and
  the merge check the panel already reads. A file opens in VS Code in the worktree (V12's open).
  From `GET /api/workspaces/changes?branch=`, read when the workspace is picked and when its
  commit count or state changes. With it open the terminal keeps at least 55 % of the window.

**V29d, planned in detail** (2026-10-20, measured on V29c's build, `a5807da`, Chromium, e2e's
fake Claude Code):

| What | Today |
|---|---|
| A workspace's branch, in its view | Counts only, in the head's state line: "2 commits · 1 file not committed yet · Merges cleanly into main". Which commits and files: a Review (an analysis: **4.6 s** for this branch, 15 commits, 66 files), History's rows (commits, a commit's files only through a diff), or VS Code |
| The terminal's box at 1280×720 · 1440×900 · 1920×1080 | 1024×612 (68.0 %) · 1184×782 (71.4 %, 148 columns) · 1664×969 (77.8 %) |
| … beside a 280 px panel | 49.4 % · **54.5 %** · 64.7 %: under the 55 % the plan asks at 1440 |
| … beside a 256 px panel | 51.0 % · **56.0 %, 116 columns** · 65.8 % |
| The git reads, this branch against `main` (15 commits, 66 files, +6,665 −2,116), warm | `git log` 1 ms · `diff --numstat -M` 17–18 ms (43 cold) · `diff --name-status -M` 17 ms |
| `git status --porcelain -z --untracked-files=all` | 5 ms in this checkout; Bitwarden's worktree (9,147 files) 14 ms warm, 572 ms cold |

- **Server**: `GET /api/workspaces/changes?branch=` answers `WorkspaceChanges` (types in core):
  where the commits start (`base`, and `since`: the default branch's name when that is the fork
  point), the tip, the commits newest first (short SHA, subject, author, date; at most 100, and
  the count), the files changed (path, the path before a rename, status, added and removed lines,
  `null` for a binary; at most 300, and the count and totals over all), and the files not
  committed in its worktree (status, path, lines for tracked files; `null` without a worktree).
  The commits and files are kept per branch for their (base, tip); the worktree's status is read
  each time.
- **Where the commits start** (decision 187): the fork point with the default branch, as Review
  computes it (`forkPoint`): the panel is what Review will show. The workspace's recorded base
  when merged (the fork point is then the tip) or without a default branch.
- **The panel** (decision 186): 256 px at the right of the tabs and their content, under the
  head; its own scroll. Sections Commits, Files and Not committed, each with its count; a
  section's empty state in a word ("No commits yet"). A file row: its status letter, its name, its
  folder (muted), `+a −r`; a click opens it in VS Code in the worktree at its first change
  (decision 188, `POST /api/workspaces/open` with `file`); the head's status says how it went. A
  deleted file is not a button. Commits are read only (their title: subject, author, date).
- **When it shows**: where the workspace's area is at least 1,200 px wide (1440 with the sidenav,
  1,248 with the rail), by a container query, so the terminal keeps 56 % at 1440. `]` and a
  button in the head hide and show it, kept per browser (`localStorage`, read in a `try`). The
  review mark and the merge check stay in the head, which shows at every width.
- **Fresh** (decision 189): read with every read of the list, as the thread is (when picked, on
  focus, every 5 s while an agent works or waits).

Verification (V29d): tests first. Core unit: the numstat parser (renames, binary files, paths
with spaces and tabs), the worktree's status (changed, staged, new, deleted, renamed, a new
folder's files). CLI unit: the endpoint's answer for a branch with commits, its fork point after
`main` moved, a merged one, a gone branch, a gone worktree, the caps; the cache by (base, tip);
`open` with `file` at the first change, a new file at line 1, a path outside the worktree
refused. Viewer unit: the rows' words (status, lines, the heading). e2e: the panel lists the
commits and files the fake agent makes and the file left uncommitted, a click opens VS Code at
the change, `]` hides it and the choice is kept across a reload, hidden at 1280 with the sidenav
open, the terminal's share at 1440 with it (≥ 55 %) and without it (≥ 65 %). `pnpm check`,
build, all e2e; no graph or analysis change (no `regression-check`). Cost: the endpoint on this
branch and on a Bitwarden worktree, warm and cold.

## Verification

1. **Tests first** (red before). Viewer unit: the page or workspace an address opens (`/`,
   `/?branch=`, `/?merge=`, old addresses); card fields and grouping; the theme read before the
   first paint; token contrast in both themes; usage labels, tones, the age text. CLI unit: usage
   as in the first plan (Claude's answer, the cached copy, an expired token with no request and
   no refresh, unknown keys left out; Codex's Go and two-window answers, an API-key login, no
   daemon; the server's 60-s copy, one refresh at a time, the 429 back-off; `SYMBIOTE_USAGE=off`).
2. **e2e**: the 40 tests that start from the Workspaces page start from the sidenav; new ones for
   the sidenav on History, Settings and a diff (the rail), a card opening its workspace from each,
   `w` and the arrows, `[` and the choice kept across a reload, the drawer at 390 px, the theme
   choice, the terminal's rows at 1440×900, the status bar's usage with a fake usage server
   (`SYMBIOTE_CLAUDE_USAGE_URL`, fake credentials in a temporary `HOME`) and e2e's fake app server
   answering `account/read` and `account/rateLimits/read`. Every request the page makes goes to
   Symbiote's server (the fonts included). All 125 of today's tests pass.
3. **Nothing else changes**: graph layouts identical (`flow.test.ts` and the golden layouts
   untouched); `symbiote diff` and `symbiote pr` output identical on this repository's last five merges (no
   analysis change, so no `regression-check`).
4. **The look** (`viewer-check`): screenshots of History, Settings, a workspace, a merge and a
   diff at 1280, 1440, 1920 and 390 px, dark and light, beside the reference; no label clipped on
   Bitwarden's 1,288-symbol graph with the new font (nodes whose text overflows: 0).
5. **Real use**: a real Claude Code and a real Codex workspace in the new terminal; the bar's
   numbers equal `/usage` and `/status` within the same minute.
6. **Cost**: first paint of `/history` within 10 % of `main`'s (48 ms here) with the fonts, and
   its first rows on a clone of this repository from ~965 ms to under 200 ms (the font wait V29a
   found); Bitwarden's
   graph: first paint, select and pan as `main` (`scripts/viewer/measure.mjs`, back to back);
   `/api/usage` from memory under 5 ms; a page fetches at most 55 KB of fonts for Latin text.

**Risks**

| Risk | Mitigation |
|---|---|
| Removing a page breaks the 40 e2e tests built on it, and links people kept | The address of a workspace stays `/?branch=`; old addresses keep their rewrites; the specs move to the sidenav in V29a, before any restyle |
| A restyle of 3,835 lines of CSS hides a behaviour change | V29a changes layout only, V29b the look only; e2e asserts behaviour, screenshots the look, each step on its own commits |
| The graph slows or its labels clip with a new font or theme | Layout constants kept (identical layouts, tested); Bitwarden measured before and after; map labels keep V8a's rule (no font size with zoom) |
| xterm counts columns with the fallback font before the bundled one loads | Open the terminal after `document.fonts.load`; an e2e checks the columns the agent is told match the box |
| Claude's usage endpoint changes or disappears (it is not documented) | Read field by field; nothing shown rather than a wrong number; the cached copy with its age |
| Symbiote holds the person's Claude token | Read only, in the server process; never sent to the page or logged; sent only to `api.anthropic.com`; never refreshed (a test); `SYMBIOTE_USAGE=off` |
| macOS asks before Symbiote reads the Keychain | The cached copy until it is allowed. Not verifiable here (Linux): said in the results |
| Dark by default surprises a person whose system is light | Appearance in Settings, remembered; light is kept |
| History gets narrower with the sidenav (1,180 → 940 px for its list at 1440) | The rail (`[`), remembered; screenshots at 1280 and 1440 |

**Order**: V29a (the shell) first, since the person's main ask is the layout and every later step
draws inside it. V29b (the look) next, on a layout that no longer changes. V29c (usage) needs only
the status bar, and decision 172 is answered: it can move before V29b. V29d (the
branch's changes) last.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V29a | The shell | Sidenav (pages, workspace cards by group, merges, Start), the main area for History, Settings, a workspace or a merge; the Workspaces page and headings gone; addresses and keys; the status bar with notices; the rail and the drawer; a diff in the shell |
| V29b | The look | Tokens after the reference, dark by default, Appearance in Settings; the bundled fonts; density, radii, icons; every page and the graph, the terminal in the mono; contrast tested |
| V29c | Usage | `usage.ts` (Claude Code, Codex), `/api/usage` with its 60-s copy, the status bar's right side |
| V29d | The branch's changes | `/api/workspaces/changes`, the workspace's right panel |

**Decisions** (172, 178 and 180 confirmed by the person; the rest proposed. They replace the first
plan's 172–179; 176 supersedes V25's 136):

| # | Question | Decision | Why |
|---|---|---|---|
| 172 | Where Claude Code's usage comes from | **The usage endpoint `/usage` reads, with the token Claude Code stored; read only, never refreshed; otherwise Symbiote's own last read, kept in its cache for every `symbiote view`, with its age (until 2026-10-21 `~/.claude.json`'s copy: "No claude copy … show the last monitored value from the real usage")** (confirmed: "use the truthful source") | The only live source for the whole account: 59 % and 53 % when the copy on disk, 17.5 h old, said 20 % and 22 %. The status line reaches only sessions Symbiote started and a TUI draws, and Symbiote's would replace the person's own. Claude Code's copy, shown through 429s, was a day old and had lost its 5-hour window |
| 173 | Which windows | **What each vendor reports, labelled by length** | The Codex Go plan here has one 30-day window: "5h · wk" would be wrong for it |
| 174 | Which subscriptions are "found" | **A logged-in agent Symbiote can start whose vendor reports windows** | An API-key login has no windows to show |
| 175 | How fresh | **A server copy, refreshed when older than 5 min while a page asks (60 s until 2026-10-21, the person's change); 5 min after a 429; through a failed read, the last numbers, not an older copy** | Codex's read takes 789 ms and both reach the vendor; a number with its age is honest. At 60 s two `symbiote view`s were refused by Claude's endpoint after 4 reads in 90 s, and 34 of 46 answers in 12 min were Claude Code's day-old copy, without its 5-hour window (fix `usage-keeps-live-numbers`) |
| 176 | The Workspaces page | **Gone: workspaces in the sidenav, one opens in the main area; `/` opens History** (supersedes 136) | The person's ask. History is the page with the most to do when no workspace is picked |
| 177 | A workspace's address | **`/?branch=` kept** | Symbiote has put it in links already (a diff's way back, threads); a new path would need one more rewrite |
| 178 | The page's name | **History** (confirmed; decision 135 stands) | The person called it Commits in this ask, then chose History |
| 179 | Theme | **Dark by default; light and system kept, chosen per browser in Settings** | The reference is dark; a light-system person can still have light |
| 180 | The font pair | **Geist + Geist Mono**, bundled (confirmed, from a mock in three pairs) | Modern and geometric, one family for text and code; 52 KB for Latin text (Inter's pair 88 KB); system fonts differ per machine (DejaVu Sans here) |
| 181 | Vendors in the status bar | **Names, not logos** | Their marks are theirs; a name reads as well at 11 px |
| 182 | A diff page | **In the shell with the sidenav as a 48 px rail by default** | The person keeps the sidenav everywhere; open, it would take the canvas from 1,140 to 900 px at 1440 |
| 183 | The right panel | **The branch's changes, not a file tree; last** | Symbiote reviews changes; a tree of the worktree is the editor's, one click away |
| 184 | New dependencies | **`@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, build assets only** | Served by Symbiote, nothing loaded from elsewhere; no icon library (inline SVG) |
| 185 | What a start shows (made in V29a) | **The new workspace, in the main area** | Its agent plans and asks first: the terminal is what to look at next. One starter for the shell, wherever it opens from |
| 186 | The right panel's width and when it shows (V29d) | **256 px, where the workspace's area is at least 1,200 px; `]` hides it, kept per browser** | At 1440 a 280 px panel leaves the terminal 54.5 % of the window, under the plan's 55 %; 256 px leaves 56 % and 116 columns. Tied to the area, not the window: the rail makes room at 1280 |
| 187 | Where the panel's commits start (V29d) | **The fork point with the default branch, as Review computes it; the recorded base once merged** | The panel shows what Review will show. A branch rebased onto a newer `main` would list `main`'s commits from its recorded base |
| 188 | Where a file opens (V29d; revised by 285, V43: its diff) | **In the worktree, at its first change against the fork point (working copy included); a new file at line 1** | One `git diff -U0` at the click; line 1 of a long file is rarely where the change is |
| 189 | How fresh (V29d) | **With every read of the list, as the thread; commits and files kept per (base, tip)** | The list is read when it can change (focus, every 5 s while an agent works or waits); uncommitted files change without a commit. A read costs ~20 ms of git once cached |

**Not in V29 (later)**: two terminals side by side (the reference splits Claude Code and Codex);
a plain shell in a workspace's worktree; a file tree; pinned workspaces (the reference pins
`main`); the status bar under `symbiote pr`; `symbiote usage` in the terminal.

## As built (V29a)

- **Going between pages in place.** Not in the plan: links to the shell's addresses (`/history`,
  `/settings`, `/?branch=`, `/?merge=` and the old ones) are caught at the document, in the
  capture phase (before a row's own handler, which only stops the click reaching the row), and
  pushed to the history; Back and Forward follow. History mounts anew on each visit, so it reads
  `?branch=` again. An e2e test checks that no navigation loads the page again.
- **A leave guard.** Settings asked through `beforeunload` before leaving with unsaved prompts,
  and a navigation in place unloads nothing: the shell asks instead (`confirm`), on Back too.
  `settings.spec` found it.
- **Starting a workspace opens it** (decision 185): from the sidenav's +, `n`, or History's "Start
  a workspace here", the new workspace opens in the main area and the status bar says "Started
  …". History listed the new branch with the cursor on it before. One starter for the shell:
  History's own Start button is gone.
- **The workspace's head**: Stop or Start, Merge into, and Review as buttons; Open in VS Code, Copy
  the prompt, Talk and Clean up under ⋯. The terminal's hint ("← in an empty prompt lists all
  your agents") is the Terminal tab's tooltip, and the brief its third tab (`&brief`).
- **"+N" on a History row** that folds several workspaces linked to the Workspaces page; it links
  to the most urgent of them now. A diff's way back says "← Workspace" when opened from one.
- **Notices wrap** in the status bar: cut to one line, the notice for an agent that did not start
  hid its "Copy the prompt" (e2e found it).
- **Headings**: History's "History" and its Start button are gone; its toolbar and help line stay
  for V29b. Settings keeps its heading for now.
- **The repository's name** comes from the server (`capabilities.repo`, the folder's name).
- **Keys attach before the first paint**, as History's do: `s` pressed as soon as the page showed
  was lost in 1 of 130 e2e tests.
- **Font matching** (found measuring first paint): History's first rows wait 850–900 ms here for
  a layout whose thread time is 2 ms, Chromium matching font names this system lacks; `main`
  too, after its first paint. The sidenav's key hints, in the monospace stack, brought the wait
  before the first paint (blank ~920 ms in 3 of 14 loads); in the text's font they no longer do.
  V29b's bundled fonts are to remove the wait (its Type and Cost above).
- **Left for V29b**: cards are 70 px high (85 on `main`; the plan said at most 64), and a diff
  under 900 px has no way to open its sidenav (no top strip there).

**Results (V29a).** Tests first, red before: 8 route unit tests (`pages.test.ts`), the repository's
name (server), 6 shell e2e tests red on `main`'s build; a 7th, a diff's rail, written with it.
`pnpm check` 929 unit tests. e2e 130 of 130; 31 tests in 7 specs written for the Workspaces page
start from the sidenav (the start, the ⋯ menu, merges opened from their card). The agent's
terminal with e2e's fake Claude Code, `main` → V29a:

| Window | `main` | V29a |
|---|---|---|
| 1280×720 | 808×429 px, 38 %, 33 rows | 972×572 px, 60 %, 136×44 |
| 1440×900 | 965×533 px, 40 %, 41 rows (135 columns) | 1136×754 px, 66 %, 159×58 |
| 1920×1080 | 1444×637 px, 44 %, 49 rows | 1615×936 px, 73 %, 226×72 |

The plan's 1440 target (at least 65 % and 55 rows) is met. A diff's canvas keeps 1,092 of its
1,140 px at 1440 beside the rail. `/history` on a clone of this repository, `main` and V29a
alternated, 7 rounds each, both orders: first paint 48 and 48 ms against 48 and 56 ms, first rows
962 and 970 ms against 963 and 981 ms. Not verified: a real Claude Code or Codex session in the
new layout (the fake agent only); browsers on Windows and macOS, where the font wait may not
exist; the README's Workspaces screenshot (`features.png`), to be retaken with V29b's look.

## As built (V29b)

- **Tokens** as planned on `:root` (dark) and `:root[data-theme='light']`, the same block again
  for System under `prefers-color-scheme: light` (a test keeps them equal), plus `--side`,
  `--raised`, `--faint`, `--edge` (a text field's border), `--focus` and `--shadow`. Light keeps
  today's values but where they failed the test: muted `#6e6e73` → `#636369` (4.15:1 on the
  raised grey), warning `#bf8700` → `#9a6700` (2.57:1), context `#8c8c93` → `#7d7d84`.
- **"Lines at least 3:1"** is read as a control's edge: text fields get `--edge` (3.38:1 on the
  panel). Lines between regions stay the reference's hairlines (`#26262b`, 1.31:1 on the page);
  a test asks 1.2:1 of them.
- **Font stacks differ from the plan.** Text is `'Geist Variable', monospace`, not
  `'Geist', sans-serif`: after a web font, Chromium on Linux matched `sans-serif` as a family
  name through fontconfig, 283 ms a time, four times in the first layout (a trace), and
  History's first paint went from 48 to 250–650 ms, fonts loaded or not. With no generic it was
  44–68 ms, but a glyph found in no family of the stack (✓, ⚙, ↻) is a search of every font
  (~100 ms): marking a symbol reviewed took 250 ms instead of 33. `monospace` matches in about a
  millisecond and its font here (DejaVu Sans Mono) has them. The family names are fontsource's
  (`Geist Variable`, `Geist Mono Variable`). Tests: no system family named anywhere, no
  `sans-serif` after Geist.
- **The fonts arrive first.** `index.html` preloads the two Latin faces (Vite rewrites the links
  to the hashed files the stylesheet uses): they are in at 7–11 ms, and the page renders once
  they are (at most 1 s), so its first frame is not in the browser's default font.
- **The terminal**: Geist Mono at 13 px is a cell of 8 × 17 px (the fallback's was 7.1 × 13). The
  terminal's box grew and its rows fell: at 1280, 1440 and 1920 it is 68, 71 and 78 % of the
  window and 128×36, 148×46 and 208×57 (V29a: 136×44, 159×58, 226×72; `main`: 33, 41 and 49
  rows). The plan's 55 rows at 1440 were set with the fallback font; the shell test asks 65 % of
  the window and 45 rows.
- **History**: its toolbar is a 44 px strip, sticky over the rows; rows are 28 px
  (`ROW_HEIGHT` 32 → 28); the rows run edge to edge on the page, the branches panel beside them
  on the same background. The keys are behind a "?" ("History's keys"); compare mode keeps its
  instruction beside the toggle and has no "?".
- **Settings**: a toolbar with its title, a "?" for what the page is and where it saves, and
  Appearance at the right (Dark · Light · System, `aria-pressed`), not a section among the
  prompts.
- **Cards**: the state dot and the title; the state and its age; the kind and the branch (the
  kind moved from before the title to before the branch, as the mock had it): 64 px, the
  plan's most (85 on `main`, 70 in V29a). The workspace's head shows the dot too, and its
  state in its tone.
- **Icons**: chevrons (branches panel, a project in the change list, the start dialog's More),
  close and ⋯ are inline SVG; Geist lacks those glyphs. The glyphs the page reads as words stay
  text: "← History", "✓ Reviewed", ↻, and the workspace marks ? ⚙ ● on badges.
- **Badges** are tinted in their severity's colour with the word in it: white on amber read at
  2.4:1. Buttons: one `.button`, filled for the main action, outlined (`.secondary`, and in a
  workspace's head and a merge) for the rest.
- **A diff under 900 px** opens its sidenav from a strip at the top, as the shell's pages do
  (left over from V29a).
- **The diff page's key hints** stay in its sidebar's footer, not behind a "?": they are the
  keys for the list above them, in view while it is used.
- **Found on the way**: a reload asked during a read was given that read, which could have
  started before the change: Land, clicked as its merge opened, kept "Merged, not checked"
  (V29a's in-place navigation opened the window). Fixed on its own commit: one more read after the
  one under way. And `reviews.spec` read the review file as soon as it existed, while the
  second mark's write was on its way: it waits for both now.

**Results (V29b).** Tests first, red before: the theme set before the first paint (index.html's
script run with each stored value and blocked storage), the tokens' contrast in both themes and
the fonts named (`tokens.test.ts`), the reload race (unit, and the V26a e2e with `/api/merges`
delayed by 1 s). New e2e (`look.spec.ts`): dark by default on a light system, Appearance's
Light kept across a reload and on a diff (React Flow's `light`), System following the scheme,
every request to Symbiote's origin with only the two Geist families loaded and 52.5 KB of fonts for
History, a card at most 64 px; and a diff's drawer at 390 px. `pnpm check` 947 unit tests; e2e
135 of 135. Measured, `main` (`ede9e12`) and V29b alternated:

| What | `main` | V29b |
|---|---|---|
| `/history` on a clone of this repository, first paint · first rows (7 rounds, medians, both orders) | 48 and 48 · 969 and 973 ms | 48 and 52 · 131 and 131 ms |
| Bitwarden `737ee3f` (1,288 symbols): first paint · select · mark reviewed · pan (3 rounds) | 1,950–1,983 · 79–82 · 33–34 ms · 63 fps | 264–289 · 73–75 · 33 ms · 63 fps |
| Bitwarden, labels cut short as j walks 40 changes | 62 of 180 | 52 of 180, none that `main` did not cut |

`main`'s first rows on History varied between runs today (400 ms in one, 969 and 973 in the
last two, as V29a measured): its system font stack's matching; V29b's were 129–131 ms in every
run. The plan's targets (first paint within 10 %, first rows under 200 ms) are met.

Graph layouts are unchanged (no layout code or constant changed; `flow.test.ts` and the golden
layouts untouched); `symbiote diff` and `symbiote pr` output are untouched (no CLI or core change). Not
verified: a real Claude Code or Codex in the new terminal (the fake agent only); browsers on
Windows and macOS, where the font costs above may not exist; the README's screenshots
(`features.png` needs a real agent session).

## As built (V29c)

- **Types in core** (`UsageReport`, `UsageSubscription`, `UsageWindow`): the server sends each
  window's length in minutes, and the viewer names it (`5h`, `wk`, `30d`, `<n>d`, `<n>h`) and
  picks its tone (`src/usage.ts`, pure).
- **Claude's own warning**: its `limits` entries carry `severity`; in real use the 5-hour window
  read `"warning"` at 79 %. A window so marked is amber below 80 % too (`warning` on the window;
  other words are not read).
- **No transcripts read** for "the limit was hit": the live endpoint reports the window at
  100 %, and Codex says so itself (`rateLimitReachedType` → `limited`, red).
- **Codex**: `account/read` and `account/rateLimits/read` need no experimental opt-in. Only the
  account's main `rateLimits` is read (its `rateLimitsByLimitId` held the same one here).
  Reading usage starts Codex's app-server daemon when it does not run, as a Codex workspace does
  (decision 154); one Codex (and one daemon connection) serves workspaces and usage.
- **Claude Code's files** are where Claude Code keeps them: `CLAUDE_CONFIG_DIR` when set (its
  `.claude.json` inside it), else `~/.claude` and `~/.claude.json`. `SYMBIOTE_CLAUDE_USAGE_URL` (for
  tests) is honoured for this machine only (`http://127.0.0.1`, `localhost`): the token cannot be
  sent to a third party by an environment variable.
- **The first ask waits** for the vendors (689–799 ms here, both in parallel); every later ask
  answers from memory and reads again in the background past 60 s.
- **A copy with no current window** (all reset since) shows the plan, no window, and says why
  on hover, rather than an old number.
- **e2e never reads a person's usage**: every spec runs `symbiote view` with `SYMBIOTE_USAGE=off`; the
  usage spec fakes Claude's endpoint and credentials (`CLAUDE_CONFIG_DIR`) and gives Codex an
  empty `CODEX_HOME`. Found by its first run, which fell back to this machine's real Codex
  sessions.
- **Not verified**: the macOS Keychain read (`security find-generic-password`), on Linux here.
  An unexplained failure: in 2 of the first ~10 runs of the usage spec, Codex's live read failed
  once (the first answer lacked Codex, or fell back to its sessions); not seen in 36 runs since,
  instrumented ones and a full suite included.

**Results (V29c).** Tests first, red before: 16 unit tests of the readers and the copy (Claude's
live answer and its headers, the older `five_hour`/`seven_day` answer, a model's week, Claude's
warning, an expired token — no request, the file unchanged, the reset window dropped —, a failed
request and a 429, not installed or not signed in, `CLAUDE_CONFIG_DIR`, the URL kept to this
machine, no token in what is returned; Codex's Go and two-window answers, an API key, no
Codex, the sessions' copy; the 60-s copy, one read at a time, the 5-min back-off, errors
keeping the numbers, `SYMBIOTE_USAGE=off`), a server test (`GET` only, `no-store`), 6 viewer tests
(labels, tones, reset words, the hover's text), and 2 e2e (the bar's windows and tones, the
token sent to the fake endpoint only and in no answer to the page, one vendor read per minute
across a reload; a failing endpoint leaving Claude out and Codex shown). `pnpm check` 970 unit
tests, e2e 137 of 137. Real use, `symbiote view` on
this repository: Claude Pro 79 % (5 h) and 68 % (week) live, later 83 % (marked warning) and 69 %;
Codex Go 0 % (30 days) live; a direct read of each source in the same minute gave the same
numbers. `/api/usage` from memory: median 0.79 ms, at most 1.95 ms over 20 asks. Not verified
against Claude Code's `/usage` screen or Codex's `/status` themselves (interactive TUIs): the
comparison is with the sources they read.

## As built (V29d)

- **The panel** is three sections, no title strip: Commits (its count and "since main"), Files
  (its count and the lines over all), Not committed. A count of no lines is muted (`+1 −0`: the
  `−0` grey, not red). Commits show their short SHA, subject and age; their hover the author and
  date.
- **The worktree's files are capped too**, at 300 like the branch's: a build's output that nothing
  ignores would have sent thousands of rows with every read of the list (found reviewing the
  first build).
- **Where there is no room** the head's button hides with the panel (one container query), and
  `]` then shows nothing. The panel stays mounted there and reads with the list (~27 ms of git a
  read); not worth a second rule.
- **`keyIsTaken`** moved from the shell to `src/keys.ts`, for the shell's keys and `]`.
- **Found, not changed**: the head's "N commits" (`ahead`) counts from the recorded base, the
  panel from the fork point. After a rebase onto a newer `main` the head counts `main`'s commits
  too (2 where the panel and Review show 1, in the rebase unit test's setup). `ahead` also decides
  a finished agent's state and the merged check: fixed after the merge on its own branch
  (`fix/commits-from-fork-point`, see JOURNAL).
- **Found on the way**: in light, the Terminal tab's label was near-black on the black it joins
  (1.25:1, V29b's). On the black it takes the dark theme's text in both themes; its own commit,
  an e2e test asking 4.5:1.

**Results (V29d).** Tests first, red before: 7 core (the numstat parser, the worktree's status,
the first changed line), 5 CLI (the changes of a branch with commits, after a rebase, merged, its
branch or worktree gone, the caps; a file opened at its change, paths outside refused; the
server's routes; VS Code at a line), 6 viewer unit (the rows' words), 3 e2e (the lists and the
open, the terminal's share; `]`, the reload, no room at 1280 until the rail; the light tab).
`pnpm check` 988 unit tests (and the refusal's words, `serverWords`); e2e 140 of 140 in two runs
in a row, after one full run that failed on a test not known (its output was not kept). Measured:

| What | V29c | V29d |
|---|---|---|
| The terminal at 1280×720 (sidenav open: no panel) | 1024×612, 68.0 % | the same |
| … at 1440×900 | 1184×782, 71.4 %, 148 columns | 928×782, **56.0 %, 116 columns** beside the panel (148 with it hidden) |
| … at 1920×1080 | 1664×969, 77.8 % | 1408×969, 65.8 %, 176 columns |
| `changes()` on a clone of this repository, the V29 branch (17 commits, 76 files, +7,473 −2,133) | — | 57 ms the first read, 26–28 ms after (commits and files kept) |
| The worktree's part in a Bitwarden worktree (9,147 files) | — | 291 ms the first read, 14–16 ms after |

Graph layouts and `symbiote diff`/`symbiote pr` are untouched: core only gained git readers and types
(`flow.ts`, the goldens and the analysis unchanged). Not verified: a real Claude Code or Codex
workspace with the panel (the fake agent only); VS Code itself opening at the line (a fake
`code` records its arguments); browsers other than Chromium (container queries need Chrome 105,
Firefox 110, Safari 16).
