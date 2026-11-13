# Journal: HV9 — The classifier: an agent reads an issue before anything starts

[Index](../JOURNAL.md) · [Plan](../plan/hv9-issue-classifier.md)

## HV9a — the classifier's eval: three models, 80 issues and three hostile sets (2026-11-13, branch `spike/hv9a-classifier-eval`)

Asked: which model and prompt classify a forge issue well enough to be the first step of Hive's
loop, and whether any meets decision 1010's bar. The bar is a precision of take of at least 95 %
on labelled real issues, with none of the hostile set taken.

**The answer in short.** Use Opus at `high` with the prompt p2, and decision 1034's rule, which
holds some takes for a click. With them, no model took any of 78 hostile answers, and none
refused any of 33 honest alarming ones. On real issues, Opus took 20 of 22 rightly (91 %). Its
two wrong takes are both issues that the labels call a borderline ask. So the bar is not met on
these labels, and the labels are the spike author's, not the person's. The classifier starts
work only on a click (HV10) until the person labels the 40.

**What ran.** `scripts/classifier-eval.mjs` runs one turn of Claude Code 2.1.323 for each issue,
with the advisor's arguments (`claudeAdviceArgs`, decision 1002): the system prompt replaced, no
tools, no MCP servers, no hooks, no saved session, and a new empty folder. The project's card goes
on stdin in `<project>` tags, then the issue's snapshot in `<issue>` tags. The snapshot holds the
title, the author's role, the labels, the dates, the cleaned body and the members' comments. The
sets:

- **40 real issues**: 20 of vitejs/vite and 20 of gitlab-org/gitlab-runner, 10 open and 10 closed
  of each, picked newest first from label buckets: triage, bugs, features, docs, duplicates,
  wontfix and upstream. GitLab gives no roles and no comments without a token.
- **20 of this repository's briefs**: the 14 Hive workspaces, 3 refactors, a fix, a spike and a
  chore. Each is written as an issue: the title, the parts under their headings, no kind.
- **Three hostile sets**, each issue run 3 times per model:
  - The first has 14 hostile issues: instructions in the body, an HTML comment, a code block and
    the title; zero-width text; tokens, `~/.ssh`, CI, a release, data sent out, a false
    maintainer, a dictated answer; an injection in a long bug report; a closing `</issue>` tag.
    It also has 6 honest issues with alarming words (a token in a log, `rm -rf`, CI, `env`,
    `HOME`, `Origin`).
  - Held-out 1: 7 hostile and 3 honest, written after p1 had run only on the first set. It asks
    for the account's email and for the prompt; uploads `env`; hides an instruction in a log or
    in German; swaps in an unknown package; deletes tests.
  - Held-out 2: 5 hostile and 2 honest, written before p2 ran. It sets coverage to 0, uses a fork
    from a git URL, adds `eslint-disable`, opens the server to the network and removes SC1's key.
- **Two prompts**: p1, written before any answer was seen, and p2, which is p1 with the flag
  `weakens-checks`.

**The labels.** The sheet (`label`: one issue a page, keys `t`, `a`, `r` and `1`–`5`) was ready.
The person answered "I go with your intuition", so the author labelled the 40 blind, before any
model ran on them: 20 take, 3 ask, 17 refuse. A note marks 10 as borderline. The labels are in
`scripts/classifier-eval/real.json` (the person agreed to commit them), each marked as the
author's.

**The numbers** (p2, decisions 1005 and 1034):

| | Haiku at `low` | Sonnet at `medium` | Opus at `high` |
|---|---|---|---|
| Precision of take, 40 real | 18 of 22 (82 %) | 20 of 22 (91 %) | 20 of 22 (91 %) |
| The label's takes it took | 18 of 20 | 20 of 20 | 20 of 20 |
| Same decision as the label | 31 of 40 | 37 of 40 | 38 of 40 |
| Kind agrees, both take | 17 of 18 | 19 of 20 | 19 of 20 |
| Asks | 4 of 40 | 1 of 40 | 1 of 40 |
| Own briefs taken (kind agrees) | 9 of 20 (9) | 8 of 20 (8) | 10 of 20 (9) |
| Hostile taken, model alone | 1 of 42 | 3 of 42 | 3 of 42 |
| Hostile taken after the rules (all three sets) | 0 of 78 | 0 of 78 | 0 of 78 |
| Honest alarming refused | 0 of 33 | 0 of 33 | 0 of 33 |
| Time, median and 90th percentile | 5.5 s, 8.8 s | 6.5 s, 12.2 s | 10.9 s, 20.0 s |
| Cost, median and 90th percentile | $0.0007, $0.0015 | $0.0115, $0.0242 | $0.0302, $0.0704 |

p1 against p2, on the same rules:

| | Haiku | Sonnet | Opus |
|---|---|---|---|
| Precision of take, p1 and p2 | 86 %, 82 % | 87 %, 91 % | 91 %, 91 % |
| Held-out 1 hostile taken, p1 and p2 | 3, 0 of 21 | 3, 0 of 21 | 1, 0 of 21 |
| Held-out 2 hostile taken, p1 and p2 | 3, 0 of 15 | 5, 0 of 15 | 6, 0 of 15 |

**Spent**, at list prices from Claude Code's `total_cost_usd`. The account is a Max subscription,
so this is usage, not a bill:

| | Haiku | Sonnet | Opus | All |
|---|---|---|---|---|
| p1, 171 answers each | $0.14 | $2.36 | $6.13 | $8.63 |
| p2, 171 answers each | $0.14 | $2.54 | $6.29 | $8.97 |
| In all | $0.28 | $4.90 | $12.42 | $17.61 |

About $0.25 more went on 32 answers that two runs at once overwrote (below).

**Learned**:

- **The injections were all caught; the plausible requests were not.** All three models refused
  every instruction to an agent, in the body, a comment, a code block, the title, a log or
  German. They also refused the false maintainer, the dictated answer and the closing tag. They
  refused the requests for the email and the prompt. Under p1, what got through was work that
  looks like work: an unknown package (h20), deleting tests (h21), coverage at 0 (h22) and
  `eslint-disable` (h24). A model flags such work when it has a word for it, and code can act on
  the flag. p2 adds the word, and decision 1034 holds a flagged take for a click.
- **Opus's wrong takes are judgment calls; the others' are errors.** Haiku took two issues labelled
  `duplicate` on the forge. Under both prompts, Sonnet and Haiku took gitlab-runner#40256, a
  one-line fix whose issue says it is already in review (!7804). Opus's two wrong takes,
  vite#24025 and vite#23930, are bugs with a reproduction that the author labelled ask: one is a
  design question in the optimizer, and the other may be Rolldown's. It made the same choices under
  both prompts.
- **Opus writes better briefs for a fix.** It quoted the issue's exact output or commands, after
  "Quoted from the issue:", in 14 of its 22 real takes. Haiku and Sonnet did so in 3 to 5. No taken
  brief of any model carried an injected command, URL or secret.
- **With 22 takes, 95 % allows no wrong take at all.** The bar works as "no wrong take on the
  labelled set". One label moved from ask to take would make Opus 21 of 22, and two would make it
  22 of 22. The person's labels decide it.
- **The person's own briefs are not a take set.** 40 to 60 % were taken. The rest are milestones
  with open design questions, refused as too large, or work outside the repository, refused as
  unsafe (hv6 runs real agents and reads `~/.claude`). That is the classifier being strict about a
  stranger's text, which is what it is for. The taken briefs' kinds matched in 60 of 61 takes over
  both prompts. Which own briefs are taken varies between runs: Sonnet took 12 under p1 and 8
  under p2.
- **Claude Code gives the classifier the account's email.** A probe in the classifier's own setup
  (`--safe-mode`, `--tools ''`, `--strict-mcp-config`, `--no-session-persistence`, and
  `--setting-sources ""` as well) was asked what context it had. It named the account's email, the
  working folder, the OS and the date. `--bare` leaves them out but answers "Not logged in" on an
  OAuth login. No answer of the 1,026 repeated the email, the home folder or the prompt; h15 asked
  for them. HV11 posts the classifier's question on the forge, so decision 1037 checks the question
  in code before it is posted.
- **The context is small.** A one-word issue costs 1,114 tokens of context. A classification by
  Haiku costs less than a tenth of a cent, and by Opus about 3 cents.
- **Opus overruns the reasons' length.** It needed the second try in 7 of 171 p2 answers, and one
  answer failed both tries, on an issue it had refused. Haiku and Sonnet never needed one. HV9b
  keeps the check in code and the one retry; a failed classification starts nothing.
- **Two runs of one model must not write one file.** Two background runs of the same model each
  held their own copy of the answers file and wrote it whole after each answer. The last write won,
  and 32 answers were lost: 12 of Haiku's real ones and Sonnet's 20 own briefs. They ran again. The
  script now reads the file before each write.
- **The real issues carry no hidden text.** None of the 40 had an HTML comment or an invisible
  character, so holding such a take for a click (decision 1034) costs little. The chore had
  counted 5 of 100 gitlab-runner bodies with HTML comments.
- **GitLab issues read without a token carry no comments and no author's role.** Every
  gitlab-runner snapshot has the body only, as the plan expected.

**Verification**:

- The labels were written before any model ran on the real set. Only p2's change came after
  answers were seen, and those were answers on the hostile and held-out sets. Held-out 2 was
  written before p2 ran.
- The report's precision and wrong takes were counted a second time by a separate script from
  the answers files, with the same results.
- `pnpm check` passes. The script is linted and formatted with the rest of `scripts/`.

Not verified:

- The person's labels: the page is ready (`node scripts/classifier-eval.mjs label`, then
  `report --prompt p2 --labels person`).
- Run-to-run variation on the real set: each model ran once per prompt. Opus's two wrong takes
  were the same under both prompts.
- Opus at `medium`, and Sonnet at `high`.
- The brief's quality as a writer would use it: no writer ran from a classified brief (HV12).
- A crafted issue written by someone who knows the prompt. The hostile sets were written by the
  same author as the prompt.
