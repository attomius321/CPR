# Journal: V84 — Export activity

[Index](../JOURNAL.md) · [Plan](../plan/v84-activity-export.md)

## V84 spike — where activity is kept, and which format reads (2026-10-31, branch `feature/export-activity`)

Read on `main` at `21e510e`: the Activity tabs' sources (V48f, V73, V77, NU2) and the person's
records in `symbiote/` (read only): 124 workspace records, 121 threads, 67 tools files, Nucleus's
file. A prototype (in the job's folder, not committed) rendered each of the 67 workspaces with
recorded tools as Markdown, two ways: one line a call with a failed call's output, and every
call's input and output.

**Learned**:
- **The activity is not one file**: a workspace's tab merges its record, thread, tools, commits and
  verdict in the browser; Codex on its app server and Hermes are read from the agents' own stores.
  An export has to be made where all of them are read: the CLI.
- **The raw records are too big to read whole**: median 154 KB, largest 796 KB (~200K tokens).
  The Markdown with a failed call's output only: median 36 KB, p90 75 KB, largest 94 KB (~24K
  tokens). With every output: p90 404 KB. Outputs are what makes a workspace's record big.
- **A workspace's record holds what its commands printed**, unredacted (only Nucleus's are, NU2):
  an export has to redact.
- **Times**: the prototype's `HH:MM:SS` lines lose the day; a workspace can span days (the tab
  draws a day's row). Day headings, and the time zone in the front matter.

## V84 — Export activity, built (2026-10-31, branch `feature/export-activity`)

Built as planned, decisions 668–672: the export in the CLI (`activity-export.ts`), read whole by
the workspaces service and Nucleus's page agent, out through two routes, `symbiote activity`, the
MCP's `activity` and Export on the three Activity tabs.

**Learned**:
- **A real run finds what fixtures do not**: Nucleus's e2e drives the built gate and hooks, and
  its export said **failed** for a call the person declined, and "allowed: the web…" on every web
  call. Both fixed; the unit fixture now has a declined Confirm and an allowed call.
- **`pgrep -f` with the view's own command line matched this session's shell**: the shell that
  ran `kill $(pgrep …)` and then started the view again had that command line in it, and was
  killed with the view (exit 144). Kill by the PID kept from `$!`.
- **A menu right-aligned to a button that is not at the bar's end** runs off a phone's screen
  (−25 px at 390 px). Measure the menu's box at 390 px, not only the page's overflow, which was 0.
- **Markdown survives agents' text**: quoting every line of a message and fencing outputs one
  backtick longer than their longest run kept all 125 real exports' structure, read back by
  `marked`.
- **The MCP's text**: `JSON.stringify` of a Markdown answer escapes its line breaks; a string
  answer is now sent as it is.

**Verification**: tests first for the export, the routes, the command and the MCP tool (red for
the right reason); the services' tests and the e2e after their code. `pnpm check` (179 files,
2,550 tests); the 10 activity e2e specs; the person's 124 records and Nucleus's file exported from
a scratch copy (sizes, structure, front matter, secrets: the plan's results); screenshots at 1440
and 390 px, dark and light.

Not verified: a running Codex workspace on its app server and a running Hermes workspace; the
desktop app's download and Copy; Firefox and Safari; a fresh agent reading an export.

