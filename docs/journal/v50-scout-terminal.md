# Journal: V50 — Scout is a terminal

[Index](../JOURNAL.md) · [Plan](../plan/v50-scout-terminal.md)

## V50 spike — what a Scout with no question takes (2026-10-25, branch `feature/scout-should-be-a-terminal`)

Asked: "Scout should always be a terminal when going to that page, with options in header to
change the model, new conversation, etc...the first settings page is unnecessary". Measured with
Claude Code 2.1.310 (Haiku 5.5, Sonnet 5.5) and Codex CLI 0.163 on its 0.164 app server, in a
throwaway repository in this job's scratch folder.

**Learned**:
- **A background session needs no prompt.** `claude --bg … --append-system-prompt "<text>"` with
  none exits 0 ("idle — send a prompt to start") and lists `blocked`, idle, nothing awaited. No
  turn runs: a page that opens Scout spends nothing until the person types.
- **Appended instructions survive a wake**: answered as told after `claude stop` and an `attach`.
- **`--resume <session>` with options copies the session, its conversation kept**: "keeps its own
  saved options, so the flags you passed started a copy as f9b2d965"; on `--model sonnet` the copy
  answered "You first asked what is in README.md, and I'm Claude Sonnet 5.5". A running session is
  copied too, and left running; the original stays listed until `claude rm`.
- **Codex starts a thread with no turn** (`developerInstructions`, its level in
  `config.model_reasoning_effort`); its terminal opened it ("GPT-6-Luna low"), and `thread/read`
  gave idle and 0 turns. `thread/fork` at another level kept the turns ("Thread forked from").
- **Background sessions need a trusted folder** ("Workspace not trusted"), and this session's
  `CLAUDE_CODE_CHILD_SESSION` turned transcripts off in what it started: the probes ran with the
  person's shell's environment, in a scratch folder trusted for them.

**Not tested**: Codex 0.163's own app server on an empty thread (it refuses to name one).

## V50 — Scout is a terminal (2026-10-25, branch `feature/scout-should-be-a-terminal`)

`/scout` opens Scout's conversation with no question and shows its terminal: Scout's
instructions are its system prompt (decision 383), the first question is typed there. Its head
picks the agent, the model and the effort; a model or a level moves the conversation to a copy on
them (decision 384); New conversation opens the next on Settings' (decision 385). The question box
stays where no terminal runs. Scribe is unchanged.

**Learned**:
- **Claude Code cannot tell a new session from an answered one.** It reads a session started with
  no prompt, one whose turn ended on a tool the gate refused, and a copy after a move all as
  `blocked`, idle, nothing awaited, and lists no turns. Scout's record says it instead: `fresh`
  from an open with no question until a turn is seen. Found in the real run, where the head said
  "Ready" after an answer; the fake had no such case.
- **A read that comes too early ends the reads.** With nothing working and no terminal open the
  workspaces are not read again, and the server keeps Claude Code's list 2 s: a question typed just
  before leaving Scout's page was never seen working. Reads now go on 5 s after a terminal closes.
  Found by the sidenav's e2e test.
- **The fake numbered sessions by its list's length**: after a removal a second copy reused
  `fake1`, and removing the original removed both. It skips an ID in use now.
- **The head's width, not the window's, decides its lines.** With two agents and Codex's model name
  the line needs 1,170 px of parts (measured on the real view); by the viewport the checkout's name
  shrank to "In p…" at 1,440 px. A container query at 1,290 px.

**Verification**: tests first, red for the right reason (`scout.test.ts` 12 new, `app-server.test.ts`
2, `prompts.test.ts` 3 changed, viewer `scout.test.ts` 3; `e2e/scout.spec.ts` 7 of 8 failing on the
page before V50). `pnpm check` 1,690 unit tests; e2e 245 of 245. Screenshots at 1,600, 1,440, 1,100
and 390 px, dark and light: no overflow. The real run through the page (plan's results): the
terminal 1.4 s after opening, the first answer in 20.9 s (`prompts.ts:147`), Sonnet in 4.2 s with
the first question remembered, the gate refusing `ls` in the copy, New conversation in 2.8 s,
Codex's thread with no turn and its fork at max keeping the conversation. Not verified: Codex on a
0.163 app server; a fork back to Codex's own model or level; macOS and Windows; graph timings (no
graph code changed).
