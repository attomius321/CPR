# AR1 — Symbiote's own record: what works, what fails, what to change (spike)

[Index](../PLAN.md) · [Journal](../journal/ar1-activity-review.md)

**Status:** planned (2026-11-01), a spike on branch `spike/activity-review` (from `main` at
`6aed550`). Nothing in `packages/` changes: each recommended change becomes a workspace of its own
once the person picks it. The person's answers to the plan (2026-11-01): Starknet's records as a
second repository, yes; Claude Code's transcripts for tokens, yes; up to 12 real `claude -p` runs
(Sonnet, medium effort, about $10 API-equivalent at most), yes; the counting scripts committed in
`spikes/activity-review/`, yes.

**Question** (the brief): from the activity of every workspace and of Nucleus, does Symbiote work
as intended, where does it fail or waste time and money, and what should change in its defaults —
the prompts, the default models and efforts, the advisor's suggestions, plan first, permission
modes, the merger, Hive's rounds and checks? The defaults must work for any project, not only
Symbiote's own repository ("The defaults should apply working on any project. Not only on
symbiote.").

## Sources, and the periods they cover

| Source | What it holds | Period |
|---|---|---|
| `~/symbiote-exports/` (the person's export, copied to the ignored `coverage/activity-review/`) | 131 workspaces and Nucleus: 904 messages, 13,735 calls (155 failed), 942 commits | 15 Oct → 1 Nov |
| … 55 of them `complete: false` | the brief, messages, reports and commits; no calls | 15 Oct → 25 Oct |
| … 76 complete | every call, notice and session event | 25 Oct → 1 Nov |
| `nucleus.md`, `symbiote/nucleus-activity.jsonl` | 5 conversations, 82 messages, 417 calls (10 failed, 5 refused), 16 Confirms, tokens per answer | 30 Oct → 1 Nov |
| The main checkout's `symbiote/` (read only) | 132 workspace records (model, effort, `permissionMode`, `planFirst`, `via`), verdicts, threads, 75 activity files | as above |
| `symbiote/hive/**` | 6 workspaces Hive drove: 20 checks started, 5 running reviews, 4 landed | 31 Oct → 1 Nov |
| `~/.cache/symbiote/` | the merge queue and its logs, the running reviewer's runs, Symbiote's logs (LG1) | logs from 25 Oct |
| Claude Code's transcripts (`~/.claude/projects/-home-anton-projects-Symbiote-worktrees-*`) | tokens per turn, interrupted turns, the 55 older workspaces | 15 Oct → 1 Nov |
| `~/projects/Starknet/symbiote/` and its transcripts | a second repository: 23 workspaces, 22 reviews, no `merge.checks` | 25 Oct → 28 Oct |
| `git log` of every branch | commits, merges, fix-ups after a review | all |

Records are only read. Copies and outputs go in `coverage/activity-review/` (ignored); only counts
and summaries reach the docs.

## What is measured

Each count with the workspaces and times it comes from.

1. **Calls**: failed calls by cause, from their recorded input and output (a test failed, a
   command not found, an edit's text not found, a file not read first, a timeout, git); refused
   calls (Nucleus's gate, permissions denied).
2. **Waits for the person**: permission prompts by tool and command, the time until answered, and
   whether an allow rule or another `permissionMode` would have removed them; "waiting for your
   input" until the person's next message, split into after a report, after a plan, and a
   question mid-work.
3. **Sessions**: started, ended and why, resumed, context cleared, interrupted turns.
4. **The check, twice**: the writer's own full-suite runs (how many, how long, on which commit)
   against Hive's runs on the same commit.
5. **Hive**: rounds and why (which test, flaky or not), the reviewer's findings kept or dropped,
   check minutes, the reviewer's cost; how often each `fix/hive-runner-flaws` flaw happened.
6. **Reviews and merges**: verdicts by kind, rounds before an approval, merges, conflicts the
   merger resolved, failed checks at merge, time to merge.
7. **Models, efforts and the advisor**: what each workspace ran with; `suggest_settings`'s
   proposals against what was started; tokens by model and effort (API-equivalent dollars, an
   estimate, not the subscription's charge).
8. **Nucleus**: context per answer, Confirms and declines, refusals.
9. **Briefs against results**: plan first kept (no edit or commit before the person's OK), scope
   grown (the person's later messages labelled: a new ask, a correction, a bug, an approval),
   "Done when" met or only claimed, what the reports say was not verified.

## How findings are judged

- **Known or new**: known when `docs/PLAN.md`, the area's journal, `fix/hive-runner-flaws` or the
  brief's "Seen, not decided" names it.
- **Product default or this repository's setup**: anything resting on pnpm, the 7-minute check or
  this repository's docs conventions is this repository's setup.
- **Concrete**: the prompt key and its new words, the setting and its new default, or the file and
  function to change.
- **Ranked** by count × cost: the person's minutes, agent minutes, tokens, or failures prevented.
- **Precise over complete**: one case, or a case not traced to a record, is "seen once", not a
  recommendation.

## Verification

1. The scripts' totals match the exports' heads (904 messages, 13,735 calls, 155 failed, 942
   commits; Nucleus 417 / 10 / 5 / 16).
2. 20 counted items, picked at random, checked by hand against the Markdown.
3. `symbiote activity` checked to write nothing before it is used.
4. Starknet's records: the same counts, to tell which findings hold outside this repository.
5. Real agents, for a default whose evidence is this repository's alone and that changes an
   agent's behaviour through its prompt: a small Python + pytest repository in `coverage/`,
   `claude -p` with today's text and the proposed one on the same task, at most 12 runs.
6. `pnpm check` on the branch (docs and spike scripts only).

**Risks**

| Risk | Mitigation |
|---|---|
| Labels by hand (scope grown, Done when) are judgement | the rubric is written down; each label cites the message; counts reported as labelled, not as fact |
| One repository's habits read as product problems | Starknet's records; real runs on a Python repository before a product default rests on Symbiote alone |
| The older 55 workspaces have no calls | their numbers come from transcripts, and the periods are said with every count |

**Decisions** are numbered when the answer is written: the next free numbers on every branch then
(`feature/hv4-autonomous-landing` and `feature/alpha-ceph-transform` are planning from 716).
