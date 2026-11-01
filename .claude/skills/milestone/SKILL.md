---
name: milestone
description: Plans and delivers a Symbiote milestone the way this repository does it — measure the problem on real data, write its plan in docs/plan/, failing tests first, implement, verify against main, record in docs/journal/ — on a Symbiote workspace's own branch, or on a milestone branch outside one; then how the work reaches main and is marked merged in the plan index. Use when the user asks to plan, implement, continue or finish a milestone (IDs like V7, Q2, HV4), to deep-plan a feature, to merge one, or to mark merged work as merged.
---

# Milestone workflow

A milestone is a user-visible step with a plan, `docs/plan/<id>-<slug>.md` (problem, goal,
design, verification, risks, decisions), and a journal of the same name,
`docs/journal/<id>-<slug>.md` (what was learned, how it was verified). `docs/PLAN.md` is the
North Star and their index by area; `docs/JOURNAL.md` lists every entry by date. Plans are built
on measurements, not guesses; results are reported with numbers.

Read what the work needs, not the folders: the index, then the plan and journal files of the
area, then a decision or a term by grep (`grep -rn '^| 246 |' docs/plan`,
`grep -rln <term> docs/plan docs/journal`).

## Where you are

Most work here runs in a **Symbiote workspace**: a branch and a worktree Symbiote made for it, a
start prompt, and a record, `symbiote/workspaces/<branch>.json` in the main checkout (the first
line of `git worktree list`). The record's `planFirst` and `hive` say which column is yours. With
no start prompt and no record you are outside a workspace: a session the person opened in a
checkout. Where the start prompt and this skill differ, the start prompt wins.

| | Outside a workspace | A workspace | A Hive workspace (`hive: true`) |
|---|---|---|---|
| Branch | `milestone/<id>-<slug>` from up-to-date `main`; a fix `fix/<slug>`, docs or tooling `chore/<slug>` | The workspace's own (e.g. `feature/<slug>`): never another branch or worktree | The workspace's own |
| The plan | Commit "Plan <ID>", push, report | With `planFirst`: the plan is your final message, then stop. **Commit nothing before the person's OK, not even the plan**: any commit turns the card from "Plan ready" to "Ready for review". Its files are the first commit after the OK. Without: commit "Plan <ID>" and go on | As its start prompt and Hive's messages say |
| Push | As you go | As you go (with `planFirst`, from the OK on) | Never: Hive does (CLAUDE.md, "Which rules are which mode's") |
| Into `main` | You merge it, after the person's yes ([Merge](#merge-outside-a-workspace)) | Say it is ready. The person reviews it in Symbiote; their Approve has Symbiote's merger merge it, run `merge.checks` and push. You merge nothing | Hive lands it (CLAUDE.md); you merge nothing |
| Marked merged | By you, after your merge ([Marking merged work](#marking-merged-work)) | Not by you, not on your branch: on `main`, later, for every merged branch at once | As a workspace |
| An unrelated bug | Its own `fix/<slug>` from `main` (test first); merged only with the person's OK | Do not fix it here: report it, and suggest a fix workspace for it | As a workspace |

## Plan (when asked to plan, or before implementing an unplanned milestone)

```
- [ ] 1. Read: docs/PLAN.md (North Star, index); the plan and journal files of the area and
         the decisions they cite
- [ ] 2. Your branch, as "Where you are" says: in a workspace the one you are on; outside one,
         git checkout -b milestone/<id>-<slug> from up-to-date main
- [ ] 3. Reproduce the user's problem; measure it on real repos (regression-check skill sets,
         scripts/viewer/measure.mjs, or the user's own layout) — numbers for the Problem table
- [ ] 4. Write docs/plan/<id>-<slug>.md from plan-template.md; add its row to the index in
         docs/PLAN.md, at the end of its area
- [ ] 5. Write docs/journal/<id>-<slug>.md from journal-template.md, the entry "<ID> spike":
         what was measured and learned; its line at the end of docs/JOURNAL.md
- [ ] 6. Commit "Plan <ID>: <title>" (body: the finding and the plan in a paragraph), push —
         except in a plan-first workspace: there steps 4–6 come after the person's OK
- [ ] 7. Report: the problem in numbers, the plan's steps, open choices; stop if asked to plan
         only, or with plan first
```

Pick the next free ID in its family (an area's prefix in the index: V the viewer, HV Hive, NX
the nexus…) and the next free decision numbers (the highest plus one). Workspaces are built side
by side, each from the `main` it started on, and two have taken the same ID and numbers: check
`main` and every other branch, at plan time and again before finishing:

```sh
grep -oE '^\| \[?[A-Z]{1,2}[0-9]+' docs/PLAN.md | sed -E 's/^\| \[?//; s/[0-9]+$//' | sort | uniq -c   # families
for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
  git grep -h -E '^\| [0-9]+ \|' "$r" -- docs/PLAN.md 'docs/plan/*.md'
done | awk -F'|' '{print $2 + 0}' | sort -n | tail -1          # the highest decision
for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
  git grep -l -E '^#{1,3} V45 ' "$r" -- docs/PLAN.md 'docs/plan/*.md'
done                                                           # anyone using V45 already
```

## Implement

```
- [ ] 1. Fixtures and tests that encode the right answers; run them: red, for the right reason
- [ ] 2. Implement in small steps; `pnpm check` green; commit at each checkpoint, and push as
         "Where you are" says
- [ ] 3. Precision cases: what must stay flagged still is (a feature that silences warnings
         must keep the real ones)
- [ ] 4. "Nothing changes without it": without the plugin/flag, results identical (tests + regression-check)
- [ ] 5. Verify (CLAUDE.md "Verifying a change"): check, build, e2e for viewer work,
         regression-check against main, real-repo before/after, cost in time
- [ ] 6. Explain every difference the comparisons show; fix or record why it is right
- [ ] 7. The plan file: Status, "As built" (what differs from the plan and why), Results; its
         index row (status, decisions); user-visible behavior in the README or the page under
         docs/reference/ or docs/guide/ it belongs to; graph-schema.md for JSON changes
- [ ] 8. The journal file: an entry with Learned (surprises, traps), Verification (tests,
         comparisons, numbers); its line in docs/JOURNAL.md
- [ ] 9. Report to the user with numbers and what was not verified; then, as "Where you are"
         says, ask before merging (outside a workspace) or say it is ready (in one)
```

A fix's journal is `docs/journal/fix-<slug>.md` and its row goes in the index under the area it
fixes. A milestone that builds on an unmerged one starts from its branch (outside a workspace,
`milestone/q2-…` from `milestone/q1-…`; a workspace, started from that branch), and they are
merged in order.

## Merge (outside a workspace, after the person's yes)

An Approve in Symbiote they ask you to act on (`symbiote-review` skill) is that yes.

```sh
git checkout main && git pull --ff-only origin main
git merge --no-ff milestone/<id>-<slug> -m "Merge <ID>: <title>"   # plus the session's trailers
pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test:e2e
git push origin main
```

Then mark it merged, and merge `main` into any open milestone branch that needs the change.

## Marking merged work

Symbiote's merger leaves the docs as they were (70 stale index rows on 2026-10-30, 23 on
2026-11-01). On `main`, after your own merge or when the person asks,
`node scripts/plan/mark-merged.mjs` lists, and with `--write` marks, every merged branch's row ✅,
its plan's Status and its journal's last line. Commit that on `main` as "Docs: merged" (the IDs
in the body; the one commit made on `main` itself) and push. Settle its notes by hand: a merged
row that says "planned" or "measured", a branch with commits after its merge.

## Templates

See [plan-template.md](plan-template.md) and [journal-template.md](journal-template.md).
