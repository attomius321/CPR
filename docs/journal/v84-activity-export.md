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
