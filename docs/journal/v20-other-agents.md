# Journal: V20 — Other agents, and answers in Symbiote

[Index](../JOURNAL.md) · [Plan](../plan/v20-other-agents.md)

## V20a spike — what running Codex in a Symbiote worktree takes (2026-10-19, branch `feature/codex-agent-integration`)

Asked, as a workspace started in Symbiote: "Integrate codex agent into Symbiote. It is already planned";
done when Codex is started in a workspace and prompted. V18 planned Codex on 0.162 without
running it. Run with Codex 0.163 (`codex-cli`, npm), logged in with ChatGPT, the person's
`gpt-6-luna` at medium effort, in a throwaway repository with a worktree beside it made as V18a
makes them (`git worktree add -b feature/farewell ../app.worktrees/feature-farewell main`).

**Learned**:
- **Codex cannot commit in a linked worktree from `workspace-write`.** It edited `greet.js`, then
  `git add`/`git commit` failed 3 of 3 times: a linked worktree's git folder is
  `<checkout>/.git/worktrees/<name>`, outside the sandbox ("Git tried to create an index lock
  under the parent repo's `.git/worktrees/` directory, which is read-only"). The change was left
  uncommitted, and Symbiote's flow reviews commits. `--add-dir <checkout>/.git` did not help: Codex
  keeps any `.git` read-only even inside a writable root. Writable roots for the worktree's git
  folder, `objects`, `refs` and `logs`: committed (10.5 s); narrowed to the branch's own ref and
  reflog folders (`refs/heads/feature`, `logs/refs/heads/feature`): committed too (12.0 s).
- **`--approve-for-me`** cannot be given with `-s` ("cannot be used with '--approve-for-me'");
  alone it escalated the refused commit to Codex's automatic reviewer, which approved it, and the
  commit ran outside the sandbox (12.6 s).
- **`exec resume` keeps the thread, not its options.** A resume continued with its context
  (3.2–12.8 s per turn), but a session started with `--add-dir`s could not commit after a resume,
  nor one started with `--approve-for-me` (2 of 2): resume takes no `-s`, `--add-dir` or
  `--approve-for-me` and starts from Codex's configuration. `-c sandbox_mode="workspace-write" -c
  sandbox_workspace_write.writable_roots=[…]` on the resume committed (6.1 s).
- **Events**: `thread.started` with the thread ID 150 ms after the start, `turn.started` at
  0.6 s, `item.started`/`item.completed` (`agent_message`, `command_execution` with its output,
  `file_change` with paths), `turn.completed` with token usage, or `turn.failed` with
  `error.message`; transient `error` events while reconnecting. No event has a time. A turn's
  first `agent_message` is a preamble ("I'll inspect …"), its last the answer. Codex writes
  "Reading additional input from stdin..." to stderr even with stdin closed.
- **Not logged in** (an empty `CODEX_HOME`): `codex login status` says "Not logged in", exit 1, in
  40 ms ("Logged in using ChatGPT" otherwise); `exec` retried for about 25 s, then failed its turn
  with a 401 and exit 1.
- **Stop**: spawned detached from Node, `codex` is a Node script (`codex.js`) running the native
  binary in the same process group; the sandboxed shell has a group of its own. SIGTERM to the
  group ended all of them in 0.1 s; the thread then resumed with its context ("I was running
  `sleep 25`; the command was stopped before it finished").
- **Its instructions**: the repository's `AGENTS.md` in the worktree was followed (1 of 1); a file
  in the main checkout's `symbiote/` was read from the sandbox (1 of 1); `exec` asked for no trust in a
  folder Codex had never seen.
- **Archive**: `codex archive <thread>` 70 ms; again on the same thread, or an unknown one, exit 1
  ("failed to archive session").
- `codex` 0.163 also has `agents` (a TUI over its app-server daemon) and `queue` (a message for a
  session there), and hooks that need the person's trust; `exec` sessions are none of these.

**Not tested**: `--approve-for-me`'s reviewer refusing; Codex with an API key; network inside the
sandbox (off by default: installs and pushes would fail); Windows and macOS. Twelve threads, in
the throwaway repository, removed with it; their session files stay in `~/.codex`.

## V20a — Codex as a workspace's agent (2026-10-19, branch `feature/codex-agent-integration`)

Asked, as a workspace started in Symbiote: integrate Codex, "already planned"; done when Codex is
started in a workspace and prompted. The start dialog now offers the agents installed (Claude
Code first unless `agent.kind` says `codex`); a Codex workspace runs `codex exec --json` in its
worktree through Symbiote's runner (`dist/codex-run.js`), which writes Codex's events into the
workspace's thread; it can commit on its branch from its sandbox; replies resume its thread;
Stop, Start, Talk (`codex resume`) and Clean up (archive) work for it. Claude Code workspaces
are unchanged; the terminal stays Claude Code's.

**Learned**:
- **The plan's design could not have worked as written**: Codex in `workspace-write` cannot
  commit in a linked worktree (its git folder is in the main checkout's `.git`, which Codex keeps
  read-only), and `exec resume` keeps none of the start's options. Both only showed by running
  Codex (spike, above): the fix is writable roots for exactly what a commit on the branch writes,
  passed on every run.
- **Separating runs by time fails in the same millisecond.** Symbiote writes its own `end: stopped`
  and may start the next run within the same millisecond; the tests' fixed clock showed it at
  once. Each run now carries an ID on its entries.
- **A detached start answers before anything is recorded.** The person's reply took 5.3 s to show
  with a real Codex (the page's next read); Claude Code's hooks had hidden this, since they write
  before `--bg` returns. Waiting up to 3 s for the run's first entry: 0.29 s.
- **A fake that waits for the test can outlive it**: two detached runs survived the e2e suite
  because one spec never ended its turn. The fake now exits when the test's folders go; checked
  with `pgrep` after the suite (0 left).
- A Playwright click on a workspace row's centre lands on its branch badge, a link to the commits
  page: the real-run driver navigated away and "missed" Talk. Not a product bug; click the title.
- **Found, not fixed here**: a Claude Code spec failed once on its own `git commit` in a worktree,
  "index.lock: File exists" (5 of 5 alone after). `/api/features` runs `git status` in each
  worktree (V18b), and status refreshes the index under its lock when it can; an agent committing
  at that moment fails the same way. `GIT_OPTIONAL_LOCKS=0` on that call is git's documented
  answer for background status. Proposed as `fix/…` from `main`.

**Verification**: tests first (core 1, runner and Codex 17, service 6 + 2, server 1, viewer 3; red
before), one guard test; 788 unit tests, 113 e2e (3 new with a fake Codex run by the real runner,
written with the viewer change; 113 of 113, then 112 with the lock flake above). A real Codex (0.163, ChatGPT login) through `symbiote view` in
Chromium, two workspaces in a throwaway repository: plans in 9–10.7 s; replies in the thread in
0.29 s; commits from the sandbox (`bdaba0c`, `e15dcb3`), ready for review 15.7–25.3 s after the
reply; Stop in 0.21 s with nothing left running; Clean up in 0.9 s, its thread archived. Screenshots
light and dark at 1440, 900 and 390 px, no page errors; the main bundle +1.0 KB. Everything made
was removed and the throwaway Codex threads archived. Not verified: Windows and macOS, an API key
login, a person's own writable roots, network inside the sandbox.

Merged into main (2026-10-19): V20a, no conflicts (`main` had not moved since the branch
started; the merge's tree is the branch's). `main` verified after the merge: 788 unit tests, lint,
typecheck, build, 113 of 113 e2e.
