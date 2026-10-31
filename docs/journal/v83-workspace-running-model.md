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
