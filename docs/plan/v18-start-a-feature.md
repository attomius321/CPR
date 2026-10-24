# V18 — Start a feature: a branch, a worktree and an agent, from the commits page

[Index](../PLAN.md) · [Journal](../journal/v18-start-a-feature.md)

**Status:** merged into main (2026-10-15, from branch `milestone/v18-start-a-feature`): V18a,
V18b and V18c, all of V18 (V18d–e became V20, asked: "Rename V18d and V18e into V20"). As built
and results: "As built — V18a", "— V18b" and "— V18c" below.

**Problem** (asked: "Let's continue with our agentic flow...from the commits view page, i would
like to "Start a new feature" feature"; then, choosing among options: Symbiote starts the agent; the
agent works in its own worktree; "plan first" is chosen per feature; and "Do not look at how this
repo is worked on": the design is for any repository). Since V15–V17 Symbiote is where a person
reviews an agent's branch and records a verdict the agent acts on. The loop's first step is not
in Symbiote: the commits page checks out and reviews, but starts nothing. Starting a feature with an
agent by hand, measured on the regression clones (ky, zod, vite, Qwik, Bitwarden, CPython) and
with Claude Code 2.1.296:

| Step | Measured |
|---|---|
| A branch and its worktree at a chosen commit (`git worktree add`, warm, 3 runs) | ky 12–20 ms (115 files, 1.7 MB); zod 66–85 ms (742, 17 MB); vite 165–178 ms (2,866, 30 MB); Qwik 315–402 ms (4,806, 56 MB); CPython 453–463 ms (6,545, 150 MB; 10.4 s cold); Bitwarden 644–854 ms (9,282, 173 MB) |
| Claude Code's own worktrees (`--worktree`, and background sessions isolating themselves) | Branch `worktree-<name>` from the remote default branch (`worktree.baseRef: "fresh"`), not from a picked commit; the folder is `.claude/worktrees/<name>` inside the checkout |
| A worktree inside the checkout | `.claude/worktrees/` is ignored by **0 of 6** clones: it shows in `git status`, and `git add -A` there picks it up. zod's root `tsconfig.json` includes `**/*.ts`, so a nested copy is type-checked with the project. In this repository a root `prettier --check .` fails on **58 files** of a nested copy (exit 1) |
| Starting Claude Code in the background (`claude --bg --name …`) from a script | Refused in **3 of 3** folders tried (this repository's checkout, a worktree of it, a new repository's worktree), exit 1 in 0.7 s: "Workspace not trusted. Run `claude` in … once and accept the trust prompt". Trust is keyed on the main checkout's root (documented); only an interactive `claude` can accept it |
| Claude Code headless (`claude -p`) in a worktree made with `git worktree add -b` | Edits and the commit landed on the feature branch in that worktree; the main checkout's branch and status unchanged (Claude Code skips its own isolation in a linked worktree, as documented); `--session-id` honoured; a one-file task: 8.5 s, $0.006 (Haiku) |
| Which agent works on which branch | `claude agents --json --all`: background sessions with `cwd`, `name`, `state` (`working`, `blocked`, `done`, `failed`, `stopped`) and `waitingFor`, in **153–158 ms**; nothing names a branch; `-p` runs are not listed. The commits page shows none of it |

Causes:
- The commits page only reads, checks out and reviews; starting work is a terminal's job, with
  commands that differ per agent and a trust step a script cannot take.
- Agent tools that make worktrees choose the base and the branch name themselves, and put the
  worktree inside the checkout, where the project's own tools and `git add -A` find it.
- A background agent's only link to a branch is the folder it runs in.

**Goal**: "Start a feature" on the commits page (a header button, `n`, and "Start a feature
here" in a row's menu). The person writes what to build; Symbiote proposes a branch name, creates the
branch at the chosen commit (the default branch's tip unless a row was picked) with its own
worktree **outside** the checkout, records the brief in `symbiote/features/`, and starts the agent
there in the background: Claude Code by default, a command from `symbiote/config.json` otherwise. The
branch then shows its agent's state on its badge and in the branches panel — working, needs you,
plan ready, ready for review, failed — with ways to talk to it. "Plan first and wait for my OK"
is a checkbox, on by default. Once the branch has commits, reviewing, the verdict and the merge
are V15–V17's, plus the worktree rules below. Symbiote never grants Claude Code's trust, never passes
a permission mode the person did not pick, never removes a worktree that holds work, and merges
nothing (decision 82). Without a feature started, nothing changes: the commits page, reviews,
`symbiote diff` and `symbiote pr`.

## A feature (core, CLI)

- **The record**: `symbiote/features/<branch>.json` (the branch's slashes as folders, as reviews are
  kept), keys sorted, `about` first, the same bytes for the same feature:

  ```json
  {
    "about": "A feature started in Symbiote. Agents: read symbiote/AGENTS.md before acting on it.",
    "agent": { "kind": "claude", "permissionMode": "auto", "session": "<uuid>", "started": "…" },
    "base": "<full SHA>",
    "branch": "feature/export-review-as-csv",
    "brief": "Export a branch review as CSV: …",
    "by": "anton@example.com",
    "created": "2026-10-15T09:00:00Z",
    "from": "main",
    "planFirst": true,
    "worktree": "/home/anton/projects/app.worktrees/feature-export-review-as-csv"
  }
  ```

  One file per feature, not per person: a branch is one feature. Kept where `reviewPlace` keeps
  reviews (`symbiote/`, else Symbiote's cache, with the same note). `symbiote/.gitignore` already hides it.
- **One `symbiote/` per repository**: the main worktree's (the parent of `git rev-parse
  --path-format=absolute --git-common-dir`), not the working tree `symbiote view` runs in. Today each
  worktree has its own `symbiote/` (V15's risk table), so a `symbiote view` opened in a feature's worktree
  would split its reviews from the main checkout's. This changes `reviewPlace` for people who run
  `symbiote view` in a linked worktree; nothing changes in a single checkout.
- **Branch name**: proposed from the brief's first line — lowercase words joined by `-`, at most
  5 words and 40 characters, prefixed `feature/` (`features.branchPrefix` in `symbiote/config.json`);
  `-2`, `-3` when taken locally or on a remote. Editable. Checked with `git check-ref-format
  --branch`; refused when it starts with `-` or exists locally or on a remote.
- **Base**: the default branch's tip — of the local and remote default-branch refs (V10c's
  `defaultBranchTips`), the one that contains the other; the local one when they diverged — or the
  picked row's commit (full SHA, `isCommit`).
- **The worktree**: `git worktree add -b <branch> <folder> <base>` (one command makes both;
  never `-B` or `--force`). The folder is beside the checkout,
  `../<checkout folder>.worktrees/<branch, slashes as ->`, configurable as
  `features.worktrees` in `symbiote/config.json` (`{repo}` stands for the checkout's folder name);
  refused if it exists. Not inside the checkout (the table above); not in Symbiote's cache, which holds
  throwaway worktrees (decision 5) and is cleared, while a feature's worktree holds work.
- **`.worktreeinclude`** (Claude Code's file, `.gitignore` syntax): Symbiote copies the git-ignored
  files it names (`.env`…) into the new worktree, as Claude Code does for the worktrees it makes;
  tracked files never.
- Core, `src/git/worktrees.ts`: `addWorktree`, `listWorktrees` (`git worktree list --porcelain`:
  folder, HEAD, branch, locked, prunable; 2–3 ms), `removeWorktree` (never `--force`: git refuses
  a worktree with changes or untracked files, and says so), `deleteMergedBranch` (`git branch -d`
  only), `mainWorktree`. `listRefs` gains each local branch's `worktree`
  (`%(worktreepath)`), so V11's menu can say "checked out in ../app.worktrees/x" instead of
  offering a checkout git refuses.

## Starting the agent (CLI)

- **Which agent**: picked per feature in the dialog among those installed (on the PATH, found as
  V12 finds `code`); the default is `agent` in `symbiote/config.json`, else Claude Code, else Codex:
  - `"claude"`: Claude Code; optional `permissionMode` and `model`;
  - `"codex"`: Codex (V20a); optional `sandbox`, `approveForMe` and `model`;
  - `{ "command": ["my-agent", "{prompt}"] }`: any other command, run detached in the worktree
    with `{prompt}` replaced, its output in a log file in Symbiote's cache (V20a);
  - none found: the feature is still made, and "Copy for the agent" gives its prompt, as after a
    verdict.

  The record's `agent.kind` says which one a feature runs, so "Send to the agent" and "Talk to
  the agent" use the same one later; switching agents is a new feature or a new start.
- **Claude Code**: `claude --bg --name <branch> --add-dir <main worktree>/symbiote
  [--permission-mode <mode>] [--model <model>] "<prompt>"`, run with `execFile` (no shell) in
  the worktree. The `--bg` text it prints is not parsed (not a stable format): the session is the
  one `claude agents --json --all` lists with that worktree as `cwd` (a real path; unique per
  feature). `--add-dir` lets it read its brief and, later, its reviews; Claude Code's worktree
  isolation refuses its edits in the main checkout (documented), and AGENTS.md says not to.
- **Codex** (0.162 here; V20a): `codex exec --json -C <worktree> -s workspace-write
  [--approve-for-me] [-m <model>] "<prompt>"`, started detached by Symbiote (Codex has no background
  supervisor like `claude --bg`), its JSONL events in a log in Symbiote's cache, its process ID in the
  record. State from the process and the last event: running → working; ended after a completed
  turn → plan ready or ready for review, as for Claude Code; a failed turn or a non-zero exit →
  failed. No "needs you": `exec` never stops to ask; a command its sandbox refuses fails, or with
  `--approve-for-me` is reviewed automatically. Reply and "Send to the agent": `codex exec resume
  <thread id> "<text>"` (the ID from the log's first event), appended to the same log; "Talk to
  the agent" copies `codex resume <thread id>`, which continues it in a terminal. Never
  `--dangerously-bypass-approvals-and-sandbox`, never `--worktree` (Symbiote made it). Not
  `--add-dir`: in Codex it makes a folder *writable*, and `symbiote/` is the person's; the prompt names
  the brief and reviews by absolute path (reading them in its sandbox is checked first). Codex
  reads `AGENTS.md` from the repository's root down to its folder, not `symbiote/AGENTS.md`: the
  prompt names it. Its account is its own login (`codex login`: a ChatGPT plan or an API key).
- **Failures keep the feature**: the branch, worktree and record stay; the feature reads "agent
  not started" with Claude Code's own words and a way out, and "Start the agent" retries:
  - "Workspace not trusted" → "Run `claude` in <main worktree> once and accept the trust prompt,
    then start the agent." Symbiote never writes `~/.claude.json` (the trust is the person's to give);
  - not installed, not logged in (`claude auth status` exits 1), or any other exit: its message.
- **The prompt** (`featurePrompt` in `packages/cli/src/features.ts`): the brief; the branch, its
  base and the default branch; with "plan first": "write a plan — what you will change and how
  you will check it — then stop and wait for the person's OK before changing anything"; else
  "plan, build and check it as the project's own instructions say"; commit on this branch as you
  go, push only if the project does; say when it is ready for review in Symbiote; where the brief and
  reviews are (absolute paths) and that `symbiote/AGENTS.md` says how to act on a review. The brief is
  at most 20,000 characters (Windows' command line holds 32,767).
- **Whose account**: the agent is the person's own `claude`, logged in as they are: a Claude
  subscription (here `authMethod: claude.ai`, `subscriptionType: pro`) or an API key. Symbiote never
  handles credentials and never passes `--bare` (it takes an API key only). The dialog says which,
  from `claude auth status` ("Claude Code · your Pro subscription"), and warns when
  `ANTHROPIC_API_KEY` is set in `symbiote view`'s environment, where the agent may use it instead.
  A subscription's plan is its profile's, as the status bar reads it (V29c: `oauthAccount`'s
  `organizationType` in `.claude.json`), else `subscriptionType`: that one is its token's, kept
  from login, and said Pro after an upgrade to Max (Fix, 2026-10-24).
  Agents share the subscription's usage limits with the person's other sessions; one that hits
  them stops and is resumed later.
- **Permission mode**: Claude Code's own default unless the person picks "Accept edits" or "Auto"
  in the dialog (default from `agent.permissionMode`). Symbiote never passes `bypassPermissions` or
  `--dangerously-skip-permissions`; a person who wants that configures it in Claude Code.

## Agent state (CLI, server)

- `GET /api/features` → `{ features: [...] }`, each `{ branch, base, created, planFirst,
  worktree: { path, exists }, ahead, merged, agent: { kind, state, waitingFor?, id?, error? } }`;
  `ahead` counts the branch's commits since its base, `merged` is V17's check against the default
  branch.
- Claude Code: one `claude agents --json --all` per answer, kept 2 s (153–158 ms each); matched by
  real path. States: `working` → working; `blocked` → needs you (with `waitingFor`: "a permission
  prompt", "input needed"…); `done` → plan ready (plan first, no commits), else ready for review
  (commits), else done; `failed`, `stopped`; no session → not running.
- Asked on load, on focus (as `/api/status` is), and every 5 s while the page is visible and an
  agent is working or needs the person. No feature: no call to `claude` at all.
- `POST /api/features` `{ brief, branch, base?, planFirst, permissionMode? }` → `{ feature }` or
  400 (name, base, brief too long) / 409 (taken, folder exists); `POST
  /api/features/<branch>/start|stop|clean`. Writes as every write: same-origin JSON with the
  custom header, one at a time. The request never names a folder or a command: Symbiote computes the
  folder and reads the command from `symbiote/config.json`.

## The commits page (viewer)

- **Start**: "Start a feature" in the header (left of Compare mode) and `n`; "Start a feature
  here" in a row's menu (the base is that row). The dialog (`StartFeatureDialog.tsx`): "What
  should the agent build?" (a text area, required); the branch name, proposed as the brief's
  first line is typed and checked as it changes; "From main at a1b2c3d" (or the row's commit);
  "Plan first and wait for my OK" (checked); the agent (Claude Code or Codex, those installed) and
  its permission mode ("Claude Code · permission: default ▾", or the configured command, shown in
  full); the worktree's folder. Ctrl+Enter starts, Escape cancels.
- **After Start** (the history's version changed: a new branch): the page lists anew, the cursor
  on the new branch's row, and a line: "Started feature/export-review-as-csv: Claude Code is
  working in ../app.worktrees/feature-export-review-as-csv".
- **Badges** (V18b): a feature's branch badge gains an agent chip before its name, next to V16's
  review chips after it: working, needs you (its `waitingFor` in the title), plan ready, ready for
  review, failed or not started. Shapes as well as colours, as V16's fix made review chips
  readable. The chip is the link to the feature (below); the branches panel draws the same chip.
- No "Features" section in the branches panel (asked: "should we create a different view for
  features?"): a feature carries more than its 260 px hold (V10b: about 35 characters), and
  in a repository with 1,591 remote branches it would be buried among them. Features have their
  own view.

## The features view (V18b)

- `/features`, beside the commits page: a tab bar on both pages, "Commits · Features (2)", the
  count being the features that need the person. The server serves the viewer there as at `/`;
  the page reads `/api/features`, on load, on focus, and every 5 s while an agent works or waits.
- One row per open feature, grouped by what it needs from the person, not by stage:
  - **Needs you**: plan ready, waiting (a permission prompt, an answer: Claude Code's
    `waitingFor`), ready for review, changes requested and fixed ("+n" since the verdict), failed
    or not started (Claude Code's words);
  - **Working**: working, with its commits since the start and its uncommitted files;
  - **Done**: approved and merged into the default branch, until cleaned up.
- A row: the agent's chip; the branch (a link, below); the brief's first line (the whole brief on
  a click); the agent's state in words ("Waiting for a permission prompt · 12 min"); commits since
  the start; "3 files not committed yet"; the review's mark (V16: "✓", "✗", "+2"); whether it
  merges cleanly (V17's check, in the background, as the Review tab does).
- Its actions as buttons on the row, what the state allows: Review (V15, once it has commits),
  Talk (copies `claude attach <id>`: it needs a terminal), Open in VS Code (the worktree's
  folder), Start / Stop the agent, Copy the prompt; Reply, Send the verdict and Clean up (V18c).
- "Start a feature" (and `n`) in its header too; after a start the new feature's row is shown
  and flashed.

## Feature and branch: each leads to the other

- **One key**: a feature is its branch. The record is `symbiote/features/<branch>.json`, and both
  pages map a branch name to its feature as reviews do: the local branch and its remote ones
  (`feature/x` and, once pushed, `origin/feature/x`) are one.
- **From the feature to the branch**: the branch name on its row goes to the commits page at the
  branch's tip, `/?branch=<name>` (a new parameter: V10b's "go to a tip" — the cursor there,
  flashed; under "This branch", every branch first). Review opens `/review/<branch>/`.
- **From the branch to the feature**: the agent chip on the branch's badge (rows and branches
  panel) goes to `/features?branch=<name>`, the feature's row scrolled to and flashed; the tip
  row's menu gains "Open its feature"; the review page's header (V15: "Review of wip · …") names
  the brief's first line as a link to the feature.
- Both addresses can be reloaded or bookmarked, as diffs and reviews can.
- **When the link breaks**: a branch deleted or renamed outside Symbiote leaves its feature saying
  "its branch is gone" (no commits link, no chip anywhere); a new branch of a cleaned-up
  feature's name gets no chip (only open features have one). Following a rename: later.

## One `symbiote view` for every worktree

- Worktrees share the repository's refs and objects: the commits page lists every feature's
  branch and commits, and a review compares commits in Symbiote's cached worktrees, never a working
  tree. So one `symbiote view`, in the main checkout, covers every feature; opened in a feature's
  worktree it shows the same page and the same `symbiote/` (decision 103).
- **Uncommitted work** is not in any commit, so no page shows it. The prompt says to commit as it
  goes; `/api/features` adds `worktree.changed` (V11's `workingState` run in the worktree, 3–10
  ms), shown on the feature: "3 files not committed yet".
- **New commits while the page is in view**: the page lists anew on focus only (V11). While an
  agent works, `/api/features` (every 5 s) carries each feature's tip; a tip that moved lists the
  history anew, so the agent's commits appear without leaving the page.
- **Open in VS Code** (V12) opens the repository's root and maps a line to its working copy
  (`editor.ts`): for a branch checked out in a feature's worktree that is the wrong copy. On a
  review of such a branch, it opens that worktree's folder and maps the line there; V17's
  conflicting files the same.

## Talking to the agent (V18c)

**Problem** (asked: "we move one abstraction up from Claude Code … it will not be anymore a
simple chat with one input"; then "Should we start simple, with only one chatbox, and we'll go
further then?", the box beside the list). Today a feature's agent is talked to only in its
session (`claude attach`, copied by Talk). Measured in the V18c spike (journal, 2026-10-15) with
a real `claude --bg` (2.1.296, its sessions on 2.1.300), Haiku and a Pro subscription:

| What V18a–b and this plan had | Measured |
|---|---|
| Reply by `claude --bg --resume <session> "<text>"` | On a live session (idle after its turn) it starts a **copy** under a new ID, without the original's `--settings`; any flag on a resume makes a copy too ("keeps its own saved options"). `claude stop` (0.66 s), then a resume with no flag (0.73 s), continues the same session with its saved permission mode, settings and model |
| What the agent said is only in its session | A `Stop` hook gets `last_assistant_message`: the whole plan or report, Markdown; no transcript to read |
| Questions and permission prompts are answered by attaching | Hooks passed with `--settings` run in background sessions. A question (`PreToolUse` on `AskUserQuestion`) and a permission (`PermissionRequest`, with an `Edit`'s old and new text or the Bash command) arrive whole and were answered from outside; when the first hook timed out, the question came again through `PermissionRequest` |
| "Plan ready" is `done` with no commits | A finished plan read `blocked` with no `waitingFor`: V18b shows "Waiting: for you". After a commit: `done` |
| (cost of a hook) | A Node script using only Node's modules: 20–34 ms per event; through Symbiote's CLI, which loads the engine: 286 ms |
| (hooks added later) | A session's options are fixed at its first start: one started without Symbiote's hooks never gets them |

**Goal**: the features view becomes a list and a panel. Picking a feature shows beside the list
its head (branch, state, facts and V18b's actions), its thread — the agent's reports and the
person's messages, newest last — and one reply box; Send continues the same session with the
text. After a verdict, "Send the verdict" fills the box with the verdict's text (what "Copy for
the agent" copies). Every feature started from V18c on gets Symbiote's hooks at its first start; in
V18c they only record and decide nothing: what an agent waits on is shown in the panel, and is
answered there in V20b. Features started before V18c keep V18b's behaviour, plus the box; a
repository with no feature makes no call to `claude`, as before.

### The hooks (CLI)

- **One script, `packages/cli/dist/agent-hook.js`**, Node's modules only (no `@symbiote/core`: 286 ms
  against 20–34 ms per event). It reads the event on stdin, finds the feature whose worktree holds
  the event's `cwd` (real paths, the records in `symbiote/features/`), and appends one line to that
  feature's thread; what it cannot read or place it leaves alone. It exits 0 and prints nothing:
  it never decides, so Claude Code goes on as without it (its own dialogs, its permission mode).
- **Registered at the first start**: `claude --bg … --settings <symbiote>/claude-settings.json`. The
  file is Symbiote's, the same for every feature, written by `prepareSymbioteFolder` and rewritten when its
  text changes (as `AGENTS.md` is): `SessionStart`, `UserPromptSubmit`, `PermissionRequest`,
  `PreToolUse` (matcher `AskUserQuestion`), `Notification`, `Stop` and `SessionEnd`, each running
  `"<node>" "<agent-hook.js>" "<symbiote folder>"` (absolute paths; `process.execPath`). A file, not
  inline JSON: a waking session reads it again (measured), so a new install path reaches older
  sessions when `symbiote view` rewrites it. It must be there when a session wakes: without it Claude
  Code stops before starting ("Settings file not found", the session `failed`; with the file
  back, a resume continues it). `symbiote view` writes it when it starts and before every start or
  reply. The person's own hooks and the repository's run beside it (measured). Every event is
  registered now so that V20b changes only what Symbiote answers, for every feature started since
  V18c.
- **The thread**: `symbiote/threads/<branch>.jsonl` (the branch's slashes as folders, as features and
  reviews are kept; `symbiote/.gitignore` hides it), one JSON line per entry, `{ at, session, kind, … }`:
  - `start` (`SessionStart`: `startup`, `resume`, `fork`) and `end` (`SessionEnd`);
  - `prompt` (`UserPromptSubmit`): what the agent was given — first Symbiote's prompt, then the
    person's messages;
  - `report` (`Stop`): `last_assistant_message`;
  - `asks` (`PermissionRequest`, and `PreToolUse` on `AskUserQuestion`): the tool and its input,
    at most 4 KB (an `Edit` can carry a whole file), or the questions with their options; a
    question that reaches both hooks (the spike: `PreToolUse`, then `PermissionRequest` when
    nothing answered it) is one entry;
  - `notice` (`Notification`): its type (`permission_prompt`, `idle_prompt`) and message.

  In `symbiote/`, not Symbiote's cache: the cache is cleared (decision 5), and a thread is the feature's
  history. Not the transcript: tool calls and their output stay in the session (`claude attach`).

### Reply (CLI, server)

- `POST /api/features/reply` `{ branch, text }` (same-origin JSON with the custom header, as every
  write; at most 20,000 characters, as a brief). The feature's newest session (V18b's choice, by
  folder): if its process lives (`status` is `busy`, `waiting` or `idle`), `claude stop <id>`
  first; then `claude --bg --resume <sessionId> "<text>"` in the worktree **with no other flag**.
  Answers `{ feature }`; 409 when there is no session to continue (removed: "Start the agent"
  instead), else Claude Code's words when it fails. The text reaches the thread through
  `UserPromptSubmit`: Symbiote does not write the person's messages itself, so the thread shows what
  the agent got.
- **A copy anyway**: if after the resume the folder's newest session is not the one resumed, the
  answer says so ("Claude Code started a copy: …"); the page shows the newest, as V18b does.
- **While the agent works or waits on a prompt**, sending stops its turn and drops what it waits
  on: the box says so, and Send becomes "Stop and send", confirmed once.
- `GET /api/features/thread?branch=<name>` → `{ entries }`, the last 200; read when a feature is
  picked and with the list's reads (on focus, every 5 s while an agent works or waits).
- `ClaudeCode` gains `resume(sessionId, cwd, text)`; `start` passes `--settings`.
- **States**: a finished turn is "plan ready", "ready for review" or "done" (V18b's rule by
  commits) when Claude Code says `done`, or `blocked` with no `waitingFor` and the thread's last
  `report` comes after its last `prompt` (measured: a finished plan reads `blocked`). With no
  thread (a feature started before V18c), `blocked` stays "Waiting: for you".

### The features view: list and panel (viewer)

- Two columns: V18b's groups on the left, each row its chip, branch, the brief's first line and
  its next step in words; the picked feature on the right. `?branch=<name>` (V18b's address)
  becomes the selection: picking writes it with `replaceState`, so reloads and links land there;
  with none, the first feature that needs the person.
- **The panel**: the head (the branch as a link, the review mark, state and facts, and V18b's
  actions — Review, Talk, Open in VS Code, Stop / Start the agent, Copy the prompt — moved from
  the row); the brief, collapsed; the thread — "Agent" reports and "You" messages with their
  times, the first prompt as "Symbiote's prompt" (collapsed), `asks` as a line ("Waiting: permission to
  run `git commit …`", "Asks: Should farewell end with !? — Yes, end with ! · No punctuation")
  with Talk to answer it (V20b answers it here), a later start as a thin line ("continued", "copy
  started"); then the box, "Reply to the agent…", Send (Ctrl+Enter).
- Messages are shown as written (Markdown as text, `white-space: pre-wrap`): no Markdown library
  in V18c (a new runtime dependency needs a reason, and plans read as text). Since 2026-10-18 the
  agent's reports are drawn as Markdown (decision 118); the person's messages and Symbiote's prompt
  are still shown as written.
- **Send the verdict**: when the branch's review has a verdict newer than the last `prompt`, the
  panel offers it: it fills the box with `verdictText` (V16's text, the one "Copy for the agent"
  copies), to edit and send. The Review tab's note (V16–V17) gains "Send to the agent", which
  opens the feature's panel with the box filled. Nothing is sent without Send (decision 82).
- A feature started before V18c: "Symbiote keeps an agent's messages from V18c on: Talk shows this
  one's." The box still works: a resume needs no hook.
- **Width**: from 1100 px both columns (the list 360 px); narrower, the panel takes the page and
  "← Features" goes back. Checked at 1440 and 900 px, light and dark.

### Verification (V18c)

1. **Unit** (red first): the hook script on the spike's recorded inputs — each event to its line,
   a `cwd` in a subfolder of the worktree, no feature for the folder (nothing written), input that
   is not JSON (exit 0, nothing written), `asks` cut at 4 KB; `claude-settings.json`'s bytes and
   the rewrite when the path changes; `start` passes `--settings`; reply — stop then resume when
   the process lives, resume only when it does not, no other flag, 409 with no session, a copy
   reported; the states (`blocked` with a `report` after the last `prompt`: plan ready; with no
   thread: waiting); the thread's last 200 entries, a broken line skipped.
2. **E2E** (red first), the fake `claude` running the hook command from the `--settings` it is
   given, as Claude Code does (`SessionStart`, `UserPromptSubmit`, `Stop` with a plan): the panel
   shows the plan and "Plan ready"; Send — the fake records `stop`, then `--bg --resume <id>
   "<text>"` and no other flag, and its `UserPromptSubmit` puts "You: …" in the thread; while it
   works, "Stop and send" asks first; a verdict — "Send the verdict" fills the box; the Review
   tab's "Send to the agent" opens the panel filled; `?branch=` reloaded lands on the same panel;
   at 900 px the panel alone with "← Features"; a feature started before V18c — the note, and Send
   still resumes. Every existing spec passes (V18b's row actions are in the panel now; their specs
   follow them there).
3. **A real agent** once, as in the spike (a throwaway repository the person trusts): plan first —
   the plan in the panel, "Plan ready"; a reply — it builds and commits, "Ready for review";
   Request changes, "Send the verdict" — a fix, "+1".
4. **Cost**: the hook 20–34 ms per event; `/api/features` as V18b's (threads are read only by
   `/api/features/thread`, ≤ 20 ms for 200 entries); first rows on the commits page as `main`'s.

**Risks (V18c)**

| Risk | Mitigation |
|---|---|
| A resume with a flag, or on a live session, makes a copy without the hooks | Reply stops a live session first and resumes with no flag; a copy is noticed and said. |
| Symbiote's install path changes (an update, `npx`) and older sessions' hook command breaks | `symbiote view` rewrites the settings file with today's path (whether a waking session reads it again is checked first); a failing hook is a non-blocking error in Claude Code: the session goes on and the thread misses those entries. |
| The thread holds what the agent saw (prompts, commands, excerpts of files) | In `symbiote/`, git-ignored, on this machine, as reviews are; `asks` capped at 4 KB. |
| Sending to a working agent loses its turn | "Stop and send", confirmed. |
| Claude Code's hook inputs change | Only documented fields are read (`hook_event_name`, `session_id`, `cwd`, `source`, `prompt`, `last_assistant_message`, `tool_name`, `tool_input`, `notification_type`, `message`); the rest is ignored; the fake replays the spike's inputs. |
| The settings file is deleted (`symbiote/` removed by hand) | A session woken from agent view or `claude attach` then fails with Claude Code's "Settings file not found"; `symbiote view` writes the file back when it starts and before each start or reply, and a resume then continues the session (measured). |

**Order (V18c)**: the two checks it needed first are done (journal, V18c spike, second run: the
person's and the repository's hooks run beside Symbiote's file; a waking session reads the file
again, and fails without it). Then the hook script and the settings file, the thread and the states,
reply, the panel, Send the verdict; then Clean up and AGENTS.md (below).

## Reviews and merges from a worktree (AGENTS.md)

- The feature's agent finds its reviews in the shared `symbiote/` (given by `--add-dir`; the prompt
  names the folder), and V17's rules apply.
- Approve says "merge `head` into `into`": from the feature's worktree that fails when `into` is
  checked out in the main checkout ("already used by worktree"), and Claude Code's isolation
  refuses git in the main checkout anyway. `symbiote/AGENTS.md` gains: "In a linked worktree, when
  `into` is checked out in another worktree (`git worktree list`), do not merge here: say that
  the approved commit is merged from that worktree." The person asks the agent there (or merges);
  Symbiote still merges nothing.
- A "Features" part of `AGENTS.md`: what a feature record is, plan first means stop after the
  plan, never edit `symbiote/`.

## Finishing a feature

- Once merged into the default branch, "Clean up": `claude rm <id>` for each session of its
  worktree (measured in the V18c spike: it removes the sessions and leaves a worktree Symbiote made),
  `git worktree remove` (git refuses while anything is uncommitted or untracked, and the page
  shows its message), `git branch -d <branch>`. The record and its thread stay, the record with
  `finished`; the view lists open features only.
- Not merged: "Stop the agent"; "Clean up" then needs a confirmation and removes the worktree
  only (git refuses it with changes); the branch and its commits stay.

## Verification

1. **Unit** (red first): core on temporary repositories — `addWorktree` (the branch at the base;
   refused: an existing branch or folder, an invalid name, a name starting with `-`),
   `listWorktrees`, `removeWorktree` (refused with changes and with untracked files),
   `deleteMergedBranch` (refused unmerged), `mainWorktree` from a linked worktree, `listRefs`'s
   `worktree`, `.worktreeinclude` (ignored files only). CLI — the name from a brief (words,
   prefix, `-2`, cap), the record's bytes (sorted, `about` first), the folder, the prompt (plan
   first or not, paths), the base rule (local/remote default branch ahead, behind, diverged);
   reviews and features in the main worktree's `symbiote/` when `symbiote view` runs in a linked one; the
   launcher with a fake `claude` on the PATH (records argv and cwd; prints `--bg`'s text; or
   fails with the trust message: "agent not started", then "Start the agent" retries); states
   from recorded `claude agents --json` answers (each state, `waitingFor`, symlinked paths, two
   sessions in one folder: the newest). Server: `POST /api/features` (another site refused, 400,
   409), `GET /api/features` (no features: `claude` never run), start, stop, clean.
2. **E2E** (red first), the fake `claude` on the PATH: Start from the header — the branch on the
   page with "working", the worktree on disk on that branch, the record, the fake's argv (`--bg`,
   `--name`, `--add-dir`, the brief in the prompt, cwd the worktree); the fake turns `blocked` —
   "needs you"; it commits and reports `done` — "ready for review", and Review (V15) opens it;
   plan first with no commits — "plan ready"; the trust failure — the message, retry; "Start a
   feature here" on a row — that base; merged — Clean up removes the worktree; a dirty worktree —
   git's refusal; V11's menu says where a feature's branch is checked out; a commit made in the
   worktree appears without leaving the page, and uncommitted files are counted; Open in VS Code on
   the feature's review asks for the worktree's folder and line. The features view (V18b): the
   groups as the fake's states change, the tab's count; a branch's chip opens its feature's row,
   the branch name on that row the commits page at its tip, and both addresses reloaded land in
   the same place; "Open its feature" from the tip's menu and the review page's header; a branch
   deleted in a terminal: "its branch is gone", no chip. Every existing spec passes.
3. **A real agent** (first, see Order): Claude Code in a temporary repository the person trusts
   once — plan first: the plan in the session, `done` with no commits, "plan ready"; a reply: it
   builds and commits in its worktree, "ready for review"; Request changes, "Send to the agent":
   a fix, "+1"; Approve: the feature's agent says to merge from the main checkout, which does.
   Codex the same way once (V20a): plan, reply by `exec resume`, a fix after Request changes.
4. **Real repositories**: on the six clones, a feature started at the default branch's tip — the
   time from Start to the page listing the branch, `git status` of the checkout unchanged;
   Bitwarden with three features: first rows against `main`'s build, `/api/features` time.
5. **Nothing else changes**: no analysis code (goldens); review, checkout and commits specs
   unchanged; a repository with no feature makes no `claude` call.
6. **Cost**: Start answers within the worktree's time (≤ 0.9 s on Bitwarden, warm) plus
   `claude --bg`'s return (measured in the first step); `/api/features` ≤ 200 ms with its 2 s
   cache; first rows as fast as `main`.

**Risks**

| Risk | Mitigation |
|---|---|
| Claude Code does not trust the repository (3 of 3 folders here) | Said with Claude Code's words and the command that fixes it; the feature stays and "Start the agent" retries; Symbiote never grants trust. |
| A background agent edits or runs commands unasked | Claude Code's permission mode decides: its default unless the person picked another; never bypassed by Symbiote. It works in its own worktree: the checkout is untouched. |
| Agents cost money and run long | Started only by a click; the dialog names the agent, its mode and the brief; "Stop the agent" in the features view. |
| Worktrees pile up (1.7–173 MB each, plus installs) | Listed in the features view; Clean up once merged. |
| A feature and its branch drift apart (deleted, renamed outside Symbiote) | Keyed by the branch name; the feature says its branch is gone; no chip on a branch that is not an open feature's. |
| A folder beside the checkout surprises, or cannot be written | The dialog shows it; configurable; git's error shown. |
| Losing work | Nothing forced: git refuses to remove a worktree with changes; a branch is deleted only merged (`-d`). |
| An agent merges from its worktree into a checked-out default branch | AGENTS.md says not to; git refuses the `switch`; Claude Code refuses git in the main checkout. |
| Claude Code's background sessions are new; their text may change | Only `claude agents --json` is read (documented for scripts); the fake follows its documented fields; the version is checked in the first step. |
| A committed `symbiote/config.json` names a command | Shown in full in the dialog before Start; the same file already loads plugins (code). |
| A person starts another session in a feature's worktree | The newest working session is shown; "2 sessions" in the title. |
| Symlinked paths (macOS `/private/tmp`, WSL `/mnt`) | Compared as real paths. |
| Reviews kept per worktree today | One `symbiote/` per repository, the main worktree's. |

**Order**: first a spike on a repository the person trusts once (`claude` run there by hand):
`--bg` with `--add-dir` and `--session-id`; the states from Start to `done` with plan first;
`--bg --resume` on a finished session and on one still running; the time `--bg` takes to return.
Then V18a (core and CLI, server, the dialog), V18b (the features view, chips, the links both
ways, polling), V18c (hooks, the thread, reply, send a verdict, the panel, AGENTS.md, clean up;
its own order above), on one branch. Codex and other commands with `.worktreeinclude` (was
V18d) and answers in Symbiote (was V18e) are V20.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V18a ✅ | Start a feature | `symbiote/features/`, one `symbiote/` per repository; branch and worktree outside the checkout; the agent started (`claude --bg`), failures kept with their reason; `/api/features` with states; the dialog (header, `n`, "Start a feature here"); the page lists the new branch. |
| V18b ✅ | The features view | `/features`: open features grouped by what they need (needs you, working, done), each with its state, commits, uncommitted files, review mark and merge check; Review, Talk (attach), Open in VS Code, Start/Stop, Copy the prompt; the tab bar with the count; agent chips on badges and in the branches panel; feature ↔ branch links (`/?branch=`, `/features?branch=`, "Open its feature", the review header); polling while an agent works, the history listed anew when a feature's tip moves; Open in VS Code in the feature's worktree; V11's menu names a branch's worktree. |
| V18c ✅ | Talk and finish | Symbiote's hooks at every first start (`--settings <symbiote>/claude-settings.json`, `agent-hook.js`), recording into `symbiote/threads/<branch>.jsonl` and deciding nothing; the features view as list and panel (`?branch=` the selection): the head and V18b's actions, the thread (reports, messages, what the agent waits on), one reply box (stop if live, resume with no flag), "Send the verdict" and the Review tab's "Send to the agent"; "plan ready" from a `blocked` session after its report; Clean up; AGENTS.md: features, merging from a worktree. |

Codex and other agents (V18d) and answers in Symbiote (V18e) moved to V20: V20a and V20b.

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 95 | Who starts the agent | **Symbiote, on the person's click, in the background: Claude Code (`claude --bg`) by default, Codex (`codex exec`, detached) or another command when picked or configured; without one, "Copy for the agent"** | Asked ("Symbiote starts it"). `--bg` sessions outlive `symbiote view`, can be attached to for questions and permission prompts, and report their state; a `claude -p` child cannot ask anything and is not listed. |
| 96 | Where the agent works | **A new worktree per feature, beside the checkout (`../<repo>.worktrees/<branch>`, configurable); never inside it, never in the cache** | Asked ("own worktree"). Inside: 0 of 6 clones ignore `.claude/worktrees/`, zod type-checks `**/*.ts`, a root Prettier check failed on 58 files. The cache is for throwaway worktrees and is cleared. |
| 97 | Branch and base | **Symbiote creates both (`git worktree add -b`): the default branch's tip or a picked row; the name proposed from the brief, `feature/` prefix, editable** | Claude Code's own worktrees branch from the remote default branch and name themselves `worktree-<name>`; the person picks where the feature starts. |
| 98 | What the agent is told | **The brief in the prompt, the plan-first instruction when ticked, and where its brief and reviews are (`--add-dir <repo>/symbiote`); the record in `symbiote/features/<branch>.json`** | The agent reads its brief without looking; reviews reach it in its worktree; the record outlives the session. |
| 99 | The agent's state | **From `claude agents --json --all`, by the worktree's folder; asked on load and focus, every 5 s while one works or waits** | The documented interface for scripts (153–158 ms); the folder is the only link to the branch; no polling when nothing runs. |
| 100 | Trust and permissions | **Symbiote never grants trust or bypasses permissions; trust failures shown with the fix; the agent restartable; the person picks the permission mode** | Measured: 3 of 3 folders refused; trust is the person's decision, and so is what an agent may do unasked. |
| 101 | Approve on a feature in a worktree | **Merged from the worktree that has the default branch (the main checkout), not the feature's; AGENTS.md says so; Symbiote still merges nothing** | `git switch main` fails in a linked worktree while the main checkout has it, and Claude Code refuses git in the main checkout; decision 82 stands. |
| 102 | Plan first | **Per feature, on by default: the agent plans and stops; "plan ready" is a finished session with no commits** | Asked ("your choice per feature"). |
| 103 | One `symbiote/` per repository | **The main worktree's, for reviews and features** | With features in worktrees, a `symbiote view` opened in one would otherwise keep its reviews apart. |
| 104 | Cleaning up | **Offered once merged; nothing forced; branches deleted with `-d` only; the record kept** | Worktrees hold uncommitted work; git's refusals protect it. |
| 105 | Where features are shown (refines V18b's plan) | **Their own view, `/features`, grouped by what each needs from the person; on the commits page only the agent chip on the branch's badge; no section in the branches panel** | Asked ("should we create a different view for features?"). A feature carries its brief, state, commits, uncommitted files, verdict, merge check and five or six actions; the panel holds about 35 characters, and its 1,591 remote branches on Bitwarden would bury them. |
| 106 | Feature and branch | **One key, the branch name; each leads to the other: the branch name on a feature goes to its tip (`/?branch=`), the chip on a branch and the tip's menu to its feature (`/features?branch=`), the review page names its feature** | Asked ("We still need a link between the feature and the branch"). The record is already keyed by the branch; addresses make both views bookmarkable. |
| 107 | How a reply reaches the agent (V18c) | **Stop the session if its process lives, then `claude --bg --resume <session> "<text>"` with no other flag** | Measured (V18c spike): a resume on a live session, or with any flag, starts a copy without the hooks; stop and resume continued the same session with its saved options in 1.4 s. |
| 108 | What Symbiote's hooks do (V18c) | **Registered for every event at each first start; they record into the thread and decide nothing** | A session's options are fixed at its first start, so the hooks must be there from the start; recording only keeps V18c to one box ("start simple, with only one chatbox"), and V20b answers through them for every feature started since. |
| 109 | Where a feature's conversation is shown (V18c) | **Beside the list in the features view: list and panel, `?branch=` the selection** | Asked, among beside the list, under the row, and a page of its own: the person answers one feature and goes to the next that needs them without leaving the page. |
| 110 | Where the thread is kept (V18c) | **`symbiote/threads/<branch>.jsonl`, written by the hook; the person's messages as the agent received them (`UserPromptSubmit`)** | Beside the record and reviews, git-ignored; not the cache, which is cleared; Claude Code's transcripts are not a documented interface. |
| 118 | Agents' reports in the thread (fix, 2026-10-18) | **Drawn as Markdown: `marked`'s lexer (GitHub's flavour, line breaks kept) reads a report, Symbiote turns its tokens into React elements; HTML shows as text, links only to `http(s):` and `mailto:`; `marked` in its own chunk, loaded when a thread is first shown; the person's messages and Symbiote's prompt as written** | Asked ("the output of agents is not rendered correctly, i see **Text**"). One of this repository's agents wrote 34 bold spans, 74 code spans, 46 bullets, 14 numbered items and 8 headings in two reports. A parser of nested lists and tables by hand is where bugs hide; `marked`'s renderer makes HTML, which would need a sanitizer; its tokens drawn as elements need neither. 46 KB (13.7 KB gzip), not in the main bundle. |

**Not in V18 (later)**: cloud sessions (`claude --cloud`, whose branch comes back on `origin`);
several agents on one feature; the agent's actions live in Symbiote (a `-p` stream, or the
transcript's tool calls in the panel); briefs from an issue tracker; editing a brief after the
start; reviewing a plan in Symbiote (Markdown has no symbols to review); a message kept for the end of the agent's turn instead of "Stop and send" (a `Stop` hook
could hand it over; not measured); the session's inbox socket (its messages reach the agent as
another session's, not the person's).

## As built — V18a

- **No real-agent spike** (asked: "I trust it works..skip the test"). V18a is built on Claude
  Code's documented behaviour (`--bg`, `agents --json --all`, `auth status`); tests and e2e run a
  fake `claude` through `SYMBIOTE_CLAUDE` (also the way to point Symbiote at another install), so no spec
  can start a real agent. `--session-id` is not passed: the session is the one whose folder is
  the feature's worktree, which needs nothing more of `--bg`.
- **Awaiting `claude --bg`**: Symbiote waits for it to exit, not for its output to close (a background
  service it starts may keep that open: V12's lesson with VS Code), 60 s at most.
- **What the page shows of the agent**: after Start, a line ("Started feature/x: Claude Code is
  working in …") and the cursor on the new branch. `/api/features` already answers each agent's
  state and `POST /api/features/start` starts one again; the chips, the Features section and its
  actions are V18b's.
- **The base from the header** is not sent: the server takes the default branch's newest tip at
  the start (the dialog shows the one it had when it opened; they differ only if the branch moved
  meanwhile). "Start a feature here" sends the row's commit.
- **Names are checked twice**: in the dialog as typed, by git's rules for branch names and the
  names in use (local and remote branches), and by the server with `git check-ref-format
  --branch`. The proposal: the brief's first line, five words, accents and apostrophes dropped,
  at most 40 characters after `feature/`, `-2` when taken.
- **The row menu** takes plain entries beside submenus ("Start a feature here").
- **The header**: the first screenshots showed the new button and a longer help line pushing the
  help to three lines and both buttons to a second row at 1440 px. "Start a feature" now sits with
  Compare mode at the right, its key as a badge (`n`), as Compare mode shows `x`; the help line is
  unchanged.
- **One `symbiote/` per repository** (decision 103) is in V18a: `reviewPlace` uses the main worktree;
  `prepareSymbioteFolder` (the folder's `.gitignore` and `AGENTS.md`) is shared by reviews and features.
- **`listRefs`** names the worktree a branch is checked out in when it is not this one; V11's menu
  uses it in V18b.
- **Config**: `features.branchPrefix`, `features.worktrees` (relative to the main checkout,
  `{repo}` its folder's name), `agent.permissionMode`, `agent.model` in `symbiote/config.json`; unknown
  values are ignored.

**Results (V18a).** Tests first: core 5 of 5 failed (no functions), the CLI module and the
viewer's helpers did not exist, the server's 4 new tests failed (no routes). Now 653 unit tests
(34 new: core 5, CLI 21, server 4, viewer 4) and 87 e2e (5 new: a feature from the header — its
branch at `main`'s tip in `<repo>.worktrees/…`, the checkout clean, the fake's `--bg`, `--name`,
`--add-dir` and the brief with plan first, the record —; `n`, a name in use refused, Escape,
Auto passed as `--permission-mode auto`; "Start a feature here" at a row's commit; a trust
refusal kept with its words and the prompt copied; no agent at all). Three existing e2e
expectations gained the new menu entry.

On the six regression clones, through `symbiote view`'s API with the fake agent, three features each:

| Repo | `POST /api/features` | `GET /api/features` (3 features) | `…/options` | Checkout's `git status` |
|---|---|---|---|---|
| ky | 104–121 ms | 40–46 ms | 72 ms | unchanged |
| zod | 161–193 ms | 37–43 ms | 83 ms | unchanged |
| vite | 305–334 ms | 40–51 ms | 92 ms | unchanged |
| Qwik | 443–506 ms | 42–47 ms | 88 ms | unchanged |
| CPython | 571–588 ms | 42–48 ms | 180 ms | unchanged |
| Bitwarden | 850–898 ms | 57–64 ms | 149 ms | unchanged |

A start is mostly `git worktree add` (Bitwarden 644–854 ms of it, measured in the spike). Every
branch was at its base (18 of 18); everything made was removed afterwards. The header against
`main`'s build on a clone of this repository: with `main` checked out, the same at 1440, 1100 and
900 px (42, 69, 70 px high; 25, 24, 24 rows in view); with a long branch name checked out, the
same at 1440 and 900 px, 10 px higher at 1100 (one row fewer). Screenshots light and dark at 1440
and 900 px: the dialog, a name in use, the line after Start; no page errors. No analysis code
changed (goldens unchanged), so no regression-check run.

Not verified: a real Claude Code started by Symbiote (skipped, as asked) — `--bg` with `--add-dir`,
its sessions' states end to end, how long `--bg` takes when it starts its background service;
Windows and macOS (worktree paths, `claude.exe` on `PATH`); Firefox and Safari.

## As built — V18b

- **The groups**, as `featureGroups` decides them: **Done** only once merged; **Working** only while
  the agent works; everything else **Needs you**, each with its next step in words — "Waiting:
  permission prompt", "Plan ready: read it and answer", "Ready for review", "Changes requested:
  send them to the agent", "2 commits since your review: review again", "Approved: ask your agent
  to merge it", "Not started: Workspace not trusted.", "Its branch is gone". The tab counts Needs
  you.
- **One reader for the page** (`useFeatures`): the features and the reviews, read together (a
  review changes what is next), shared by the tab bar, the page and the review header; on load,
  on focus, and every 5 s only while an agent works or waits.
- **Live listing**: a feature's tip that is not the listed one lists the history anew, the cursor
  kept on its commit at its place in the view (when that commit is in the first 200 rows; else on
  HEAD, as before).
- **The marks**: on a branch's badge, before its name, a link to the feature; in the branches
  panel beside the entry, since a link cannot sit inside the entry's button. The first screenshots
  showed two new features' badges folded into "+2" on `main`'s row — where a feature sits until
  its agent commits —, so "+N" now carries the most urgent mark among those it folds (failed,
  waiting, ready, then working), linking to the features view.
- **"Open its feature"** is in the menu of the row where a feature's branch is (its tip).
- **Actions**: Stop only while the agent works or waits (`claude stop <id>`); Start the agent after
  a failed start, a stop, a failure or once it is no longer listed; Talk copies `claude attach
  <id>`; the merge check is asked per row, in the background, once per pair of tips (V17's
  `git merge-tree`).
- **Files not committed** count new files one by one and leave ignored ones out (`git status
  --porcelain --untracked-files=all`).
- **The tab bar** made the bar 4 px taller at first (37 to 41 px); without the tabs' vertical
  padding it measures as `main`'s.
- **Open in VS Code** from a review of a branch checked out in a feature's worktree opens that
  worktree and maps the line in its working copy (the review page asks the refs where the branch
  is checked out); V11's checkout menu says "checked out in <folder>".
- **Trap**: the server keeps Claude Code's sessions for 2 s, so an e2e test that changes the fake's
  state waits for the page's next read, not a reload. One checkout e2e check, "the taller submenu
  moves up", now allows the submenu level with its entry: the row menu has more entries since V18.

**Results (V18b).** Tests first: core 1, CLI 3, server 2, editor 2, viewer 6 failed before the code
(groups, next steps and marks 4, the folded badge 1, the checkout menu 1). Now 667 unit tests (14
new since V18a) and 92 e2e (5 new, with the fake agent: the groups as its state changes and the
tab's count; the links both ways — the mark, the branch name, "Open its feature", the review
header; an agent's commit arriving with the cursor kept; stop, start again, copy the prompt, Talk,
Open in VS Code; a branch checked out elsewhere, and one deleted in a terminal: "Its branch is
gone", no mark).

On a clone of this repository with three features (one waiting for a permission, one finished
with a commit and a file not committed, one working): the features view and the review header in
light and dark at 1440 and 900 px, the marks on the commits page and in the branches panel; no
page errors. Against `main`'s build, warm servers, 4 rounds each: first rows on Bitwarden
982–998 ms (`main` 984–1,042 ms), on ky 975–991 ms (`main` 973–1,004 ms); the bar 37 px on both.
No analysis code changed (goldens unchanged).

Not verified: a real Claude Code (as for V18a) — `claude stop` and `claude attach` with a real
session; VS Code opening a worktree for real (the tests use a fake `code`); Windows and macOS;
Firefox and Safari.

## As built — V18c

- **The record is saved before the agent starts**: the session's first hooks (`SessionStart`,
  Symbiote's prompt) fire while `claude --bg` is still starting, and the hook finds a feature by its
  record; saved after the start, as V18a did, those entries were dropped. The e2e fake, which
  runs the hooks of its `--settings` file as Claude Code does, found it.
- **`hooks: true`** in the record's `agent` tells a feature whose thread is recorded from one
  started before V18c ("Symbiote keeps an agent's messages from V18c on: Talk shows this one's").
- **The settings file** is written when a feature is started or a message sent, and on a list of
  features that has a recorded one; `symbiote view` builds its services lazily, so not at its own
  start. A repository with no feature gets no file. The hook's command quotes each path for the
  shell Claude Code runs it in (single quotes; double on Windows).
- **The thread** keeps `PreToolUse` only for questions; a question seen by both hooks is one
  entry, made so by the reader (`readThread`), not the hook. Entries are read whole (the last
  200).
- **Reply**: one at a time ("a message is being sent", 409). Sending to a working agent, or one
  waiting on a prompt, is refused (409, "sending stops its turn") unless asked with `stop`; the
  panel asks first ("Stop and send", then "Stop it and send"), also when the page's state was
  older than the server's. A live but idle session is stopped without asking: nothing is lost.
- **Clean up** refuses before touching anything while files in the worktree are not committed
  (git would refuse its removal, but only after `claude rm` had removed the sessions); then
  `claude rm` for each session in the worktree (a live one stopped first), `git worktree
  remove`, `git branch -d` when merged. `removeWorktree` and `deleteMergedBranch` (core) were
  planned in V18a and built now.
- **The rows**: the first screenshots at 1440 px showed rows with no brief (the branch name took
  the 360 px line); the brief leads the row now, the branch on a line below.
- **The thread opens at its newest entry**: with a real agent the panel showed the plan and hid
  the fix below the fold; it scrolls to the end when it shows and when an entry arrives, not on a
  read with nothing new.
- **"Send to the agent"** in the Review tab is a link to `/features?branch=<b>&send=verdict`;
  the panel fills its box once the thread (with the verdict) is read.

**Results (V18c).** Tests first: core 2, thread 8, features 10, server 1, reviews 1, viewer 4
and e2e 8 (6 new; 2 V18b specs whose actions moved to the panel) failed for the right reasons.
Now 692 unit tests (25 new since V18b) and 98 e2e (6 new), all passing. The hook, built: 22–23 ms
per event, exit 0 on any input. With a real Claude Code (2.1.296, Haiku, the person's Pro
subscription, its own default permission mode, `auto`) in a throwaway repository, driven
through `symbiote view`'s API: a start in 1.0 s; the plan in 13 s, read as "plan ready" (Claude Code:
`blocked`, the thread: a report after the prompt); "OK, go ahead." continued the same session
(no copy) in 1.6 s, which committed and read "ready" 13 s later; a "request changes" verdict's
text, sent the same way (1.6 s), gave a fix commit 9 s later; after a merge into `main`, Clean up
in 1.4 s (no session left, worktree and branch removed, the checkout's status clean). The thread
held every step: Symbiote's prompt, the plan, "Continued", the messages, the reports. Screenshots
light and dark at 1440 and 900 px with three features (a plan answered and a command waiting, a
question with its options, one working), "Stop and send" asked, and the real agent's thread; no
page errors. No analysis code changed (goldens unchanged); the commits page is unchanged.

Not verified: permissions and questions from a real agent in the panel (the real run was in
`auto` and asked nothing; the spike recorded both, and the e2e fake replays those inputs); a
session that wakes from agent view or `claude attach` rather than from Symbiote; the thread while
`symbiote view` is closed (the hook writes files and needs no server, by design); Clean up of an
unmerged feature with a real agent (unit and e2e only); Windows and macOS (the hook's quoting);
Firefox and Safari.
