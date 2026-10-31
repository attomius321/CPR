# Journal: V83 — What a workspace's agent runs on: its model and effort, in its head and on its card

[Index](../JOURNAL.md) · [Plan](../plan/v83-workspace-running-model.md)

## V83 spike — where Symbiote can read what an agent runs on (2026-10-31, branch `feature/workspace-running-agent-model-and`)

Asked: "I want to see clearly at workspace level which agent model and at what effort it is
running." Measured on the person's 120 workspace records, the 110 Claude Code transcripts of their
worktrees (Claude Code 2.1.316), Nucleus's recorded hooks, `claude agents --json`, Codex 0.163's
generated app-server schema, and the running `symbiote view` (a screenshot of a workspace's page).

**Learned**:
- **Symbiote cannot name the model of most workspaces today**: 103 of 120 records have no model
  (the agent's default) and 16 no level. The Brief tab's "Started with…" is the only place either
  is said, and only as the start.
- **Claude Code's transcript says both on every answer**: `message.model` (`claude-opus-5-5`),
  `requestedModel` and `effort` (`xhigh`) on the assistant lines, 110 of 110 transcripts. At rest
  the last answer is within 14 KB of the file's end (median 8 KB), but a line can be 1.36 MB (a
  tool's result), so mid-turn the last answer can be far up a small window.
- **Claude Code's hooks do not carry it**: no hook has the level; SessionStart has `model` only on
  `startup` (1 of 5 starts in Nucleus's record: `resume` and `clear` have none). Every hook has
  `transcript_path`, which is how Symbiote can find the transcript without Claude Code's folder
  layout. `claude agents --json` gives the session's ID and folder, not the model.
- **The transcript names models by full ID, Claude Code's list mostly by alias**: `claude-opus-5-5`
  is not in the list (`opus` is "Opus 5.5"); the full IDs that are (`claude-opus-4-6` → "Opus
  4.6") follow one pattern, so the name can be built from the ID.
- **Codex says it where Symbiote already asks**: 0.163's `Thread` has `model` and
  `reasoningEffort`, "Current configured … when loaded, otherwise the latest persisted", on the
  `thread/read` the list makes; a level unset is null.
- **A card's facts row has no room for it**: 242 px at the 300 px sidenav; the kind and two facts
  take about 200 px, "Opus 5.5 · xhigh effort" about 140. It would wrap on some cards and when the
  merge check loads, which is the growing and shrinking the person asked to end.

Not measured yet: whether the transcript follows `/model` and `/effort` typed mid-session, and from
which answer (one `/effort` in all the person's transcripts): the build's first step.

## V83a — what runs, read back from the session (2026-10-31, branch `feature/workspace-running-agent-model-and`)

The list says what each workspace's agent runs on (`agent.runsOn`), beside how it started.
Claude Code: its transcript's newest main answer, at the `transcript_path` Symbiote's hook now
keeps on a start and a prompt. The list reads it only when it grew: its last 64 KB, 2 MB the first
time. Codex on its app server: its thread's `model` and `reasoningEffort`. Decisions 659–660.

**Learned**:
- **Settle it with one real run first**, as V47 did: a scratch session on `haiku` at `low`, then
  `/model sonnet` and `/effort medium`, then a turn. The next answer said `claude-sonnet-5-5` at
  `medium`. The commands write a `system` `local_command` line ("Set model to `Sonnet 5.5`"), not
  an answer. In `-p` a typed `/model` lasts only for that process ("for this session only"): one
  process over stream-json was needed to see it.
- **Claude Code 2.1.316's Stop hook now carries `effort: {level}`**, undocumented; SessionStart
  carried no `model` on `startup` here. Only `transcript_path` is on every hook.
- **Real Codex answers a thread's settings without a turn**: `thread/start` then `thread/read`
  gave the model and level given, else the configured `gpt-6-luna` at `medium`. The probe left two
  archived, empty threads in `~/.codex/archived_sessions`: not deleted, Codex indexes them.
- **A request's own `config` hid the fake server's**: the fake's `thread/start` handler names its
  parameter `config`, so the configured model read as undefined. The first read test caught it.
- **A comment before a union's first member**: Prettier hoists it and indents the whole union
  again. On another member it stays put.

**Verification**: 16 tests red for the right reason (no transcript kept, no model read), then
green; the CLI's 1,180 tests.

## V83b — the head's chip, the card's row, one line of state (2026-10-31, branch `feature/workspace-running-agent-model-and`)

The head says what its agent runs on in a chip after its kind; every card in a row of its own. A
card's state is one line, cut at its end, its tip whole. The model named from its ID. Decisions
661–664.

**Learned**:
- **`-webkit-line-clamp: 1` cuts at a word**: "Running mkdir -p…" and the rest of the line empty,
  a path being one long word. `white-space: nowrap` with an ellipsis fills the line.
- **A chip beside a title must give way first**: at 390 px the chip kept its 169 px and left the
  title "worksp…". With `flex-shrink: 100` the title keeps its room and the chip its icon.
- **The scratch view's errors are not the head's**: over a mocked list, the view's "no workspace
  …" filled the actions and the chip shrank to its icon at 1440 px. Hidden for the screenshots;
  the real head had 470 px free beside a 40-letter title.
- **Naming in the list would have run Claude Code**: V47's kept list is read again at the next use
  after a failed read, every 5 s from the list. The ID's pattern gives the same names.
- **A tip needs a hover the page did not redraw**: under load, the workspace's page was drawn again
  under a still pointer right after the start, and V83's first tip never showed. The test hovers
  again until the tip says its words (`expectTip`).
- **Full runs beside another workspace's suite flake** (load 14–16): three runs failed one to three
  tests each, all different, all passing alone. V79's kind-chip test failed in two: it measures
  the chip as the starting card gives way, and fails on `main`'s build too (3 of 60 on `main`, 5
  of 60 on the branch, 20 runs 8 at once). Left for a fix of its own.

**Verification**: 7 unit tests and 2 e2e tests red for the right reason (no chip; the state 40 px
for a long command), then green. `look.spec.ts`'s V79 card height updated knowingly (140 → 164).
`shell.spec.ts`'s V44 guard (no icon on a card but an action's and the facts') leaves out the
model row's icon, a fact too. After `main` was merged in: `pnpm check` 2,547 unit tests; e2e the
viewer's 364, the nexus's 20. Screenshots at 1440 × 900, 1×, dark and light, of every page with the sidenav over the
person's list (their 4 live transcripts read by the branch's reader), the folded rail, a 264 px
sidenav and the 390 px drawer. Cost on the person's 114 transcripts: 0.08–0.10 ms a poll
unchanged, 0.35–0.41 ms grown, 1.24 ms (7.68 cold) the first read; the list's request 196 ms.

Not verified: a Codex workspace through the list with the real Codex; Codex by `exec` and Hermes
(unchanged); a session from before V83 taking the path at its next prompt, with the person's
build.
