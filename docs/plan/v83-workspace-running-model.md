# V83 — What a workspace's agent runs on: its model and effort, in its head and on its card

[Index](../PLAN.md) · [Journal](../journal/v83-workspace-running-model.md)

**Status:** built (2026-10-31), on branch `feature/workspace-running-agent-model-and` (a
workspace started in Symbiote, from `main` at `6250957`; `main` merged in at `82cbd6c`); ready
for review. V83a–b built; "As built" and results at the end. The person OK'd the plan
with their answers to its three questions: "1. On the head and each sidenav card. Also, in the
sidenav card, keep the agent action one line only..right now the card keeps growing and
shrinking, and on hover, the tooltip expand the agent action message. 2. Recommended 3. Not now."
— on the head and every card, the effort in words, Nucleus and Scribe unchanged; and a card's
state on one line, its tip saying it whole.

**Problem** (asked: "I want to see clearly at workspace level which agent model and at what
effort it is running."). Only the Brief tab says it, and as the agent started: "Started with
Claude Code at xhigh effort." (`startedWith`, V30b, V47). `WorkspaceAgentState.effort` says of
itself "Its session may have changed it since (Claude Code's `/effort`): Symbiote does not read it
back". Measured on the person's records and transcripts:

| What | Measured |
|---|---|
| The person's workspace records | 120: 116 Claude Code, 3 Codex, 1 Hermes |
| Started without a model (the agent's default) | **103 of 120**: Symbiote cannot name what they run on |
| Started without an effort level | 16 of 120 |
| Claude Code's transcripts of those workspaces with the model and the level on their last answer | **110 of 110** (`message.model`, `requestedModel`, `effort`; Claude Code 2.1.316) |
| What they ran on | Opus 5.5 at xhigh 98, Opus 5.5 at medium 8, Opus 5.5 at high 2, Sonnet 5.5 at low 1 and at high 1 |
| Where the last answer is, at rest | within **14 KB** of the file's end (median 8 KB; files median 6.3 MB, at most 45.7 MB) |
| A transcript's longest line | median 418 KB, at most 1.36 MB (a tool's result): mid-turn the last answer can be that far up |
| Claude Code's hooks | none carries the level; SessionStart carries `model` only on `startup` (1 of the 5 starts Nucleus recorded); every hook carries `transcript_path` |
| Codex 0.163's `Thread` (`thread/read`, which the list already asks) | `model` and `reasoningEffort`: "Current configured … when loaded, otherwise the latest persisted" |

What causes it:
- Symbiote says what it passed at the start (V30b, V47) and reads nothing back; the agent's
  default has no name Symbiote can read before a session answers (V47, decision 337).
- A person changes both in the terminal (`/model`, `/effort`); nothing in the head or on the card
  says either, and Claude Code's own terminal line does not show them here.

**Goal**:

```
⑂  workspace running agent model and effort  [feature]  ✳ Opus 5.5 · xhigh effort     [Stop the agent] ⋯
   feature/… ○ ✳ Running sed … · 5 min

● workspace running agent model and effort   5m      ← a card
  ✳ Running sed -i "s/await page.waitFor…            ← one line, its tip says it whole
  [feature]  ⊸ 0  ⑂ clean
  ✳ Opus 5.5 · xhigh effort                          ← what it runs on, a row of its own
  feature/workspace-running-agent-model-and
```

- **The head**: a chip after the kind chip: the agent's mark, the model by its name, its effort in
  words (the person's choice 2). Its tip: "Claude Code runs on Opus 5.5 (claude-opus-5-5) at xhigh
  effort", "As of its answer at 11:42", and, when it differs, how it started ("Started on its
  default model at xhigh effort").
- **The card** (the person's choice 1): the same words in a row of their own, on every workspace's
  card whose agent is known.
- **A card's state on one line** (the person's ask): what the agent does or what is next, cut with
  "…"; its tip says it whole, as it does today.
- **Before its first answer**: what it started with, said as that ("Started at xhigh effort").
- **Unchanged**: the Brief tab's "Started with…", the Start page, Settings, Nucleus and Scribe (the
  person's choice 3), History's pages, a waiting card's question (two lines), the folded rail;
  `symbiote diff` and `symbiote pr`; no graph or analysis change.

## Where it is read (cli)

- **Claude Code** (decision 659): its transcript, the file Claude Code writes each answer to.
  - Symbiote's hook (`thread.ts`, `threadEntry`) keeps the hook's `transcript_path` on the
    `start` and `prompt` entries (`ThreadEntry.transcript`). A session running before this change
    gives it at its next prompt, once the person's build has it.
  - The list (`summary` in `workspaces.ts`) takes the newest entry's transcript. Its newest answer
    of the main session (not `isSidechain`, not the `<synthetic>` model): `message.model`, else
    `requestedModel`; `effort`; its `timestamp`.
  - Read in a new `workspace-running.ts`, beside `workspace-activity.ts`.
- **When the list reads it** (decision 660): only when the file grew since the last read (its size
  and time, kept in memory per transcript), its last 64 KB. A window with no answer (a long tool's
  result last) keeps what was read before. A view with nothing read yet reads its last 2 MB once.
- **Codex on its app server**: the thread's `model` and `reasoningEffort` from the `thread/read`
  the list makes already (`CodexThread.model`, `.effort`); with no level set, that model's default
  from its list (`model/list`'s `defaultReasoningEffort`), else unsaid.
- **Codex by `exec`, Hermes** (4 of 120): what it started with, as today.
- **The model's name** (decision 661): the agent's list as Symbiote keeps it (V47) when it has it
  in hand; else from the ID (`claude-opus-5-5` → "Opus 5.5", `claude-haiku-4-5-20251001` → "Haiku
  4.5", `gpt-5.6-terra` → "GPT-5.6-Terra"); else the ID. The list never waits on reading the
  agent's models.
- **API**: `WorkspaceAgentState.running?: { model?: string; name?: string; effort?: string; at?:
  string }` — `model` and `effort` stay what it started with. Absent when nothing was read.

## The head and the card (viewer)

- **`runsOn(agent)`** (pure, `workspaces/workspaces.ts`): the words and the tip, from `running`,
  else from what it started with, else null (no agent). The effort in words: "xhigh effort"; a
  model with no level (Haiku 4.5): no level said.
- **`RunsOn`** (`WorkspaceFacts.tsx`): the agent's mark (V53), then the words. In the head after
  `KindTag` (`PageHead`'s `beside`); on the card a row of its own (decision 662), after the kind
  and the facts, before the branch. A row of its own because the facts row has 242 px at the
  300 px sidenav, the kind and two facts take about 200 px, and "Opus 5.5 · xhigh effort" about
  140 px: in that row it would wrap on some cards, and when the merge check loads — a card that
  grows and shrinks, what the person asked to end.
- **The card's state on one line** (decision 663): `.sidenav .workspace-state` cut at one line
  (V79's two, decision 577); its tip unchanged ("Claude Code" and the whole line).
- Styles by the `symbiote-style` skill: existing tokens, the head's line's muted text; no new
  colour.

## Verification

1. **A real run first**: a scratch session on `haiku` at `low`, one turn; `/model sonnet` and
   `/effort medium`, another turn. Whether the transcript follows, and from which answer; what the
   hooks give as `transcript_path`. Two one-word turns, in a scratch folder.
2. **Tests first** (red before):
   - CLI unit: reading a transcript's end (the newest main answer; a subagent's and a synthetic one
     skipped; fields missing; broken lines; a window with no answer; the 2 MB first read); reading
     only a grown file; `threadEntry` keeping `transcript_path`; `summary` giving `running` for
     Claude Code from the newest entry's transcript, for Codex on its server from its thread (a
     level unset: the model's default), none for `exec` and Hermes; the names (the list, the ID's
     pattern, the ID).
   - Viewer unit: `runsOn` — running, as started, changed since the start, no level, no agent.
   - e2e (`workspaces.spec.ts`): the fake Claude Code writes a transcript and gives its path to the
     hooks; the head's chip and the card's row say "Haiku 4.5 · low effort", then follow an answer
     on another model within a poll; before the first answer, what it started with; a card's long
     state on one line, its tip whole; no page errors.
3. **Cost**: the list (`GET /api/workspaces`) on the person's real workspaces, `main`'s build and
   the branch's alternated, median of runs; the transcript bytes read per poll.
4. **Nothing else changes**: `pnpm check`, `pnpm build`, the full `pnpm test:e2e` (`env -u
   WAYLAND_DISPLAY`).
5. **Screenshots** at 1440 × 900, 1×, dark and light: a workspace's page, the sidenav with every
   card's state (the mock list, `page.route`), the folded rail, the 390 px drawer, every page with
   the sidenav.

**Risks**

| Risk | Mitigation |
|---|---|
| The transcript is Claude Code's own format, not documented (`effort` is recent) | Read field by field; a field missing falls back to what it started with; a test pins today's shape (2.1.316) |
| A change in the terminal shows from its next answer, not at the command | The tip says "As of its answer at …" |
| The list polls every 5 s | A transcript is read only when it grew, 64 KB; measured against `main` |
| Sessions started before this change | No transcript path until their next prompt: they show what they started with |
| Cards 24 px taller (a fifth row) | A card's state is one line now: a card that had two lines of state is 4 px taller, not 24 |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V83a | The real run; what runs, read (cli) | `thread.ts`, `workspace-running.ts`, `workspaces.ts`, `app-server.ts`, core `workspaces.ts` |
| V83b | The head's chip, the card's row, one line of state (viewer) | `workspaces.ts`, `WorkspaceFacts.tsx`, `Workspace.tsx`, `Sidenav.tsx/.css` |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 659 | Where does Symbiote learn what an agent runs on? | **Claude Code: its transcript's newest answer, at the path its hooks give; Codex on its server: its thread's `model` and `reasoningEffort`; else what it started with** | 110 of 110 transcripts have both; no hook carries the level; Codex's thread says its current settings |
| 660 | When is a transcript read? | **By the list, only when it grew: its last 64 KB; a window with no answer keeps the last read; 2 MB once when nothing was read** | At rest the answer is within 14 KB of the end; a tool's result can be 1.36 MB; the list polls every 5 s |
| 661 | How is a model named? | **From its ID's pattern, in the viewer; else the ID** (planned: the agent's list when in hand, then the pattern) | Transcripts say `claude-opus-5-5`, which Claude Code's list (`opus`, `claude-opus-4-6`…) does not; the pattern gives the list's names, and reading the list from the list would run Claude Code at every poll after a failed read |
| 662 | Where is it shown? | **A chip after the kind in the head; a row of its own on every card** | The person's choice; in the facts' row it would wrap on some cards and when the merge check loads |
| 663 | A card's state? | **One line, cut with "…" at its end; its tip says it whole** (V79's two lines, decision 577) | The person: "the card keeps growing and shrinking"; a cut at a word left "Running mkdir -p…" and the line's end empty |
| 664 | The level in words or a meter? | **Words: "xhigh effort"** | The person's choice 2; the Brief tab's words |

**Not in V83 (later)**: changing the model or the level from the head; Nucleus's and Scribe's heads
reading their transcripts (the person's choice 3); History's pages; Hermes's and `codex exec`'s own
records of what they ran on.

## As built (V83)

- **What is read, as planned** (decision 659). The real run first (Claude Code 2.1.316, a scratch
  folder): a turn on `haiku` at `low`, then `/model sonnet` and `/effort medium` typed, then a
  turn. The transcript's next answer said `claude-sonnet-5-5` at `medium`. The commands write a
  `system` `local_command` line, not an answer: a change shows from the next answer, as the risks
  said. Real Codex 0.163, no turn spent: a thread started on `gpt-5.6-luna` at `low` read back
  both; one started with nothing read back the configured `gpt-6-luna` at `medium`.
- **`runsOn`, not `running`**: `WorkspaceAgentState.runsOn: { model?, effort?, at? }` with the
  agent's own IDs. A field named `running` read as a yes or no.
- **Named from the ID, in the viewer** (decision 661, changed): `modelName` builds the name from
  the ID's pattern, else gives the ID; the agent's list is not read. Reading it from the list
  would run Claude Code at every poll after a failed read (V47 tries a failed read again at its
  next use). The pattern gives the list's name for every full ID the list has.
- **The icon is the Start page's Model icon** (lucide's cpu), not the agent's mark: a working
  card's state already starts with the mark. The agent's name is in the tip.
- **A Codex level unset**: the thread says the configured one (the real run), so the model's list
  is not read for it.
- **A card's state is cut at its end** (`nowrap` and an ellipsis), not by `-webkit-line-clamp: 1`.
  The clamp broke at the last word that fit: "Running mkdir -p…" with the rest of the line empty,
  a path being one long word.
- **The head's chip gives way before the title** (`flex-shrink: 100`, its icon at least): at
  390 px it left the title 5 letters ("worksp…"). At 1440 px it is whole beside a 40-letter title.
- **Tests changed knowingly**: the fake app server answers a thread's model and level as real
  Codex does, so two V27a tests now see the configured `gpt-6-luna` at `medium`; `look.spec.ts`'s
  V79 card is 164 px (140), its fifth row.

**Results.**

| What | Before (`main`) | V83 |
|---|---|---|
| The person's 4 live Claude Code workspaces with a transcript (read by V83's reader) | the Brief tab: "Started with Claude Code at xhigh effort", the model named for 1 of 4 | head and card: "Opus 5.5 · xhigh effort", 4 of 4, read from their newest answers |
| A working card at 300 px, the mock of the person's list and a Codex card | 140 px, 160 px when a long command takes two lines of state | 164 px, whatever its agent runs |
| The head at 1440 px, a 40-letter title | — | the title whole, the chip whole (169 px) |
| The head at 390 px | — | the title "workspace running agen…", the chip its icon |
| A model row at a 264 px sidenav | — | one line, none cut |

Cost, per Claude Code workspace and poll of the list, on the person's 114 workspace transcripts
(`packages/cli/dist`, median, two runs): a transcript unchanged 0.08–0.10 ms (a `stat`); grown,
its last 64 KB read and parsed 0.35–0.41 ms (at most 1.89); the first read, up to 2 MB, 1.24 ms
with the files in the page cache, 7.68 ms without (at most 15.04). The list's request on the
person's running view (`main`'s build, 5 workspaces) takes 196 ms (median of 5): V83 adds about
0.2 % when every transcript grew. The last 64 KB held the newest answer in 113 of 114; the other
was mid-turn, and the first read's 2 MB found it. Codex adds no request (its `thread/read` was
made already).

Tests: `pnpm check` 2,550 unit tests; e2e: the viewer's 363 (V44's guard of a card's icons now leaves out the model row's, as it does the facts'), the nexus's 20. Not verified: a Codex workspace through Symbiote's list with the real Codex (its
`thread/read` measured alone; the fake answers as it did); Codex by `exec` and Hermes, unchanged
(4 of 120 records); a session from before V83 picking the path up at its next prompt, with the
person's build (the hook's code is the same for both events, tested on each).
