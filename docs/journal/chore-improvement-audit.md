# Journal: Chore — Improvement audit

[Index](../JOURNAL.md)

## Improvement audit: every app checked, what to improve (2026-11-06, branch `chore/improvement-audit`)

The person asked for every app Symbiote ships to be verified as it is on `main` (c2aa5c4), and for
what could be better: "find, don't fix". Nothing but this page, its two index lines and its
screenshots changed. Each finding below gives where it is, the evidence, why it matters, a fix
and its size (S: under a day, M: a few days, L: a milestone). The findings are grouped by app,
each group ranked by value. The top 10 is at the end.

**How each finding was checked.** **Reproduced**: I ran it and saw it, with the output or a
screenshot. **Measured**: a number from a run. **Code**: I read the lines named and the failure
follows from them, but I did not run it. A short list at the end holds what four read-only code
reviews reported that I did not check myself.

**How the apps were run.**
- **`symbiote view`**: my own instances, each with its own `SYMBIOTE_CACHE_DIR`, restarted after
  the build, on scratch repositories. The e2e harness provided the fake Claude Code
  (`serveWorkspaces`), a fixture diff (`serveFixture`), a fake GitHub pull request
  (`servePullRequest`), and recorded Overview and Hive states (`overview-data.ts`,
  `hive-pages-data.ts` through `page.route`).
- **Coverage**: every page in both themes at 1440×900 and 1×. The Overview also at 1024×700.
  Every shell page was also opened with the API failing (500) and with it never answering.
- **The nexus**: on `--port 0`, with a home of its own.
- **The desktop window**: on Xvfb `:160`, stopped by its PID.
- **Not done**: no real agent, Nucleus, Scout, Scribe or Hive run, and no file dialog.
- **One side effect on your machine**: my `pnpm check` added 2 test folders to
  `~/.cache/symbiote/worktrees` (finding R3); I left them there. The later unit-test timing ran
  with a cache of its own and added none (649 folders before and after).

### The checks

| Check | Result | Time | Notes |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | passed | 0.2 s | the store was warm |
| `pnpm check` | passed | 97 s | format, lint, typecheck; vitest 242 files, 3,412 tests in 40.9 s |
| `pnpm build` | passed | 5 s | Vite warns that one chunk is over 500 kB (finding V12) |
| `pnpm test:e2e`, viewer | **1 failed**, 430 passed | 3.0 min | `workspaces.spec.ts:2293`; see below |
| the same test alone, `--repeat-each 5` | 5 passed | 6.2 s | **a flake under load**, not a failure on `main` |
| `pnpm test:e2e`, nexus | 32 passed | 18.3 s | `pnpm test:e2e` never reached it: the viewer's failure ends the run first |
| `pnpm logs:check` (its own stack, random ports) | passed | 82 s | Loki ready after 30.6 s; 17 dashboard panels as expected |
| `./install.sh --no-app` (`XDG_BIN_HOME` in a scratch folder) | passed | 1.0 s | wrote both commands; printed the PATH advice |
| `pnpm audit` | 2 high, 7 moderate, 3 low | | finding R4 |
| CI on `main` (GitHub Actions) | **red since 2026-10-13** | | finding R1 |

The e2e failure, from the full run:

```
1) e2e/workspaces.spec.ts:2293:1 › a fast-forward main can no longer take waits for you; Merge commit instead lands it with one (V67)
   Expected: "Cannot fast-forward: main has 1 commit feature/add-a-half-function does not. …"
   Received: "Queued: d190621 into main, by fast-forward (main moved: fast-forwarding again from its tip)"
   26 × locator resolved to … "Queued: …"  (Timeout: 12000ms)
```

The entry stayed "Queued" for the whole 12 s window while the other specs ran. Alone it passed 5
times out of 5. I did not find why the queue took longer than 12 s under load (finding S9).

Unit tests, slowest files (vitest JSON, run with a cache folder of its own):

| File | Time | Tests |
|---|---|---|
| `cli/test/hive-runner.test.ts` | 44.6 s | 81 |
| `cli/test/merges.test.ts` | 37.0 s | 95 |
| `cli/test/workspaces.test.ts` | 26.7 s | 139 |
| `cli/test/nucleus.test.ts` | 18.9 s | 70 |
| `plugin-qwik/test/qwik.test.ts` | 17.2 s | 18 |

The suite runs in 41 s of wall time because the files run in parallel; no single test takes over
3.3 s.

### What was opened, and what was not

| App | Pages and states opened | Not reached, and why |
|---|---|---|
| `symbiote view` | Overview (empty, normal with records, lists longer than their cards, 1024×700, Hive); Git (fresh, after a merge); Nucleus (Terminal tab); Skills (empty); Monitor; History (empty, after a merge); Settings: Checks, Hive mode, Nucleus, Merger, Scribe, Suggest settings, Skill library, Appearance; Start a workspace (blank, filled); a workspace: working, waiting for a permission, plan ready, ready for review, approved, and each tab (Claude Code, Thread, Activity, Brief); its review's Files and Graph; a merge waiting to land and landed; a diff's Files and Graph; a pull request's Files and Graph; the intro (0.6, 2.5 and 6 s); Hive: the question's page, the Overview, the Run tab live, landed and stopped, the sidenav, Settings' Hive page, New goal; every shell page with the API failing and never answering | Settings' prompt groups (Workspaces, Reviews) were not opened one by one. A finished workspace's page in History needs a cleaned-up workspace. The merger agent's conflict page, a failed agent and a stopped agent were not reached by hand: `merges.spec.ts` and `workspaces.spec.ts` cover them and passed. Nucleus's Activity tab and Scribe's pane would start the fake agent's sessions: not opened |
| Real graphs | Bitwarden 737ee3f (Angular plugin, 1,288 symbols), ky 0d59458: first paint, select, mark, pan, 3 rounds | |
| The nexus | the list, a running repository's card, a folder's card, a typed path, no match, a Symbiote's tab | Open Symbiote and `git init` on a folder: they write. `explorer.spec.ts` covers them and passed |
| Desktop window | the start page, a view, both themes | The file dialog (Open a repository…): it opens on your Windows desktop. `app.spec.ts` ran in the e2e and passed |
| CLI | `diff` on ky, zod, vite, RealWorld and Bitwarden; every error path (no base, a bad revision, a bad `--depth`, `--fail-on` or `--plugin`, an unknown option, outside git); `--json`; `--codequality`; `pr` without a number; `activity`; `merge` without a branch; every `--help` | `pr` against a real forge: only the e2e's fake GitHub (I chose not to use your token) |
| MCP server | `symbiote mcp` over stdio: `initialize`, `tools/list` (25 tools), and the read-only tools `overview`, `workspaces`, `start_options`, `merges`, `usage`, `code_map`, `workspace`, `activity`, `thread`, `merge_log`, plus an unknown tool | The tools that act (start, reply, merge, clean): they would ask for Confirm on a real view |
| GitHub Action, GitLab template | read, and every URL they name was fetched | Neither was run in CI: the workflow has never run (finding R5) |
| `install.sh` | run with `--no-app`, and with an unknown option | the app step (`app install`): it writes your desktop's launcher |
| Logs app | `pnpm logs:check`; your running dashboard, read only | |

### Findings: the repository and CI

**R1. CI on `main` has been red for over three weeks.**
- **Where**: the GitHub Actions run of c2aa5c4.
- **Evidence (Reproduced)**: `gh run list --branch main --status success` gives 2026-10-13 as the
  last green run. In the latest run all three jobs fail:
  - **ubuntu, node 22 and node 24**: `packages/cli/test/main.test.ts:277` expects
    `"symbiote": "/tmp/symbiote-test-RISjEd/symbiote"` but receives
    `"/tmp/symbiote-test-L1sKhB/state/symbiote-test-RISjEd-04e66f954606"`. The runner has no
    `git config user.email`, so `reviewPlace` (`packages/cli/src/reviews.ts:144`) falls back to
    the cache. Locally it passes, because your email is set.
  - **macOS**: `eslint .` stops with "JavaScript heap out of memory" (exit 134) after ~2 GB.
- **Why it matters**: nothing outside this machine checks `main`, and the red has become noise.
- **Fix**: set `user.email` in that test's repository. Give lint more heap
  (`NODE_OPTIONS=--max-old-space-size=4096`), or lint per package. **S**

**R2. Every install and CI address in the docs names a repository that does not exist.**
- **Where**:
  - `README.md:44` (`git clone https://github.com/attomius321/Symbiote.git`)
  - `docs/guide/review-and-ci.md:207` (`uses: attomius321/Symbiote@main`) and `:243`
  - `ci/gitlab/symbiote.yml:4` and `:21`
- **Evidence (Reproduced)**: `curl -I https://github.com/attomius321/Symbiote` answers 404, and
  the template's raw URL answers 404. The same file under `attomius321/CPR`, which is public now,
  answers 200.
- **Why it matters**: the install command, the Action and the GitLab include fail for anyone but
  you.
- **Fix**: rename the GitHub repository to Symbiote (GitHub then redirects `CPR`), or point the
  four places at `CPR`. Your call. **S**

**R3. Tests leak analysis folders into your real cache, and nothing prunes the cache.**
- **Where**:
  - `packages/core/test/plugins.test.ts:71,73` calls `analyzeGit` without `cacheDir`.
  - `vitest.config.ts:24` sets only `SYMBIOTE_LOG`.
  - `packages/core/src/git/repo.ts:36` names a slot by the folder's basename.
- **Evidence (Measured)**:
  - `~/.cache/symbiote/worktrees` holds 649 folders and 3.5 GB. 631 of them are
    `symbiote-test-*` (42 MB), dated every day since 2026-10-21; my `pnpm check` added 2 more.
  - With `SYMBIOTE_CACHE_DIR` set, a full vitest run added none.
  - Your main checkout's `git worktree list` holds 17 cache checkouts.
- **Why it matters**: the cache only grows, and every orphaned slot is a registered worktree.
- **Fix**: set `SYMBIOTE_CACHE_DIR` in `vitest.config.ts`'s `env` (**S**). Name a slot after the
  main worktree (**S**). Add a prune of slots whose repository is gone (**M**).

**R4. `pnpm audit`: one high advisory in a runtime dependency.**
- **Evidence (Measured)**: Electron 44.9.0 (`packages/desktop`) has "Mitigation for compromised
  eMudhra intermediate certificates", fixed in 44.9.1. The rest are in dev tools:
  - vite 8.3.1 under vitest: 1 high, 4 moderate, 1 low; fixed in 8.3.3.
  - fast-uri under ajv (core): 2 moderate, 2 low.
  - minimatch under eslint: 1 moderate.
- `pnpm outdated -r`:
  - Patch updates for react, xyflow, dagre, marked, vite, vitest, eslint and Playwright.
  - Majors behind: electron 44 → 45, typescript 6 → 7, @angular/compiler 21 → 22,
    @types/node 22 → 26.
  - No declared dependency is unused.
- **Fix**: bump electron to ≥ 44.9.1 and the patch versions (**S**). The majors each need a
  milestone's checks (**M**).

**R5. The Action and the GitLab template have never run.**
- **Evidence (Reproduced)**: `.github/workflows/symbiote.yml` has no runs. `ci.yml` never calls
  `action/run.sh`.
- **Why it matters**: with R2, nothing would show that the documented CI path is broken.
- **Fix**: a CI job that runs `action/run.sh` on a fixture pull request. **M**

### Findings: `symbiote view` (the viewer)

**V1. A JSON file that is not a graph turns the whole page white.**
- **Where**: `packages/viewer/src/diff/App.tsx:280` (dropping a file) and
  `src/history/commits.ts:376` (`?graph=`). No error boundary exists anywhere in `src` (0 matches
  for `ErrorBoundary` or `getDerivedStateFromError`).
- **Evidence (Reproduced)**: `?graph=` serving `{}` gives 0 elements under `#root` and the page
  error "Cannot read properties of undefined (reading 'filter')". A `{ schemaVersion: '0.1.0' }`
  file fails the same way.
- **Why it matters**: dropping a wrong file is easy, and the page then says nothing.
- **Fix**: check the shape and `schemaVersion` before `setState`, and add an error boundary
  around each page. **M**

**V2. With the API failing, every page says "drop a graph JSON"; while it has not answered, every page says "Loading graph…".**
- **Where**: the shell decides from `/api/capabilities` and `./api/graph`
  (`src/diff/useDiffGraph.ts:101-125`).
- **Evidence (Reproduced)**: with `/api/**` answering 500, the Overview, Git, Nucleus, Skills,
  Monitor, History, Start and Settings all show "Review a change as a graph — Run symbiote view
  main, or drop a graph JSON"
  ([shot](../images/chore-improvement-audit/api-failing-overview.png)). With `/api/**` never
  answering, all eight say "Loading graph…"
  ([shot](../images/chore-improvement-audit/api-pending-settings.png)).
- **Why it matters**: a server that errors looks like no server, and the advice given is wrong
  for a running `symbiote view`.
- **Fix**: an error state that says the server answered with an error, with Retry; neutral
  loading words. **S**

**V3. Every shell page load asks for `/api/graph`, gets a 404, and logs a console error.**
- **Where**: `src/diff/useDiffGraph.ts:120`. It polls `./api/graph` even when
  `/api/capabilities` says this view serves no diff.
- **Evidence (Measured)**: 25 page loads in the empty-repository tour gave 25 × `GET /api/graph
  404` and 25 × "Failed to load resource: … 404". The workspace tour gave 39 of each.
- **Why it matters**: the console of a healthy page is never clean, so a real error is easy to
  miss. It is also one more round trip before the shell draws.
- **Fix**: skip the graph read when capabilities say no diff. **S**

**V4. Failed reads are dropped silently, and some leave a page spinning forever.** Code.
- **Where**:
  - `workspaces/ThreadTab.tsx:21-24`: a non-OK answer becomes `null`, which `:61` draws as
    "Reading its messages…" forever.
  - `workspaces/useWorkspaces.ts:96-99`: a non-OK answer replaces the list with `null`, so the
    sidenav goes back to its skeleton.
  - `diff/store.ts:29-35`: review marks and drafts are `PUT` with `.catch(() => undefined)` and
    `ok` is never read, so a failed save is lost with no word.
  - `diff/DetailPanel.tsx:51-61`: a rejected source read stays in the cache for the session.
  - `workspaces/HiveRunTab.tsx:99`: the log tail closes on its first error and never
    reconnects. `StepLog.tsx` does reconnect.
  - `history/api.ts:122-130`: a network error mid-analysis reads as "missing", and the page stops
    polling.
- **Why it matters**: these are the states the brief asks about (error, loading), and in each the
  page never says anything went wrong.
- **Fix**: one `useRead` hook with loading, value and error states (the same
  `fetch → ok ? json : null → .catch(() => {})` block is written about 15 times). A visible
  "not saved" for review marks. **M**

**V5. `getJson` shows the server's JSON to the person.** Code.
- **Where**: `ui/http.ts:28` throws `new Error(await response.text())`. `serverWords`, 10 lines
  above in the same file, already reads `{ error }`. History's refused workspace
  (`WorkspaceHistory.tsx:96`) renders that message.
- **Effect**: the page shows `{"error":"…"}`.
- **Fix**: `serverWords` in `getJson`, `history/api.ts:69` and `history/git-api.ts:36`. **S**

**V6. The Overview at 1024×700: the fifth figure takes its own row, and "Agents at work" shows only its head.**
- **Evidence (Reproduced)**: [shot](../images/chore-improvement-audit/overview-1024x700.png),
  with normal mode's records:
  - "Time to merge" wraps under the other four figures and adds ~100 px.
  - "Waiting for you" shows 1.5 rows of its 24.
  - "Agents at work" shows its head and no row.
  - The head's line is cut ("6 merges in…").
- **Why it matters**: the Overview is the page `/` opens, and a half-screen window on a laptop
  is a common size.
- **Fix**: five figures on one row down to ~1000 px (smaller numbers or a 5-column grid), or
  fold the fifth into the head. **S**

**V7. On Bitwarden's map, project names cover file names.**
- **Evidence (Reproduced)**, `measure.mjs` shot of 737ee3f with the Angular plugin, at the
  opening zoom:
  - "desktop" covers "vault-l…" ([shot](../images/chore-improvement-audit/bitwarden-map-desktop-label.png)).
  - "storybook" is drawn over a file's label in its small frame
    ([shot](../images/chore-improvement-audit/bitwarden-map-storybook-label.png)).
  - "@bitwarden/components" runs out of its frame over another label.
- **Why it matters**: the map is the first view of a large change. These labels are the ones
  that say where things are.
- **Fix**: keep a frame's name band clear of its children in `packFrames`, and cut a name to its
  frame's width. **M**

**V8. The review's comment hint breaks before its last two characters.**
- **Where**: the review sidebar, at its default width.
- **Evidence (Reproduced)**: "…write one in its panel ( c" then ")." alone on the next line
  ([shot](../images/chore-improvement-audit/review-hint-wrap.png)).
- **Fix**: keep "(c)." together (`white-space: nowrap` on the key and its brackets). **S**

**V9. History's empty state indents its second line by 24 px.**
- **Where**: `workspaces/WorkspaceHistory.tsx:178` puts `className="hint"` on the second `<p>`.
  The global `.hint { padding: 24px }` (`ui/controls.css:313`) overrides the card's own spacing
  (`WorkspaceHistory.css:56`, "6px").
- **Evidence (Reproduced)**: [shot](../images/chore-improvement-audit/history-empty-indent.png).
- **Fix**: a class of its own, or `.history-none .hint { padding: 0 }`. **S**

**V10. In a browser, the theme, text size and panel widths reset on every new `symbiote view`.**
- **Where**: each run serves on a new port, so the page has a new origin with empty storage.
  `packages/desktop/src/state.ts:35-37` says so, and the desktop app copies six choices back.
  Nothing does that for a browser tab (`--browser`, or no app installed).
- **Evidence (Code)**: `theme.ts` keeps the choice in `localStorage` only. I did not run two
  views to watch it reset.
- **Fix**: keep the viewer's choices on the server (`/api/state`, as review state is) or in the
  config folder. **M**

**V11. Small text and look items.**
- **The Monitor's sentence repeats itself on a small repository**: "14 lines of code in 2 files.
  Half of it is in 1 file (50 %); the largest file holds 50 %." **S**
- **Graph page counts differ**: the head says "1 error · 1 warning" while the Findings tab says
  3; the third is an info. Say "3 findings" or count infos in the head. **S**
- **A landed merge stays under "Merging"**: the sidenav's group "Merging" lists the entry as
  "Landed · into main" until it is removed. **S**
- **Hive's red focus ring**: in New goal, the focused, empty Title has a crimson ring (Hive's
  accent), which reads like a validation error. Worth a look against the style skill. **S**
- **Times in three formats**: "18 min median" on the Overview, "3:04:00 brief to landed" and
  "18:38 since the brief" on a Run tab. **S**

**V12. One 1.16 MB script for every page.**
- **Evidence (Measured)**: `index-C32ADK0U.js` is 1,158.8 kB, 363.6 kB gzipped; Vite warns.
  xterm (331 kB) and the intro are split already. First paint is fast on this machine:
  - fixtures: 44–130 ms to the page head;
  - Bitwarden: first paint 307–340 ms, select 103–104 ms, mark reviewed 34 ms, pan 63 fps
    (V6's reference: 650 ms, 72 ms, 60 fps).
- **Why it matters**: low priority while everything is local.
- **Fix**: lazy-load the pages that are not the first (Settings, Skills, Monitor, History). **M**

### Findings: the CLI, its server and the MCP server

**S1. Any local process can answer the person's Confirm, and can claim to be Nucleus.**
- **Where**:
  - `packages/cli/src/server.ts:2321-2333`: a write needs only `x-symbiote: 1`, a JSON content
    type, and no Origin or our own.
  - `server.ts:795-805`: `/api/mcp/asks` lists the pending Confirms, and `/api/mcp/answer`
    answers them.
  - `server.ts:836`: a request that sends `x-symbiote-caller: nucleus` is treated as Nucleus,
    which starts workspaces without a Confirm when that setting is on (`mcp.ts:1406`).
- **Evidence (Reproduced, on my own view)**:
  - `curl ${U}api/mcp/asks` → 200.
  - A POST to `api/mcp/answer` with no Origin reached the handler: 404 "no ask nope", not 403.
  - The same POST with a foreign Origin → 403.
- **Why it matters**: the Confirm is the person's gate on starts, merges and clean-ups. An agent
  with Bash in a workspace can `curl` past it. Browsers are kept out; local processes are not.
- **Fix**: a per-run secret handed to the page and to the bridge, required on writes and on the
  Nucleus identity. **M**

**S2. The merger's check can outlive its timeout and Symbiote.**
- **Where**: `packages/cli/src/programs.ts:105-132` (`runShell`, used by `merges.ts:367`) spawns
  `shell: true` without a process group. At 60 minutes, `child.kill()` stops only `sh`;
  `pnpm check && pnpm build` keeps its children, and `close` waits for them.
- **Evidence (Code)**: Hive fixed the same thing with `runGroup` and `killGroup` (HV2, decision
  654).
- **Fix**: use `runGroup` in the merger. **S**

**S3. The merge lock can be taken twice.**
- **Where**: `merge-queue.ts:39` creates the lock with `{ flag: 'wx' }` and writes the pid in the
  same call. A second process that reads it in between sees `''` → pid 0 → "not held"
  (`merge-queue.ts:52`), removes it and takes its own.
- **Evidence (Code)**: `hive-runner.ts:339` repeats the pattern, and so does core's
  `git/worktree.ts:107` for analysis slots.
- **Why it matters**: rare, but two queues would then merge into one target.
- **Fix**: one shared `pidLock()`: write the pid to a temp file and `link()` it to the lock;
  treat an empty, young lock as held. **S**

**S4. Network calls with no timeout.**
- **Where**:
  - `packages/forge/src/http.ts:18`: `fetch` with no `AbortSignal`, so a stalled GitHub or
    GitLab waits for undici's 300 s.
  - `packages/core/src/git/merging.ts:164-175` (`pushCommit`, the normal-mode merger's push)
    runs `git push` without `network()`'s timeout and `BatchMode` (`sync.ts:42-50`). An ssh
    prompt or a stalled network holds the merge queue.
- **Evidence (Code)**.
- **Fix**: `AbortSignal.timeout(30_000)`; pass `network(repo)` to the push. **S**

**S5. `symbiote view --help` and `symbiote --help` say it opens on Git.**
- **Where**: `packages/cli/src/main.ts:240`: "It opens on Git (g)". The top-level help says
  "without revisions, Git: every branch…".
- **Evidence (Reproduced)**: `/` has opened the Overview since V91 (`pages.ts:202`), as
  `docs/reference/commands.md` says.
- **Fix**: S.

**S6. `symbiote merge --help` misses the first default target.**
- **Where**: `main.ts:338-339` says "the branch its workspace started from, else the one the
  approval names, else the default". The code puts the reviewed-against branch first
  (`merges.ts:458-462`).
- **Evidence (Code)**: `commands.md:130` is right; `docs/area/merger.md` lists this trap.
- **Fix**: S.

**S7. A failed merge is logged without its reason.**
- **Where**: `main.ts:986-998` adds `message` only when the entry has one. The comment says
  "a failure as a warning, with its words".
- **Evidence (Measured)**: all 21 "merge failed" lines in `~/.cache/symbiote/logs` (2026-10-25
  to 11-05) carry only `branch`, `into` and `state`. Your logs dashboard shows "merge failed
  feature/nx6-nexus-explorer → main" and nothing more. Over the same days 113 merges landed and
  21 failed.
- **Fix**: set the entry's message at every failure (the failed step and its last line). **S**

**S8. The MCP tools do not say which are read-only, and they accept unknown arguments.**
- **Evidence (Reproduced)**:
  - `tools/list` returns 25 tools, none with `annotations` (`readOnlyHint`, `destructiveHint`).
  - The schemas (`mcp.ts:191-198`) set no `additionalProperties: false`, so `wait` with
    `{"seconds": 1}` waited its default 10 minutes. My client timed out at 120 s.
- **Why it matters**: annotations let an agent's client allow reads without asking, and a
  mistyped argument should fail rather than block 10 minutes.
- **Fix**: S.

**S9. A fast-forward merge stayed "Queued" for over 12 s under load.**
- **Where**: `e2e/workspaces.spec.ts:2293`.
- **Evidence (Reproduced)**: see The checks; it passes alone.
- **Why it matters**: either the queue waits on something it should not, or the spec's 12 s is
  too tight for a loaded machine. I did not find which.
- **Fix**: time the queue's steps in that spec under load, then fix the cause. **S–M**

**S10. A typo dumps the whole help.**
- **Evidence (Reproduced)**: `symbiote diff HEAD~1 --frobnicate` prints the error, then 20 lines
  of help.
- **Fix**: print the error and "see symbiote diff --help". **S**

### Findings: core and the plugins

**C1. Findings on a file whose path has a space are dropped from line-based output.**
- **Where**: `packages/core/src/git/changed-lines.ts:73-77` (`headerPath`).
- **Evidence (Reproduced, git's side)**: git writes `+++ b/my file.ts^I` (a TAB after a name
  with a space), and `headerPath` keeps the TAB. The key `my file.ts\t` matches no file. The unit
  test writes the headers by hand, without the TAB.
- **Why it matters**: `pr --post-findings`, Hive's review and `--codequality` lose every finding
  on such a file.
- **Fix**: strip a trailing `\t`, and test with real git output. **S**

**C2. A `pnpm-workspace.yaml` written in flow style is not read.**
- **Where**: `packages/core/src/workspace.ts:19-26`.
- **Evidence (Code)**: `packages: ['apps/*', 'libs/*']` sets `inPackages`, but only `- item`
  lines are read, so no pattern is found. Cross-package imports then resolve through the
  installed `node_modules`, the checkout's, not the analyzed revision's.
- **Fix**: read the flow form too (or use a YAML parser). **S**

**C3. Graph order depends on the locale.**
- **Where**: 10 `localeCompare` sorts in core, among them `diff.ts:179,182`.
- **Evidence (Code)**: a non-ASCII path sorts differently under `en_US` and `sv_SE`, so CI and a
  laptop can write different graph JSON for one change.
- **Fix**: compare by code point. **S**

### Findings: the nexus

**N1. In a browser, the nexus is always dark.**
- **Where**: `packages/nexus/page/index.html:16-21` reads `symbiote.viewer.theme` from its own
  origin, where nothing sets it. The nexus has no theme switch, and it ignores the system's
  scheme.
- **Evidence (Reproduced)**: with the browser set to the light scheme
  ([shot](../images/chore-improvement-audit/nexus-light-scheme.png)), the page draws dark.
- **Fix**: default to `system`, or show the viewer's Theme choice. **S**

**N2. Opening a Symbiote's tab logs a 405.**
- **Where**: `src/page/reach.ts:40-41` probes the Symbiote with `HEAD /`, and `symbiote view`
  answers 405 (`curl -I` → `HTTP/1.1 405 Method Not Allowed`).
- **Evidence (Reproduced)**: one console error per tab opened.
- **Fix**: answer HEAD as GET in `symbiote view`, or probe `/api/status`. **S**

**N3. A slow `git rev-parse` reads as "no repository", and the nexus offers `git init`.**
- **Where**: `src/folders.ts:184-192` maps every error, including the 1 s timeout, to `null`.
  `init.ts` then answers 409 `init`.
- **Evidence (Code)**: on `/mnt/c`, where git under WSL is slow, or in a repository owned by
  another user ("dubious ownership"), a folder inside a repository is offered `git init`. A yes
  nests a repository.
- **Fix**: treat only "not a git repository" as none; walk up the parents for `.git` first. **S**

**N4. Any local process can drive the nexus on its fixed port.**
- **Where**: `src/server.ts:215-222` has the same gate as S1.
- **Evidence (Code)**: on 7347, `POST /api/symbiotes {"folder":…,"init":true}` runs `git init`
  with no person's yes; decision 928's yes is the page's only.
- **Fix**: the same per-run secret as S1. **M**

**N5. `commands.md:184` says Enter "goes into a folder".**
- **Evidence (Code)**: since NX6, Enter opens the folder, or asks about `git init`; → goes in.
  The README is right.
- **Fix**: S.

### Findings: the desktop window

**D1.** Nothing broken was found. Both themes draw, the window opens in about 200 ms after
Electron starts, and `app.spec.ts` passed in the e2e. The view's first load logs the `/api/graph`
404 of V3. Electron's audit item is R4.

### Findings: install, the Action, GitLab, the logs app

**I1. `./install.sh` fails on macOS unless run with `--no-app`.**
- **Where**: `scripts/install.mjs:131-133` runs `symbiote app install` and fails on its error.
  `packages/cli/src/app.ts:181-182` throws "not supported on darwin yet".
- **Evidence (Code)**: the README says "macOS runs the same code".
- **Fix**: skip the app step off Linux, with a note. **S**

**I2. The Action and the GitLab template are not pinned to Symbiote's versions.**
- **Where**:
  - `action/install.sh:4` hard-codes `pnpm@12.8.1` apart from `packageManager`.
  - `action.yml` and `ci/gitlab/symbiote.yml` use Node 22; `.nvmrc` says 24.
  - The template clones `SYMBIOTE_VERSION: main`.
- **Evidence (Code)**: they match today.
- **Fix**: read `packageManager`; pin a tag. **S**

**I3. The logs app works; one gap.** `logs:check` passed. Your dashboard loads with one 401
(`/api/user/stars`, Grafana's for anonymous viewers). The gap is S7: failed merges have no
reason.

### Findings: code health

**Q1. Four closures hold most of the CLI.**
- **Evidence (Measured)**:

  | File | Lines |
  |---|---|
  | `server.ts` | 2,516 |
  | `hive-runner.ts` | 2,315 |
  | `workspaces.ts` | 2,212 |
  | `main.ts` | 1,614 |
  | `mcp.ts` | 1,570 |
  | `merges.ts` | 1,382 |

  `startViewServer`, `hiveRunner`, `workspaces()` and `symbioteMcp` are single closures of
  ~900–2,000 lines with shared mutable state.
- **In the viewer**: `HistoryPage.tsx` (1,737), `SettingsPage.tsx` (1,423), `Workspace.tsx`
  (1,320); in the nexus, `page/main.ts` (1,265).
- **Why it matters**: they cannot be tested in parts.
- **Fix**: routes per service with an explicit context. **L**

**Q2. Type safety is good; the network edges are the holes.**
- **Counts (from the reviews' scans)**:
  - `any`: 0 in every package.
  - Non-null `!`: 4 in cli, 13 in monitor, 0 in core and nexus. The viewer's 83 are mostly the
    intro engine's math.
- **The holes**:
  - Every `res.json()` in the viewer (33) is an unchecked cast, and so are the SSE payloads.
  - `forge/src/http.ts:52` casts the forge's JSON.
  - `runner.ts:78` casts a child's output `as Graph`.
- **Fix**: shape checks at those edges (V1 is one). **M**

**Q3. React's hooks and accessibility lint rules are off.**
- **Evidence (Code)**: `eslint.config.js` has neither `react-hooks` nor `jsx-a11y` (0 matches).
  The viewer review counted 216 effects with hand-kept dependency lists,
  one of 25 entries (`HistoryPage.tsx:1313-1338`).
- **Fix**: `react-hooks/exhaustive-deps` as a warning first. **S**

**Q4. Waits in the e2e.**
- **Evidence (Measured)**: 27 `waitForTimeout` calls in 15 specs. Most deliberately wait for
  "nothing happens". These race on time:
  - `large-graph.spec.ts:126,174`
  - `pan.spec.ts:36`
  - `edges.spec.ts:126,147`
  - `workspaces.spec.ts:1197,1200`
- **Fix**: poll, as `projects.spec.ts`'s `settledBox()` does. **S**

**Q5. Risky modules with no tests of their own.**
- **Evidence (Code)**:
  - `merge-queue.ts`: the lock and the cross-process queue.
  - `programs.ts`: `runShell`'s timeout.
  - `core/src/git/merging.ts`: none of its 9 functions is named in a test.
  - `workspace-codex.ts`, `workspace-hermes.ts`.
- **Fix**: S each, written as failing tests for S2, S3 and C1 first.

### Findings: docs that disagree with the code

- S5 and S6 (CLI help), N5 (nexus Enter), R2 (addresses).
- **The `v` key**: it marks a forge change's file as viewed (`viewer/src/diff/App.tsx:239`) and
  is missing from `commands.md`'s keys table.
- **The style skill's numbers**: `.claude/skills/symbiote-style/SKILL.md:43` says a card's head
  is 37 px, and its table (`:113`) says "16 px margins and gutters, 16 px insets, 48 px card
  heads". `ui/base.css` has 12, 8, 12 and 40 (V85, V93).
- **Environment variables read but not documented** in `configuration.md`:
  - `GITHUB_ENTERPRISE_TOKEN` (`forge/src/github.ts:181`)
  - `SYMBIOTE_APP=<command>`; only `off` is described
  - `SYMBIOTE_VIEWER_DIR`, which is for tests and may stay out
- **Packages' `CLAUDE.md` files**:
  - core's does not mention its `git/` modules for the Git page or its record types (~3,700
    and ~2,000 of its ~13,400 lines, by the core review's count).
  - plugin-angular's and plugin-qwik's leave out `src/styles.ts` and their style fixtures.

### From the code reviews, not checked by me

Each needs a failing test first:
- **`merges.json` loses updates across processes**: `symbiote merge` and `symbiote view` both
  read, modify and rename it (`merge-queue.ts:22-33`).
- **`symbiote/config.json` is written in place**, not renamed into place (`prompts.ts:1040`).
- **A late throw after headers are sent can end `symbiote view`**: `server.ts:474-477`.
- **One `null` record ends a hook's thread lookup**: `thread.ts:183`.
- **A stash can go stale between its SHA and its index**: `core/src/git/stash.ts:40-105`.
- **The Angular version is read from the installed package for both sides of a diff**:
  `plugin-angular/src/index.ts:238-251`.
- **`commitResolution` stages with glob pathspecs**: `core/src/git/merging.ts:229`. Qwik's
  `[id]` routes would match other paths.
- **The nexus**:
  - A failed home scan polls twice a second forever (`scan.ts:201`, `page/main.ts:1196`).
  - Each folder listing probes every running Symbiote (`main.ts:147`).
  - Stop could signal a reused pid (`start.ts:55-65`).
- **The desktop window**:
  - No `setPermissionRequestHandler`.
  - `symbiote:start:forget` skips its sender check (`desktop/src/main.ts:488`).
  - The start page waits forever on a server that never prints its line (`launcher.ts:56-83`).
- **Dead code**:
  - `WorkspaceFacts.tsx`'s `WorkspaceState`, `KindTag`, `StateDot`, `StateAge` and `StateFor`.
  - `EffortIcon`.
  - About 10 CSS classes with no user, such as `.merge-chip` and `.branch-pick`.
  - About 170 exports used only in their own file.
- **Duplication**:
  - The terminal's palette is hard-coded in 5 files, in two greys: `#e6e9ef` and `#e3e6ec`.
  - Three hand-written pid locks.
  - Five copies of git's message stripper.

### Top 10

Ranked by value for the work; each could be one fix, chore or milestone.

| # | What | Findings | Size | Kind |
|---|---|---|---|---|
| 1 | Make CI green again: the test's git identity, lint's heap | R1 | S | fix |
| 2 | Fix the repository's address in the README, the Action and the GitLab template (or rename the repository) | R2, R5 | S | chore |
| 3 | A per-run secret for writes to `symbiote view` and the nexus; the Confirm and the Nucleus identity only through it | S1, N4 | M | milestone |
| 4 | Error and loading states: an error boundary, a graph shape check, one read hook with an error state, "not saved" marks, the API-failing page | V1, V2, V4, V5 | M | milestone |
| 5 | Tests stop leaking into the person's cache; prune orphaned slots | R3 | S + M | fix |
| 6 | The merger's check in a process group, timeouts on forge and push calls, one safe pid lock | S2, S3, S4 | S | fix |
| 7 | A failed merge logs its reason | S7 | S | fix |
| 8 | Core correctness: paths with a space, flow-style pnpm workspaces, code-point sorting | C1, C2, C3 | S | fix |
| 9 | Clean console and small look fixes: `/api/graph` 404, HEAD 405, History's indent, the review hint, the nexus theme, CLI help texts, the `v` key and the style skill's numbers | V3, N2, V9, V8, N1, S5, S6, docs | S | chore |
| 10 | Layout at small sizes and on big maps: the Overview at 1024 px, project names over files on the map | V6, V7 | M | milestone |

Next after these: electron ≥ 44.9.1 and the patch bumps (R4), the macOS install (I1), MCP
annotations (S8), and the fast-forward flake (S9).
