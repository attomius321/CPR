# Fix: no agent lists the person's other sessions or runs their routines

[Index](../PLAN.md) · [Journal](../journal/fix-agents-no-session-messages.md)

**Status**: built, ready for review. Branch `fix/agents-no-session-messages`.

## Problem

Claude Code 2.1.325 gives its default tool set `ListAgents`, `SendMessage` and `RemoteTrigger`.
`ListAgents` lists the person's other sessions on this machine, Nucleus among them. `SendMessage`
writes to one. `RemoteTrigger` creates and runs the person's claude.ai routines as the person,
and a routine may post into an existing session. HV10 denied all three to a writer started from
an issue (decision 1068). Every other agent Symbiote starts with Claude Code's default tools kept
them: the workspace agent in normal mode and in Hive. A `claude -p` probe with the default tools
listed all three. A message an agent sends this way passes by Symbiote's record.

## Goal

Deny `ListAgents` and `RemoteTrigger` to every agent Symbiote starts. Take no other ability away
from an agent.

`SendMessage` stays. It also sends a follow-up to a subagent the agent started, and the person
decided that an agent keeps every ability it has. A deny rule names a whole tool, so it cannot
keep the follow-up and refuse another session. An agent can therefore still message a session
whose name it knows, such as Nucleus, though it can no longer list them.

`SendToProject` and `SendToProjectContext` stay too. They work only in a turn where the person
ran `/send-to-project`, and they show the person a confirmation first. claude.ai's other tools
and connectors (`Artifact`, `DesignSync`, `PushNotification`…) are not this fix's decision.

## Design

`SESSION_TOOLS` (`packages/cli/src/claude-code.ts`) lists the two tools. Each agent gets it
denied where its settings come from:

| Agent | How it starts | Had (2.1.325) | Has now |
|---|---|---|---|
| Workspace agent, normal mode and Hive | `--bg`, `claude-settings.json` (`agentSettings`), no `--tools` | all three | `SendMessage`; the two denied in the settings file |
| Hive writer from an issue | `--bg`, its own settings file (`issueWriterSettings`) | none: 1068 denies all three | unchanged; `DENIED_TOOLS` takes the two from `SESSION_TOOLS` |
| Nucleus, Scribe | `--bg --tools …`, their gate's settings file (`pageAgentSettings`) | none listed under `-p`; their gate refuses any other tool when called | the two denied in the settings file too |
| Hive's running reviewer | `-p --tools Bash,Read,Edit,Write,Grep,Glob`, `reviewerSettings` | none listed | the two denied in its settings |
| The merger's agent | `-p --tools Read,Grep,Glob`, no settings file | none listed | `--disallowedTools ListAgents,RemoteTrigger` |
| The advisor | `-p --tools ''` | no tools | `--disallowedTools` as the merger |
| The models probe | `-p --tools ''`, never takes a turn | no tools | unchanged |
| Codex (workspaces, Nucleus, Scribe, merger, advisor) | Codex 0.163 | no such tools: its `multi_agent` starts subagents in its own thread; `agent_message_board` is under development, off | unchanged |

An agent started before the fix keeps the two tools until it is started again. The shared
settings file is written again when its text differs, but Claude Code 2.1.325 does not apply a
new deny to a session it resumes (see Results).

## Verification

- A test of every agent's settings or arguments (`packages/cli/test/agent-session-tools.test.ts`),
  red on `main` for the five agents that lacked the deny.
- A real normal-mode start and a Nucleus start in a trusted scratch repository, `main`'s build
  and this branch's: the transcript's tool list.
- `pnpm check`, `pnpm build`, `pnpm test:e2e`.

## Decisions

1078 was free on `main` and every branch on 2026-11-14 (HV11's branch goes to 1077).

| # | Question | Decision | Why |
|---|---|---|---|
| 1078 | Which of Claude Code's tools that reach the person's other sessions does every agent Symbiote starts lose? (extends 1068's `ListAgents` and `RemoteTrigger` to every agent) | **`ListAgents` and `RemoteTrigger`, in each agent's settings file or as `--disallowedTools` where it has none. `SendMessage`, `SendToProject` and `SendToProjectContext` stay; an issue's writer keeps 1068's deny of `SendMessage`** | They list the person's sessions and run their routines as the person, past Symbiote's record. `SendMessage` also follows up the agent's own subagents, and an agent keeps every ability it has (the person's call); `SendToProject` needs the person's own `/send-to-project` and a confirmation |

## As built

Planned first with `SendMessage` denied too, as the brief asked. The person decided that no agent
loses an ability. `SendMessage` stays in every agent but an issue's writer, and `RemoteTrigger`
joined the list.

The plan said a running agent would take the deny when it wakes. The real run showed it does not
(below), so the docs say an agent keeps the tools until it is started again.

## Results

Real starts in a trusted scratch repository (`/tmp/hv10a-reach/loc`, removed after), Claude Code
2.1.325, Haiku at low effort, each agent asked to reply "ok". The tool list is read from each
transcript: `prompt_snapshot.tools` plus `deferred_tools_delta.addedNames`.

| Start | Tools | `ListAgents` | `RemoteTrigger` | `SendMessage` |
|---|---|---|---|---|
| `main`'s build (10 November, no deny since HV10): a normal-mode workspace agent | 36 | listed | listed | listed |
| This branch's build: a normal-mode workspace agent | 34 | absent | absent | listed |
| `main`'s build: Nucleus (`--bg --tools`) | 6: `Bash Glob Grep Read WebFetch WebSearch` | absent | absent | absent |
| This branch's build: Nucleus | the same 6 | absent | absent | absent |
| `main`'s workspace agent resumed with no flag, after this branch rewrote `claude-settings.json` | 37 | listed, and a `ListAgents` call ran | listed | listed |

Neither workspace agent listed a claude.ai connector (Gmail, Drive…) or another MCP server. Both
listed claude.ai's `Artifact`, `ArtifactData`, `ArtifactComments`, `DesignSync`,
`PushNotification`, `SendToProject` and `SendToProjectContext`.

`pnpm check`: 3,806 tests in 275 files. `pnpm build` passed. `pnpm test:e2e`: the viewer 493 of
493, the nexus 32 of 32.
