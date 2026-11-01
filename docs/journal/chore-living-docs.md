# Journal: Chore — Living docs

[Index](../JOURNAL.md) · [Plan](../plan/chore-living-docs.md)

## Living docs: area pages, replaced decisions marked, the register, branches (2026-11-01, branch `chore/living-docs`)

Asked how to keep 122 plans and 181 journals (491,611 words, one month) from growing without
end, and how large projects do it; then "Yes, do it". Researched PEP 1 and PEP 12, Rust's RFC
README, Chromium's documentation guide, the UK GDS's decision records and Anthropic's context
engineering post: all keep the record unchanged, a small page of what holds now, and links both
ways. Built that: `docs/area/reviews.md` and `docs/area/merger.md`, checked against the code at
`108f956`; `scripts/plan/consolidate.mjs`, which marks a replaced decision's row from what the
newer row says and generates `docs/decisions.md`; the rules in CLAUDE.md, PLAN.md and the
milestone skill. Branches cleaned up first. Decisions 776–781.

**Learned**:
- **Replacements were written one way only.** 15 rows say they replace 18 older decisions;
  3 of those older rows said so back. Decision 80 (V16, "Approve pushes") was still the first hit
  of the lookup CLAUDE.md gives, a day after 82 replaced it.
- **Some replacements were never written.** 82 says "the agent merges"; 142 (V26) made the merger
  do it. 149's preselected target became 473's (V65). 147's rule was dropped by 164. Found only by
  writing the area pages from the code; now written on the newer rows, so the script marks them.
- **Fixes change decisions without a number.** 71's `.gitignore` text (the `merge.md` fix) and
  243's Check again (the queue fix) changed in fixes that record no decision. The area page says
  what holds; the register cannot.
- **The code had moved past every plan.** `symbiote merge --help` names the default target as
  "from, else the approval's into, else the default branch"; `targets` in `merges.ts` checks the
  workspace's `against` first (V65). Not fixed here: a fix of its own.
- **A question can carry a link.** V82's 633 links an anchor in its own plan; copied into
  `docs/decisions.md`, one folder up, it broke. The register now rebases links (a test first, red).
- **The register is a conflict magnet if branches write it.** Every branch adding a decision
  would rewrite the generated file, as every branch once appended to `JOURNAL.md` (53 conflicts
  in AR1). So it runs on `main` with `mark-merged.mjs`, not in `pnpm check`.
- **History needs a finished workspace's end.** It finds a workspace's commits by its branch, else
  by `tip` in its record (V77). 14 finished records had no `tip`: written before their branches
  went, as Clean up writes it. 10 of them had no commit of their own (`tip` is `base`), so they
  got no `merged`, as `isMerged` decides.
- **`mark-merged.mjs` copes with gone branches**: after the deletions it still said "Nothing to
  mark", finding each by its merge commit's subject.
- **Deleting 205 branches on `origin` needs the person's go.** The permission check refused a
  push whose list was computed at run time. The person ran it from the list written to a file;
  its last three names, on a line of their own, ran as a command and failed, so they were deleted
  after, by name, once their tags were checked on `origin`.

**Verification**:
- Tests first: `packages/cli/test/plan-consolidate.test.ts`, 8 tests, 7 red before the script
  existed (the eighth, a banner taken back, passed as nothing wrote banners). Then the
  link-rebasing case, red, then green.
- On the docs: the script read 15 forward references; each checked by hand against its row
  (wholly or in part: 74 "there", 384 "on the page", 446's centring). No note: no number is
  ambiguous or unknown. 752 decision rows (746 numbers; 1–4 used twice by D2c's local table, 242
  and 243 by V26 and V36), the same count as an awk over every table headed `# … Decision`. The
  gaps (573–575, 586–588, 722–729, 745–749, 753–759) are on no branch; AR1 says "722–729 left
  free".
- Reader test (writing-docs skill): a fresh agent per page, the page only, 10 questions each.
  Round 1: all answers right and quoted; guessed in part: the push default, when a held merge
  starts, what "+n" counts from. Fixed, with the terms they named (workspace, main checkout, Hive
  mode, `<repo-id>`) and the sentences read twice. Round 2, new agents: all 10 right and quoted
  on both pages; the guesses left were outside the questions (`<id>`, the order of queued
  entries, when `head` moves), then fixed.
- Prose: merger 13.4 words a sentence, reviews 13.8; 3 sentences over 25 words each, lists.
- Links: 1,194 relative links in the changed files, 0 broken after the fix.
- Branches: 49 merged local branches deleted (and the merged V75 worktree, clean); 5 unmerged
  ones tagged `archive/<branch>` and deleted, plus a tag for `origin`'s
  `milestone/v20-other-agents`; the 6 tags pushed and checked equal to the branch tips on
  `origin`. Left: `main` and the open HV4 workspace. On `origin`, 205 merged branches (each
  checked an ancestor of `origin/main`) and the 5 archived ones deleted; left there: `main` and
  `chore/living-docs`.
- `pnpm check`: 2,747 tests, format, lint, typecheck. `pnpm build`.

Not verified: that an agent changing the merger or reviews does better with the page than with
the journals (the reader test measures the page alone); the other 13 areas.
