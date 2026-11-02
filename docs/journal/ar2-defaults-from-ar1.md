# Journal: AR2 — The changes AR1 found

[Index](../JOURNAL.md) · [Plan](../plan/ar2-defaults-from-ar1.md)

## AR2 plan — six changes from AR1's measurements (2026-11-01, branch `spike/activity-review`)

The person picked AR1's changes 1–6, to be built on the spike's branch, the flaky end-to-end tests
included. The reviewer's change waits for `fix/hive-runner-flaws`, which rewrites the runner
around it. Decisions 738–744.

## AR2 — the six changes, built (2026-11-01, branch `spike/activity-review`)

Built and tested first, one commit each:

- the journal's union merge;
- Hive's check messages and the spike's answer;
- who sent each message in the record;
- Send to the agent on a failed merge check;
- the flaky end-to-end tests.

Decisions 738–744. 2,689 unit tests; the full e2e suite passed three times on the last build.

**Learned**:

- **A note, not the text, says who sent a message.** A project can change every prompt, and
  Nucleus's messages are words of its own, so no reading of the text can tell them apart.
  - Symbiote writes a `sent` note (sender, key, digest of the whitespace-collapsed text) just
    before it types a message.
  - The reader labels the prompt that matches it and drops the note, so nothing that reads a
    thread meets a new kind of entry.
  - The default texts' openings label the records from before AR2.
- **A verdict is the person's.** Labelled Symbiote's, the Thread tab hid the person's comments
  inside a collapsed prompt; the first full e2e run caught it. Now it is "Your verdict".
- **AR1's hand count was two short.** The built reader finds 14 of 255 "person's messages" that
  were not the person's: a fourth verdict, and the start prompt of an agent Nucleus restarted.
- **Load from busy loops does not reproduce the flaky tests.** `intro.spec.ts` ran 45 of 45 green
  with 24 of 32 cores busy. The agents' diagnoses, written when each failure was pasted to them,
  gave the causes:
  - a card measured mid-slide;
  - the intro's states seen late by the spec's clock, while the engine slows its frames under
    load by design;
  - a merge and its log slower than Playwright's 5-second default.
  The fixes wait for the state, or give a state 15 s.
- **Two suites at once found one more race**: `hive.spec.ts` read the diff's head colour once
  while it was drawn again. Polled now.
- **`pnpm check` stops before `pnpm build`**: a formatting slip in one spec left a verification
  round testing an old bundle, and its failures looked like a regression. Read the check's log
  first.

**Verification**:

- Tests first, red for the right reason, in `prompts`, `thread`, `workspaces`, `merges`,
  `server`, `mcp`, `hive-runner`, `activity-export`, and the viewer's `workspaces`,
  `activity-groups` and `merges`.
- New e2e test: `merge-send.spec.ts`.
- `pnpm check` (2,689 tests), `pnpm build`, the full e2e alone (377 + 20), then twice at once
  (377 each).
- The built reader run on AR1's real records.
- Screenshots of the new button, dark and light at 1×.

Not verified:

- a real Claude Code session getting `merge.failed`;
- a real Hive run with the new words;
- the flaky tests under several whole suites from other workspaces at once.

`main` merged in after `fix/hive-runner-flaws` landed. That branch rewrote Hive's delivery
around the same `reply` call this one gives a sender to; both changes were kept. The journal
merged with no conflict, by the union attribute added here. On the merged tree: `pnpm check`
(2,707 unit tests), `pnpm build`, the full e2e (viewer 378, nexus 20).

Merged into main (2026-11-01).
