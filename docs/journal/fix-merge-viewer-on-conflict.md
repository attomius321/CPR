# Journal: Fix — the merge page on a conflict: red for what is lost, a question answered there

[Index](../JOURNAL.md)

## Fix — red for what is lost or doubled, amber for what the agent wrote; Needs you answered on the page (2026-10-25, branch `fix/merge-viewer-on-conflict`)

The person ran two real merges of `feature/discounts` into `main`. Both were correct in substance
(about 11 s and 7K tokens each, tests 7 of 7, `main` unmoved until Approve), but the page around
them misled: on the correct merge 3 of 4 files were red, while the one real mistake, `## Unreleased`
written twice, showed only in amber. "Needs you" asked about "Region 4" on a page that numbered no
region and offered only Retry and Remove. Files opened on README, not on the pricing.ts that lost
the discount. The review tab said "the agent resolves them on feature/discounts first". The
branch's name was cut in the gutter, the Files tab went away during Ask again, and the Log stayed
on the old run.

**Learned**:
- **Reproduced without their repository.** Their four files rebuilt as unit cases read as they
  reported: README (re-wrapped prose) "Drops all 2 lines from main · Drops 1 of 2 lines from
  feature/discounts · 2 lines written by the agent", the tests' `});` "2 lines kept twice", a merged
  doc comment "Drops the line from main · Drops the line from feature/discounts", CHANGELOG amber
  "1 line written by the agent", README shown first. A wrong pricing.ts (the discount lost) was red
  too: right and wrong looked alike.
- **The cause: lines counted, not read.** The page compared each side's lines as counts: no order,
  no words, nothing of the lines around a region. Now lines pair in order (a longest common
  subsequence, then lines moved, by text): each `});` belongs to its own test, and "kept twice" is a
  copy past the ones a side has. On `e380fef`, the merge V46 replayed, JOURNAL.md's "2 lines kept
  twice" and PLAN.md's "10" read "Keeps every line of both sides".
- **A rewrite keeps what a side changed, not its line.** First try: a side's line counted as kept
  when all its words were in lines the agent wrote. README broke it: the agent kept the branch's
  first line as it was and spread main's words over it and a new one. So the words are looked for
  in the whole resolution, counted only when they reach a line the agent wrote. Then a real run
  applied the discount in a new variable (`const discounted = …; return Math.round(discounted *
  100) / 100;`): neither side's `return` line was there word for word, and the page said red. What
  must be found is a side's change: its tokens not paired in order with the ancestor's. Prose files
  and comment lines are read for words only; code for its symbols too, so a changed operator stays
  dropped.
- **The copy needed the lines around the region.** The prompt shows 3 above and below each region;
  the merger now keeps them (`around`), and a line the agent wrote that equals one of them is red,
  "Repeats “## Unreleased” from just above it". Kept, they stop at another region's markers: the
  prompt shows those, but they are not in the file once it is resolved (the first real run's
  `around` showed `<<<<<<< HEAD` as a line below a region).
- **The prompt now says those lines stay in the file.** One real run with it (Claude Code 2.1.310,
  `sonnet`, a repository like the person's: CHANGELOG, a README paragraph, tests, pricing.ts; 4
  files, 5 regions): 14 s, 10.7K tokens in and 961 out, a correct resolution, no line written again.
  One run says nothing of the rate: the person's copy came once in two.
- **A question threw its regions away.** On `needsYou` the merger kept `regions: []`: nothing to
  number or show. The regions asked about are kept (`resolution.asked`), numbered as the prompt
  numbers them; Request changes answers the question (`again.asked`: "You asked: … The person
  answered: …"), so `symbiote merge --again` answers it too, and the page has an Answer box. Files
  opens on the file holding the region the question names, marked "Asked about".
- **Ask again reset the entry as a new merge.** `fresh` cleared `conflicts`, which the tabs are
  drawn from: sampled every 25 ms, "Review resolution: Files | Log" became "Merging: no tabs". The
  files asked about stay listed until the merge says which conflict.
- **The log followed the end only when it was at it.** Scrolled up in run 1, run 2 ran and ended out
  of view: its rows still showed "line 86" of run 1's check. A new run's first line now scrolls it
  to the end. Not scrolled up, it always followed.
- **Still red on a correct merge: a number both sides counted up.** `e380fef`'s settings.spec.ts:
  each side made "14 prompts" 15, the merge says 16 and `toHaveCount(17)`. "15" is in no line the
  agent wrote: "Drops 1 of 3 lines from main". A token check cannot see arithmetic; left as it is.
- **This machine's headless GPU process hung** during the session: no animation frame fired, even
  on a blank page, so every Playwright click and screenshot waited out its timeout.
  `--disable-gpu --disable-software-rasterizer` brought frames back, without WebGL: the six intro
  specs fail under it. The config written to pass those flags was committed by `git add packages`
  and removed in the next commit.

**Verification**: tests first, red for the reason reported:
- Viewer unit (`merges.test.ts`): the person's four files as one correct merge and as a wrong one,
  the real run's two pricing.ts regions and the same without the discount, a changed operator,
  moved lines; a question's tone, files, named region and first file; the files during Ask again;
  the gutter's width. One expectation changed: only the second copy of a doubled line is marked.
- CLI: the regions asked about, an answer in the next prompt, the files kept while asked again and
  none once the merge is clean, the lines around a region, `aroundOf` at another region's markers,
  `symbiote merge` with a question (a fake Claude Code); the prompt's new sentence.
- e2e: three new specs, run on `main`'s sources built with this branch's specs: each failed with
  the brief's symptoms ("CHANGELOG.md1 region1 line written by the agent", "README.md … Drops all 2
  lines from main …", "total.test.ts src1 region2 lines kept twice"; "Merging: no Files"; a question
  with Log first). Green on the branch.
- `pnpm check`: 1,589 tests. Build. e2e, full run with the flags above: 233 of 242. Failed: the six
  intro specs (no WebGL); `merges.spec.ts:53`, an assertion this branch did not change, timed out
  while the agent was still resolving (passed in three runs of the spec alone); `changes.spec.ts:104`
  (code not changed here; passed alone); a spec of mine expecting "above" on a blank line (fixed).
  Then the merger, changes and intro specs alone: 15 of 21, the six intro specs failing.
- Real data: `e380fef` replayed, its 5 regions cut from the committed merge: README amber, JOURNAL
  and PLAN green, settings.spec.ts red (the count above). `resolutionFiles` 8.3 ms for the 5,
  `reviewRegion` 1.9 ms for the 411-line PLAN.md region.
- Screenshots at 1440×900 and 390×844, dark and light: the real run's resolution, and replays of
  its answer as a question and with `## Unreleased` written again (a fake Claude Code giving the
  recorded answer). No horizontal overflow, no page error; "feature/discounts" whole in the gutter
  at both widths.

Not verified: the intro specs on this machine; a real Codex merger; the copy's rate with the new
prompt (one run); a name over 24 characters cut at its start in the gutter (no such branch in the
shots); macOS and Windows; `regression-check` (no analysis code: core gained optional queue fields).
