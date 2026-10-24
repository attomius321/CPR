# V24 — A structured brief: kind, title, goal, done when

[Index](../PLAN.md) · [Journal](../journal/v24-structured-brief.md)

**Status:** merged into main (2026-10-19, from branch `milestone/v24-structured-brief`): V24a–c. Plan revised the same day with the user's answers: Spike and Refactor are kinds of their own; "Done
when" is optional for every kind; Symbiote guesses the project's check command; the brief's format
left to the plan (Markdown headings, decision 124).

**Problem** (asked: "The Create a workspace dialog need some structuring..like multiple inputs
where the user is prompt about the feature/chore/fix. With a title, final goal, etc."). The
dialog (`StartFeatureDialog.tsx`, V18) has one text area, "What should the agent build?". One
string does three jobs: the agent's brief, the branch name (its first line's first five words)
and the workspace's name in every list (its first line). Measured:

| What | Today |
|---|---|
| Inputs about the work | 1 free-text area (placeholder: "what, why, what done looks like") |
| Branch prefix | `feature/` for every workspace (`features.branchPrefix`, one value) |
| This repository's merges into `main` | 35: 20 milestones, 7 fixes, 4 chores or docs, 4 other — a third is not a feature |
| What the agent is told about "done" | Only what the person thought to write; the prompt adds "check it as the project's own instructions say" |
| The name in lists | The brief's first line, however long; a brief that starts with context names the workspace after that context |

What agent vendors ask for in a task, read on 2026-10-19 (sources in JOURNAL "V24 spike"):
Anthropic's Claude Code best practices ("give Claude a check it can run"; for a bug "the
symptom, the likely location, and what 'fixed' looks like"; specs "state what is out of scope"),
Devin (context, success criteria, patterns to reuse; "Make sure it works" is the bad example),
GitHub Copilot's coding agent (a clear problem, complete acceptance criteria, which files),
Codex (file paths; a reproduction and constraints "matter more than a high-level description").
All four ask for the same three things a single text area leaves to memory: **the goal and why,
how done is checked, and the bounds** (where to look, what not to touch); bugs add **what
happens against what should, and how to reproduce it**. Issue forms (GitHub) keep required
fields few and mark the rest optional.

**Guessing the check command** (measured on 16 repositories' default branches, 2026-10-19: this
one, the six regression repositories, TypeScript (Go port), React, Express, Requests, Flask,
FastAPI, ripgrep, axum, cobra). The rule below, from root files only, against what the
repository's agent instructions, CONTRIBUTING or CI run:

| Result | Repositories |
|---|---|
| Same command, or one that runs it (13) | Symbiote `pnpm run check`; ky, Express, Bitwarden `npm run test`; RealWorld `bun run test`; React `yarn run test`; zod `nub run test`; TypeScript `npm run test` (= `hereby test`); axum, ripgrep `cargo test --workspace`; cobra, Requests `make test`; FastAPI `bash scripts/test.sh` |
| Right but heavy (2) | Qwik `pnpm run test` builds everything and runs e2e (its AGENTS.md says `pnpm test.unit`); vite's runs unit, serve and build suites |
| Close (1) | Flask `uv run pytest` (CI: `tox` through `uv`) |
| None found, words instead (0) | — |

No guess was wrong; 2 of 16 were slow. 7 of 16 repositories have agent instructions
(`CLAUDE.md`/`AGENTS.md`); the prompt already tells the agent to follow them, and the guess
is shown with its source and is editable, so a heavy guess costs the person one edit.

Causes:
- One text area, no prompt about the parts an agent needs; the placeholder is the only hint.
- No kind: a fix gets a `feature/` branch and the same instructions as a feature.
- The name is derived, not given.

**Goal**: the dialog asks for the work in a few labelled parts, chosen by its **kind** —
Feature, Fix, Refactor, Chore or Spike: a **title** (the workspace's name and its branch), the
one part that kind needs, **Done when** (optional; filled in for every kind but Feature, with the
guessed check command), and optional parts behind "More". Symbiote assembles them into the agent's
brief in a fixed order with fixed headings, and the branch takes the kind's prefix. The record
keeps the parts, so the panel shows them as written. Unchanged: workspaces started before V24
(their brief, name and branch as today), the agent's launch, plan first, permissions, the
worktree, reviews and merges; `symbiote diff`, `symbiote pr` and the graph JSON.

## The kinds and their inputs (viewer)

The kind is a segmented control at the top (Feature · Fix · Refactor · Chore · Spike; `1`–`5`
while it has focus), Feature by default, the last one picked remembered per repository (with the
draft, decision 128). Required: the title and the kind's one part. `<check>` is the guessed command
(below), else the words "the project's checks".

| Kind | Required part | Done when (optional, pre-filled) | Under "More" (optional) | Branch |
|---|---|---|---|---|
| **Feature** | **Goal** — "What should it do, and why?" | empty; placeholder "e.g. `<check>` passes, and …" | Where to look; Out of scope; Notes | `feature/` |
| **Fix** | **What happens** — "What goes wrong, and what should happen instead?" | "A test that fails today passes, and `<check>` passes." | How to reproduce; Where to look; Notes | `fix/` |
| **Refactor** | **What to restructure** — "What, and why is the current shape a problem?" | "Behaviour is unchanged: existing tests pass without changing what they assert, and `<check>` passes." | Where to look; Out of scope; Notes | `refactor/` |
| **Chore** | **What to change** — "What, and why now?" (dependencies, config, docs, tooling) | "`<check>` passes." | Where to look; Out of scope; Notes | `chore/` |
| **Spike** | **Question** — "What do you want to find out, and what will you decide with the answer?" | "A written answer: what was tried, what was measured, and a recommendation." | What is known; Where to look; Notes | `spike/` |

- Visible per kind: title, the required part, Done when; "More" collapsed unless a field in it
  has text. Optional means the brief leaves an empty part out; an empty Done when leaves the
  prompt's "check it as the project's own instructions say" as the only word on it.
- Under Done when, when a command was guessed: "`pnpm run check` from package.json (scripts.check)"
  — the command and where it came from, so a wrong or heavy guess is seen before Start.
- **Switching kind** keeps every text typed: the required part is one text area whose label
  changes; Done when changes to the new kind's default only while it still equals the old
  kind's default (edited text is kept); More's fields are kept and shown where the kind has them.
- Branch: proposed from the **title**, with the kind's prefix; editable as today, and once
  edited no longer follows title or kind.
- Lengths: the assembled brief is checked against `maxBrief` (20,000) as one text, the count
  shown under the dialog when it is within 10 % of it.
- **A draft**: the fields are kept per repository while the dialog is open and cleared after a
  start; Escape and Cancel keep it, "Clear" empties it. (Built in Symbiote's cache, not
  `localStorage`: decision 128.)
- Ctrl+Enter starts, Escape cancels, as today; Tab goes kind → title → required part → Done
  when → More → branch → plan first → Start.

## Guessing the check command (CLI)

`GET /api/features/check?at=<commit>` → `{ command, source }` or `{}`, read from the commit the
workspace starts at (`git cat-file` of a few root files; the worktree does not exist yet). The
dialog asks when it opens and when the start commit changes; it shows words until the answer
comes, and keeps words if the request fails. First match wins:

1. `package.json` `scripts.check`, else `scripts.test` (not npm's `echo "Error: no test
   specified" && exit 1`) → `<pm> run check|test`. `<pm>`: the `packageManager` field's name,
   else the lockfile (`pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lock`/`bun.lockb` bun,
   else npm).
2. `Makefile` with a `check:` or `test:` target → `make check|test`.
3. `scripts/test.sh` → `bash scripts/test.sh`.
4. `Cargo.toml` → `cargo test`, with `--workspace` when it has a `[workspace]` table.
5. `go.mod` → `go test ./...`.
6. `pyproject.toml`, `setup.py`, `tox.ini` or `pytest.ini` → `uv run pytest` with `uv.lock`,
   else `python -m pytest`.

Root files only: a monorepo's root command is what its people run (10 of 10 JavaScript
repositories above had one). Agent instructions are not parsed: their commands sit in prose and
code blocks with many alternatives (Qwik's lists 6), and the agent reads them anyway.

## The record, the request and the prompt (core, CLI)

- `FeatureRequest` and the record gain `kind` (`feature` | `fix` | `refactor` | `chore` |
  `spike`), `title` and `parts` (`{ goal?, happens?, restructure?, change?, question?, known?,
  reproduce?, doneWhen?, where?, outOfScope?, notes? }`, absent when empty). The request no
  longer sends `brief`: the **server** assembles it (`briefOf` in
  `packages/cli/src/features.ts`), so the record's `brief` stays what the agent was told and
  every reader of `brief` (the panel's "The brief", `featurePrompt`) works unchanged. Server
  checks: a known kind, a title, the kind's required part, only the kind's parts, the assembled
  length; 400 with the field's label otherwise.
- Old records (no `kind`): read as before; their name is the brief's first line. New records:
  the name is `title`. `FeatureSummary` gains `kind` and `title` (absent for old ones).
- **The brief** (`briefOf`): Markdown headings in a fixed order, empty parts left out, the
  person's text verbatim under each:

  ```
  # Fix: The date column sorts as text

  ## What happens
  …
  ## How to reproduce
  …
  ## Where to look
  …
  ## Done when
  A test that fails today passes, and `pnpm run check` passes.
  ```

  Order: the required part, then context (reproduce, known, where, out of scope, notes), Done
  when last (Anthropic's guidance: the material first, the request and its check last).
- **The prompt** (`featurePrompt`): unchanged except one line per kind after the brief, the
  only instruction Symbiote adds:

  | Kind | Line |
  |---|---|
  | Feature | none |
  | Fix | "Reproduce it first, with a failing test where the project has tests, then fix the cause, not the symptom." |
  | Refactor | "Change structure, not behaviour: do not change what existing tests assert; if behaviour must change, stop and say so." |
  | Chore | "Keep to what is asked; if it needs a change in behaviour, stop and say so." |
  | Spike | "The answer is what is asked for, not a change to merge: put it in your final report; keep experiments out of the project's code unless the brief says otherwise." |

- **Branch prefixes**: `features.branchPrefixes` in `symbiote/config.json` (default `{ "feature":
  "feature/", "fix": "fix/", "refactor": "refactor/", "chore": "chore/", "spike": "spike/" }`,
  a partial object overrides only its kinds); `features.branchPrefix`, if set, stays the Feature
  prefix. `FeatureOptions.branchPrefix` becomes `branchPrefixes`.
- No graph JSON or analysis change.

## The workspace list and panel (viewer)

- A row's name is the title (old workspaces: the brief's first line, as today), with the kind
  as a small text tag before it (`fix`, `refactor`, `chore`, `spike`; none for Feature, the
  common case).
- "The brief" in the panel shows the assembled brief, as today; the review page's "Workspace: …"
  uses the title.
- A Spike's answer is its agent's final report, in the thread as today; reviews and merges are
  unchanged for it (its branch is usually empty, and Clean up ends it).

## Verification

1. **Unit, red first**:
   - `briefOf` per kind: order, headings, empty parts left out, text kept byte for byte, a part
     that contains `## ` lines; the per-kind prompt line.
   - `guessCheck` on fixture trees built as git commits: each rule, the order between them
     (`package.json` with `check` and `test`; `Makefile` beside `Cargo.toml`), npm's placeholder
     `test` skipped, each package manager source, Cargo with and without `[workspace]`, none →
     `{}`; read from the given commit, not the working copy.
   - Request validation: missing title, missing required part per kind, a part the kind does not
     have, unknown kind, assembled length over 20,000; `{ brief }` alone still accepted as a
     Feature.
   - Old records read unchanged and named by their first line; `proposeBranch` from the title
     with each kind's prefix, `-2` when taken; config with `branchPrefix` only, `branchPrefixes`
     only (partial), both.
2. **The guess on real repositories**: the 16 above again through `/api/features/check`, the
   same results as the table; its time on Bitwarden's full clone (target: under 50 ms).
3. **E2E** (`features.spec.ts`, rewritten where it fills the brief): each kind starts a
   workspace whose fake agent received the expected brief and line; the guessed command and its
   source under Done when; switching kind keeps text and swaps an unedited Done when only;
   Start disabled until the title and required part have text; More opens itself when a field in
   it has text; the draft survives Escape and a reload, and is gone after a start; an old record
   is listed by its first line; keyboard path (Tab order, `1`–`5`, Ctrl+Enter).
4. **Nothing else changes**: the e2e suite, the commits page and reviews; no analysis code, so
   no regression sets.
5. **Viewer** (`viewer-check`): the dialog in light and dark at 1440 × 900 and 390 × 844, each
   kind, More open and closed: it fits without scrolling at 1440 × 900 with More closed; the five
   kinds fit on one line at 390 px; screenshots against today's.
6. **With a real agent**: one workspace of each kind started with a real Claude Code (headless,
   Haiku, plan first) on a scratch repository with a planted bug: the Fix's plan names a failing
   test first; the Refactor's and Chore's change no test assertions; the Spike's report answers
   the question and its branch has no commits; record what the plans say.

**Risks**

| Risk | Mitigation |
|---|---|
| A form is slower than one text area for a quick ask | Two required inputs (title, one part); Done when filled in; measure keys from open to Start against today's |
| A guessed command is wrong or heavy (Qwik, vite) | Shown with its source under Done when, editable; root files only, so no guess from prose; measured on 16 repositories: 0 wrong, 2 heavy |
| A guess runs against an old start commit with different scripts | Read from the start commit, the tree the agent gets |
| Someone pastes a long spec | Parts take any length; the assembled limit is the only one |
| Five kinds crowd the control at 390 px | Short labels; measured in step 5; below that width the control wraps |
| A spike's agent commits anyway | The prompt line says not to; the branch's review shows any commit as usual |
| Older viewers or scripts posting `{ brief }` | The server keeps accepting `brief` alone as a Feature with the brief's first line as its title (one release), so nothing that posts today breaks |

**Order**: `briefOf`, the record and the request, then `guessCheck` and its endpoint (unit tests
first), then the dialog, then the list and panel; the real-agent check last.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V24a ✅ | Kinds and parts in the record | `kind`, `title`, `parts` in `FeatureRequest`, the record and `FeatureSummary`; `briefOf`; the per-kind prompt line; `branchPrefixes`; server validation; old records and `{ brief }` requests as before. |
| V24b ✅ | The check guess | `guessCheck` and `GET /api/features/check`; the 16-repository comparison repeated through it. |
| V24c ✅ | The structured dialog | Kind control, the kind's inputs, Done when with the guess, More, the draft, branch from title and kind; the list's title and kind tag; e2e; screenshots; the real-agent check. |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 122 | Which kinds | **Feature, Fix, Refactor, Chore, Spike** | Asked (revised 2026-10-19: Spike and Refactor of their own). Refactor differs from Chore in what done means (tests' assertions unchanged); a Spike's output is an answer, not a branch to merge |
| 123 | Who assembles the brief | **The server**, from the parts; the record keeps both | One place for the format; `brief` stays what the agent was told, so every reader of it is unchanged |
| 124 | Headings or XML tags in the brief | **Markdown headings** | Left to the plan. The person reads the brief in the panel as written; Claude Code and Codex both read Markdown; headings carry the same structure tags would, and an agent's own instructions (CLAUDE.md, AGENTS.md) are Markdown too |
| 125 | Does Symbiote fill in a check command | **Yes, guessed from root files, shown with its source, editable** | Asked (revised 2026-10-19; proposed "no"). Measured on 16 repositories: 13 the documented command, 2 right but heavy, 1 close, 0 wrong. Seen and editable before Start, so precision is the person's to keep |
| 126 | Is Done when required | **No, for any kind** | Asked. Filled in for four kinds, so it is there unless removed; an empty one falls back to the project's own instructions |
| 127 | Where a spike's answer goes | **The agent's final report**, in the thread | Repositories keep spikes in different places or not at all; the thread is Symbiote's own record. A brief can ask for a file instead |
| 128 | Where the start dialog's draft and last kind are kept | **Symbiote's cache, per repository** (`/api/features/draft`), not browser storage | Found building V24c: `symbiote view` takes a free port per run and browser storage is per origin (decision 17), so a draft in `localStorage` would be gone at the next `symbiote view`. The cache is per user, so nothing lands in the repository |

**Not in V24 (later)**: templates per repository (`symbiote/config.json` defining kinds and fields);
a guess from agent instructions; attaching screenshots or logs as files; filling a brief from an
issue or a review comment; an LLM rewriting the person's brief; spike answers as a document kind
in reviews.

**As built (V24a)**:
- The start dialog's options carry the kinds (`kinds`: each one's name, its parts in the brief's
  order with their headings, which one is required, Done when's default), so V24c's dialog
  renders the server's one table instead of a copy: the brief's order and the dialog's are the
  same by construction. `branchPrefix` became `branchPrefixes`; today's dialog uses the Feature's.
- Done when's defaults say `{checks pass}` where the plan said `<check>`: the token carries its
  verb, because "`pnpm run check` passes" and "the project's checks pass" do not agree with one
  verb. The Chore's default reads "Nothing else changes, and {checks pass}." so the token is never
  at the start of a sentence.
- A request with `brief` alone makes a record as before V24 (no kind, no title), not a Feature
  with the brief's first line as title: as a Feature, an old client's agent would get its whole
  brief under "## Goal", which is not what it was told before.
- A title is one line of at most 200 characters (not in the plan): it names the workspace in
  lists and proposes its branch.
- The prompt names the work by its kind ("You are starting a new fix", "This fix's record"), and
  a Spike's closing paragraph says to commit nothing unless the brief asks and to give the answer
  in the report, instead of "Commit your work … the person reviews the branch".
- The brief's sections are separated by blank lines.

**As built (V24b)**: as planned, plus:
- The tree is read with `git ls-tree` (the root's names, and `scripts/test.sh` asked for by
  path); only the files a rule needs are read (`package.json`, the Makefile, `Cargo.toml`).
  Lockfiles are known by name, never read: `pnpm-lock.yaml` runs to megabytes.
- `GNUmakefile` and `makefile` count as a Makefile; a line `test := …` sets a variable and is not a
  target.
- A `packageManager` that is not a plain program name is ignored for the lockfile's, so the
  dialog never shows an arbitrary command from it.
- Guesses are kept per commit while `symbiote view` runs (a commit's files never change).

**Results (V24b)**: through `guessCheck` and `treeAt` on the same 16 repositories, the same 16
commands as the planning table. 13–17 ms per guess on full clones (Bitwarden 15–17 ms, this
repository 13–15 ms; three runs each), against the 50 ms target.

**As built (V24c)**:
- The draft and the last kind are kept by `symbiote view` in Symbiote's cache (`/api/features/draft`), not
  in `localStorage` (decision 128); after a start the draft is cut to the kind. Edits are saved
  400 ms after typing pauses, Start saves at once, Cancel and Escape save what is pending.
- An info button (ⓘ) after the kinds shows what each is for, in a line, the picked one marked
  (asked after V24c was built): on hover, while it has the focus, or once tapped; Escape hides it,
  not the dialog. It spans the dialog under the kinds and takes no pointer events.
- The kind picker is a radio group: `1`–`5` and the arrow keys while it has focus, one tab stop.
  The title has the focus when the dialog opens (the kind is remembered, so typing starts
  there); Shift+Tab reaches the kinds.
- The dialog shows "Check: `<command>`, from <source>" under Done when when a command was
  guessed; Done when and More's fields say "optional".
- The dialog scrolls inside the window when it is taller than it (More open, a phone).
- The viewer counts the brief's length as the server makes it (`briefLength`), checked against
  `briefOf` by a test, for the count shown within 10 % of 20,000.
- `getJson` and `postJson` moved to `http.ts`: the dialog and its starter imported each other.
- The kind tag is the kind's own word (`fix`, `refactor`, `chore`, `spike`), in the list, the
  panel's head, and the review page's "Workspace: <title>".

**Results (V24c)**:

| What | Before (V24b's build) | V24c |
|---|---|---|
| Dialog height, 1440 × 900, More closed | 463 px | 645 px; fits (no scroll) for each kind, light and dark |
| Dialog, 390 × 844, More closed | — | 685 px; fits; the five kinds and their info on one line |
| More open (Spike) | — | 912 px of content in an 866 px dialog at 1440 × 900: scrolls inside it |
| Inputs to fill for a quick ask | 1 (the brief) | 2 (title, the kind's part), 1 Tab between; a kind other than the last is 1 more key |
| e2e | 104 | 110 (6 new; 4 red on V24b's build, 1 guards what stays; the info's red before it existed) |

With a real Claude Code (2.1.303, Haiku, `claude -p`, read-only tools, plan first) given Symbiote's
own prompt for each kind on a scratch repository with a date sort that compares strings: the Fix's
plan writes a failing test first and fixes the comparator, not the one pair; the Refactor's keeps
`test/totals.test.js` unchanged and asks before adding tests; the Chore's changes only the README;
the Spike's commits nothing, keeps experiments out of the project and ends in a written answer;
the Feature's (no Done when) plans tests and `npm test` itself. 21–46 s each. Not through
`claude --bg` (its trust prompt cannot be answered by a script, V18) and not in a real worktree:
the agents said so, as they did of the record paths that did not exist.
