# Journal: V29 — A workbench: pages and workspaces in a sidenav, a new look, usage at the bottom

[Index](../JOURNAL.md) · [Plan](../plan/v29-workbench.md)

## V29 spike — today's workspace layout, and where usage can be read (2026-10-20, branch `milestone/v29-workbench`)

Asked: UI improvements after a reference (a window with workspaces and sessions in a sidebar, the
agents' terminals filling the middle, the worktree's files on the right, each subscription's
5-hour and weekly use in a status bar), "Love the fact that i can see the session usage for each
found subscription at the bottom".

Measured on `main` (`ede9e12`) with e2e's fake Claude Code and three workspaces, Chromium at
1280×720, 1440×900 and 1920×1080 (a throwaway spec, not committed): the terminal is 808×429,
965×533 and 1,444×637 px (38, 40 and 44 % of the window; 33, 41 and 49 rows). 268 px sit above it
at every size and 66 px below. The workspace list is 360 px wide and holds three workspaces in
298 px.

**Learned**:
- **Claude Code's copy of the usage on disk is not live.** `~/.claude.json`'s
  `cachedUsageUtilization` was 16.3 h old while a session ran: it is written when `/usage` is
  opened. Live numbers reach Claude Code with each answer (the `anthropic-ratelimit-unified-*`
  headers) and leave it in two places only: the status line's input (`rate_limits.five_hour` and
  `seven_day`, `used_percentage` and `resets_at`, for subscribers after the first answer) and the
  SDK's `rate_limit_event`. Hooks do not get them. Transcripts record a window only when it is hit
  (`apiErrorParams.rate_limit_info`, 2 of this repository's sessions).
- **A status line of Symbiote's would replace the person's.** Symbiote passes its hooks with `--settings`; a
  `statusLine` there would win over the person's own, which today's terminal shows. And it would
  only run where a TUI draws the session.
- **The cached copy has about 20 keys under code names**, one at 100 % here
  (`iguana_necktie`). Its `limits` list (kind, group, percent, reset) is the part meant to be
  shown.
- **Codex's windows are not "5h · wk" on every plan.** On the Go plan here, `account/rateLimits/read`
  on the daemon Symbiote already uses answers one window of 43,200 min (30 days) at 0 %, in 789 ms (it
  asks OpenAI); `account/read` gives the plan in 3 ms. Rollouts carry the same `rate_limits` per
  turn.
- **Not measured**: the endpoint Claude Code's `/usage` reads
  (`api.anthropic.com/api/oauth/usage`), because it needs the OAuth token Claude Code stored. It
  waits for the person's yes (decision 172). The token on this machine expires about 8 h after
  Claude Code last refreshed it. Symbiote must never refresh it: if the refresh token rotates (not
  checked), a refresh by Symbiote would sign Claude Code out.
- **e2e**: 125 tests; 6 selectors in 2 specs name the page tabs the shell would move.

## V29 replanned — no Workspaces page, the reference's look, a modern font (2026-10-20, branch `milestone/v29-workbench`)

Asked, on the first plan: "There is no need for workspaces page anymore … On sidenav, will see the
available pages, and under pages, will be the workspaces. On the right of page, will see the
current selected page … I want the change in styling also, to match the screenshot"; and "i don't
like the font family. Make it more modern".

Measured on `main` (`ede9e12`), Chromium at 1440×900:
- **The font is not Symbiote's choice.** `system-ui` gives DejaVu Sans here (`CSS.getPlatformFontsForNode`
  on History's rows and heading), DejaVu Sans Mono for SHAs; Segoe UI on Windows, SF Pro on macOS.
  Bundled variable fonts for Latin text: Inter 48 KB, JetBrains Mono 40 KB, Geist 29 KB, Geist
  Mono 23 KB (Latin Extended 15–85 KB more, fetched only when used); all OFL 1.1, from
  `@fontsource-variable` 5.3.0. A dark mock of the planned sidenav, workspace and status bar was
  drawn in each pair and today's font, for the person to pick.
- **A new look is mostly new tokens.** The stylesheet (3,835 lines, 601 rules) takes its colours
  from 19 tokens on `:root`, with 2 hex colours and 6 `rgb()` outside it; dark mode is one
  `prefers-color-scheme` block, and React Flow's `colorMode` is `"system"`.
- **Graph layouts do not read the font.** Node widths are estimated from character counts
  (`nodeWidth`, 9.4 px a character, measured on wide DejaVu Sans): a narrower font leaves slack,
  not clipped labels. Keeping the constants keeps every layout identical.
- **xterm measures its cell from the font it is given**: with a bundled mono, the terminal must
  open after the font has loaded, or its columns are counted with the fallback's width.
- **What the sidenav would take**: a diff's canvas is 1,140 px (300 px change list beside it);
  History's commit list 1,180 px (260 px branches panel). A 240 px sidenav takes 21 % of either; a
  48 px rail takes 4 %.
- **e2e**: 40 of the 125 tests, in 4 specs, start from the Workspaces page; 24 open `/` and expect
  it.

## V29 decisions — the live Claude source, History, Geist (2026-10-20, branch `milestone/v29-workbench`)

The person chose Geist and Geist Mono (decision 180, from a mock of the planned sidenav, workspace
and status bar in three pairs), kept History (178), and said yes to the live source for Claude
Code's usage (172: "use the truthful source").

**Measured** once allowed: `GET api.anthropic.com/api/oauth/usage` with the stored access token
and `anthropic-beta: oauth-2025-04-20`, three reads 2 s apart: 200 in 355, 218 and 265 ms, the
same 2,289 bytes, no rate-limit headers. It said 59 % (5-hour) and 53 % (weekly), while
`~/.claude.json`'s copy, 17.5 h old, said 20 % and 22 %. That copy's 5-hour window had reset
15 h before, so its number described nothing current: the plan now drops a cached window whose
reset has passed. The answer has 29 keys; 3 have a value (`five_hour`, `seven_day` and
`iguana_necktie`, a code name), and `limits` lists the two meant to be shown, with kind and
reset. The token was read in the script's process only and not printed.

## V29a — the shell: the pages and the workspaces in a sidenav (2026-10-20, branch `milestone/v29-workbench`)

No Workspaces page: a sidenav lists History and Settings, then the workspaces by group and the
merges in Symbiote's queue; the main area shows what is picked; a status bar says what the last
action did. `/` alone is History; a workspace keeps `/?branch=`; a merge is `/?merge=`.

**Learned**:
- **One window means navigation in place.** With full page loads between the sidenav's entries
  the sidenav would reload and the terminal reattach each time. Links to the shell's addresses
  are caught at the document in the capture phase, before a row's own handler (the cards' and
  badges' links only stop the click reaching their row), and pushed. History mounts anew on each
  visit, since it reads `?branch=` once.
- **In place, nothing unloads.** Settings' `beforeunload` question about unsaved prompts never
  came; the shell now asks for the page (`confirm`), on Back too.
- **History's first rows wait on font matching here.** A trace of the first load: one layout of
  859 ms wall time and 2.3 ms thread time, for 50 layout objects. With one installed font for
  every element the wait is gone and the first rows show at 85–107 ms instead of ~950 ms; the
  sans stack alone (`system-ui, -apple-system, 'Segoe UI'`) costs ~570 ms, the monospace stack
  (`ui-monospace, SFMono-Regular, Menlo`) ~300 ms. `main` has it too, after its first paint. The
  sidenav's key hints in the monospace stack brought it before the first paint (blank ~920 ms in
  3 of 14 loads); in the text's font they no longer do. Not chased in V29a: V29b bundles its
  fonts and names only them and generic families. Measured in headless Chromium on Linux (WSL);
  a browser on Windows or macOS may never wait.
- **A long notice cut to one line hid its button**: the status bar wraps instead.
- **A key pressed as soon as the page shows** was lost when the shell attached its keys after the
  paint (1 of 130 e2e tests); a layout effect attaches them before, as History's are.
- **A diff of `symbiote view` reads the same capabilities as the shell's pages** (`commits`): the diff
  shell flashed on History until it was kept to a diff's states.

**Verification**: unit (8 route tests, the server's repository name), 7 shell e2e tests (6 red on
`main`'s build), `pnpm check` 929 tests, e2e 130 of 130 with 31 tests in 7 specs moved from the
Workspaces page to the sidenav. The agent's terminal (fake Claude Code): 1440×900 965×533 px, 41
rows → 1136×754 px, 58 rows (66 % of the window); 1280 and 1920 in PLAN.md. `/history` on a
clone of this repository, `main` and V29a alternated 7 rounds, both orders: first paint 48/48 →
48/56 ms, first rows 962/970 → 963/981 ms. Not verified: real agents in the new layout; other
browsers and systems.

## V29b — the look: the reference's tokens, Geist, one density (2026-10-20, branch `milestone/v29-workbench`)

Dark by default with light and System in Settings (Appearance, this browser), the reference's
tokens, Geist and Geist Mono served by Symbiote, 44 px toolbars, 28 px rows and buttons, 6 px radii,
tinted badges, cards of 64 px, the keys behind a "?", the terminal black and edge to edge.

**Learned**:
- **A web font can cost more than the system font it replaces, through its fallback.** With
  `'Geist', sans-serif`, History's first paint went from 48 ms to 250–650 ms, and the same with
  the fonts blocked. A trace: one 1,136 ms layout, four `MatchFamilyName("sans-serif")` calls to
  the font service at ~283 ms each — after a web font, Chromium on Linux asked fontconfig for
  `sans-serif` as a family name, and did not keep the answer. As the only family, `sans-serif`
  was resolved through the browser's settings in a few ms. `monospace` was matched in about 1 ms.
- **A glyph in no family of the stack is a search of every font**: ~100 ms here
  (`FallbackFontForCharacter`). With Geist alone, marking a symbol reviewed (its ✓) took 250 ms
  instead of 33. `'Geist Variable', monospace` keeps both fast: DejaVu Sans Mono has ✓ ⚙ ↻.
  These costs are this machine's (WSL); Windows and macOS were not measured.
- **Preloading the fonts and drawing once they are in costs nothing locally**: they arrive at
  7–11 ms from Symbiote's server, before the bundle has run, and the first frame is in Geist.
- **Geist Mono's lines are tall**: a cell of 8 × 17 px at 13 px, where the fallback's was
  7.1 × 13. The terminal's box grew to 71 % of a 1440×900 window and its rows fell from 58 to 46
  (`main` 41). Row targets depend on the font; the box is what the layout controls.
- **WCAG's contrast for "lines"** applies to a control's edge, not to a hairline between
  regions: text fields got their own `--edge` token at 3:1; the reference's region lines are
  1.31:1 and stay.
- **A reload asked during a read was answered by that read** (`loading ??=`), which could have
  started before the change: Land, clicked as its merge opened in the shell, kept "Merged, not
  checked", and nothing read again. V29a's in-place navigation opened the window (the view's
  reader starts as it mounts); the fonts' timing made it fail twice in a row. `reloadWorkspaces()`
  now reads once more after a read under way; mount, focus and timer reads still share it.
- **A test read a file written as it goes**: `reviews.spec` read the review file as soon as it
  existed, while the second mark's write was on its way. It waits for both marks now.

**Verification**: unit tests red before (the theme script run with each stored value and with
storage blocked, token contrast in both themes, the fonts named, the reload race with a fake
fetch); e2e red before for the race (`/api/merges` delayed 1 s) and new in `look.spec.ts` (dark
by default on a light system, Light kept across a reload and on a diff, System following the
scheme, every request to Symbiote's origin with only the two Geist families and 52.5 KB of fonts on
History, a card at most 64 px) and `shell.spec.ts` (a diff's drawer at 390 px). `pnpm check` 947
tests, e2e 135 of 135. Against `main` (`ede9e12`), alternated: `/history` on a clone of this
repository, first paint 48 → 48/52 ms, first rows 969/973 → 131/131 ms (7 rounds, both orders);
Bitwarden `737ee3f`'s graph: first paint 1.95–1.98 s → 0.26–0.29 s, select 79–82 → 73–75 ms,
mark reviewed 33 → 33 ms, pan 63 fps both; labels cut short as j walks 40 changes 62 → 52 of
180, none new. Screenshots, dark, of History, Settings, a workspace, its thread, the start
dialog and a diff at 1280, 1440 and 1920 px (all but the dialog at 390 too) and a merge at
1440; light at 1440. Not verified: real agents in the new terminal; other browsers and
systems; the README's screenshots.

## V29c — usage in the status bar (2026-10-20, branch `milestone/v29-workbench`)

Each subscription Symbiote's agents run on, at the status bar's right: `Claude Pro · 5h 59% · wk 66%`,
`Codex Go · 30d 0%`. Claude Code's from the endpoint its `/usage` reads, with the token it stored,
read only (decision 172); Codex's from its app server. `symbiote view` keeps a 60-s copy
(`GET /api/usage`).

**Learned**:
- **Claude grades its own windows**: `limits[].severity` read `"warning"` at 79 % of the
  5-hour window. A fixed 80 % threshold would have shown it green; the window carries the
  warning now. Other words are not read until seen.
- **The shapes** (Claude Code 2.1.303 on Pro, Codex 0.163 on Go, read today): Claude's `limits`
  list has `kind` (`session`, `weekly_all`), `percent`, `resets_at` (ISO with microseconds),
  `scope`; its plan is `oauthAccount.organizationType` (`claude_pro`); its token file has
  `expiresAt` in ms. Codex's `account/read` gives `type: "chatgpt"` and `planType`;
  `account/rateLimits/read` (0.8 s, it asks OpenAI) `primary`/`secondary` with `usedPercent`,
  `windowDurationMins`, `resetsAt` in seconds, and `rateLimitReachedType`; no experimental
  opt-in needed. Codex's sessions carry the same in snake case.
- **A fallback can reach the person's files from a test.** The first run of the usage spec fell
  back to Codex's sessions in this machine's `~/.codex`. Every spec now runs `symbiote view` with
  `SYMBIOTE_USAGE=off`, and the usage spec gives Claude Code a `CLAUDE_CONFIG_DIR` and Codex a
  `CODEX_HOME` of its own.
- **"One read at a time" needs the decision taken before the read**: a refresh with nothing due
  still left a promise "under way" for a tick, and the next ask, past 60 s, reused it and read
  nothing (a unit test found it).
- **Unexplained**: in 2 of the first ~10 runs of the usage spec Codex's live read failed once;
  not seen in 36 runs since, instrumented ones and a full suite included.

**Verification**: 16 unit tests of the readers and the copy, 1 server test, 6 viewer tests, 2
e2e (red before: no module, a 404), `pnpm check` 970 tests, e2e 137 of 137. Real use on this
repository: Claude 79 % and 68 %, later 83 % (warning) and 69 %, Codex 0 %, each equal to a
direct read of its source in the same minute; not compared with the `/usage` and `/status`
screens themselves. `/api/usage` from memory 0.79 ms median, the first ask 689–799 ms. Not
verified: the macOS Keychain read.

## V29d spike — what the branch's changes cost, and the room beside the terminal (2026-10-20, branch `milestone/v29-workbench`)

Measured on V29c's build (`a5807da`), Chromium, e2e's fake Claude Code (a throwaway spec, not
committed).

**Learned**:
- **A workspace says how much, not what.** Its head says "2 commits · 1 file not committed yet ·
  Merges cleanly into main"; which files takes a Review, an analysis: 4.6 s for this branch
  against `main` (15 commits, 66 files).
- **The git reads are cheap.** On this branch: `git log` 1 ms, `diff --numstat -M` 17–18 ms warm
  (43 cold), `diff --name-status -M` 17 ms. `git status --porcelain -z --untracked-files=all`: 5
  ms here, 14 ms warm and 572 ms cold in a Bitwarden worktree of 9,147 files. Reading them with
  every read of the list (every 5 s while an agent works) costs little once commits and files are
  kept per (base, tip).
- **The plan's 280 px did not fit its own rule.** The terminal's box is 1024×612, 1184×782 and
  1664×969 at 1280, 1440 and 1920 (68, 71 and 78 % of the window). Beside 280 px it would keep
  49, 54.5 and 65 %: under the 55 % the plan asks at 1440. Beside 256 px: 51, 56 and 66 %, 116
  columns at 1440. The rule is the area's width, not the window's: with the rail, 1280 has room.
- **`git diff --raw --numstat -z` gives both in one run**, raw records first; kept as two runs
  (`listChangedFiles` exists and is tested), in parallel.
- **The recorded base and the fork point agree** on this repository's 3 workspaces with a branch
  (the other 3 branches are gone): too few to tell how often a branch is rebased. The panel takes
  the fork point, as Review does (decision 187).

## V29d — the branch's changes beside the terminal (2026-10-20, branch `milestone/v29-workbench`)

A workspace shows its branch at the terminal's right: the commits since the fork point and the
files they change with their lines (what Review will show), then the files its worktree has not
committed. A file opens in VS Code in the worktree at its first change. 256 px, where the
workspace's area is at least 1,200 px wide; `]` hides it, kept per browser.

**Learned**:
- **The plan's width broke its own rule.** 280 px would have left the terminal 54.5 % of a
  1440×900 window, under the 55 % asked; 256 px leaves 56 % and 116 columns (measured with the
  panel built: 928×782 px). A container query on the workspace's area, not a media query on the
  window: the rail gives room at 1280.
- **Two counts of a branch's commits.** The head's `ahead` counts from the workspace's recorded
  base, the panel (and Review) from the fork point: after a rebase onto a newer `main` the head
  says 2 where the panel lists 1. Not changed here: `ahead` also decides a finished agent's state.
- **An empty branch is "merged" by the fork point** (the fork point is its tip), as a merged one
  is: told apart by the recorded base, so a new workspace says "since main" and a merged one
  "since it started".
- **Untracked files need a cap too**: a build's output that nothing ignores lists every file
  (`--untracked-files=all`), every 5 s.
- **`git diff -U0 <base> -- <path>` in the worktree** finds a file's first change in the working
  copy, committed or not, in one run; a rename is found only with both of its paths in the
  pathspec (with the new one alone the whole file is new, line 1).
- **A light theme's text on the terminal's black**: V29b's tab joined to the terminal kept the
  theme's text colour, near-black in light (1.25:1). Seen only in a light screenshot of a
  workspace; fixed on its own commit with an e2e contrast check.

**Verification**: tests first, red before — 7 core (numstat with renames, binary files, tabs;
the worktree's status; the first changed line, a rename through both paths), 3 workspaces (the
changes, a rebase, merged, gone branch and worktree; the caps; opening at the change, paths
outside refused), 1 server, the editor's file at a line, 6 viewer unit, 3 e2e. `pnpm check`
988 unit tests, e2e 140 of 140 in two runs in a row. One full run before them failed and its
output was cut to its last lines: which test failed is not known (no failure in the 3 runs
around it). The terminal at 1440×900 beside the panel 928×782 px (56.0 %, 116
columns), 1184×782 without it; 1920 65.8 %; 1280 with the sidenav open: no panel, 68 %.
`changes()` on the V29 branch of a clone of this repository (17 commits, 76 files): 57 ms first,
26–28 ms after; a Bitwarden worktree's status and lines 291 ms first, 14–16 ms after. Screenshots
at 1280, 1440, 1920 and 390 px dark, 1440 light. No layout, graph or analysis code changed. Not
verified: real agents with the panel; VS Code itself (a fake `code` records its arguments);
browsers other than Chromium.

Merged into main (2026-10-20): V29a, V29b, V29c and V29d, no conflicts (`main` had not moved
since the branch). `main` verified after the merge: frozen install, 988 unit tests, format, lint,
typecheck, build, 140 of 140 e2e.
