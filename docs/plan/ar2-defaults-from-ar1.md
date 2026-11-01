# AR2 — The changes AR1 found

[Index](../PLAN.md) · [Journal](../journal/ar2-defaults-from-ar1.md)

**Status:** planned (2026-11-01), on branch `spike/activity-review`, after AR1 (decision 738).

The person's answers (2026-11-01):

- Build it here, on the spike's branch.
- Steps 1–6 of AR1's ranked list; the reviewer's change (AR1's #7) waits for
  `fix/hive-runner-flaws`.
- Fix the flaky end-to-end tests here, time-boxed; list what stays flaky.

**Problem**: AR1's measurements (`docs/plan/ar1-activity-review.md`, 15 October – 1 November):

| What | Measured |
|---|---|
| Merges into `main` that conflicted | 53 of 148, every one in `docs/JOURNAL.md`; 17 with a union merge |
| Hive's messages ask the writer to run the whole check, then Hive runs it | 12 duplicate suite runs, about 40 min, in 6 Hive workspaces; on a Python repository, 1–3 whole checks per turn with today's words, 0 with the new ones |
| Spikes whose answer the person asked to commit | 4 of 11, in both repositories |
| "The person's message" that was not the person's | 12 of 255 in the export: Hive's, verdicts, subagents' hand-backs; also every background job's end in the Thread tab, and a restarted agent's start prompt |
| A failed merge check pasted by hand into the branch's terminal | 14 times in 13 workspaces |
| The flaky e2e tests | 3 of 3 failed Hive checks; 10 of 14 pasted merge failures |

**Goal**: the six changes, each tested first. With Hive off and no merge failing, nothing a
person sees changes but the record's labels.

## 1. The journal merges as a union (this repository's setup)

- `.gitattributes`: `docs/JOURNAL.md merge=union`. Git keeps both sides' lines, the target's
  first, which is what the merger wrote by hand.
- `docs/reference/configuration.md`, the merger's rules: a `merge=union` line for an append-only
  file (a changelog) keeps such conflicts from reaching the merger.
- Not `docs/PLAN.md`: its rows go inside tables by area, where a union can misplace one.

## 2. Hive's check messages (product prompts)

- `hive.start`: after "…the person lands the branch.", the sentence "Symbiote runs the whole
  check after each of your turns: before you end one, run the tests your change touches, not the
  whole check."; "So commit everything" becomes "Commit everything".
- `hive.check`: its last line becomes "Fix the cause and run the tests that failed, and the ones
  your fix touches, until they pass. Then commit and end your turn: Symbiote runs the whole check
  again."
- `hive.review`: its last sentence becomes "Then commit and end your turn: Symbiote runs the whole
  check again."
- A project's own text for these keys is kept as it is.

## 3. The spike's answer kept (product prompts)

- The spike's line (`KIND_LINES.spike`): "The answer is what is asked for, not a change to merge.
  Put it in your final report; if the brief or the project's instructions say where answers are
  kept (a file, its docs), write it there too. Keep experiments out of the project's code unless
  the brief says otherwise."
- The spike's closing words: "Commit only what the brief or the project's instructions ask you to
  keep. When you have the answer, say it: the person reads your report in Symbiote."

## 4. Who sent a message (product code)

- **Symbiote notes what it sends.** Each message Symbiote types into a workspace's agent gets a
  `sent` entry in the thread, just before it is sent. The entry holds who sent it (`hive`,
  `nucleus`, `merger`, `verdict`), its prompt key and a digest of its text.
  - Sends through `reply`: Hive, Nucleus's `reply` tool, and step 5's Send to the agent. The
    person's own messages from the reply box carry no sender.
  - The verdict the viewer types into the terminal is noted through `POST /api/workspaces/sent`.
- **Each prompt gets a label** (`from` on its thread entry):
  - a prompt matching the last unmatched `sent` entry before it is labelled by its sender;
  - the first prompt of a session Symbiote started (`startup`) is Symbiote's start prompt, a
    restart's too;
  - `<task-notification>` is a background job's end;
  - `<agent-message` is a subagent's hand-back;
  - records from before AR2 have no `sent` entries: Symbiote's default texts' openings are
    matched instead (`Symbiote ran the check on`, `Approved the branch`…);
  - anything else is the person's.
  The labels are given where a thread is read (`thread.ts`).
- **Who reads the labels:**
  - the export (`activity-export.ts`): "Hive's message (`hive.check`)", "Nucleus's message",
    "The verdict, typed by Symbiote", "Symbiote's message (`merge.failed`)", "A subagent's
    hand-back";
  - the Thread and Activity tabs (`threadItems`, `activityEvents`): Symbiote's messages as
    Symbiote's, a background job's end and a hand-back as a line;
  - Nucleus's `thread` tool.

## 5. A failed merge check, sent to the branch's agent (product)

- New prompt key `merge.failed`, in Settings → Prompts with the merger's, placeholders `{branch}`,
  `{at}`, `{into}`, `{command}`, `{output}`:

  > Symbiote merged {at} into {into} and ran the check: `{command}` failed. Its last lines:
  >
  > ```
  > {output}
  > ```
  >
  > Say whether your branch causes it. If it does, fix it on {branch} and commit: the person
  > approves the new commit. If it does not (a test your change cannot reach, or a commit on
  > {into}), say why in a few lines and change nothing: the person runs the check again.

- On a merge whose check failed, when its branch is a workspace whose agent takes messages:
  **Send to the agent**, beside Check again. The person presses it; nothing is sent on its own.
- `POST /api/merges/send {id}` builds the text from the failed check's command and last lines,
  as Hive's `hive.check` does (the same line limits), and sends it with `reply` (`by: merger`).

## 6. The flaky end-to-end tests (this repository's setup)

- Reproduce each under load: the spec repeated (`--repeat-each`), and the full suite with other
  work running. Start with those AR1 saw fail most:
  - `shell.spec.ts` (the keys and the card's focus);
  - `workspaces.spec.ts` (the done card's clean-up);
  - `intro.spec.ts:52`, `:178`;
  - `merges.spec.ts:54`, `:202`;
  - `changes.spec.ts:100`, `report.spec.ts:30`, `open-pr.spec.ts:48`, `scout.spec.ts:475`.
- Fix the race: wait for the state, not a time. A test that cannot be made stable in the time-box
  is listed in the journal with what was tried; it is not skipped.

## Verification

1. **Tests first**, red for the right reason:
   - `prompts.test.ts`: the new words, a project's own kept;
   - `thread.test.ts`: the labels, old records by their openings;
   - `activity-export.test.ts`: the headings;
   - the server and merge tests: `/api/merges/send` and the `sent` entry;
   - viewer unit tests: `threadItems`, the activity events.
2. **e2e**: a failed merge check, Send to the agent, and the fake agent gets the command and its
   lines; the Thread tab shows Hive's message as Symbiote's.
3. **The real export rerun on AR1's records**: the 12 mislabelled messages come out labelled.
4. **A scratch merge** of two branches appending to the journal lands with no conflict.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`, the full suite 3 times for step 6.
6. **The new button** in both themes at 1×, as the `symbiote-style` skill asks.

**Risks**

| Risk | Mitigation |
|---|---|
| A `sent` entry and the prompt it is for do not match (whitespace, a cut) | Digest of whitespace-normalised text; a test with a 20,000-character message |
| `fix/hive-runner-flaws` also changes `hive-runner.ts` | One line here (the sender on `reply`); merge `main` in after it lands |
| Flaky fixes hide a real bug | Each fix waits on the state the test means; the test still fails when the state never comes |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 738 | Where AR2 is built | **On `spike/activity-review`, after AR1** | The person's answer: one branch to review |
| 739 | What Hive asks of the writer | **The failing tests and those its change touches; Symbiote runs the whole check** | AR1: 12 duplicate runs; the Python trial's 0 against 1–3 |
| 740 | Where a spike's answer goes | **The report, and where the brief or the project keeps answers; commit only that** | 4 of 11 spikes asked to commit the answer |
| 741 | Who sent a message | **Symbiote notes each message it sends (`sent`: sender, key, digest); a prompt is labelled by the note it matches, a session's first prompt as the start, old records by the default openings** | 12 of 255 mislabelled; a project can change every text, so the note, not the text, says who sent it |
| 742 | A failed merge check and the agent | **`merge.failed`, sent when the person presses Send to the agent; never on its own** | Normal mode is the person's; 14 pastes by hand |
| 743 | The journal's conflicts | **`docs/JOURNAL.md merge=union` in this repository; the docs suggest it for append-only files** | 53 conflicts to 17 when replayed |
| 744 | A flaky test | **Fixed by waiting for state; one that stays flaky is listed, never skipped** | The person's answer |

**Not in AR2**: the running reviewer reading the person's later words (after
`fix/hive-runner-flaws`); a check retried once (rests on this repository's flakes); a merge
failure sent on its own (Hive mode, HV4).
