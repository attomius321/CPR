---
name: milestone
description: Plans and delivers a Symbiote milestone the way this repository does it — measure the problem on real data, write the docs/PLAN.md section, branch, failing tests first, implement, verify against main, record in docs/JOURNAL.md, then ask before merging. Use when the user asks to plan, implement, continue or finish a milestone (IDs like V7, Q2, W1), to deep-plan a feature, or to merge one.
---

# Milestone workflow

A milestone is a user-visible step with a section in `docs/PLAN.md` (problem, goal, design,
verification, risks, decisions) and an entry in `docs/JOURNAL.md` (what was learned, how it was
verified). Plans are built on measurements, not guesses; results are reported with numbers.

## Plan (when asked to plan, or before implementing an unplanned milestone)

```
- [ ] 1. Read: PLAN.md North Star, related sections and decisions; JOURNAL entries of the area
- [ ] 2. Branch from up-to-date main: git checkout -b milestone/<id>-<slug>
- [ ] 3. Reproduce the user's problem; measure it on real repos (regression-check skill sets,
         scripts/viewer/measure.mjs, or the user's own layout) — numbers for the Problem table
- [ ] 4. Write the PLAN.md section from plan-template.md; add a row to "Proposed next" (§12)
- [ ] 5. JOURNAL entry "<ID> spike": what was measured and learned
- [ ] 6. Commit "Plan <ID>: <title>" (body: the finding and the plan in a paragraph), push
- [ ] 7. Report: the problem in numbers, the plan's steps, open choices; stop if asked to plan only
```

Pick the next free milestone ID in its family (V = viewer, A = Angular, Q = Qwik, W = workspaces,
X = extension points, R = references, D = detectors, P = performance, G/I/C = forges, interdiff, CI)
and the next free decision numbers (the highest number in PLAN.md plus one).

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
- [ ] 7. PLAN.md: Status, "As built" (what differs from the plan and why), Results; README for
         user-visible behavior; graph-schema.md for JSON changes
- [ ] 8. JOURNAL.md entry: Learned (surprises, traps), Verification (tests, comparisons, numbers)
- [ ] 9. Report to the user with numbers and what was not verified; ask before merging
```

Unrelated bugs found on the way get their own `fix/<slug>` branch from `main` (test first), are
reported, and are merged only when the user agrees.

A milestone that builds on an unmerged one branches from it (`milestone/q2-…` from
`milestone/q1-…`) and they are merged in order.

## Merge (only after the user says so)

```sh
git checkout main && git pull --ff-only origin main
git merge --no-ff milestone/<id>-<slug> -m "Merge <ID>: <title>"   # plus the session's trailers
pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test:e2e
git push origin main
```

Then mark it merged — PLAN.md status "merged into main (<date>, from branch …)", the milestone
table row ✅, JOURNAL "Merged into main (<date>)" — commit "Docs: <ID> merged" and push. Merge
`main` into any open milestone branch that needs the change.

## Plan section template

See [plan-template.md](plan-template.md).
