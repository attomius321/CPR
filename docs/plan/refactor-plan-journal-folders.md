# Refactor — the plan and the journal in folders, read through an index

[Index](../PLAN.md) · [Journal](../journal/refactor-plan-journal-folders.md)

**Status:** planned (2026-10-24), on branch `refactor/journal-and-plan` (a workspace started in
Symbiote, from `main` at `ab9e352`; `main` at `86d9530` merged in).

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
