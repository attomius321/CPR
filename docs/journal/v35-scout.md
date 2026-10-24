# Journal: V35 — Scout: an agent to ask about the repository

[Index](../JOURNAL.md) · [Plan](../plan/v35-scout.md)

## V35 spike — what a read-only agent in the checkout takes (2026-10-22, branch `feature/scout-an-agent-to-ask`)

Asked: a Scout page, "a read-only agent I can ask questions about the repository", and to settle
git history, one conversation or many, hooks, and the agent. Claude Code 2.1.306 (Sonnet 5.5,
the person's subscription) and Codex 0.163 on the person's daemon, in a throwaway clone of this
repository at `84bc324` in the folder the V18c spike had the person trust.

**Learned**:
- **Git changes the answers.** Three real "why" questions with the merger's tools (Read, Grep,
  Glob) took 9–10 turns, $0.070–0.105 and named no commit ("couldn't get commit hashes", "my
  inference"); with `git log`, `git show` and `git blame` allowed, 4–6 turns, $0.055–0.064, and
  3–10 commits each. The repository's docs answer much of "why" already; git adds when.
- **Permission rules cannot keep Bash read-only.** Claude Code's documentation lists `git log
  --output=<file> main` among what `Bash(git log * main)` matches, and says deny rules are not a
  security boundary. Its built-in read-only set, in `dontAsk` with no rule, ran 9 of 10 git read
  commands and refused `git log -S'MERGER_ANSWER' --oneline`, the pickaxe. A PreToolUse hook runs
  before the rules, and its block holds over an allow rule: a gate Symbiote writes and tests.
- **This session's own classifier refused a probe** that asked a nested agent to try writes
  (`git log --output=…`, `touch`, `git checkout -b`): "Create Unsafe Agents". Not worked around;
  the docs answered the question the probe would have.
- **`claude --bg` ignores `--session-id`** ("--bg manages the session id") and prints
  `backgrounded · <id> · <name>`, which V18 chose not to parse. `claude agents` listed the
  person's own interactive session in the main checkout: by path it would be Scout's.
- **What a wake keeps**: "woke session … with its saved options (--name, --tools,
  --permission-mode, --strict-mcp-config, --settings, --model)"; it then listed `Glob, Grep,
  Read, EndConversation`.
- **States**: `working`/`busy` during a turn, `done`/`idle` 1–3 s after its answer, not V18c's
  `blocked` (a plan). The name stayed "Scout" through two turns.
- **Tokens**: 9.9K on a fresh conversation's first request (6.7K written to the cache), 13.0K on
  a follow-up after a stop and a wake (11.2K from the cache).
- **Codex read-only**: `thread/start` with `sandbox: read-only`, `approvalPolicy: never` answered
  `readOnly`, no network, in 133 ms; `git log` ran in the sandbox; the answer came in 4.3 s; no
  trust entry was written, unlike V27b's writable starts.
- A Spike workspace, today's way to ask: 1 of 16 workspaces here; a worktree is 67–76 ms on this
  repository, but it starts at the default branch, not the checkout as it is.

**Not tested**: writes refused by Claude Code (the classifier's refusal above) and by Codex's
sandbox; `claude attach` restarting a stopped Scout session (V21 says it keeps the saved options);
macOS. Cleaned up after: the session stopped and removed, the clone deleted, the Codex thread
archived.

## V35 — Scout: a read-only agent to ask about the repository (2026-10-22, branch `feature/scout-an-agent-to-ask`)

Asked: a Scout page to ask questions about the repository without starting a workspace. `/scout`
(the sidenav's pages, key `a`): a question starts a read-only Claude Code or Codex in the checkout
`symbiote view` runs in; its answer and follow-ups are in its own terminal; New conversation starts
over. Claude Code's Bash goes through Symbiote's PreToolUse gate (decision 236), the session is
found by its recorded ID (239), no hook records it (238), the prompt is `prompts.scout`.

**Learned**:
- **git parses more than a prefix check sees.** On git 2.43 `git grep --open=true hello` and
  `git grep -nOtrue hello` each ran `true` as the pager: git takes a long option's unique
  beginning and bundled short options. `git log --outp=…` failed (diff options take no
  abbreviation), `git diff --no-ind` was taken. The gate now refuses every beginning of the
  options that write or run a program, and for grep any bundle holding `O`. Probing git itself
  found this; the first 78 tests passed without it.
- **The real agent keeps to its prompt before the gate is needed.** Asked to change README.md and
  commit, it made no tool call and named the workspace to start; asked to run `ls`, it ran
  `git ls-tree` instead. Only an explicit "call Bash with exactly `ls packages`" reached the gate,
  which refused it ("PreToolUse:Bash hook error: Scout runs only git's read commands …"), and the
  agent quoted it. The gate is the boundary; the prompt keeps it from being hit.
- **`git log -S` is what "why" questions use**: the real agent ran it in two of four answers,
  through the gate, which Claude Code's own read-only set would have refused.
- **Scout's terminal is Claude Code's**: the person can run `! <command>` there or Shift+Tab to
  another mode, as in any terminal of theirs; Scout suggested `! ls packages` itself. The agent's
  tools stay Read, Grep, Glob and the gated Bash.
- **The person's default model sets the pace**: 49–51 s for a code or history question with
  Opus 5.5 (their `model`), against 10 s with Sonnet in the spike; 12–17 s for a short turn.
- **A test's own address**: the e2e helper's URL ends with `/`; the spec's first run asked for
  `//scout`, which the shell reads as History, and failed for that reason, not Scout's.

**Verification**: tests first, red for the right reason (`scout.test.ts` 15, `scout-gate.test.ts`
84 cases, prompts 3, viewer route, mark and reader, e2e 5 of 5 on the build without Scout).
`pnpm check` 1,233 tests; e2e 188 of 188. After the last style change, five specs together
(scout, shell, look, settings, workspaces): `shell.spec`'s keys test failed once (ArrowDown left
the focus on the first card), then passed 27 of 27 alone and 57 of 57 in the same five again; not
explained, not seen before in this branch's runs. Real Claude Code 2.1.306 and Codex 0.163 through
`symbiote view`'s API in a throwaway clone of this repository (PLAN.md's V35 results): the merger's
prompt found in `packages/cli/src/prompts.ts`, a change declined, `ls` refused by the gate, `git
status` empty and HEAD unchanged after five turns; New conversation removed the session (1.5 s);
Codex's read-only thread answered in 7.6 s and was archived. `/history` first paint as `main`'s
(medians within 4 ms, alternating). Screenshots at 1440×900 and 390×844, dark and light. Cleaned
up: the clone, both conversations (the Claude Code session removed, its transcripts deleted; the
Codex thread archived), the `main` build. Not verified: Codex's own terminal on Scout's thread in
the page; macOS and Windows; `regression-check` (no analysis code changed).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `8fb3152`, no conflicts
(`main` had not moved since the branch).
