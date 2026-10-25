# V35 — Scout: an agent to ask about the repository

[Index](../PLAN.md) · [Journal](../journal/v35-scout.md)

**Status:** merged into main (2026-10-22, from branch `feature/scout-an-agent-to-ask`, a workspace
started in Symbiote; approved in Symbiote at `8fb3152`). Its "As built" and results below.

**Problem** (asked: "a read-only agent I can ask questions about the repository ('where is X
decided?', 'why does Y work this way?', 'what touches Z?') without starting a workspace").
Symbiote starts agents only on workspaces. A question is a terminal outside Symbiote, or a Spike:
1 of this repository's 16 workspaces, which made a branch, a worktree (67–76 ms here, 0.85 s on
Bitwarden, V18), a title and a brief, at the default branch's tip rather than the checkout as it
is, and needed Clean up after. Measured for Scout (Claude Code 2.1.306, Sonnet 5.5, `dontAsk`,
in a throwaway clone of this repository at `84bc324`):

| Real question | Read, Grep, Glob (the merger's tools) | The same, and `git log`, `git show`, `git blame` |
|---|---|---|
| Why does the merger answer each region as JSON? | 9 turns, 71K tokens read, $0.091, 19 s; no commit ("couldn't get commit hashes") | 4 turns, 38K, $0.059, 31 s; 10 commits named |
| Why does a reply stop the session, then resume it? | 9 turns, 106K, $0.105, 19 s; no commit ("couldn't name the commit") | 5 turns, 50K, $0.055, 15 s; 5 commits |
| What calls `newestSession`, and why by real path? | 10 turns, 60K, $0.070, 17 s; the why "my inference" | 6 turns, 65K, $0.064, 18 s; 3 commits, the why from V18's rule |

What decides the design:

- **Permission rules cannot keep Bash read-only.** Claude Code's own documentation lists
  `git log --output=<file> main` among what `Bash(git log * main)` matches, calls argument
  patterns "fragile", and says a deny rule "isn't a security boundary". With Bash and no rule in
  `dontAsk`, Claude Code's built-in read-only set ran 9 of 10 git read commands and refused the
  pickaxe (`git log -S'MERGER_ANSWER' --oneline`), the search a "why" question needs most. A
  PreToolUse hook runs first: its block "takes precedence over allow rules", and its allow does
  not lift a deny or ask rule. Claude Code's sandbox would hold at the OS level, but on Linux it
  needs bubblewrap and socat and otherwise runs commands unsandboxed. (A probe asking an agent to
  try writes was refused by this session's own safety classifier; not run.)
- **The session**: `claude --bg` ignores `--session-id` ("--bg manages the session id"), and its
  printed text is not parsed (V18). `claude agents --json --all` listed the person's own
  interactive session in the main checkout beside this agent's: matching by path would take it.
  A background session keeps `--tools`, `--permission-mode`, `--strict-mcp-config` and
  `--settings` through a stop and a wake (Claude Code says so; after one it listed `Glob, Grep,
  Read`). It reads `working`/`busy` while it answers and `done`/`idle` 1–3 s after.
- **Tokens**: a fresh conversation's first request reads 9.9K tokens (6.7K written to the cache);
  a follow-up after a stop and a wake read 13.0K, 11.2K of them from the cache.
- **Codex**: a thread started on the person's app-server daemon with `sandbox: read-only` and
  `approvalPolicy: never` read `{"type":"readOnly","networkAccess":false}` in 133 ms; `git log`
  ran in the sandbox; it answered in 4.3 s; no trust entry was written; the clone stayed clean.
- First answers: "where is the merger's prompt defined?" gave `packages/cli/src/prompts.ts`
  (`MERGER`, line 131) in 10 s with Claude Code, 4.3 s with Codex.

**Goal**: a **Scout** page in `symbiote view` (`/scout`, in the sidenav's pages with History and
Settings, key `a`): a question box starts a conversation with a read-only agent in the checkout
`symbiote view` runs in, as it is now; its answer and the follow-ups are in the agent's own
terminal; New conversation starts over. It never edits, commits, checks out or pushes. Its prompt
is `prompts.scout` in Settings. **Unchanged**: workspaces, the merger, reviews and
`symbiote/AGENTS.md`; with no question asked, nothing is started and nothing written.

## Server (`packages/cli/src/scout.ts`)

- **Record**: `symbiote/scout.json` (beside `config.json`; in Symbiote's cache when reviews are
  kept there): the agent's kind, its session's `id` and `sessionId` (Claude Code) or thread
  (Codex), and when it started. Ignored by `symbiote/.gitignore` already (`*`).
- `GET /api/scout`: the agents installed (the default first), the conversation and its state
  (`working`, `answered`, `interrupted`, `stopped`, `gone`, `unknown`), and whether terminals run.
- `POST /api/scout/ask { text, agent? }`: with no conversation, starts one with
  `prompts.scout`, `{question}` filled; with one, continues it (Claude Code: stopped first when
  idle, refused while it works; Codex: `send`), for where no terminal runs.
- `POST /api/scout/new`: ends the conversation: Claude Code's session stopped and removed
  (`claude rm`; its transcript stays, `claude --resume` opens it), Codex's thread interrupted and
  archived; the record removed.
- `POST /api/scout/terminal { cols, rows }`: `claude attach <id>`, or `codex resume <thread>
  --remote <address> -C <checkout>` with V27b's trust note, in a terminal of V21's.
- **Claude Code**: `claude --bg --name Scout --tools Read,Grep,Glob,Bash --permission-mode dontAsk
  --strict-mcp-config --settings <symbiote>/scout-settings.json [--model <agent.model>] "<prompt>"`
  in the checkout. Its session: the background session in the checkout named Scout that
  `claude agents` lists after the start and did not before; then by its recorded ID only.
- **The gate** (`scout-gate.ts`, built as `dist/scout-gate.js`, Node's modules only like
  `agent-hook.js`): Scout's settings file runs it as a PreToolUse hook for every tool. Read, Grep
  and Glob pass to Claude Code's own rules. Bash is allowed only for a git read command it parses:
  `git [--no-pager]` and one of `log show blame diff shortlog grep rev-parse merge-base ls-files
  ls-tree describe`, words of safe characters or quoted text (no `$`, backquote or backslash in
  double quotes), no global option but `--no-pager`, no option that writes or runs a program
  (`--output…`, `-O…`/`--open-files-in-pager`, `--ext-diff`, `--no-index`), optionally piped into
  `head`, `tail`, `wc` or `grep` and `2>&1` or `2>/dev/null`; anything else is denied with the
  rule in words. Any other tool is denied. In `dontAsk` nothing asks.
- **Codex**: `thread/start` with `sandbox: read-only`, `approvalPolicy: never`, named Scout, on
  its app server (V27a); without a daemon, Scout says so (no `exec` fallback: no terminal).
- No recording hooks: the state comes from `claude agents` by ID (Codex: `thread/read`).

## Prompt

- `prompts.scout` (Settings group "Scout"), Symbiote's default in `prompts.ts`: who it is, read
  only (and that work goes through a workspace), what it can run, how to answer (paths with
  lines, symbols, the commits that explain why), and that the repository's workspace and review
  rules (`symbiote/AGENTS.md`, its CLAUDE.md's workflow) are not its own. `{question}` required.

## Viewer

- Route `{ page: 'scout' }` at `/scout` (`pages.ts`); the server serves `/scout` as the shell.
- Sidenav: "Scout" between History and Settings, `a`, an icon; a dot while it works, and
  "answered" when an answer came while the person was on another page, until Scout is opened.
- `/api/scout` read with the workspaces (`useWorkspaces`), every 5 s while Scout works.
- Page: a head ("Scout", read-only in `<checkout>` with `<agent>`, New conversation); with no
  conversation, the question box (and the agent, when two are installed); with one, its terminal
  (`AgentTerminal` given Scout's endpoint), "Open again" when it ends. In `symbiote-style`.
- `a` opens Scout; on Scout with no conversation it focuses the box.

## Verification

1. **Tests first** (red for the right reason): `scout.test.ts` — the start's arguments (read-only
   tools, `dontAsk`, the gate's settings), the session found by ID with the person's newer
   session in the same folder not taken, the new session found from the lists before and after,
   record kept and removed, refusals; `scout-gate.test.ts` — a table of accepted and refused
   commands (`--output=`, `-c`, `-C`, `;`, `&&`, `$(…)`, backquotes, `>`, globs, other programs,
   other tools); `prompts.test.ts` — the default and an override; `app-server.test.ts` — a
   read-only start on the fake server; viewer `pages.test.ts` and the sidenav's mark;
   `e2e/scout.spec.ts` with the fake Claude Code — open Scout from the sidenav and by `a`, ask,
   see the answer in its terminal, a session of the person's in the checkout not taken, New
   conversation.
2. **Nothing else changes**: every other unit and e2e test as on `main` (the Settings page lists
   one more prompt).
3. **Real Claude Code**: "where is the merger's prompt defined?" answered with
   `packages/cli/src/prompts.ts`; asked to change a file, it does not and `git status` stays
   clean; a "why" question runs `git log -S`; the gate refuses a command Claude Code would run
   (`ls`).
4. **Viewer**: `pnpm test:e2e`; `viewer-check` screenshots at 1440×900, dark and light, and
   390 px; `/history` first paint as `main`'s.

**Risks**

| Risk | Mitigation |
|---|---|
| The gate's parser lets a write through | An allow-list: one program, listed subcommands, no shell operator outside `| head/tail/wc/grep`, quoting rules; a table of refusals in tests; Codex's sandbox is the OS's |
| The person's own allow rules or hooks let more through | The gate's deny comes before allow rules; `--strict-mcp-config` drops MCP servers and their allow rules |
| A Claude Code release changes `--tools`, `dontAsk` or what a wake keeps | Arguments under test; the gate denies any tool but Read, Grep and Glob whatever Claude Code offers |
| The person's session in the checkout taken for Scout's | Never by path: by the recorded ID; e2e with such a session |
| A long conversation grows costly | New conversation; Claude Code compacts it |
| The session removed outside Symbiote | Read as `gone`: the page offers a new conversation |
| Codex's TUI lets the person change approvals | Their choice in Codex's own terminal; Symbiote starts the thread read-only with approvals `never` |

**Order**: the gate and the start (unit tests), then the API, then the page and the e2e, then
the real run.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V35 | Scout | `/scout` with a read-only Claude Code or Codex in the checkout, git through Symbiote's gate, `prompts.scout` |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 236 | Git history for Claude Code | **Bash through Symbiote's PreToolUse gate**: git read commands it parses allowed, every other command and tool denied, in `dontAsk` | Allow rules match `git log --output=<file>`; Claude Code's read-only set refused `git log -S`; without git 0 of 3 answers named a commit, with it 3 of 3 (18 commits), in 4–6 turns instead of 9–10 |
| 237 | One conversation or one per question | **One per repository, kept and resumed**; New conversation starts over | A follow-up needs the last answer; it read 86 % from the cache (11.2K of 13.0K tokens); a fresh one pays 9.9K and starts blind |
| 238 | Symbiote's agent hooks | **None that record**: the state from `claude agents` by ID (Codex: its app server); the sidenav shows working and answered | `working`/`busy` then `done`/`idle` 1–3 s after an answer; nothing asks in `dontAsk`; Scout has no thread to show. The gate is its only hook |
| 239 | How Scout's session is found | **The new background session named Scout in the checkout, then its recorded ID; never by path** | `--bg` ignores `--session-id` and its text is not parsed (V18); by path the person's own session there would be taken |
| 240 | Which agent | **As workspaces**: `agent.kind`, else Claude Code, else Codex; the other offered when both are installed. Codex on its app server only, `read-only`, approvals `never` | Read-only thread in 133 ms, git ran, no trust written; `exec` has no terminal |
| 241 | Shortcut | **`a`** ("ask") | Free in the shell, History, the diff page and the menus |

**Not in V35 (later)**: starting a workspace from an answer; an effort choice (the agent's
default; since `fix/scout-effort-level`, see below); Scout's answers as a thread without a
terminal; Scout's key on a diff's page.

**After V35: Scout's effort** (`fix/scout-effort-level`, JOURNAL). Asked: "an option to put scout
on an effort level from the beginning of the conversation", the default "in config.json, and from
setting i can adjust that level", and every effort setter "a drag and drop stepper, with a step
being a level". A conversation starts at `scout.effort` in `symbiote/config.json` when the agent
lists it, else the agent's own; Scout's box can pick another for that conversation; Settings
sets `scout.effort` (Scout's group, Effort). The levels are read apart from `/api/scout`
(`GET /api/scout/efforts`): the shell reads that on every poll, and reading Codex's levels starts
its daemon. The start page's Effort select is the same stepper: a range input with a stop for
the agent's own level, then each level it lists.

**After V35: the page is Scout's terminal** ([V50](v50-scout-terminal.md)). Asked: "Scout should
always be a terminal when going to that page, with options in header to change the model, new
conversation". The page opens a conversation with no question (`POST /api/scout/open`),
`prompts.scout` is its system prompt, and its head moves the conversation to another model or
level (`POST /api/scout/switch`, a copy of the session). The question box stays where no terminal
runs.

## As built (V35)

- **The gate reads commands as git does.** git takes a long option's unique beginning and bundled
  short options: on git 2.43 `git grep --open=true hello` and `git grep -nOtrue hello` each ran
  `true` as a pager. The gate refuses any beginning of `--output`, `--open-files-in-pager`,
  `--ext-diff` and `--no-index` (`--outp=`, `--open=`) and, for `git grep`, a bundle holding `O`;
  `git log -S'Options'` still passes. `git describe` was left out of the planned list
  (`--dirty` refreshes the index).
- **A question after the session was removed outside Symbiote starts a new conversation**, rather
  than the page asking for one first.
- **One Claude Code for workspaces and Scout** in `symbiote view`: one list of its sessions every
  2 s for both. `/api/scout` is read with the workspaces, reviews and merges (4 requests a read).
- **The page focuses its question** when it opens; `a` on Scout goes to the question or the
  terminal.
- **Scout's terminal is Claude Code's own**: there the person can still run a command with `!` or
  change the mode with Shift+Tab (the status line shows "don't ask on"). Those are the person's
  acts, as in any terminal; the agent's tools stay Read, Grep, Glob and the gated Bash, and no
  Edit or Write tool exists in the session. Found in the real run, where Scout suggested
  `! ls packages` after declining to run `ls`.

**Results.** Tests first, red for the right reason: `scout.test.ts` (15) and `scout-gate.test.ts`
(84 cases) without their modules, the prompts' 3 without a `scout` key, the viewer's route,
mark and reader (3 requests a read), and `e2e/scout.spec.ts` (5 of 5 on the build without Scout).
`pnpm check` 1,233 tests; e2e 188 of 188 (`shell.spec` and `settings.spec` count the third page
and the 14th prompt). The gate answers in 16 ms a call. With the real Claude Code 2.1.306 (the
person's default model, Opus 5.5) through `symbiote view`'s API, in a throwaway clone of this
repository at `84bc324`:

| Asked | Time | What Scout did |
|---|---|---|
| Where is the merger's prompt defined? | 51 s | 12 tool calls, two `git log -S` let through by the gate; `packages/cli/src/prompts.ts:131` (`MERGER`), with `DEFAULT_PROMPTS` and `MERGER_ANSWER` |
| Change README.md and commit it | 12 s | No tool call: declined, and named the workspace to start |
| Why does a reply stop the session, then resume it? (with `git log -S`) | 49 s | `git log -S` twice, `git show --stat`: `bc4daa3` (V18c) and the journal's measurement |
| Run `ls packages` | 17 s | Ran `git ls-tree` instead |
| Call Bash with exactly `ls packages` | 17 s | Refused by the gate, its rule quoted word for word |

`git status` was empty before and after, HEAD unchanged. New conversation took 1.5 s and the
session left `claude agents`. Codex 0.163 through the same API: a thread named Scout in the
read-only sandbox, started in 1.3 s, answered within 7.6 s (`rg`, `sed` and `git log` ran there;
`prompts.ts`, `b8242e0`, `56a3099`), no trust entry written, archived by New conversation.
`/history` first paint on the clone (485 commits), `main`'s build and this one back to back: 6
rounds, medians 52 and 56 ms (first row 125 and 127 ms); 12 rounds, 56 and 52 ms (126 and 126):
no difference. Screenshots at 1440×900 and 390×844, dark and light, of the empty page and of the
real conversation in its terminal: no overflow, no page errors. Not verified: Codex's own terminal
on Scout's thread in the page (its trust question) with the real Codex; macOS and Windows;
`regression-check` (no analysis code changed: core gained types only).
