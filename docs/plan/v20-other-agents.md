# V20 — Other agents, and answers in Symbiote

[Index](../PLAN.md) · [Journal](../journal/v20-other-agents.md)

**Status:** planned (2026-10-15). Moved out of V18 (asked: "Rename V18d and V18e into V20"):
V20a was V18d, V20b was V18e. V20a, Codex: merged into main (2026-10-19, from branch
`feature/codex-agent-integration`, a workspace started in Symbiote); as built and results under "As built
(V20a)" below. V20b dropped (2026-10-20, decision 163). V20c not started. Each gets its own plan (the problem measured, design, verification) when it starts;
what V18 already designed and measured for them:

- **V20a, Codex**: V18's "Starting the agent" (Codex 0.162: `codex exec --json` started
  detached, its states from its JSONL events, replies by `codex exec resume`; the agent picked
  in the dialog); V18's verification step 3 for Codex. Planned in full below, measured on Codex
  0.163; the spike changed the design (commits, resume's options).
- **V20c, other agents** (was in V20a; asked for Codex alone: "Integrate codex agent into Symbiote"):
  a configured `agent.command` for any other agent, and `.worktreeinclude` under "A feature".
- **V20b, answers in Symbiote**: dropped (asked: "Delete v20b"; decision 163). V21's terminal shows
  the agent's own prompts in the panel and answers them, and V27b does the same for Codex. The
  hooks V18c registered stay, recording only (decision 108).

## V20a — Codex

**Problem** (asked: "Integrate codex agent into Symbiote. It is already planned"; done when a full
test with Codex "creating a workspace with it, and prompting something to him" runs). A
workspace's agent is Claude Code or nothing: `FeatureOptions.agent` is Claude Code's, the record
reads only `kind: "claude"`, and with Claude Code missing the dialog says "No agent found" even
where Codex is installed. Measured with Codex 0.163 (installed here, logged in with ChatGPT,
`gpt-6-luna` at medium effort from its own `config.toml`) in a throwaway repository and a
worktree beside it, made as V18a makes them (journal, "V20a spike"):

| What V18's plan assumed | Measured |
|---|---|
| `codex exec --json -C <worktree> -s workspace-write "<prompt>"` builds and commits | It edits, but **cannot commit**: a linked worktree's git folder is `<checkout>/.git/worktrees/<name>`, outside the sandbox's writable roots ("Git tried to create an index lock under the parent repo's `.git/worktrees/`"), 3 of 3 runs. `--add-dir <checkout>/.git` does not help: Codex keeps any `.git` read-only. Writable roots for the worktree's git folder, `objects`, and the branch's ref and reflog folders (`refs/heads/feature`, `logs/refs/heads/feature`): committed, inside the sandbox, 2 of 2 (10.5–12.0 s) |
| `--approve-for-me` optional | Cannot be combined with `-s` (it implies `workspace-write`). It escalated the refused commit to Codex's automatic reviewer, which approved it: the commit ran **outside** the sandbox (12.6 s) |
| `codex exec resume <thread> "<text>"` continues the same session | It does, with its context (3.2–12.8 s), but with **none of the start's options**: neither `--add-dir` nor `--approve-for-me` survived (a commit refused again, 2 of 2); `exec resume` takes no `-s`, `--add-dir` or `--approve-for-me`. `-c sandbox_mode="workspace-write" -c sandbox_workspace_write.writable_roots=[…]` on the resume: committed (6.1 s) |
| Its states from its JSONL events | `thread.started` (the thread ID) 150 ms after the start, `turn.started`, `item.started`/`item.completed` (`agent_message`, `command_execution`, `file_change`), `turn.completed` (usage) or `turn.failed` (`error.message`); transient `error` events ("Reconnecting... 2/5"). **No timestamps** in any event. Exit 0 after a completed turn, 1 after a failed one |
| (not logged in) | `codex login status` (40 ms) prints "Logged in using ChatGPT", or "Not logged in" with exit 1; `exec` then retries for about 25 s and fails its turn with a 401 |
| (stop) | Spawned detached from Node (its own process group: `codex.js` and the native binary), SIGTERM to the group ended both in 0.1 s, the sandboxed command it ran included; the stopped thread resumed with its context (3.2 s) |
| (its instructions) | Codex reads the repository's `AGENTS.md` in the worktree (followed, 1 of 1); reading `symbiote/` in the main checkout from its sandbox works (1 of 1); no trust step for `exec` in a folder Codex never saw |
| (cleaning up) | `codex archive <thread>`: 70 ms; a second archive of the same thread fails (exit 1, "failed to archive session") |

Causes:
- Symbiote knows one agent: its options, record, states and messages are Claude Code's.
- Codex's sandbox protects git's folders, and a worktree's live in the main checkout's `.git`.
- `exec resume` starts from Codex's configuration, not from the thread's first options.

**Goal**: the start dialog offers the agents installed — Claude Code and Codex — the default
first; a workspace started with Codex runs `codex exec` in its worktree in the background, can
commit on its branch from inside its sandbox, shows its state (working, plan ready, ready for
review, stopped, failed with Codex's words), its thread (Symbiote's prompt, Codex's reports, the
person's messages) and takes replies in the panel's box; Stop, Start the agent, Talk (copies
`codex resume`), Clean up work for it. Unchanged: Claude Code workspaces (launch, hooks,
terminal, states), workspaces started before, a repository with no workspace (no call to either
agent), the analysis.

### Starting Codex (CLI)

- **Found** as Claude Code is: `SYMBIOTE_CODEX` (a path or a command on PATH), else `codex` on PATH
  (`findCodex`); a fake in tests and e2e. `packages/cli/src/codex.ts` holds what Symbiote asks of it
  (`Codex`: `start`, `resume`, `stop`, `alive`, `archive`, `account`), as `ClaudeCode` does.
- **The command**: `codex exec --json -C <worktree> -s workspace-write -c
  sandbox_workspace_write.writable_roots=[<git folders>] "<prompt>"`; a reply is `codex exec
  resume --json -c sandbox_mode="workspace-write" -c sandbox_workspace_write.writable_roots=[…]
  <thread> "<text>"` in the worktree (decision 130). Never `--dangerously-bypass-…`, never
  `--worktree` (Symbiote made it), never `--add-dir` (`symbiote/` is the person's), no `--approve-for-me`.
  The model and effort are Codex's own configuration.
- **The git folders**, from `git rev-parse --path-format=absolute --git-dir --git-common-dir` in
  the worktree: the worktree's git folder; the common `objects`; the folders holding the branch's
  ref and reflog (`refs/heads/<branch's folder>`, `logs/refs/heads/<branch's folder>`), those that
  exist. Not `refs/` whole: other branches' refs stay read-only.
- **Detached, through Symbiote's runner** (decision 129): `node <dist/codex-run.js> <thread file>
  <startup|resume> <codex> <args…>`, spawned detached in the worktree (its own process group;
  `unref`), its process ID in the record (`agent.pid`). The runner, Node's modules only as
  `agent-hook.js`, starts Codex and turns its events into the workspace's thread
  (`symbiote/threads/<branch>.jsonl`, V18c's entries), stamped as they arrive: `thread.started` →
  `start` (the thread ID as `session`) and `prompt` (what it was given: Symbiote's prompt, or the
  person's message); a `turn.completed` → `report` (the turn's last `agent_message`); its end →
  `end` with `reason`: `completed`, `stopped` (SIGTERM, SIGINT, SIGHUP), or the failure in
  Codex's words (`turn.failed`'s message, else the last `error` event, else the last lines of its
  error output, else its exit code). It outlives `symbiote view` like Claude Code's background
  sessions. Not a log in Symbiote's cache (V18's plan): events have no times, the thread is what the
  panel and V23's order read, and Codex keeps its own session files.
- **Before starting**: `codex login status`; exit 1 → the workspace is kept, "not started:
  Codex is not logged in: run `codex login`, then start the agent" (instead of a 25 s run that
  fails with a 401).
- **The prompt**: `featurePrompt` unchanged; it names the record, the reviews and
  `symbiote/AGENTS.md` by absolute path, which Codex can read.

### State, replies, stop and clean up (CLI)

- **State** (`codexState`, decision 131): from the record's `started` (when the last run
  started), the thread's entries since then and whether the runner's process lives
  (`process.kill(pid, 0)`): an `end` since then — `completed` → finished (plan ready, ready or
  done by commits, V18b's rule), `stopped` → stopped, else failed with its reason as `error`; no
  `end` and the process lives → working; no `end` and it is gone → finished if a `report` came,
  else failed ("Codex ended without a word"). No "needs you": `exec` never stops to ask. The
  state's `id` is the thread ID (Talk).
- **Reply** (`/api/features/reply`, unchanged route): while a run lives, refused unless `stop`
  (V18c's "Stop and send"); then the runner with `exec resume` on the newest `start`'s thread ID.
  No thread ID yet → 409 "start the agent again".
- **Stop**: SIGTERM to the runner's process group, waiting at most 2 s for it to go; if the
  runner left no `end`, Symbiote writes `end: stopped`.
- **Start the agent** again: a new `codex exec` with the prompt (a new thread), as Claude Code
  starts a new session.
- **Clean up**: a live run stopped; each thread the workspace ran archived (`codex archive`,
  failures ignored: an archived thread fails the same way, and nothing is lost); then V18c's
  worktree and branch rules.
- **The terminal** (V21) is Claude Code's: for a Codex workspace `/api/features/terminal`
  answers 409, and the page offers Talk instead.

### Which agent (core, CLI, viewer)

- `AgentKind` gains `'codex'`. `FeatureOptions.agent` becomes `agents`: those installed, the
  default first (decision 132), each `{ kind, command, account?, apiKey?, permissionMode? }`
  (`permissionMode` and `apiKey` Claude Code's). `FeatureRequest` gains `agent?` (absent: the
  default); a permission mode with Codex is refused (400). The default: `agent.kind` in
  `symbiote/config.json`, else Claude Code, else Codex.
- Codex's account from `codex login status`: "your ChatGPT account", "an API key", "not logged
  in".
- **The dialog**: with two agents, "Agent: Claude Code ▾ / Codex" in the agent line; Claude Code
  keeps its permission select; Codex shows "sandbox: its worktree, commits on its branch". With
  none: "No agent found (Claude Code or Codex …)".
- **The panel**: the line after Start names the agent ("Codex is working in …"); Talk copies
  `codex resume <thread> -C <worktree>` for Codex (decision 133); "Its agent failed: <reason>"
  when there is one.
- **The record**: `agent: { kind: "codex", started, pid }`; old records unchanged.

### Verification (V20a)

1. **Unit** (red first): the runner on scripted Codex event streams (a fake `codex` printing
   them) — start then prompt with the thread ID, the report of a turn's last message, `end`
   completed, a failed turn's message, stopped on SIGTERM, a broken line ignored, Codex not
   found; `codexState` for each case (working, plan ready / ready / done, stopped, failed with
   reason, gone without a word, a new run before its first event); the commands (`exec` and
   `exec resume`, their flags, the TOML list of folders); the git folders of a real worktree;
   `codex login status` parsed; options with both, either or no agent and `agent.kind`; a start
   with Codex (record, runner spawned, "not logged in" kept as not started); reply (refused
   while it runs unless `stop`, then stop and resume); stop; clean up (archive, worktree);
   the terminal refused for Codex; Claude Code's tests unchanged.
2. **E2E** (red first), a fake `codex` as `SYMBIOTE_CODEX`, run by the real runner: Start a workspace
   with Codex picked — its state working, then plan ready with its report in the thread; a reply
   sent — "You:" and a new report; Talk copies `codex resume …`; Stop while it works — stopped;
   no Codex installed — the dialog offers Claude Code only. Every existing spec passes.
3. **A real Codex** (the brief's "done when"): in a throwaway repository through `symbiote view` in
   Chromium — start a workspace with Codex, plan first; the plan in the thread, "plan ready"; a
   reply ("go ahead") — it builds and commits on its branch, "ready for review"; Stop and Start;
   Clean up. Times for each step; everything made removed.
4. **Viewer**: screenshots of the dialog with two agents and of a Codex workspace's panel, light
   and dark, 1440 and 900 px; no page errors.
5. **Nothing else changes**: no analysis code (goldens), Claude Code's unit and e2e tests as
   they are; a repository with no workspace calls neither agent.

**Risks (V20a)**

| Risk | Mitigation |
|---|---|
| The git folders made writable let Codex change git's data beyond its branch | Only the worktree's git folder, `objects` (append-only by git's design) and the branch's ref and reflog folders; other refs, `config` and hooks stay read-only; said in the README |
| Symbiote's `writable_roots` replace the person's own `sandbox_workspace_write.writable_roots` for these runs | Said in the README; a configured list for Symbiote's runs is later if asked |
| A reused process ID reads as "working" | Only while the thread has no `end` since the last start; a run that ended normally always wrote one |
| The runner is killed hard (SIGKILL, Windows) and writes no `end` | The state reads the process as gone: finished with a report, else failed; Stop writes `end: stopped` itself |
| Codex's event names change | Only `thread.started`, `turn.completed`, `turn.failed`, `error` and `item.completed` of type `agent_message` are read; the fake follows the 0.163 stream recorded in the spike |
| Talk's `codex resume` continues the thread outside Symbiote | Its turns are not in the thread; the state reads the last Symbiote run; said in Talk's title |
| Network is off in Codex's `workspace-write` sandbox (installs, pushes fail) | Codex's own `network_access` setting decides; the prompt already says push only if the project does |
| Windows: no process groups; npm's `codex.cmd` shim | Not verified; Stop kills the runner's tree with `taskkill /T`; said in the results |

**Order**: the spike (done: journal). Then core types and the runner with its tests, the Codex
launcher and states, the service (start, reply, stop, clean, options), the dialog and panel,
the e2e fake; then the real Codex run and screenshots.

**Proposed decisions (V20a)**:

| # | Question | Decision | Why |
|---|---|---|---|
| 129 | How Symbiote runs Codex | **`codex exec --json` detached through Symbiote's runner (`codex-run.js`, Node's modules only), which writes Codex's events into the workspace's thread as they arrive; replies by `codex exec resume`** | Codex has no background supervisor like `claude --bg`; its events carry no timestamps, and the thread (V18c) is what the panel, the states and V23's order read. The runner also knows the exit and Codex's last words. |
| 130 | Codex's sandbox | **`workspace-write`, plus the worktree's git folder, `objects` and the branch's ref and reflog folders as writable roots, passed on every run (`-c`); never full access, never `--approve-for-me`** | Measured: without them nothing can be committed in a linked worktree (3 of 3); `--add-dir .git` stays read-only; `--approve-for-me` runs the commit outside the sandbox; `exec resume` keeps none of the start's options. |
| 131 | A Codex workspace's state | **From the thread since the last start and whether the runner's process lives: an `end` decides (completed, stopped, failed with its reason); else working while it lives; no "needs you"** | `exec` never stops to ask; the runner writes the end it saw; the process check covers a run with no end yet. |
| 132 | Which agent a workspace runs | **Picked in the start dialog among those installed; the default `agent.kind` in `symbiote/config.json`, else Claude Code, else Codex; kept in the record** | V18's plan; the record's `agent.kind` makes later replies, stops and clean-ups use the same agent. |
| 133 | Talking to Codex outside the panel | **Talk copies `codex resume <thread> -C <worktree>`; no terminal tab for Codex in V20a** | Its turns in a terminal would not reach the thread, which the state reads; `codex resume` gives the whole session where the person wants it. |
| 134 | Codex's sessions at Clean up | **Archived (`codex archive`), not deleted; failures ignored** | Archiving is undone with `codex unarchive`; the person's history stays theirs. |
| 163 | V20b, answers to permissions and questions in Symbiote | **Dropped** | Asked ("Delete v20b", 2026-10-20). The panel's terminal shows the agent's own prompts and answers them: Claude Code since V21, Codex since V27b. What V20b alone would add (answers without node-pty, from the list, an edit as a diff before allowing it) has not been asked for. The hooks registered since V18c stay, recording only |

**Not in V20a (later)**: `agent.command` and `.worktreeinclude` (V20c); a Codex terminal in the
panel (with its turns recorded, e.g. through Codex's hooks, which need the person's trust);
`--approve-for-me`; a Codex model or writable roots set in `symbiote/config.json`.

### As built (V20a)

- **Runs told apart by an ID, not by time.** The plan read a run's entries as those since the
  record's `started`. With the tests' fixed clock, Symbiote's own `end: stopped` and the next start
  fell in the same millisecond, and the new run read as stopped; a real machine can do the same.
  Symbiote now gives each run an ID (`agent.run`, a UUID) that the runner writes on every entry
  (`ThreadEntry.run`, optional; Claude Code's entries have none), and the state reads the entries
  with the record's `run`. The runner takes it as an argument: `node codex-run.js <thread>
  <startup|resume> <run> <codex> <args…>`.
- **A start or a reply waits for the run's first entry** (3 s at most, not once the runner is
  gone). With a real Codex the person's reply showed in the thread 5.3 s after Send: a Codex
  start returns once the runner is spawned, and the page saw the message at its next read, while
  Claude Code's hooks write it before `--bg` returns. After: 292–294 ms.
- **What Codex is given comes after `--`** (a reply may start with `-`; measured: `--` ends
  Codex's options). Every run passes the same `-c sandbox_workspace_write.writable_roots=[…]`,
  the start with `-s workspace-write`, a resume with `-c sandbox_mode="workspace-write"`.
- **`commitFolders`** (core, `git/worktrees.ts`) names the git folders from `git rev-parse
  --git-dir --git-common-dir` in the worktree, real paths, the ref and reflog folders only when
  they exist.
- **The account** from `codex login status` (it writes to stderr) is kept a minute, except "not
  logged in", asked again at the next start.
- **The runner runs from source too** (Node's own modules and `import type` only): its unit test
  starts it detached with Node's type stripping and stops it by its process group.
- **The dialog** says "sandbox: its worktree and branch" (the first words wrapped the line at
  1440 px), the details in its title.
- **The e2e fake Codex** waits for the spec to end its turn; one spec never did, and two runs
  outlived the suite: the fake now exits once the test's folders are removed (0 left after).

**Results (V20a).** Tests first: core 1, runner and Codex 17, service 6 (and the options test
changed), server 1, viewer 3, red before for the right reasons (missing modules and fields, the
state's run); then 2 more for the wait for the first entry, red before. One guard test (Codex is
asked nothing for a repository with no workspace, or with Claude Code's alone) passed as written.
Now 788 unit tests (761 on `main`) and 113 e2e (110 on `main`; 3 new for Codex with a fake run by
the real runner, written with the viewer change rather than before it): 113 of 113 in a first full
run; in the last, 112, a Claude Code spec ("Send the verdict…") failing once on its own `git
commit` in a worktree ("index.lock: File exists"), then 5 of 5 alone. Not this branch's: since
V18b, `/api/features` counts a worktree's files with `git status`, whose index refresh can take
the lock while an agent commits; `GIT_OPTIONAL_LOCKS=0` is git's answer for background status.
Proposed as its own fix (not made here).

A real Codex (0.163, the person's ChatGPT login, `gpt-6-luna` at medium effort) in a throwaway
repository (a greeter with `npm test`), through `symbiote view` in Chromium:

| Step | Measured |
|---|---|
| Start a workspace, Codex picked in the dialog, plan first | Answered in 210 ms (818 ms with the wait for its first entry, its thread ID in the answer) |
| Its plan | In the thread, "Plan ready", 10.7 s and 9 s after Start (two workspaces) |
| A reply ("OK, go ahead: build it, run the tests, and commit it") | In the thread 294 ms after Send (5,335 ms before the wait); it built, ran `npm test` and **committed on its branch from its sandbox** (`bdaba0c`): "Ready for review · 1 commit · Merges cleanly into main" 25.3 s after Send |
| Stop during a turn (`sleep 60` asked for) | "Stopped" 211 ms after the click; no `sleep` or runner left |
| A reply to the stopped thread | Resumed it (292 ms to the thread); committed (`e15dcb3`), ready 15.7 s after Send |
| Talk | Copied `codex resume 01a1554a-… -C <worktree>` |
| Clean up, unmerged (asked first) | 882 ms: the worktree removed, the branch kept, the record `finished`, its thread in `~/.codex/archived_sessions` |
| Page errors | None |

Screenshots of the dialog (1440 px light and dark, 390 px) and of the panel (1440 and 900 px,
light and dark): the agent line on one line at 1440 px, two at 390 px. The viewer's main bundle
592,739 → 593,757 bytes. No analysis code changed (goldens unchanged), so no regression sets.
Everything made was removed, the throwaway Codex threads archived.

Not verified: Windows and macOS (process groups, `taskkill`, npm's `codex.cmd`); Codex with an
API key; a person's own `sandbox_workspace_write.writable_roots`, which Symbiote's runs replace;
network-dependent checks inside Codex's sandbox; a reftable repository (no ref folders to grant);
the 390 px dialog wraps "Spike" to a second line of the kinds here (CSS this branch does not
touch; V24c measured it on one line).

## Milestones

| # | Milestone | Output |
|---|---|---|
| V20a | Codex | Codex picked in the start dialog among the agents installed (`agent.kind` the default); `codex exec --json` detached through Symbiote's runner, which records the thread; commits from its sandbox (its branch's git folders writable); its states; replies by `exec resume`; Stop, Start, Talk (`codex resume`), Clean up (archive). |
| ~~V20b~~ | ~~Answers in Symbiote~~ | Dropped (decision 163). Was: what an agent waits on, answered in the panel through the hooks registered since V18c: a permission (an edit as a diff, a command; allow, or deny with a reason), a question (its options); the hook waits for the person up to its timeout, then Claude Code's own dialog (measured: the question comes again through `PermissionRequest`). |
| V20c | Other agents | `agent.command` for any other agent (detached, log, running/exited); `.worktreeinclude`. |
