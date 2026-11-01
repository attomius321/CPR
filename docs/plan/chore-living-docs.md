# Chore — Living docs: what holds now, beside plans kept as written

[Index](../PLAN.md) · [Journal](../journal/chore-living-docs.md)

**Status:** built (2026-11-01), on branch `chore/living-docs` (outside a workspace, from `main` at
`108f956`); ready for review.

**Problem** (asked: "How would you manage this multitude of Journal and Plans in time, because i
would like to delete the branches, and somehow 'consolidate' these md files … how big players do
this?", then "Yes, do it"). Measured on `main` at `108f956`:

| What | Measured |
|---|---|
| Plans and journals | 122 plan files (342,003 words, 2.3 MB) and 181 journal files (149,608 words, 1.3 MB), all written from 2026-10-01 to 2026-11-01 |
| What CLAUDE.md asks before a change: "read the journal files of the area you touch" | Workspaces: 22,353 words of journals, its decisions spread over 67,073 words of plans; Agents 24,709 and 76,989; Shell and look 24,805 and 61,589 |
| Decisions replaced later | 15 rows say they replace 18 older decisions ("supersedes 80", "replaces 611"); 3 of the older rows say so back. `grep -rn '^\| 80 \|' docs/plan`, the lookup CLAUDE.md gives, returns V16's "Approve pushes the reviewed commit", replaced by 82 a day later |
| Decisions replaced without a word | 82 says "Symbiote pushes and merges nothing; the agent merges"; since V26 the merger merges an approved branch (142, 146), into the branch reviewed against since V65 (473). Nothing in 82's row says so |
| Branches | 56 local (49 merged into `main`), 212 on `origin` (206 merged); 30 worktrees |

What causes it:
- Every file is a record of its day: a plan says what was decided then, a journal what was
  learned then. Nothing says what holds now, so a reader rebuilds it from every file of the area,
  newest last, and cannot tell a replaced decision from one in force.
- A replacement is written on the new row only.

How large projects keep the same kind of record (researched 2026-11-01):
- **Python's PEPs**: "Once resolution is reached, a PEP is considered a historical document
  rather than a living specification" (PEP 1); what holds lives in the Language and Library
  References, and a final PEP carries a banner: "This PEP is a historical document. The
  up-to-date, canonical documentation can now be found at …" (PEP 12's `canonical-doc`).
  `Superseded-By` and `Replaces` headers link both ways; no PEP is deleted.
- **Rust's RFCs**: "once accepted, RFCs should not be substantially changed … More substantial
  changes should be new RFCs, with a note added to the original."
- **Chromium** (Google's documentation guide): "once the code is implemented, design docs should
  serve as archives of these decisions, not as half-correct docs"; implemented code's docs go in
  the README beside it, changed in the same change as the code; "A small set of fresh and
  accurate docs is better than a large assembly … in various states of disrepair."
- **Architecture decision records** (the UK's GDS): a record is not edited; a replaced one gets
  "Status: superseded" under its heading and a link to its replacement.
- **Anthropic on agents' context**: "the smallest possible set of high-signal tokens"; CLAUDE.md
  up front, the rest found when needed through "lightweight identifiers (file paths …)".

All of them keep three layers: the record, never rewritten; a small page of what holds now,
changed with the code; and links between the two.

**Goal**: an area's reader reads one page of what holds now, then the plans for why. Plans and
journals stay word for word, but for a status line on a replaced decision and a banner naming the
area's page. Merged branches go; unmerged work stays reachable. **Unchanged**: the code and its
tests, every decision's number, every journal entry.

## The area page (`docs/area/<area>.md`)

- One per area of the index, titled as the index's heading (`# The merger`). What it does, how it
  works now (modules, files, settings, routes), the decisions in force (number, the rule as it
  holds today, where it was made, and what changed it), the traps from the journals with links,
  and the commit it was checked against.
- Written from the code as it is, the plans and journals as sources: where they differ, the code
  wins and the page says so.
- Changed in the commit that changes what it says (the milestone skill's last step), as Chromium
  changes a README with its code.
- Pilot: **Reviews** and **The merger**, the areas where decision 80 and 82 were found stale. The
  other 13 after the person has read these two.

## Replaced decisions, marked both ways (`scripts/plan/consolidate.mjs`)

- A newer row names what it replaces in its own words, as today: `supersedes 80`,
  `replaces 378, 446's centring`. `N's …` or words after the number make it partly replaced.
- The script writes the older row's status at the end of its question:
  `*(superseded by 82 of V17)*`, `*(partly superseded by 507 of V72)*`. It owns that marker: run
  again, it rewrites it, so a removed marker removes the status.
- A number used twice (242, 243) is not marked: the script lists it for a person.
- Replacements nobody wrote (as 82's) are found area by area while writing its page, and written
  on the newer row (`replaces 82's "the agent merges"`), the one place a replacement is said.

## The register (`docs/decisions.md`)

- Generated: every decision by area and milestone, in the index's order: number, question, status
  (in force, superseded by, partly superseded by), plan. The decisions' text stays in the plans.
- An area with a page gets a line under its index heading linking the page and its register
  section; a plan in that area gets a banner under its reference line: `> What holds now: [The
  merger](../area/merger.md). This plan is kept as it was written.`
- Run on `main` with `mark-merged.mjs`, in the "Docs: merged" commit; `--check` exits 1 when
  something would change. Not in `pnpm check`: branches built side by side would each regenerate
  the register and conflict on it, as they did on `JOURNAL.md` (53 conflicts, AR1).

## Branches

- Merged branches deleted, here and on `origin`: their commits are in `main`, and
  `mark-merged.mjs` finds a gone branch by its merge commit (`Merge <branch>: …`).
- An unmerged branch is kept as a tag, `archive/<branch>`, pushed, before it is deleted.
- A finished workspace's record without `tip` gets it first, as Clean up writes it (V77, decision
  566), so History still finds where the workspace ended; `merged` only when it has commits, as
  `isMerged` says.
- An open workspace's branch and worktree stay.

## Verification

1. **The script, test first**: a test repository with plans, an index and area pages; the
   markers, the register, the banners and the index lines expected; a number used twice listed,
   not marked; a second run changes nothing; `--check` exits 1 on a stale file.
2. **On the docs**: every forward reference found and checked by hand against its row; the
   register's counts against a grep of the decision tables.
3. **The pages**: every claim checked against the code at the commit named; a reader test by a
   fresh agent given only the page (questions answered from the page, compared with the code).
4. **Nothing else**: `git diff main --stat` is Markdown, the script and its test; `pnpm check`,
   `pnpm build`.

**Risks**

| Risk | Mitigation |
|---|---|
| A page goes stale like the plans did | The milestone skill changes it with the code; each page names the commit it was checked against |
| The parser takes a number that is not a decision ("1,312 px") | Only a number at the start of a list item after `supersedes`/`replaces`; a number no decision has is listed, not marked |
| Deleting a branch loses work | Merged: its commits are in `main`. Unmerged: an `archive/` tag, on `origin` too. The deletions on `origin` wait for the person's go |
| History loses a finished workspace's changes | `tip` written into its record before its branch goes |

## Milestones

| # | Milestone | Output |
|---|---|---|
| a | Branches | Local merged and unmerged branches gone (tags, tips); `origin`'s after the person's go |
| b | The script and its test | `scripts/plan/consolidate.mjs`, `packages/cli/test/plan-consolidate.test.ts` |
| c | Two area pages | `docs/area/reviews.md`, `docs/area/merger.md`; the replacements found there written |
| d | The rules | CLAUDE.md, PLAN.md's "How the plan is kept", the milestone skill |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 776 | Where what holds now is written | **`docs/area/<area>.md`, one per area of the index, checked against the code; plans and journals stay as written** | Python's References beside the PEPs, Chromium's READMEs beside design docs; 22K–25K words of journals per large area today |
| 777 | How a replaced decision is marked | **The newer row says what it replaces; `consolidate.mjs` writes `*(superseded by N of ID)*` on the older one** | PEP's `Superseded-By`/`Replaces`, the ADRs' status; 18 replaced rows, 3 marked back today |
| 778 | The register | **`docs/decisions.md`, generated on `main` with the "Docs: merged" commit; not in `pnpm check`** | A generated file every branch rewrote would conflict as `JOURNAL.md` did |
| 779 | Plans of an area with a page | **A banner under the reference line names the page; the index's area heading links it** | PEP 12's `canonical-doc` banner: the reader of an old plan is sent to what holds |
| 780 | The other areas | **Reviews and The merger first; the 13 others after the person reads them; an area's page is changed with its code** | A page per area is a day's work to check against the code; the pilot says whether it pays |
| 781 | Branches | **Merged ones deleted; an unmerged one kept as an `archive/<branch>` tag first; a finished workspace's record gets its `tip` first** | Commits stay reachable and History keeps each workspace's end; the branch list shows open work only |

**Not in this chore (later)**: the other 13 area pages; `JOURNAL.md` by month (36 KB today,
read whole); moving old plans to an archive folder (300 files' links and the decision greps name
their paths); pruning plans (the measured why is there, and nothing else keeps it).

## As built

- **As planned**, with these differences:
  - **Three replacements written on newer rows** that nobody had written: 142 and 473 replace parts
    of 82, 473 replaces 149's preselected target, 164 replaces 147's rule. Found by writing the
    pilot pages from the code.
  - **The register rebases links**: a question can link within its plan (V82's 633); copied to
    `docs/decisions.md`, one folder up, the link broke. Found by the link check; a test first.
  - **The area pages define their terms** (workspace, main checkout, entry, Hive mode, fork
    point, cache): the reader test's agents named them as used before they were explained.
  - **The deletions on `origin` were not made**: the permission check refused a push of 205
    deletions listed at run time. The list is in the journal; the person decides.
- **Not a decision, a finding**: `symbiote merge --help` gives the default target without the
  reviewed-against branch, which `targets` in `merges.ts` checks first. Left for a fix of its own.

**Results**:

| What | Before | After |
|---|---|---|
| What to read before changing Reviews | its journals, 3,995 words, and its 5 plans, 13,071 words, for the decisions | its page, 1,829 words, then the plans it links for why |
| The merger | its journals, 7,889 words, and its 4 plans, 11,570 words; 473, 742 and 743, which also rule it, are in V65's and AR2's plans | its page, 2,217 words, with those decisions listed |
| Replaced decisions marked on the older row | 3 of 18 | 21 of 21, by the script: the 18, and 82, 147 and 149, whose replacements were written on newer rows |
| `grep -rn '^\| 80 \|' docs/plan` | "Pushes the reviewed commit", no word of 82 | the same row, ending `*(superseded by 82 of V17)*` |
| Every decision's status | none | `docs/decisions.md`: 746 numbers in 752 rows, 10,329 words, by area |
| Branches | 56 local, 212 on `origin` | 2 local (`main`, the open HV4 workspace); `origin` unchanged until the person's go; 6 `archive/` tags |

- **Reader test**: two rounds per page, 10 questions each, a fresh agent each round given only the
  page. Round 1: every answer right and quoted, three in part guessed; round 2: all right and
  quoted.
- **Checks**: 8 tests for the script (red first); `pnpm check` 2,747 tests and `pnpm build`.
  `hive-runner.test.ts`'s "stops for the person at the cap" timed out twice in 6 full runs here
  (5.08 s and 5.10 s against 5 s; 1.1 s alone); `main` passed it 3 of 3 under the same load. Not
  patched: it touches no code of this chore; listed.

Not verified: whether an agent that changes the merger or reviews makes fewer mistakes with the
page than with the journals; the other 13 areas, which have no page yet.
