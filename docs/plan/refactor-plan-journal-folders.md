# Refactor — the plan and the journal in folders, read through an index

[Index](../PLAN.md) · [Journal](../journal/refactor-plan-journal-folders.md)

**Status:** merged into `main` on 2026-10-24 (built 2026-10-24), on branch `refactor/journal-and-plan` (a workspace
started in Symbiote, from `main` at `ab9e352`; `main` at `86d9530` merged in). As built and
results under "As built (the plan and the journal)" below.

**Problem** (the brief: "JOURNAL.md and PLAN.md should be breaked in folders, with each
version/feature, and with references"; then "a structured way of plan and journal, so it
consume less tokens … without losing information"). Measured at `86d9530`, tokens taken as
bytes / 4:

| File | Lines | Bytes | ≈ Tokens | Of which |
|---|---|---|---|---|
| `docs/PLAN.md` | 11,087 | 882,633 | 220K | 49 milestone sections 814,950 (92 %); "Proposed next" 33,403; North Star and §1–§11 21,138; §12's other tables 6,390; Phase 1's table, §13 and §14 6,752 |
| `docs/JOURNAL.md` | 5,653 | 406,960 | 100K | 171 entries in date order |

- What an agent is told to read first ("PLAN.md North Star, related sections and decisions;
  JOURNAL entries of the area") is two files of 220K and 100K tokens, more than a context
  holds: it greps and reads windows, and finds a section's decisions, "As built" and results
  by line numbers.
- Decisions 20–289 sit in their milestone's section; §14 holds 1–19 and 119. 51 source files
  cite decisions by number ("decision 246"). 242 and 243 are each used twice (a V26 fix and
  V36).
- The files hardly point at each other: 2 links from PLAN.md to the journal, 1 back. No test
  reads either file (4 use their paths as sample strings).
- Every milestone appends to both files at the same place, so branches built side by side
  conflict there (the merger's own test case is a conflict in `docs/JOURNAL.md`).

**Goal**: an index small enough to read whole, then only the files of the area one works on;
every line of both files kept, word for word. **Unchanged**: the code, the tests and what they
assert, every decision's number and row, every entry's text.

## Design

- **Layout** of `docs/`:
  - `PLAN.md`: the North Star, how the plan and the journal are kept, and the index: every
    milestone, fix and chore by area, one row each (ID, title, status, decisions, its plan
    and journal files).
  - `JOURNAL.md`: every entry by date, one line each, linked to its file, in the order the
    one file had.
  - `plan/design.md`: §1–§11, §13 and §14 as written (the v1 design, its risks, decisions
    1–19 and 119). `plan/roadmap.md`: §12 as written (the phases and their milestone tables,
    "Proposed next" up to V44, Phase 1's table).
  - `plan/<id>-<slug>.md`: one per milestone section. `journal/<id>-<slug>.md`: that
    milestone's entries (spike, parts, replans, merge), under the same name.
    `journal/phase-<n>-<name>.md`: the milestones of 2026-10-01, whose plan is roadmap.md's
    tables. `journal/fix-<slug>.md`, `chore-<slug>.md` and a few others: an entry made on a
    branch of its own.
- **Text moves word for word.** A plan section's headings move up two levels (`### V42 — …`
  becomes `# V42 — …`), so each file has one title; a journal entry keeps its `##` heading,
  under a title naming the file's milestone or branch. Line 3 of every file is its
  references: the index and its twin. Relative links in moved text are re-pathed.
- **An entry goes with its milestone**: by its ID, or by its branch when that is a milestone's
  (V42's card-focus fix is in `v42-koi`); else to a file of its own, named after its branch.
- **The index by area**: engine and analysis, framework plugins, forges and CI, the graph,
  History, reviews, workspaces, agents, the merger, shell and look, the native window, docs
  and the repository. Reading up on a piece of work is the index, then its area's rows.
- **"Proposed next" stays as written**, in roadmap.md: its rows are each milestone's problem
  told again (33 KB); the index is the list new work is added to, a title and no paragraph.
- **The instructions** (CLAUDE.md, the `milestone` skill with a journal template, the other
  skills, the packages' CLAUDE.md, README) say what to read and where to write; the next free
  milestone ID and decision number by a grep over `main` and every other branch.

## Verification

- **Rebuild**: a script puts the files back together (titles and reference lines dropped,
  headings moved back, links resolved to repository paths) and compares the result with the
  two files before the split: identical, but for the lines this section lists as changed.
- **References**: every relative link in `docs/`, the READMEs, the CLAUDE.md files and
  `.claude/skills/` resolves; every file is in the index once and every entry in JOURNAL.md
  once; 171 entries and 291 decision rows, each once.
- **Nothing else**: `git diff main --stat` is Markdown only; `pnpm check` and `pnpm build`.
- **Cost**: the bytes an agent reads to start on one milestone, before and after.

**Risks**

| Risk | Mitigation |
|---|---|
| A branch made before the split appends to `PLAN.md` and `JOURNAL.md` (open: `milestone/v20-other-agents`) | Its merge conflicts there: its section and entries go to new files, rebuilt from the branch's own insertions. |
| Links into the old files' anchors break | In the repository two: README's `#x1--plugins` and graph-schema's `#62-stable-ids`, re-pointed. |
| The index drifts from the files | A row per milestone and its status is what the milestone skill already asks for; the rebuild script's counts can be run again. |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 290 | Where the plan and the journal live | **`docs/plan/` and `docs/journal/`: a file per milestone, the same name in both; `PLAN.md` and `JOURNAL.md` are their indexes** | The two names every instruction gives stay the way in. A folder per milestone (`plan.md` and `journal.md` in it) would pair them too, but needs a folder for each fix. |
| 291 | Where an entry without a plan goes | **A file of its own, named after its branch (`fix-<slug>.md`)**, unless it was made on a milestone's branch | CLAUDE.md's unit is "one entry per milestone or fix"; filing a fix under the milestone it touches is a call each writer would make differently. The index puts it in its area. |
| 292 | What is read first | **`PLAN.md`: the North Star and the index by area**; then the files of the area; a decision or a term by grep | The index is read whole; every row gives its area, status, decisions and both files. |
| 293 | "Proposed next" | **Kept as written in `plan/roadmap.md`; new work gets an index row** | Its rows tell each milestone's problem again; the plan file holds it. |

## As built (the plan and the journal)

- **137 files**: in `docs/plan/`, 50 milestone plans, `design.md` and `roadmap.md`; in
  `docs/journal/`, 87 files: 50 under a plan's name, 5 for the phases of 2026-10-01, 4 more
  without a plan section (D1, P1, V22, the Angular 11 trial), 21 fixes and 7 others (4 chores,
  2 features, the rename).
- **Filed by judgment** (each visible in both indexes): the Angular 11 trial in a file of its
  own; "Plan revised: Angular as a plugin" with X1; "Merged: X1, A1–A2", the Angular templates
  spike with A1–A2; the Qwik spike with Q1–Q2; "Phase 3 kickoff" with phase 3; V26b (dropped)
  with V26; V42's card-focus fix, made on V42's branch, with V42.
- **The index's status is git's**: V39–V44 and the viewer refactor are ✅ there, merged into
  `main`, while their plans still say "ready for review" as written.
- **Rows in the order built**: by each file's first journal entry, so V10c comes before V10b
  and V44 before V43 within their areas, as they were merged.
- **The scripts were not committed**: the split, the rebuild check and the link check ran from
  the job's folder. The rebuild compares with the files before the split, a check made once;
  the index's upkeep is the milestone skill's (a row, its status), as the "Proposed next" row
  was.
- **The templates**: `plan-template.md` writes a plan file (its title `#`, its parts `##`, the
  reference line) and its index row; `journal-template.md` is new. The skill's branch-wide greps
  for the next decision number and a taken ID read `PLAN.md` and `docs/plan/` alike, so they
  work on branches made before the split.

**Results**:

- **Nothing lost**: both files rebuilt from the new ones (titles and reference lines out,
  headings back, links resolved to repository paths) equal the files before the split, but for
  the two intro passages rewritten (PLAN.md's status quote, 2 lines into 3; JOURNAL.md's
  "Newest milestone last", 1 line into 2) and 7 blank lines: 2 sections had none before the
  next heading (V34, V41) and gain one, 5 double blank lines between journal entries become
  single. 295 decision rows (291 numbers, 242 and 243 twice, 290–293 this refactor's) and 172
  entries, each once.
- **References**: 638 relative links in 160 Markdown files, 0 broken, anchors included (before:
  65 links in the 20 files then, 0 broken). README's `#x1--plugins` and graph-schema's
  `#62-stable-ids` re-pointed at the new files.
- **What is read** (tokens taken as bytes / 4):

| Read | Before | After |
|---|---|---|
| `PLAN.md` | 882,633 bytes; a plain read returns its first 2,000 lines, 173,536 bytes (≈43K tokens), up to V7 | 13,713 bytes (≈3.4K), whole: the North Star and 88 index rows |
| `JOURNAL.md` | 406,960 bytes; a plain read returns 134,615 (≈34K), up to 2026-10-14 | 15,738 (≈3.9K), whole: 172 entries by date |
| Starting on V42: the index, its plan, its journal | the two files, found by grep and read in windows | 33,856 (≈8.5K) |
| The largest pair: V18's plan and journal, with the index | | 92,832 (≈23K) |

A plan file's median is 14 KB (3.3–62 KB), a journal file's 3.6 KB (0.6–20 KB). All of it,
indexes included, is 1,338,335 bytes, 3.2 % more than the two files just before the split
(1,297,445): the indexes (29 KB) and each file's title and reference line.

- **Nothing else changed**: `git diff main` is Markdown only (no code, no test). `pnpm check`:
  1,387 tests in 100 files; `pnpm build` passes. No e2e: no viewer change.

Not verified: the anchors as GitHub renders them (checked with GitHub's rules for slugs, by a
script, not on github.com); how much an agent saves in practice, beyond the bytes above; the
merge of `milestone/v20-other-agents`, which predates the split and appends to both old files.
