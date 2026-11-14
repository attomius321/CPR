# Journal: Fix — no agent lists the person's other sessions or runs their routines

[Index](../JOURNAL.md) · [Plan](../plan/fix-agents-no-session-messages.md)

## Fix — `ListAgents` and `RemoteTrigger` denied to every agent (2026-11-14, branch `fix/agents-no-session-messages`)

Asked: every agent Symbiote starts had Claude Code's `ListAgents` and `SendMessage`, which list and
message the person's other sessions, Nucleus among them. HV10 denied them only to a writer started
from an issue (decision 1068).

**Learned**:
- **Only the workspace agent had them.** A `claude -p` probe on 2.1.325 with the default tools
  listed `ListAgents`, `SendMessage` and `RemoteTrigger`. With `--tools Read,Grep,Glob` it listed
  those three tools only. So the running reviewer, the merger and the advisor never had them: each
  passes `--tools`. Nucleus started with `--bg --tools` listed 6 tools, none of the three, and its
  gate refuses any other tool anyway. The workspace agent, in normal mode and in Hive, starts with
  no `--tools` and listed all three.
- **`RemoteTrigger` reaches sessions too.** It creates and runs the person's claude.ai routines as
  the person, and a routine may post into an existing session. `SendToProject` does not belong
  with them: it works only in a turn where the person ran `/send-to-project`, after a
  confirmation.
- **`SendMessage` cannot be split.** It also follows up a subagent the agent started. A deny names
  the whole tool. The person decided that no agent loses an ability: `SendMessage` stays, and an
  agent can still message a session whose name it knows, such as Nucleus.
- **A resumed session keeps its tools.** `main`'s workspace agent, resumed with no flag after this
  branch rewrote `claude-settings.json`, still listed the three tools, and its `ListAgents` call
  ran. Claude Code 2.1.325 does not apply a new deny to a session it resumes, so an agent started
  before the fix keeps the tools until it is started again.
- **Codex has nothing to deny.** Codex 0.163's `multi_agent` starts subagents in its own thread;
  `agent_message_board` is under development and off.
- **A transcript holds the whole tool list**: `prompt_snapshot.tools` (the loaded tools) plus
  `deferred_tools_delta.addedNames` (the deferred ones). No need to ask the agent.

**Fixed**: `SESSION_TOOLS` (`packages/cli/src/claude-code.ts`) lists `ListAgents` and
`RemoteTrigger`. `agentSettings`, `pageAgentSettings` and `reviewerSettings` deny them, and
`DENIED_TOOLS` takes them from there. The merger's and the advisor's `-p` arguments get
`--disallowedTools`, since they have no settings file. Decision 1078.

**Verification**: the new test `agent-session-tools.test.ts` checks every agent's settings or
arguments. It failed on `main` for the five agents that lacked the deny, and passes now. Six older
tests that compare exact settings or arguments now expect the deny. Real starts in a trusted
scratch repository, Haiku at low effort:

| Start | Tools | `ListAgents` | `RemoteTrigger` | `SendMessage` |
|---|---|---|---|---|
| `main`'s workspace agent | 36 | listed | listed | listed |
| This branch's workspace agent | 34 | absent | absent | listed |
| Nucleus, either build | 6 | absent | absent | absent |
| `main`'s workspace agent, resumed after the rewrite | 37 | listed; a call ran | listed | listed |

The probe sessions were stopped and removed, and the scratch folder deleted. `pnpm check`: 3,806
tests in 275 files. `pnpm build` passed. `pnpm test:e2e`: the viewer 493 of 493, the nexus 32 of
32.
