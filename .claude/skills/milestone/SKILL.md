---
name: milestone
description: Plans and delivers a Symbiote milestone the way this repository does it — measure the problem on real data, write its plan in docs/plan/, branch, failing tests first, implement, verify against main, record in docs/journal/, then ask before merging. Use when the user asks to plan, implement, continue or finish a milestone (IDs like V7, Q2, W1), to deep-plan a feature, or to merge one.
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

## Plan (when asked to plan, or before implementing an unplanned milestone)

```
- [ ] 1. Read: docs/PLAN.md (North Star, index); the plan and journal files of the area and
         the decisions they cite
- [ ] 2. Branch from up-to-date main: git checkout -b milestone/<id>-<slug>
- [ ] 3. Reproduce the user's problem; measure it on real repos (regression-check skill sets,
         scripts/viewer/measure.mjs, or the user's own layout) — numbers for the Problem table
- [ ] 4. Write docs/plan/<id>-<slug>.md from plan-template.md; add its row to the index in
         docs/PLAN.md, at the end of its area
- [ ] 5. Write docs/journal/<id>-<slug>.md from journal-template.md, the entry "<ID> spike":
         what was measured and learned; its line at the end of docs/JOURNAL.md
- [ ] 6. Commit "Plan <ID>: <title>" (body: the finding and the plan in a paragraph), push
- [ ] 7. Report: the problem in numbers, the plan's steps, open choices; stop if asked to plan only
```

Pick the next free milestone ID in its family (V = viewer, A = Angular, Q = Qwik, W = workspaces,
X = extension points, R = references, D = detectors, P = performance, G/I/C = forges, interdiff, CI)
and the next free decision numbers (the highest number plus one). Workspaces are built side by
side, each from the `main` it started on, and two have taken the same ID and numbers: check
`main` and every other branch, at plan time and again before finishing:

```sh
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
- [ ] 2. Implement in small steps; `pnpm check` green; commit and push at each checkpoint
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
- [ ] 9. Report to the user with numbers and what was not verified; ask before merging
```

Unrelated bugs found on the way get their own `fix/<slug>` branch from `main` (test first), are
reported, and are merged only when the user agrees. A fix's journal is `docs/journal/fix-<slug>.md`
and its row goes in the index under the area it fixes.

A milestone that builds on an unmerged one branches from it (`milestone/q2-…` from
`milestone/q1-…`) and they are merged in order.

## Merge (only after the user says so)

```sh
git checkout main && git pull --ff-only origin main
git merge --no-ff milestone/<id>-<slug> -m "Merge <ID>: <title>"   # plus the session's trailers
pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test:e2e
git push origin main
```

Then mark it merged — the plan file's status "merged into main (<date>, from branch …)", its
index row ✅, the journal's "Merged into main (<date>)" — commit "Docs: <ID> merged" and push.
Merge `main` into any open milestone branch that needs the change.

## Templates

See [plan-template.md](plan-template.md) and [journal-template.md](journal-template.md).
