# AR1 — Symbiote's own record: what works, what fails, what to change (spike)

[Index](../PLAN.md) · [Journal](../journal/ar1-activity-review.md)

**Status:** measured (2026-11-01), a spike on branch `spike/activity-review` (from `main` at
`6aed550`). Nothing in `packages/` changed. The counting scripts, the trials' runner, their prompts and their
repository (a git bundle) are in `spikes/activity-review/`, with a README to rerun them. Their outputs, and copies of the person's records, stay in the ignored
`coverage/activity-review/`. Each recommended change becomes a workspace of its own once the
person picks it.

The person's answers to the plan (2026-11-01):

- Starknet's records as a second repository: yes.
- Claude Code's transcripts for tokens: yes.
- Up to 12 real `claude -p` runs (Sonnet, medium effort, about $10 API-equivalent at most): yes.
- The counting scripts committed in `spikes/activity-review/`: yes.

**Question** (the brief): from the activity of every workspace and of Nucleus, does Symbiote work
as intended? Where does it fail or waste time and money? What should change in its defaults: the
prompts, the default models and efforts, the advisor's suggestions, plan first, permission modes,
the merger, Hive's rounds and checks? The person added: "The defaults should apply working on any
project. Not only on symbiote."

## The answer

- **Symbiote works as intended where it was measured.** Plan first held in every workspace with
  recorded calls (67 of 67): the agent changed nothing before the person's OK. The person answered
  a plan in a median 2.4 minutes. 116 of 131 workspaces were approved. The other 15: tests of
  Symbiote itself (5), spikes answered in their report (5), work still running (2), and 3 left
  unmerged. Calls rarely failed (145 of 13,318, 1.1 %), and none of the failures stopped a
  workspace.
- **The time goes to checks and conflicts, mostly this repository's own:**
  - Writers ran the full end-to-end suite 181 times, in 63 of 74 workspaces (8.0 h measured).
  - Merges ran the check 89 times (8.5 h); 12 failed.
  - 53 of 148 merges into `main` conflicted, every one in `docs/JOURNAL.md`. The merger spent a
    median 5.7 minutes on each resolution, and the person confirmed it in a median 30 seconds.
  - The failures were mostly the same few timing-sensitive end-to-end tests. They failed Hive's
    check 3 times out of 3, and 10 of the 14 merge failures the person pasted into an agent's
    terminal.
- **Money: $1,884 API-equivalent for 127 workspaces in 17 days**, almost all of it Opus. Cache
  reads are 99 % of the tokens read and about 60 % of the dollars: each turn reads the whole
  conversation again, and a workspace's largest request carried a median 343,000 tokens. Scope
  that grew after a build was reported cost $91 (5 %). Nucleus cost $26 over four conversations.
- **Seven changes, ranked below:**
  - two in this repository's setup: a union merge for `docs/JOURNAL.md`, and the flaky end-to-end
    tests;
  - four product defaults: Hive's check messages, a failed merge check sent to the branch's
    agent, the spike line, and the running reviewer reading the person's later words (the last
    rests on one case);
  - one product code change: the record labels Symbiote's own messages.
- **Hive's check messages, tried on a Python repository:** with today's words, the writer ran the
  whole check before ending its turn 3 times out of 3. With the proposed words, it ran only the
  failing tests, 3 times out of 3. All six fixed the bug and committed.
- **What the records cannot show:** whether the agents' work was right, beyond the person's
  approval; whether xhigh effort does better than high; what the card showed while an agent waited
  on its own background job; anything Codex did (3 workspaces, at most one message each).

## What was tried

- **The person's export**, 132 Markdown files, copied to `coverage/activity-review/exports/`. Its
  heads were the check on the counts: 904 messages, 13,735 calls (155 failed), 942 commits.
- **The same records as JSON**, read from the main checkout's `symbiote/` and cut at the export's
  time, 2026-11-01 08:09 UTC: `workspaces/` (settings), `threads/` (prompts, reports, notices,
  sessions), `activity/` (calls), `reviews/` (verdicts), `hive/` (Hive's steps, checks and
  reviews), `nucleus-activity.jsonl`. `spikes/activity-review/load.mjs` joins them per workspace.
  Its totals match the export's heads exactly: 13,318 workspace calls, 145 failed, 450 reports.
  `fix/hive-runner-flaws` and this spike were still running, so the cut keeps them at the
  export's numbers.
- **Claude Code's transcripts** of each worktree (`~/.claude/projects/…`), read by
  `transcripts.mjs`: tokens and model per request, interrupted turns, compactions, subagents.
  They also cover the 55 workspaces from before calls were recorded.
- **Dollars at API list prices** (`price-table.mjs`):
  - Opus 5.5: $4 per million input tokens, $20 output, $0.20 cache read, a 1-hour cache write at
    2× input.
  - Sonnet 5.5: $2 input, $10 output.
  - Checked against Claude Code's own cost lines: within 3 % where its records are whole.
  - These are API-equivalent dollars, not what the subscription charged.
- **Symbiote's logs** (`~/.cache/symbiote/logs`, from 25 October): every merge's states.
  `git merge-tree` replayed each of `main`'s 148 merges since 15 October to list their conflicted
  files, and replayed them again with a union merge driver in a scratch clone.
- **Starknet**, the second repository the person runs Symbiote on: 23 workspaces, 25–28 October,
  the same scripts.
- **Hand labels**: the person's 119 messages after the plan's answer, in
  `coverage/activity-review/later.txt`. They were read and labelled; the labels used in counts
  are rules in `phases.mjs`, plus a hand list of 19 messages that grew a workspace's scope.
- **Real agents on a small Python repository** (`spikes/activity-review/trials/run.mjs`): a stock
  ledger with `unittest` and a 75-second integration suite.
  - Each run used `claude -p` on Sonnet at medium effort, in a fresh clone under `/tmp`, confined
    as Symbiote's running reviewer is: Claude Code's sandbox, edits accepted only in the clone, no
    network, no hooks.
  - 13 runs, $0.82 in all. Five were setup runs: they failed because edit permissions were
    refused (a clone under `~/.claude/` counts as sensitive). That is one run over the 12 agreed.

## The numbers by kind

Symbiote's repository unless the row says Starknet. Messages, commits, tokens and dollars cover
15 October to 1 November; calls and merges cover 25 October to 1 November; Hive covers 31 October
to 1 November.

### Workspaces and settings

| What | Count | Source |
|---|---|---|
| Workspaces | 131: 87 feature, 25 fix, 9 spike, 7 chore, 3 refactor | `workspaces/` |
| Agent | Claude Code 127, Codex 3 (the 3 others at most one message each) | `workspaces/` |
| Model actually run | Opus in 123 of 127 transcripts; Sonnet in 3; Haiku in 1 (with Opus) | transcripts |
| Effort | xhigh 95, Claude Code's own 17, medium 10, high 8, low 1 | `workspaces/` |
| Plan first | 121 of 131 | `workspaces/` |
| Started by | the person 111, Nucleus 19, Scout 1 | `workspaces/` |
| Permission mode | recorded `default` 124 (Claude Code's own), `auto` 3; the sessions ran in `auto` (every one of the 130 worktrees' transcripts) | `workspaces/`, transcripts |
| Driven by Hive | 6 | `hive/` |
| Starknet | 23 workspaces; Opus at xhigh in 21; plan first 22; no Hive | Starknet's `symbiote/` |

### Cost and tokens

| What | Count | Source |
|---|---|---|
| API-equivalent dollars | $1,884 for 127 workspaces; median $11.42, p90 $30.07, max $48.80 | transcripts |
| By effort | xhigh: 95 workspaces, $1,514, median $13.39; high: 8, $137, $14.91; medium: 9, $23, $1.96 | transcripts |
| By kind | feature: 85, $1,536, median $16.75; fix: 25, $182, $5.87; spike: 8, $86, $5.85 | transcripts |
| Tokens | cache reads 5.64 billion (99 % of tokens read, about 60 % of dollars); cache writes 50 million; output 18.6 million | transcripts |
| Context of one request | median per workspace 342,700 tokens, max 772,202; no compactions | transcripts |
| Nucleus | $26 for 4 conversations, 294 requests; context median 122,500, max 383,500 | transcripts |
| Hive's reviewer | $5.33 recorded for 3 reviews; the 2 lost reviews' costs were not recorded | `hive/` |
| The merger | not recorded: its `claude -p` runs keep no session | – |
| Starknet | $237 for 23 workspaces, median $9.72 | transcripts |

Cost by what the work answered: each request is charged to the last prompt before it.

| What the work answered | The person's messages | API-equivalent $ | Share | Workspaces |
|---|---|---|---|---|
| The person's answer to the plan, through the build | 107 | 718 | 38 % | 101 |
| A background job of the agent's own ended | – | 356 | 19 % | 112 |
| Other messages (questions, answers, corrections) | 81 | 191 | 10 % | 41 |
| The start prompt, to the first report | – | 174 | 9 % | 88 |
| Before any recorded prompt (older workspaces) | – | 127 | 7 % | 40 |
| "Go on after the plan" | 6 | 120 | 6 % | 6 |
| Scope grown after a build was reported (hand list) | 19 | 91 | 5 % | 7 |
| "wyd?", "continue" and other pings | 12 | 39 | 2 % | 11 |
| A failed merge check, pasted by the person (the 14th, a second paste in `feature/tauri-integration`, falls under other messages) | 13 | 31 | 2 % | 13 |
| A subagent's hand-back | 5 | 18 | 1 % | 2 |
| "Merge main in, resolve conflicts" | 6 | 17 | 1 % | 6 |

### Calls, waits and sessions

| What | Count | Source |
|---|---|---|
| Calls | 13,318 in 74 workspaces: Bash 10,472, Read 1,068, Edit 426, Write 416 | `activity/` |
| Failed calls | 145 (1.1 %): 62 recorded without output (25–28 October, when the hook kept none; the one traced was a chain whose last `cat` found no file); 14 a path not found; 8 a check failing; 8 killed; 6 Python's PIL missing; the rest scratch scripts | `activity/` |
| Turns | 447; median 2.9 min, p90 12.7 min, 39.0 h in all | `threads/` |
| The person's reply to a report | 196; median 2.7 min; 181 within an hour (14.4 h in all); 15 later | `threads/` |
| Permission prompts | 29 notices in 21 workspaces, answered in a median 69 s, 0.7 h in all; asked for Bash 17 times, EnterWorktree 6 (all 15–25 October), AskUserQuestion 20 | `threads/` |
| "Waiting for your input" notices | 240: the person spoke next 91 times; the agent's own background job ended next 75 times; nothing followed 74 times | `threads/` |
| Sessions | 129 started, 34 resumed (30 workspaces), 1 cleared; the 20 resumes that recorded nothing did no work either (0 requests) | `threads/`, transcripts |
| Interrupted turns | 2; subagents 6 sessions in 3 workspaces; API errors 2 | transcripts |
| Starknet | 2,467 calls, 19 failed; 58 turns; the person's reply median 1.8 min; no permission prompts | Starknet's records |

### Checks, merges and reviews

| What | Count | Source |
|---|---|---|
| The writer's own full end-to-end runs | 181 in 63 of 74 workspaces (median 2, max 10 a workspace), the viewer's or the nexus's whole Playwright suite; 138 timed: median 4.6 min, 8.0 h | `activity/`, task notifications |
| Merge checks | 89: median 6.2 min, 8.5 h; 38 ready, 39 to a resolution, 12 failed (10 workspaces) | logs |
| Merges into `main` | 148 since 15 October; 53 conflicted: `docs/JOURNAL.md` 53, `docs/PLAN.md` 10, `README.md` 3, code 8; 42 in docs only | `git merge-tree` |
| The merger's resolutions | 41: median 5.7 min, 3.8 h; the person confirmed in a median 0.5 min | logs |
| Approve to landed | median 6.9 min, p90 11.0 min (72 merges) | logs, `reviews/` |
| Verdicts | 132, all approve; no request-changes, no comments; 14 workspaces approved twice or more | `reviews/` |
| Starknet merges | 23 landed, 5 resolved by the merger, none failed; 23 verdicts, all approve, no comments | Starknet's records |

### Hive (6 workspaces, 31 October to 1 November)

| Workspace | Checks started | Passed / run | Check min | Reviews | Messages at landing |
|---|---|---|---|---|---|
| `chore/check-timeout-comment` (HV2's real run, a comment-only change) | 4 | 1 / 3 | 21 | – | 0 |
| `chore/hive-north-star` | 1 | 1 / 1 | 7 | approved, $0.82 | 0 |
| `feature/alpha-ceph-hive-name` | 1 | 1 / 1 | 7 | – | 0 |
| `feature/hive-honeycomb-background` | 2 | 1 / 1 | 7 | changes, 3 kept, $2.22 | 0 |
| `feature/hive-live-progress` | 3 | 3 / 3 | 23 | unavailable; changes, 1 kept, $2.29; unavailable | 1 |
| `feature/hv3-running-reviewer` | 8 | 2 / 3 | 22 | – | 7 |

- **Failed checks**: 3 of 3 were timing tests the change could not reach:
  - `intro.spec.ts:52` and `:178`;
  - `merges.spec.ts:54` and `:56`.
  The other 359–367 tests passed.
- **The writers' own full runs** in these 6 workspaces: 12, about 40 minutes, besides Hive's 87.

## Problems found

Known: named in `docs/PLAN.md`, a journal, `fix/hive-runner-flaws` or the brief. New: named
nowhere.

1. **Merges conflict in the journal, every time** (new as a number; this repository's setup).
   - 53 of 148 merges into `main` conflicted, all in `docs/JOURNAL.md`, which every workspace
     appends to. 42 were docs only.
   - Each costs a merger run (Opus at xhigh here; median 5.7 minutes) and the person's confirm.
   - Replayed with `docs/JOURNAL.md merge=union`, 17 still conflict. With `docs/PLAN.md` too, 11.
2. **A few timing-sensitive end-to-end tests fail checks** (known: V26's decisions 242–243, the
   HV2 journal, `fix-merger.md`; the counts are new). This repository's setup.
   - Hive's failed checks: 3 of 3.
   - The 14 merge failures the person pasted into a writer, 20–31 October. The agents found:
     - 10 a race in a test the branch could not reach;
     - 1 a commit on `main`;
     - 1 the branch's own bug;
     - 1 the merger merging the old approved commit again (20 October);
     - 1 not reproduced.
   - The tests involved: the keys and focus tests in `shell.spec.ts`, the done card in
     `workspaces.spec.ts`, and tests in `intro.spec.ts`, `merges.spec.ts`, `changes.spec.ts`,
     `report.spec.ts`, `open-pr.spec.ts` and `scout.spec.ts`.
   - In 7 of the 14, the agent then changed a test it had not broken on its own feature branch,
     outside its brief. The branch needed another review each time; 14 workspaces were approved
     twice or more.
   - The comment-only HV2 run needed 3 rounds and 21 minutes of checks.
3. **A failed merge check reaches the agent only by the person's paste** (new; product default).
   - V26 keeps a clean merge whose check failed at `failed`, "not given to the agent".
   - The person copied the output into the branch's terminal 14 times in 13 workspaces. Each
     time the agent spent a turn (median about 4 minutes, $31 in all) telling whether its branch
     caused it.
4. **Hive's own prompts tell the writer to run the whole check** (new; product default).
   - `hive.check` ends "Fix the cause, run the check yourself, commit, and end your turn", and
     `hive.review` "Then run the check, commit, and end your turn". Hive then runs the same check.
   - In the 6 Hive workspaces, writers ran the full suite 12 times (about 40 minutes) beside
     Hive's 12 checks.
   - The brief saw the duplicate ("seen, not decided"); its cause in the prompts is new.
   - This repository's `CLAUDE.md` adds to it: its "Verifying a change" table asks for the full
     suite on any viewer change.
5. **The running reviewer reads the brief, not the person's later words** (known from the brief;
   its cause is new).
   - `reviewPrompt` (`hive-review.ts`) gives the brief, the diff and the check.
   - In `feature/hive-honeycomb-background`, 1 of the 3 kept findings was the compact look the
     person had asked for after the brief. Of all reviews, 1 of 4 kept findings was this.
   - The Python trial did not reproduce it: its reviewer, given only the brief, left the later
     format change alone. That was one run, on Sonnet.
6. **The record calls Symbiote's messages the person's** (new; product code).
   - `activity-export.ts` labels every prompt but the first "The person's message", task
     notifications aside.
   - So 12 of the 255 such messages in the export were not the person's: 4 of Hive's, 3
     verdicts, 5 subagent hand-backs. (AR2's reader, run on the same records, finds 14: a fourth
     verdict, and the start prompt of an agent Nucleus restarted.)
   - The Activity tab, the export and Nucleus's `thread` tool read the same.
7. **Spikes answer in the report, but the person wants the answer kept** (new; product default).
   - The spike line says "put it in your final report … Commit nothing unless the brief asks for
     it".
   - In 4 of 11 spikes the person then asked to commit or build the result: 2 of 9 here
     ("Please commit the spike, with these details you found. Everything.", "can you put these
     somewhere in the files??") and 2 of 2 in Starknet ("Commit everything…", "Build everything on
     this branch.").
8. **Hive's runner flaws** (known: `fix/hive-runner-flaws`, being fixed). How often each happened:
   - **A message at landing reruns the check on an unchanged tip**: 1 workspace,
     `feature/hv3-running-reviewer`. The person's 7 messages at landing started the check 3 times
     at `6da7d5a` after it had passed. One run ran to its end (7.5 minutes) and failed on the
     flaky tests.
   - **A check's failure sent after the branch was settled**: 1. In
     `feature/hv3-running-reviewer`, the failure was sent at 14:19, after the person approved at
     14:12; the branch landed at 14:22.
   - **A turn Hive never sees**: 1, `feature/hive-honeycomb-background`.
     - Its session ended at 17:00:13, one second before Hive sent the review.
     - The transcript then holds $7.49 of the writer's work that the thread does not.
     - Hive stayed at `writing` until the person had Nucleus restart the agent at 00:55.
9. **The reviewer's false "sandbox unavailable"** (known, fixed in `464030c`).
   - 2 of 5 reviews were lost, about 6 minutes each, in `feature/hive-live-progress`.
   - The second came from `main`'s runner, which still had the old code; the workspace landed
     unreviewed.

Seen, not a problem:

- **Permission prompts are rare**: 29 notices in 21 of 74 workspaces, and none in Starknet. Claude
  Code ran in `auto` mode, its own default here. Symbiote records that mode as `default`, as V18
  decided.
- **Resumes that recorded nothing did nothing**: the 20 silent resumes had no requests in the
  transcripts; each was a terminal opened before a clean-up.
- **The person approves; never comments or requests changes**: 132 verdicts, all approve; 155 in
  both repositories. Feedback goes through the terminal. Whether the graph was read is not
  recorded (Symbiote's logs show 115 analyses started, both repositories together).
- **Plan first stays useful**:
  - Of 109 answers to a plan, 20 were a bare OK and 19 short numbered answers. The rest decided,
    corrected or added something.
  - In 6 workspaces the person wrote "after you plan, start working" (5 of them right after the
    start): plan first was on where they wanted it off.
  - In Starknet, 13 of 21 answers were an OK or "Go": its tasks were smaller.

## Recommendations, ranked by what they save

Each is labelled **product default** (Symbiote's prompts, settings or code, for every
repository) or **this repository's setup** (its `CLAUDE.md`, `symbiote/config.json`,
`.gitattributes`, tests).

| # | Change | Label | Saves, as measured | Holds elsewhere? |
|---|---|---|---|---|
| 1 | `.gitattributes`: `docs/JOURNAL.md merge=union` | this repository's setup | 36 of 53 conflicted merges in 17 days (at the merger's median 5.7 min, about 3.4 h at Opus xhigh, and 36 confirms) | – |
| 2 | Fix or quarantine the flaky end-to-end tests | this repository's setup | 3 of 3 failed Hive checks; 10 of 14 pasted merge failures (each a re-check of 6.2 min, an agent's turn and often a second review) | – |
| 3 | `hive.check`, `hive.review`, `hive.start`: run the failing tests, not the whole check | product default | about 40 min of duplicate suite runs in 6 Hive workspaces; in the trial, 75–226 s per turn down to 0 | Yes in the Python trial, 3 of 3 against 3 of 3 |
| 4 | A failed merge check, sent to the branch's agent (`merge.failed`) | product default | 14 pastes in 13 workspaces; the agent gets the command and its output | Likely: any project with a check that can fail on merge |
| 5 | The record labels Symbiote's own messages | product code | 12 of 255 "person's messages" mislabelled (5 %) | Yes: the export's code is the same everywhere |
| 6 | The spike line: keep the answer where the project keeps answers | product default | 4 of 11 spikes needed a "commit it" message | Seen in both repositories |
| 7 | The running reviewer reads the person's later words | product default | 1 of 4 kept findings was the person's own later ask | One case; the trial did not reproduce it |

**1. A union merge for the journal** (this repository's setup).

- The change: add `.gitattributes` with `docs/JOURNAL.md merge=union`.
- Git then keeps both sides' appended lines, the target's first. That is what the merger already
  wrote ("Kept both sides' journal entries, main's two first then the branch's …").
- Replayed on `main`'s 148 merges, conflicts fall from 53 to 17.
- `docs/PLAN.md merge=union` would bring it to 11. Its rows are inserted inside tables by area,
  so a union could put a row in the wrong order: read a few such merges before adding it.
- Product side, docs only: `configuration.md`'s `symbiote/merge.md` section could say that an
  append-only file (a changelog) avoids the merger entirely with a `merge=union` line in
  `.gitattributes`.

**2. The flaky end-to-end tests** (this repository's setup).

- The change: fix them or mark them so the check skips them.
- The tests:
  - `intro.spec.ts:52`, `:178` (WebGL and wall-clock timing);
  - `merges.spec.ts:54`, `:56`, `:202`;
  - `shell.spec.ts:120`, `:121`, `:163`, `:164`;
  - `workspaces.spec.ts:950`, `:993` (the done card);
  - `changes.spec.ts:100`, `report.spec.ts:30`, `open-pr.spec.ts:48`, `scout.spec.ts:475`.
- Product counterpart, not ranked: a check that retries a failed command once, recording a pass
  on the retry as flaky. It would have kept all 3 of Hive's failed rounds here. It doubles a real
  failure's time, and its value rests on this repository's flakes, so it was not tried.

**3. Hive's check messages** (product default). New words (the change from today in bold):

- `hive.start`, a new sentence after its third, the fourth losing its "So": "…once both pass, the
  person lands the branch. **Symbiote runs the whole check after each of your turns: before you
  end one, run the tests your change touches, not the whole check.** Commit everything before you
  end a turn, …"
- `hive.check`, its last line: "**Fix the cause and run the tests that failed, and the ones your
  fix touches, until they pass. Then commit and end your turn: Symbiote runs the whole check
  again.**"
- `hive.review`, its last sentence: "Add each test to the branch, where the project keeps its
  tests, and make it pass; or, for a test you think is wrong, say in one line why and leave it
  out. **Then commit and end your turn: Symbiote runs the whole check again.**"
- Tried (6 runs, the Python repository, 75-second check, Sonnet at medium effort; the writers
  here ran Opus at xhigh, not tried):

  | Words | Runs | Whole checks per turn | Turn time | Fixed and committed | Cost |
  |---|---|---|---|---|---|
  | Today's | 3 | 2, 3, 1 | 165, 243, 89 s | 3 of 3 | $0.068–0.072 |
  | Proposed | 3 | 0, 0, 0 | 10, 12, 13 s | 3 of 3 | $0.060–0.065 |

- This repository's setup alongside: `CLAUDE.md`'s "Verifying a change" could say that in a Hive
  workspace Hive runs the full check, so the writer runs the specs its change touches.

**4. A failed merge check, sent to the branch's agent** (product default).

- On a merge that failed its check, a **Send to the agent** action. It types a new prompt key,
  `merge.failed`, into the branch's terminal, as Hive's `hive.check` does. In normal mode the
  person presses it, so nothing is sent unasked.
- Proposed text: "Symbiote merged {at} into {into} and ran the check: `{command}` failed. Its last
  lines: ```{output}``` Say whether your branch causes it. If it does, fix it on {branch} and
  commit: the person approves the new commit. If it does not (a test your change cannot reach,
  or a commit on {into}), say why in a few lines and change nothing: the person runs the check
  again."
- "Change nothing" answers the 7 of 14 agents that changed a test they had not broken on their
  feature branch, each then needing another review.

**5. Symbiote's messages labelled as Symbiote's** (product code).

- The change, in `activity-export.ts` and the Activity tab:
  - a prompt that matches a Hive step's `sent` message (`hive/<branch>.jsonl`) is "Hive's
    message (`hive.check`)";
  - one that matches a `verdict.*` text is "The verdict, sent";
  - one starting `<agent-message` is "A subagent's hand-back".
- Nucleus's `thread` tool should say the same.
- Effect: the record says who spoke; a count of the person's asks was 5 % off.

**6. The spike line** (product default). New words:

- `KIND_LINES.spike`: "The answer is what is asked for, not a change to merge. Put it in your
  final report; if the brief or the project's instructions say where answers are kept (a file,
  its docs), write it there too. Keep experiments out of the project's code unless the brief says
  otherwise."
- The spike's tail: "Commit only what the brief or the project's instructions ask you to keep.
  When you have the answer, say it: the person reads your report in Symbiote."
- Not tried with real agents: it changes what is committed, not how the agent works. Its evidence
  holds in both repositories.

**7. The running reviewer reads the person's later words** (product default). Lowest: one case.

- `reviewPrompt` adds, after the brief, the person's messages to the writer since the brief,
  read from the thread with problem 6's labels: "The person's messages to the writer after the
  brief. They change or add to it; where they differ from the brief, they win:"
- `hive.reviewer`: "each a real case the brief covers (the brief as the person's later messages
  change it)", and "a case the brief and the person's later messages do not cover is not a
  finding".
- Tried once each way: both reviewers found the real defect and neither flagged the later ask, so
  the trial neither supports nor refutes it. It matters more from HV4 on, when a wrong finding
  costs a round with no person to overrule it.

**Not recommended from these records:**

- **Models and efforts.** The advisor proposed Opus at high effort with plan first 10 times out
  of 11, and Sonnet at medium once, for a spike. The person started 5 of the 9 that followed at
  xhigh, the spike included, and 4 at high.
  - The records hold no like-for-like comparison of efforts or models: tasks differed, and medium
    effort's median of $1.96 came from smaller, earlier tasks.
  - Changing the advisor's guide or a default effort needs a measured comparison, as HV6 plans
    for the graph.
- **Permission mode.** Prompts were rare (29 in 21 workspaces) because Claude Code ran in `auto`.
  No change.
- **Plan first.** Kept 67 of 67, answered in 2.4 minutes, and the person decided something in most
  answers. No change. The 6 "after you plan, start working" messages are too few for a third
  choice on the Start page.

## What the records could not show

- **Quality.** Whether a workspace's result was right beyond the person's approval, and whether a
  higher effort or a larger model did better.
- **Before 25 October.** The calls of the 55 workspaces from before calls were recorded (their
  tokens are in the transcripts; their calls are not), and merges before 25 October (Symbiote's
  logs start then).
- **The merger's tokens and dollars**: its runs keep no transcript.
- **What the card and the window showed** while an agent waited on its own background job (75 of
  240 "waiting for your input" notices). Also why the person sent "wyd?" or "continue" 12 times.
- **Time outside Symbiote**: reading the graph, testing by hand, and the subscription's real
  charge.
- **Codex**: 3 workspaces, at most one message each.
- **Another repository with real Hive runs**: Starknet ran no Hive workspace.

## Verification

1. **Totals match the export's heads**: calls 13,318, failed 145, reports 450; the person's
   messages 249 plus Symbiote's 6 make the export's 255; Nucleus 417 calls, 10 failed, 5 refused,
   16 Confirms. Only `fix/hive-runner-flaws` differed (still running), and the cut at the
   export's time fixed it.
2. **Prices checked against Claude Code's own cost lines**: per-workspace sums within 3 % where
   its `cost-state` is whole: for example $38.94 for `feature/hv3-running-reviewer` against its
   $38.94, and $41.62 for `feature/hive-tentacles` against $42.67 (2.5 %).
3. **Merges replayed** with `git merge-tree` (git 2.43), in a scratch clone for the union driver.
4. **Labels read by hand**: every one of the 119 later messages, the 14 pasted failures with the
   agent's answer to each, and the 109 answers to a plan.
5. **20 counted items picked at random** (8 failed calls, 6 of the person's messages, 3
   permission prompts, 3 suite runs) were found in the export's Markdown at the same time with the
   same text. One suite run was the nexus's suite (20 tests), not the viewer's: the count of
   "whole suite" runs holds both.
6. **Commits before the OK**: all 7 cases traced to their commands. Each was a scratch
   repository's `git init` in the agent's temporary folder, not the branch.
7. **`symbiote activity`** was not used: it builds a workspace service that may write the
   records. The scripts read the files themselves.
8. **`pnpm check`** on the branch: format, lint, typecheck and 2,676 unit tests pass. The branch
   changes docs and `spikes/`, which the check does not format, lint or test.

**Risks**

| Risk | Mitigation |
|---|---|
| Hand labels are judgement | Counts use the written rules in `phases.mjs`; the hand list (19 messages) is in the code |
| One repository's habits read as product problems | Each problem labelled; Starknet's records compared; the prompt change tried on a Python repository |
| The trials are small (6 and 2 runs, Sonnet) | They are reported as runs, not rates; the reviewer change is ranked last for that reason |

**Decisions** (735–737: after `fix/hive-runner-flaws`'s 716–721 and V86's 730–734 on
`feature/alpha-ceph-transform`; 722–729 left free):

| # | Question | Decision | Why |
|---|---|---|---|
| 735 | Which records, and up to when | **The person's export and the same records as JSON, cut at the export's time (2026-11-01 08:09 UTC); Claude Code's transcripts for tokens; Starknet as the second repository** | The export's heads are the check; transcripts cover what the record lacks (tokens, the older 55) |
| 736 | What a dollar is | **API list prices per token (Opus 5.5 $4 / $20, cache read $0.20, 1-hour cache write 2× input), called API-equivalent** | Matches Claude Code's own estimate within 3 %; the subscription's charge is not per token |
| 737 | How a recommendation is made | **Labelled product default or this repository's setup, ranked by measured savings; a prompt change that alters an agent's behaviour tried on a Python repository first** | The person's words: the defaults must work on any project |

**Not in AR1**: the changes themselves (each its own workspace once picked), a comparison of
efforts or models, and Codex's behaviour.
