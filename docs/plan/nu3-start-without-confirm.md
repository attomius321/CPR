# NU3 — Nucleus starts workspaces without a Confirm

[Index](../PLAN.md) · [Journal](../journal/nu3-start-without-confirm.md)

**Status:** building (2026-11-02), on branch `feature/nucleus-start-without-confirm` (the
workspace's, from `main` at `e23651c`).

**Problem** (the brief: "Add a setting, off by default, that lets Nucleus … start a workspace
without the person's Confirm in Symbiote"; the person's addition: "in Hive mode this setting is
enabled"). Every `start_workspace` Nucleus calls through Symbiote's MCP waits for the person's
Confirm, 10 minutes at most (decisions 360, 361), with the settings it starts with in its words
(decision 584). A person who has already told Nucleus what to start presses Confirm a second time.
In Hive mode, where nothing is meant to wait for the person (decision 688), Alpha Ceph's start
still waits: HV4 left it "until HV7" (HV4's plan, its Start row and "Not in HV4").

**Goal**: a setting in Settings, off by default and for this repository only, with which Nucleus's
`start_workspace` starts at once. While Hive is on, it starts at once whatever the setting says.
Every other asked tool (`restart_agent`, `clean_workspace`, `finish_review`, every merge action)
still waits, and so does every call of the person's own agents through `symbiote mcp`. A start
without a Confirm is recorded in Nucleus's activity, marked so. **With the setting off and Hive off,
nothing changes**: the same asks, records, tool descriptions and instructions, byte for byte.

## The setting (`nucleus-start.ts`, `server.ts`)

- Kept in `symbiote/nucleus-start.json` (`{ "withoutConfirm": true, "since": "<ISO date>" }`),
  beside `hive.json` and placed as it is (`reviewPlace`: the main checkout's `symbiote/`, so every
  worktree shares it; Symbiote's cache where the reviews are kept there). A missing, broken or
  foreign file reads as off; a file git tracks reads as off, so a commit never turns it on for
  every clone (Hive's rule, decision 621). Not `symbiote/config.json`: agents edit and commit it.
- `GET /api/nucleus/start-confirm` answers `{ withoutConfirm, own, hive }`: what holds now, the
  person's own choice, and whether Hive is on. `POST { withoutConfirm }` sets the person's choice;
  refused (409) while Hive is on, as Settings shows it.
- No MCP tool reads or changes it. Nucleus's gate already denies it every write and every command
  but git's read commands (V35, decision 236).

## Hive mode

- Hive on or off is what HV4's branch reads too: `HiveRecord.on()`, `symbiote/hive.json` in the
  main checkout, a tracked one read as off. Read at each call, as the setting is.
- While Hive is on, Nucleus's (Alpha Ceph's) `start_workspace` starts at once whatever the setting
  says; the person's choice stays stored, and holds again once Hive is off.
- HV4 (decision 772) turns Hive on only when no normal-mode workspace is open, and `workspaces.start`
  marks a workspace started while Hive is on `hive: true`: a start Alpha Ceph makes without a
  Confirm is a Hive workspace.

## The MCP (`mcp.ts`)

- `McpOptions.withoutConfirm()`: why Nucleus's start goes without a Confirm now, `'hive'`,
  `'setting'` or none. The server gives it from the two records; Hive first.
- Only `start_workspace`, only for `via: 'nucleus'`: checked as before (`asking.start_workspace`),
  then no ask is held and the start runs (in `exclusive`, as before). The answer is
  `{ workspace, withoutConfirm: 'setting' | 'hive' }`: a conversation that read the tools before the
  setting changed learns it from the answer.
- `tools/list` and `initialize` for Nucleus say it: `start_workspace`'s description ends "Starts at
  once, without the person's Confirm: …" in place of "Waits for the person's Confirm…", and the
  instructions name `start_workspace` as the one that does not wait. For every other caller, and
  for Nucleus with both off, the texts are today's.
- Nucleus's prompt (`prompts.ts`, `NUCLEUS`) is unchanged: the tool's description and the server's
  instructions carry the change, and with the setting off nothing changes.

## The record (core `nucleus-activity.ts`, the viewer's activity, the export)

- `ConfirmStage` gains `{ stage: 'skipped'; why: 'setting' | 'hive' }`: one `confirm` line with the
  call's words and its own `ask` ID, between the call's start and end.
- The Activity tab shows it as "Started without a Confirm: <words>", said "Your setting" or "Hive
  mode", with what the start did as its detail. The Markdown export: "Started without a Confirm
  (your setting): <words> (`start_workspace`)".
- Records from before read as before; an older viewer shows the line as a Confirm without an end.

## Settings (`SettingsPage.tsx`)

- Nucleus's page (Alpha Ceph's while Hive is on) gains a row, **Start workspaces without a
  Confirm**, a switch, before its prompts: "This repository only, kept out of git. Starting an
  agent again, verdicts, merges and clean-ups still wait for your Confirm."
- While Hive is on: on and not changeable, "On while Hive mode is on. Your own choice (off) holds
  again when Hive is off."

## Verification

1. **Unit tests, red first** (`mcp.test.ts`, `nucleus-start.test.ts`, `server.test.ts`,
   `activity-export.test.ts`, the viewer's `activity-nucleus.test.ts`):
   - both off: every test as on `main`; `tools/list` and `initialize` identical;
   - the setting on: Nucleus's start runs with no ask held, recorded start, `confirm skipped`, end;
     the answer says `withoutConfirm: 'setting'`;
   - the setting on: `restart_agent`, `clean_workspace`, `finish_review` and every merge tool still
     hold an ask; `symbiote mcp`'s callers still asked;
   - Hive on, the setting off: started with `why: 'hive'`; Hive off again: asked;
   - the descriptions and instructions follow the setting for Nucleus only;
   - the record: off by default, a broken file off, a tracked file off; the POST refused while
     Hive is on.
2. **e2e** (`mcp.spec.ts`): through the bridge `--as nucleus`, with the switch off a Confirm on the
   page; turned on in Settings, the start answers at once, its workspace in the sidenav and
   Nucleus's Activity "Started without a Confirm"; `restart_agent` still asks; Hive on, the switch
   on and disabled.
3. `pnpm check`, `pnpm build`, `pnpm test:e2e`; Settings → Nucleus seen in both themes, Hive on.

**Risks**

| Risk | Mitigation |
|---|---|
| Any local process can call as Nucleus (`symbiote mcp --as nucleus`, the header) and, with the setting on, start a workspace without a Confirm | Measured: a key in Nucleus's environment does not reach its bridge (decision 787). Documented; only starts, never a merge or a verdict; each recorded |
| A workspace agent turns the setting on with a request to the local server, as it can turn Hive on today | The same limit as Hive's switch; noted |
| Hive turns off between the check and the start | A few milliseconds; the record says why it went without a Confirm |
| A conversation's tool list read before the setting changed | Each answer says `withoutConfirm` |

**Order**: core types and the record first, then the MCP, the server, the activity, Settings,
e2e, docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| NU3 | The setting, the MCP, the record, Settings | tests, e2e, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 782 | Where the setting is kept | **`symbiote/nucleus-start.json` beside `hive.json`, never committed (a tracked file reads as off), off by default; set only on Settings' page (`/api/nucleus/start-confirm`); no MCP tool reads or sets it** | The brief: only the person changes it; a commit must not turn it on for every clone (621's reason) |
| 783 | Hive mode | **While Hive is on (`HiveRecord.on()`, as HV4 reads it), Nucleus's start goes without a Confirm whatever the setting; Settings shows it on and not changeable; the person's choice holds again when Hive is off** (replaces HV4's "Alpha Ceph's Confirm on a start stays until HV7") | The person's addition to the brief |
| 784 | What skips the Confirm | **Only `start_workspace`, only Nucleus's calls; its description, the server's instructions and its answer (`withoutConfirm`) say so; every other asked tool and every `symbiote mcp` caller wait as before** | The brief; out of scope: the rest |
| 785 | The record | **A `confirm` line with `stage: 'skipped'` and `why`, shown "Started without a Confirm" in the Activity tab and the export** | The brief: recorded, marked as started without one |
| 786 | Where the switch is | **On Nucleus's page in Settings, before its prompts** | Where the person sets what Nucleus does; Hive's page is Hive's alone |
| 787 | Who counts as Nucleus | **The bridge's `--as nucleus` header, as since MC1; not a key** | Measured: a `claude --bg` session's MCP server does not get the starter's environment (`NU3_PROBE_KEY` null), and a key on disk is readable by every agent of the same user, as `/proc` is. The plan's first choice, a per-view key, cannot reach Claude Code's Nucleus |

**Not in NU3 (later)**: skipping the Confirm for anything but a start; a stronger proof that a call
is Nucleus's; telling a running conversation of a changed setting other than in an answer.
