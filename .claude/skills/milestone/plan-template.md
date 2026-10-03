# PLAN.md milestone section — template

Insert before `### Phase 1 milestones` in `docs/PLAN.md`. Write for a reviewer who has not seen
the conversation: short sentences, measured numbers, real file and commit names. Sections V6, W1
and Q1–Q2 are good examples.

```markdown
### <ID> — <Title in a few words>

**Status:** planned (<date>), on branch `milestone/<id>-<slug>`; not started.

**Problem** (asked: "<the user's words>"). What happens today, measured: a table of real changes
(repo, commit, the numbers that show the problem). What causes it, in two or three points.

**Goal**: what the user will see or get, and what must not change (e.g. "without the plugin,
nothing changes"; "a single-project graph is drawn as today").

#### <Design topic> (one heading per part: rules, core, viewer, CLI…)

- The rule or mechanism, concrete enough to implement: names of files, hooks, fields, options.
- Why this and not the obvious alternative, when the measurements decided it.
- Schema or API changes with their version bump.

#### Verification

1. **Fixtures** (red before): each behavior with its expected result; precision cases.
2. **Nothing else changes**: goldens, other plugins' fixtures, `regression-check` sets.
3. **Real repos**: which sets or repos, what must hold, expected numbers.
4. **Viewer** (if any): e2e spec, screenshot, first paint against today's.
5. **Cost**: the time budget (e.g. +5 % at most).

**Risks**

| Risk | Mitigation |
|---|---|

**Order**: which part first, what is prototyped before the rest.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| <ID>a | … | … |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| <next free number> | … | **…** | the measurement or reason |

**Not in <ID> (later)**: what was considered and left out.
```

After implementing, add under the section:

```markdown
#### As built (<ID>)

- **<Topic>**: what differs from the plan and why (the measurement or bug that changed it).

**Results.** Fixtures, comparisons (e.g. "29 comparisons identical"), real repos before/after,
cost in time.
```
