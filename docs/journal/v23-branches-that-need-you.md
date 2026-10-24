# Journal: V23 — Branches that need you, first in the branches panel

[Index](../JOURNAL.md) · [Plan](../plan/v23-branches-that-need-you.md)

## V23 — Branches that need you, first in the branches panel (2026-10-18, branch `feature/sort-branches-by-last-agent-action`)

Asked, as a feature started in Symbiote: "sort the commits from Commits page by last agent action...so
i can see the branches that need my attention at the top", then "we need to sort the Branches from
the left side of the commits page". Planned as V22; `main` took V22 and decision 119 meanwhile,
so it is V23 with decisions 120–121. In the panel's Local list the open features that need the
person come first, the one whose agent acted last on top, then those whose agent works, each with
a short age; then the checked-out branch and the rest by name, as before.

**Learned**:
- **Claude Code keeps no time of a session's last activity**: `claude agents --json --all`
  (2.1.302) gives `startedAt`, `state` and `status` only. Symbiote's thread has the times, but not all
  of it is the agent's: `chore/update-readme`'s last entries were an `idle_prompt` notice a minute
  after its report and a `/clear` (an end and a start) three days later. Only reports and
  questions count.
- **`symbiote view` from a branch's build rewrites `symbiote/claude-settings.json`** to that build's hook
  whenever it lists features: never run it in the person's checkout to measure. Measured on a
  clone with copies of the records and threads instead.
- **Reading every thread on every list costs with long threads**: before, a thread was read only
  for a blocked session; now it is read for each feature with an agent, every 5 s while one works
  or waits. 9.6 ms for a 5,000-entry thread whole, 0.6 ms for its last 256 KB.
- **The page stops reading the features once none works or waits** (V18b's rule): the e2e's
  first draft answered an agent after both had reported, and the page never saw it. A change made
  then shows when the page is back in view.
- **The age costs names about five characters** in the 260 px panel; the full name stays the
  entry's title.

**Verification**: tests first — 6 unit tests red before the code (CLI 3, viewer 3), one guard
green; the new e2e test red on `main`'s build at its first order. 730 unit tests, 103 e2e. On a
clone of this repository with two made-up features beside its own, Chromium at 1440 × 900 light
and dark and the 880 px overlay: the three open features are the first three local entries
(`main`'s build: 4th, 10th, 12th of 22); no page errors. `/api/features` 33.5–34.0 ms against
`main`'s 33.2–34.1 ms (median of 20, three runs each, back to back). No analysis code changed: no
regression sets. Not verified: dozens of features; Firefox, Safari, Windows, macOS; a real Claude
Code session acting while the page is open (the e2e fake runs Symbiote's real hooks).

Merged into main (2026-10-18), approved in Symbiote at `4321040`: no conflicts (`main` had been merged
into the branch before the review). `main` verified after the merge (same tree as the approved
commit): 730 unit tests, build, 103 e2e.
