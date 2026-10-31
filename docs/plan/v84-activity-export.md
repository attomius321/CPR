# V84 — Export activity: a workspace's or Nucleus's, as Markdown for a person or an agent

[Index](../PLAN.md) · [Journal](../journal/v84-activity-export.md)

**Status:** ready for review (2026-10-31), on branch `feature/export-activity` (a workspace
started in Symbiote, from `main` at `21e510e`). The person asked for the plan and to start
implementing with its recommendations ("Make the plan, and start implementing with your own
recommandations"). Its "As built" and results below.

**Problem** (asked: "I need a way to export activity of a workspace. Find the right format. This
will be read by me or another agent. Any activity should be exportable (including Nucleus)").
Measured on `main` at `21e510e`, on the person's records (`symbiote/`, read only):

| What | Found |
|---|---|
| Where a workspace's activity is | Four places merged by the Activity tab in the browser (V73): its record (`workspaces/<branch>.json`), its thread (`threads/<branch>.jsonl`), its tools (`activity/<branch>.jsonl`), its commits (git) and its review's verdict; Codex on its app server and Hermes from their own stores |
| Where Nucleus's is | `nucleus-activity.jsonl` (NU2), and `nucleus-activity.1.jsonl` past 4 MB |
| A way to take it out | None. The tab's Raw events view shows lines on the page only; the files are JSON Lines in four folders, and the app server's and Hermes's are not files at all |
| Workspaces with recorded tools | 67 of 124 records. Their raw records (record, thread, tools): median **154 KB**, p90 541 KB, largest **796 KB** (`feature/nucleus`) |
| Calls a workspace | median 164, p90 302, most 355; failed calls: median 2, most 11; turns (messages given): median 5, most 23 |
| Nucleus | 509 lines, 500 KB, 6 conversations (30 Oct 17:10 to 31 Oct 10:04): 35 messages, 203 calls (26 Symbiote's own), 14 Confirm lines |
| Secrets | Nucleus's lines are redacted when written (NU2, decision 608); a workspace's are not: its commands' inputs (8 KB) and outputs' ends (2 KB) are kept as the agent ran them |

**A prototype of the format** (the journal's spike): the same 67 workspaces rendered as Markdown,
one line a call and the messages and reports whole:

| Rendering | Median | p90 | Largest |
|---|---|---|---|
| The raw records (JSON Lines) | 154 KB | 541 KB | 796 KB |
| Markdown, a failed call's output only | **36 KB** | **75 KB** | **94 KB** |
| Markdown, every call's input and output | 52 KB | 404 KB | 614 KB |

At about 4 bytes a token, the lean Markdown of the largest workspace is ~24K tokens: an agent reads
it whole. Its raw records are ~200K, more than most agents' context.

**Goal**: every activity Symbiote shows on an Activity tab — a workspace's, a finished one's in
History (V77), Nucleus's (NU2) — can be taken out as one file a person reads in any editor and an
agent reads whole: from the tab (download or copy), from a terminal (`symbiote activity`), and
through Symbiote's MCP (`activity`). **Unchanged**: what is recorded and how; the Activity tabs'
timelines; every existing API answer.

## The format (decision 668)

**Markdown**, one file, `symbiote-activity` version 1:

- **Front matter** (YAML, every string JSON-quoted so it parses): `symbiote-activity: 1`, `of`
  (`workspace` or `nucleus`), `repository`, `branch`, `title`, `kind`, `agent` (kind, model,
  effort), `created`, `finished`, `base`, `from`, `worktree`, `exported`, `first`/`last` (the
  span), `timezone`, counts (`messages`, `calls`, `failed`, `commits`), and `complete: false` with
  `missing` when part of the activity could not be read (below). An agent reads the facts without
  reading the timeline.
- **`# Activity: <title>`**, a line saying what it is, then **`## Brief`** (quoted whole).
- **The timeline**, oldest first, a `##` heading a day (`## Fri 31 Oct 2026`):
  - the milestones as `###` headings with their time, their text quoted whole under them:
    Symbiote's prompt and the person's messages, the agent's reports (Nucleus's answers, with
    their tokens and time), a question or permission asked, the review's verdict (its text for the
    agent);
  - between them, one list item a call: `10:06:12 · Bash · \`git log -5\` · exit 0 · 0.2 s — the
    agent's words`; an edit's `+12 −3`; a failed call **failed** with its recorded output and its
    whole input fenced under it; a call still running "no end recorded";
  - the session's events (started, ended and why, a notice), commits (`abc1234 subject`) as list
    items at their times;
  - Nucleus: a `###` heading where the conversation changes, the gate's refusal and its reason,
    the pages read and a search's results under their call, Symbiote's own record of its tools,
    each Confirm asked and how it ended, compactions and errors.
- Quotes and fences keep the agents' text from being read as the export's structure: a fence is
  one backtick longer than the longest run in its text.

**JSON Lines** as the second format (`--format jsonl`): a header object, then every line as
Symbiote read it, oldest first, each with `record` naming its source (`workspace`, `thread`,
`tool`, `commit`, `verdict`, `nucleus`). It is lossless (every input and output recorded): for a
tool or a script (`jq`), not for reading.

Why Markdown: it is the format both readers already read — a person in any editor or rendered,
an agent as text it was trained on — and it is 4× smaller than the records (above): the median
workspace is ~9K tokens. JSON is what the records are, and is too big and too noisy to read; a
web page or PDF would serve the person and not the agent.

## Where it is made (decision 669)

In the CLI, once: `activity-export.ts`, pure (sources in, text out), and each service gathers its
sources:

- `Workspaces.exportActivity(branch, format)` (`workspaces.ts`): the record, the **whole** thread
  and the **whole** tools file (the tab reads the newest 1 MB; the largest file is 755 KB),
  commits (`changes`, 100 at most, as listed), the verdict; Codex on its app server its last 50
  turns as the tab reads them; Hermes its session. A finished workspace whose agent's store is
  not asked (V77, decision 564) exports its record, commits and verdict, and says so
  (`missing`).
- `PageAgent.exportActivity(format)` (Nucleus's only): both files whole, read after what is being
  written.
- The viewer never builds it: it imports only types from core, and the export must be the same
  from the tab, the terminal and the MCP.

## What is kept out (decisions 670, 671)

- **Secrets** (670): NU2's `redactDeep` on every string of both formats, by the server's
  environment and the token shapes. A workspace's records are written as the agent ran its
  commands; an export is the record that leaves the machine.
- **Size** (671): the Markdown gives a call's output only when it failed (the debugging part);
  the JSON Lines give everything recorded. Nothing is cut beyond what was recorded.

## The ways out (decision 672)

- **The tab**: an **Export** button on every Activity tab's bar (a workspace's, History's,
  Nucleus's), a menu: *Download Markdown*, *Download JSON Lines*, *Copy Markdown*. Downloads are
  `GET /api/workspaces/activity/export?branch=&format=` and `GET /api/nucleus/activity/export?format=`
  with `Content-Disposition: attachment`, named `activity-<repository>-<branch>-<date>.md` (or
  `…-nucleus-…`). Copy reads the same address and writes the clipboard: an agent's chat takes a
  paste.
- **The terminal**: `symbiote activity [<branch>] [--nucleus] [--format markdown|jsonl] [--out
  <file>]`, to stdout by default. Without a branch, the checked-out branch's workspace: an agent in
  its worktree runs `symbiote activity`. No running `symbiote view` needed.
- **Symbiote's MCP**: `activity` (`branch`, or `nucleus: true`), the Markdown as the tool's text,
  the newest messages that fit in 60 KB (~15K tokens, under Claude Code's MCP answer limit), with
  a line saying how many were left out and the command that gives all.

## Verification

1. **Tests first**, red for the right reason: the Markdown of a recorded workspace (a prompt, an
   ask, calls ending well, failing and never ending, an edit, a commit, a report, a verdict, a
   second day), of Nucleus (two conversations, a refused call, a page, a search, Symbiote's record,
   a Confirm declined, tokens); a quote and a fence that hold backticks and headings; the front
   matter parsed back; secrets planted in a command and an output redacted; JSON Lines lossless
   (every line back by `record`); the MCP cut by messages; the API's headers; the command's
   options and its branch from the checkout.
2. **The tabs**: e2e — Export on a workspace's tab downloads the Markdown with its calls, JSON
   Lines too, Copy fills the clipboard; Nucleus's tab; History's.
3. **Real records**: every one of the person's workspaces and Nucleus's file exported from a
   scratch copy (read only, as V74's screenshots): no error, sizes against the prototype's, the
   largest read by a fresh agent with only the file ("what did the agent do, what failed").
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`; screenshots of the menu, dark and light, 1440 and
   390 px.

**Risks**

| Risk | Mitigation |
|---|---|
| A secret leaves the machine in an export | Redacted as NU2's record is; the tests plant each shape |
| An agent's text breaks the Markdown | Quoted and fenced longer than any backtick run in it; tested |
| A big export in the MCP's answer | The newest messages within 60 KB; the command gives all |
| The app's download | Electron's own Save dialog (no handler today); Copy works everywhere |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V84a | The export | `activity-export.ts`, the services' gathering, the API, `symbiote activity` |
| V84b | Symbiote's MCP | `activity` |
| V84c | The tabs | Export on the three Activity tabs, e2e, screenshots, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 668 | The format | **Markdown with YAML front matter, one file; JSON Lines as the lossless second** | Both readers read Markdown; 36 KB median against 154 KB of records |
| 669 | Where it is made | **In the CLI, once, pure; the tab, the command and the MCP use it** | One export everywhere; the viewer imports only types |
| 670 | Secrets | **Every string redacted by NU2's `redactDeep`** | A workspace's records are not redacted when written |
| 671 | How much | **The whole record; in Markdown a call's output only when it failed** | Lean Markdown p90 75 KB, with every output 404 KB |
| 672 | The ways out | **Export on every Activity tab (download, copy); `symbiote activity`; MCP `activity` within 60 KB** | "Read by me or another agent": the person hands it over, or the agent takes it |

**Not in V84 (later)**: Scribe's activity (nothing is recorded, NU2); the merges' logs (V46, their
own page and format); an export of several workspaces at once; the timeline's phases (the tab's
classification lives in the viewer: the export is the record, in time order).

## As built (V84)

- **Built as planned**: `packages/cli/src/activity-export.ts` (pure, every string redacted first),
  `Workspaces.exportActivity`, Nucleus's `exportActivity` (`page-agent.ts`), the two
  `…/activity/export` routes, `symbiote activity`, the MCP's `activity`, and `ExportMenu.tsx` on the
  shared `ActivityTimeline`'s bar (a workspace's tab, History's, Nucleus's).
- **A declined Confirm is not a failure.** Nucleus's real e2e run showed Symbiote's
  `start_workspace` as **failed** with "The person declined" under it. NU2's tab counts it as
  declined; the export now does too: "declined by the person" (or not answered in time, or its
  call ended first), no output, not in `failed`.
- **The gate's allow reasons are left out.** Every web call said "allowed: the web, as its agent
  reads it (NU1)". A refusal and its reason stay; the JSON Lines keep every decision.
- **A call under a second is in milliseconds** ("12 ms", not "0 s"): Claude Code's Bash calls
  are often under 50 ms.
- **Export on a phone's width**: its menu opened from the button's right edge, 25 px off the
  window at 390 px; it opens from its left edge now. Under 520 px the button shows its icon
  alone, its word kept as its name, so the counts keep room.
- **The MCP's answer is the Markdown itself**: a tool's text answer is now sent as it is (any
  other value as its JSON, as before), not as a JSON string with escaped line breaks.
- **Nucleus's export reads, never rotates**: the tab's read moves the file past 4 MB; the export
  reads both files whole and writes nothing.
- **Copy** writes a promised clipboard item while the export is read, so the click's permission
  holds in Chromium; a browser without promised items gets the text once read.
- **Not done**: the reader test by a fresh agent (planned in Verification 3); this session
  starts no agent unasked. The exports' structure was checked by a parser instead (below).

**Results.** Tests first, red for the right reason, for the export (the module missing), the
routes (404), the command (unknown command) and the MCP tool (unknown tool); the services' tests
and the e2e were written after their code. 12 tests for the export, 3 for the workspace service,
1 for Nucleus's, the routes in `server.test.ts`, 5 for the command, 2 for the MCP tool; e2e: the
workspace's tab (both downloads, their names and contents, the clipboard), Nucleus's and
History's. `pnpm check`: 179 files, 2,550 tests (2,547 after `main` was merged in). `pnpm
test:e2e`, 363 viewer tests: the first run failed one, `mcp.spec.ts`'s count of Symbiote's tools
(24, now 25 with `activity`; fixed); the second, on the merged tree, failed two timed waits under
the machine's load (`merges.spec.ts:56`, a resolution in 5 s; `nucleus.spec.ts:437`, a record read
after New conversation), paths this branch does not change: `merges`, `nucleus` and `mcp` specs
then passed alone, 26 of 26. The nexus's 20 pass.

| What | Result |
|---|---|
| The person's 124 workspace records and Nucleus's file, copied into a scratch repository (read only), exported by the built `symbiote activity` | 248 runs, both formats: no failure; ~330 ms a run, Node's start most of it |
| Markdown, the 67 workspaces with recorded tools | median **38.7 KB**, p90 75.6 KB, largest **100.8 KB** (the prototype: 36, 75, 94) |
| JSON Lines, the same 67 | median 177 KB, p90 549 KB, largest 806 KB |
| Nucleus's (509 lines, 6 conversations) | Markdown 121 KB, JSON Lines 510 KB |
| The Markdown read back by `marked` (CommonMark) | 125 files: 13,398 list items and 872 headings, as written; no agent's text added or broke one |
| Front matter (PyYAML) and JSON Lines | 125 front matters parse; 26,641 JSON lines parse |
| Secrets | No token shape left in any export (the 3 matches of a loose search are the redaction's own regular expressions, quoted in records) |
| `complete: false` | 54 workspaces whose agents started before calls were recorded (V48f), 2 finished on Codex's app server, 1 finished on Hermes |
| The MCP's 60 KB | Nucleus's 121 KB → 48 KB, its 20 oldest of 35 messages left out and said; the largest workspace 101 KB → 45 KB, its first turn left out |
| Screenshots, History's and Nucleus's tabs with the menu open: 1440 and 390 px, dark and light | No horizontal overflow, no page errors; the menu inside the window at both widths |

**Not verified**: an export of a running Codex workspace on its app server (`symbiote activity`
starts Codex's app server to read it, as `symbiote merge` starts Codex for its levels) and of a
running Hermes workspace (unit-tested readers only); commits in the scratch copy (it had none of
the branches: real commits are listed by `changes`, as the e2e's History export shows); the
desktop app's download (Electron's own Save dialog; no handler) and Copy there; Firefox and
Safari; a reader test by a fresh agent.
