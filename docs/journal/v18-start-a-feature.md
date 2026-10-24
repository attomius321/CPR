# Journal: V18 — Start a feature: a branch, a worktree and an agent, from the commits page

[Index](../JOURNAL.md) · [Plan](../plan/v18-start-a-feature.md)

## V18 spike — what starting a feature with an agent takes (2026-10-15, branch `milestone/v18-start-a-feature`)

Asked: "Start a new feature" from the commits page, continuing the agentic flow. The person chose
Symbiote starting the agent, a worktree per feature and "plan first" per feature, and asked for a
design for any repository, not shaped by how this one is worked on. Measured before planning:

- `git worktree add` at the default branch's tip, warm, on the regression clones: ky 12–20 ms
  (1.7 MB) to Bitwarden 644–854 ms (173 MB); CPython 453–463 ms warm but 10.4 s cold.
- Claude Code's own worktrees (`--worktree`, and background sessions isolating themselves before
  their first edit) live in `.claude/worktrees/` inside the checkout, on `worktree-<name>`
  branched from the remote default branch. None of the six clones ignores that folder, zod's root
  tsconfig includes `**/*.ts`, and in this repository a root `prettier --check .` failed on 58
  files of a nested worktree (removed after). So Symbiote makes the worktree itself, beside the
  checkout, at the commit the person picks; Claude Code skips its own isolation in a linked
  worktree.
- `claude --bg` refused all three folders tried (this repository's checkout, a worktree of it, a
  new repository's worktree): "Workspace not trusted. Run `claude` in … once and accept the trust
  prompt", exit 1 in 0.7 s. Trust is keyed on the main checkout's root and only an interactive
  `claude` accepts it: a page cannot, and Symbiote must not write it. The feature must survive a
  failed start and the agent be restartable.
- `claude -p` (no trust step) in a worktree made with `git worktree add -b`, Haiku, a one-file
  task: the commit landed on the feature branch, the main checkout untouched, `--session-id`
  honoured, 8.5 s and $0.006; its stream has a `vcs_state_changed` event per commit. `-p` runs
  are not in `claude agents --json`, and cannot ask for a permission or an answer: background
  sessions can, and report `state` (`working`, `blocked`, `done`, `failed`, `stopped`) and
  `waitingFor`, listed in 153–158 ms. The worktree folder is what ties a session to its branch.
- From a feature's worktree, Approve's `git switch <default branch>` fails while the main checkout
  has that branch, and Claude Code's isolation refuses git in the main checkout: the approved
  merge happens from the main checkout. Reviews are kept per working tree today (`symbiote/` at
  `symbiote view`'s root), so a `symbiote view` opened in a worktree would keep its own.

Not yet run: `claude --bg` end to end (states from start to `done`, `--bg --resume`, `--add-dir`
and `--session-id` with `--bg`), which needs a repository the person has trusted; it is the first
step of the plan.

## V18a — Start a feature (2026-10-15, branch `milestone/v18-start-a-feature`)

"Start a feature" in the commits page's header (or `n`, or "Start a feature here" in a row's
menu) asks what the agent should build, proposes a branch named after it, creates the branch at
the default branch's newest tip (or the row's commit) with its own worktree beside the checkout
(`../<repo>.worktrees/<branch>`), records the brief in `symbiote/features/<branch>.json` and starts
Claude Code there in the background (`claude --bg --name <branch> --add-dir <symbiote>`, the
person's permission mode, plan first by default). A failed start keeps the feature with Claude
Code's words; without an agent the prompt is offered to copy. Reviews now live in the main
checkout's `symbiote/`, shared by its worktrees.

**Learned**:
- The real-agent spike was skipped at the person's word; Symbiote relies on Claude Code's documented
  interfaces only (`agents --json` for scripts, not `--bg`'s printed text) and the tests run a
  fake through `SYMBIOTE_CLAUDE`, which every feature spec sets: no test can start a real agent.
- A start costs what `git worktree add` costs: 0.1 s on ky, 0.85–0.9 s on Bitwarden; listing three
  features with their agents 37–64 ms, one `claude agents` call per list.
- Adding a header button wrapped the help line to three lines and both buttons to a second row at
  1440 px (seen only in a screenshot); grouped at the right with key badges, the header measures
  as `main`'s except 10 px at 1100 px with a long branch checked out.
- Playwright's `getByLabel('Branch')` matched the brief's field too once the brief said "branch"
  (a label's text includes its text area's content): find fields by role and exact name.
- `git branch -D` refuses a branch checked out in a worktree, even one whose folder was deleted,
  until `git worktree prune`; a cleanup script that ignored the error left a branch the dialog then
  rightly called taken.

**Verification**: tests first (core 5 of 5, server 4, the CLI and viewer modules missing). 653
unit tests (34 new), 87 e2e (5 new; 3 expectations gained the new menu entry), all passing. On the
six regression clones through `symbiote view`'s API with the fake agent: 18 features started at their
base, each checkout's `git status` unchanged, all removed after. Screenshots light and dark at
1440 and 900 px, no page errors. No analysis code changed. Not verified: a real Claude Code
started by Symbiote, Windows and macOS, Firefox and Safari.

Merged into main (2026-10-15), V18a–c together. `main` verified after the merge: 692 unit
tests, build, 98 e2e.

## V18b — The features view (2026-10-15, branch `milestone/v18-start-a-feature`)

`/features` lists the features started from Symbiote grouped by what each needs from the person —
Needs you, Working, Done — with its agent's state in words, its commits, files not committed, its
review and whether it merges, and Review, Talk, Open in VS Code, Stop / Start the agent, Copy the
prompt. "Commits · Features (n)" in the bar counts what needs the person. A feature and its branch
lead to each other: the mark on the branch's badge (and in the branches panel), "Open its
feature" on its row, the review page's header; the branch name on a feature goes to its tip
(`/?branch=`). An agent's commits show on the commits page as they come, the cursor kept.

**Learned**:
- A feature waits on `main`'s row until its agent commits, and that row already shows three
  badges: the first screenshot had both features' marks folded into "+2". The folded badge now
  carries the most urgent mark; looking at real rows found it, the unit tests had one branch.
- A link cannot sit inside a button: in the branches panel the mark is beside the entry.
- Listing anew resets the cursor to HEAD (V11); doing that whenever an agent commits would move
  the view under the reader, so the cursor's commit and its place in the view are kept.
- The server keeps Claude Code's sessions 2 s (each call is ~155 ms): an e2e test that changes the
  fake's state must wait for the page's next read, not reload at once.
- Adding a menu entry made a checkout e2e premise ("the taller submenu moves up") false at that
  window size; the window check it guards still holds.

**Verification**: tests first (core 1, CLI 3, server 2, editor 2, viewer 6). 667 unit tests, 92
e2e (5 new), all passing. Screenshots on a clone of this repository with three features, light
and dark, 1440 and 900 px, no page errors. First rows against `main`'s build: Bitwarden 982–998
against 984–1,042 ms, ky 975–991 against 973–1,004 ms; the bar 37 px on both. Not verified: a
real Claude Code session stopped or attached, VS Code opening a worktree for real, Windows,
macOS, Firefox, Safari.

Merged into main (2026-10-15), V18a–c together. `main` verified after the merge: 692 unit
tests, build, 98 e2e.

## V18c spike — answering a background agent from Symbiote (2026-10-15, branch `milestone/v18-start-a-feature`)

Asked: V18c moves "one abstraction up from Claude Code": not a chat with one input. Question:
can Symbiote see and answer what a `claude --bg` session waits on (a question, a permission, a plan)
while Claude Code keeps hosting the session? Run with Claude Code 2.1.296 (the background service
ran its sessions on 2.1.300), Haiku, the person's Pro subscription and no API key. A throwaway
repository in `~/projects` with a feature worktree beside it, as V18a makes them; `claude` run
with a clean environment, as a `symbiote view` started in a terminal would; a stand-in for Symbiote passed
with `--settings`: command hooks that log every event and, for a question or a permission, wait
for an answer file, as Symbiote's server would wait for the person.

**Learned**:
- **Trust**: a repository inside a trusted folder (`~/projects`) is not trusted: `--bg` exited 1
  in 0.6 s, the message naming the worktree's folder. Once the person trusted the main checkout
  (one interactive `claude` there), its worktree started: trust is the main checkout's, as
  documented. `--bg` returned in 0.7–0.9 s, starting the background service.
- **Permission mode**: without `--permission-mode` the session ran in `auto`, the account's own
  default. In `auto` a classifier decides and permission requests are rare; `manual` is today's
  name of the old default and prompts for edits and commands.
- **Hooks from `--settings` run in a background session**: `SessionStart`, `UserPromptSubmit`,
  `PreToolUse`, `PermissionRequest`, `Notification` (`permission_prompt` about 6 s after a
  request, `idle_prompt` 60 s after a turn ends), `Stop`, `SessionEnd`; each with `session_id`
  and `cwd`. Whether the person's own hooks (`~/.claude/settings.json` has three) ran beside
  them was not checked.
- **A question** (`AskUserQuestion`) reached a `PreToolUse` hook whole: question, header, options
  and their descriptions. `allow` with `updatedInput.answers` after 20 s: the agent took the
  answer. While that hook waits, `claude agents` says `working`.
- **A permission** reached the `PermissionRequest` hook with `tool_name` and the full
  `tool_input` (an `Edit`'s old and new text; a Bash command) and Claude Code's suggestion
  (`acceptEdits` for the session). `allow`: it went on (edit, check, commit, 10–18 s each).
  `deny` with a message ("read the diff in Symbiote first, do not commit"): the agent left the change
  uncommitted and quoted the reason. While that hook waits, `claude agents` says `blocked` ·
  `permission prompt`: the dialog is open beside the hook, the first answer wins.
- **When a hook times out** (set to 15 s): the question's `PreToolUse` hook gave way to Claude
  Code's dialog, which fired `PermissionRequest` for `AskUserQuestion`; answering that one with
  `allow` and `updatedInput.answers` worked (12 s, "You picked Blue"). One hook can answer both
  permissions and questions. If it times out too, the dialog stays: `blocked` · `input needed`
  until someone attaches.
- **The plan**: the `Stop` hook's `last_assistant_message` held the whole plan (Markdown); no
  transcript to read. After it, with no commits, `claude agents` said `blocked` with no
  `waitingFor`, not `done` as documented: V18b shows that as "Waiting: for you", not "Plan ready".
  After the agent committed: `done`.
- **Replies**: `--bg --resume <id> "text"` on a session whose process is alive (idle after its
  turn) started a copy under a new ID, without the original's `--settings`: no hook fired, and it
  then sat at a permission prompt nothing outside could answer. Any flag on a resume also made a
  copy ("keeps its own saved options"). `claude stop` (0.66 s), then `--bg --resume <id> "text"`
  with no flags (0.73 s) continued the same session with its saved permission mode, settings and
  model: the hooks fired again and the reply arrived as the person's prompt. So the hooks must be
  in the first launch.
- **Clean up**: `claude rm` on the four sessions that ran in the Symbiote-made worktree removed the
  sessions only; the worktree and branch stayed (after a merge into `main`), and `git worktree
  remove` and `git branch -d` removed them.
- A session renames itself (`spike-plan` became `greet-farewell-punctuation`), and `claude logs`
  prints a terminal screen with escape codes: match sessions by folder, never parse logs.

**Not tested**: a hook waiting longer than 20 s (documented default 600 s, `timeout` per hook); a
hook that cannot reach Symbiote (`symbiote view` closed); the session's inbox socket; a session whose
process the supervisor stopped after an hour idle; Windows and macOS. Four sessions, all removed
with the repository; Claude Code's own records of them (transcripts, the trust entry) remain in
`~/.claude` and `~/.claude.json` (`claude purge <path>` removes them).

**Second run** (the two checks the V18c plan asked for first; one Haiku session in the same
throwaway repository, recreated at the path the person had trusted, so no trust step; the
repository's `.claude/settings.json` committed with a `SessionStart` hook and a
`Bash(node --version)` allow rule; Symbiote's stand-in hooks in a settings file labelled `symbiote-v1`):
- **The person's settings still apply beside `--settings`**: the repository's hook, Symbiote's hooks
  and the person's own `SessionStart` hook all ran (GSD's update check wrote its cache in the same
  second as the session's start). No permission was asked for `node --version`; that may be
  Claude Code's own list of read-only commands rather than the rule, so the rule is not shown.
- **A waking session reads its settings file again**: rewritten as `symbiote-v2` while the session was
  stopped, the resume ("woke session … with its saved options (--name, --permission-mode,
  --settings, --model)") ran the `symbiote-v2` hooks.
- **The file must be there when it wakes**: moved away, the resume exited 0 but the session
  failed ("exit 1 before init — Error: Settings file not found: …"); with the file back, the next
  resume continued the same session.

## V18c — Talking to the agent (2026-10-15, branch `milestone/v18-start-a-feature`)

Asked to move "one abstraction up from Claude Code", starting simple with one box, beside the
list. The features view is now a list and a panel: picking a feature shows its state and
actions, its thread — Symbiote's prompt, the agent's plans and reports, the person's messages, what
the agent waits on — and one box whose message continues the agent's own session. "Send the
verdict" (and "Send to the agent" in the Review tab) fills the box with the review's verdict.
Clean up removes a merged feature's sessions, worktree and branch. The thread is recorded by
hooks Symbiote gives every agent it starts (`--settings <symbiote>/claude-settings.json`), which decide
nothing: answering permissions and questions in Symbiote is V20b (planned as V18e), on the same
hooks.

**Learned**:
- **A reply is stop, then resume with no flag.** Measured in the spike: a resume of a live
  session, or with any flag, starts a copy without the hooks. With a real agent the same session
  continued twice (1.6 s each), its hooks still firing.
- **The first hooks fire before `--bg` returns.** Symbiote saved the feature's record after the start,
  so the hook found no feature for the session's first events. The e2e fake caught it because it
  runs the hooks of its `--settings` file as Claude Code does; a fake that only records argv would
  not have.
- **A hook is a process per event**: a script with Node's modules only costs 22–23 ms; going
  through Symbiote's CLI, which loads the engine, 286 ms. `thread.ts` stays free of `@symbiote/core`.
- **Two layout bugs only a browser showed**: rows with no brief in the 360 px list (the branch
  took the line), and, with a real agent's long plan, a thread that opened at its oldest entry
  with the fix out of sight. Unit tests and the e2e specs with short messages passed both.
- **A finished plan is `blocked`, not `done`**: with the thread's last report after its last
  prompt, Symbiote reads it as "plan ready" — confirmed with the real agent.
- **The 2 s session cache again**: an e2e that set the fake's state and reloaded pressed Send
  while the page still said "Working", and the panel rightly asked before stopping the agent.
  Tests wait for the page's next read, as V18b's journal says.
- A limit, not tried: `git branch -d` checks the merge against the branch's upstream, else
  `HEAD` (git's documented rule), so with another branch checked out where `symbiote view` runs, Clean
  up's branch deletion would be refused in git's words, the worktree already removed.

**Verification**: tests first (core 2, thread 8, features 10, server 1, reviews 1, viewer 4, e2e
8). 692 unit tests, 98 e2e, all passing. A real Claude Code (Haiku, Pro subscription, `auto`)
driven through `symbiote view`'s API: start 1.0 s, plan 13 s and "plan ready", reply 1.6 s and a commit
13 s later, a verdict sent back 1.6 s and a fix 9 s later, Clean up 1.4 s; everything made was
removed. Screenshots light and dark at 1440 and 900 px, no page errors. Not verified: permissions
and questions from a real agent in the panel, a session woken outside Symbiote, `symbiote view` closed
while an agent works, an unmerged Clean up with a real agent, Windows and macOS, Firefox and
Safari.

Merged into main (2026-10-15), V18a–c together. `main` verified after the merge: 692 unit
tests, build, 98 e2e.
