# Journal: V24 — A structured brief: kind, title, goal, done when

[Index](../JOURNAL.md) · [Plan](../plan/v24-structured-brief.md)

## V24 spike — what a brief for an agent should hold (2026-10-19, branch `milestone/v24-structured-brief`)

Asked: structure the "Start a workspace" dialog into several inputs (kind, title, goal…), after
research on how to brief a coding agent.

Measured on this repository: of 35 merges into `main`, 20 are milestones, 7 fixes, 4 chores or
docs, 4 other; every workspace branch is `feature/` today. No real workspace records exist on
this machine (only e2e fixtures), so how people fill the one text area is not measured.

Read on 2026-10-19, what vendors ask a task to hold:
- Claude Code best practices (https://code.claude.com/docs/en/best-practices): a check the agent
  can run; for a bug the symptom, the likely location and what "fixed" looks like, then a failing
  test; specs name files, state what is out of scope, end with a verification step; skip the plan
  when the diff fits in a sentence.
- Anthropic prompting guidance
  (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices):
  give the why; material first, the request last.
- Devin (https://docs.devin.ai/essential-guidelines/instructing-devin-effectively): context,
  success criteria, patterns to reuse; "Make sure it works" as the bad example.
- GitHub Copilot coding agent
  (https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results): a clear
  problem, complete acceptance criteria, which files.
- Codex (https://developers.openai.com/codex/prompting): file paths; reproduction and constraints
  matter more than a high-level description.
- spec-kit's spec template and Kiro's requirements (EARS acceptance criteria): heavier, for
  multi-step specs; GitHub issue forms: few required fields, the rest optional.

Learned: the sources agree on three parts a single text area leaves to memory — the goal and
why, how done is checked, the bounds — plus, for a bug, what happens against what should and
how to reproduce it. That is the plan: a kind, a title, two required parts per kind, the rest
optional. Not fetched: Cursor's and Linear's guidance; form-friction numbers were secondary and
contradictory, so none are used.

Revised the same day with the user's answers: Spike and Refactor are kinds of their own; Done
when is optional; Symbiote guesses the check command; the brief's format left to the plan (Markdown
headings). Measured for the guess, on the default branches of 16 repositories (shallow blobless
clones: this one, ky, zod, vite, the Angular RealWorld app, Bitwarden, Qwik, TypeScript's Go
port, React, Express, Requests, Flask, FastAPI, ripgrep, axum, cobra): a rule over root files
(`package.json` `check` then `test` with the package manager from `packageManager` or the
lockfile; `make`; `scripts/test.sh`; `cargo test`; `go test ./...`; `pytest`) gave the command
the repository's agent instructions, CONTRIBUTING or CI use in 13, a right but heavy one in 2
(Qwik's `test` builds everything and runs e2e; vite's runs three suites), a close one in 1
(Flask: `uv run pytest`, CI runs `tox`), none wrong.

Learned:
- `check` is rare: only this repository has one; `test` is the convention, and its weight varies
  from one tool (zod) to a full build and e2e (Qwik).
- `cargo test` alone misses a workspace's other crates: ripgrep's CI runs `--workspace`, so the
  rule adds it when `Cargo.toml` has `[workspace]`.
- 7 of 16 have `CLAUDE.md` or `AGENTS.md` (Bitwarden's in `.claude/`), but their commands sit
  among alternatives (Qwik lists six); parsing them would guess worse than the manifests, and the
  agent reads them anyway.
- The package manager is not always npm, pnpm or yarn: zod's `packageManager` is `nub`, and
  `nub run test` is what its CONTRIBUTING says, so the field's name is used as given.

## V24a — Kinds and parts in the record (2026-10-19, branch `milestone/v24-structured-brief`)

A start request may now give a kind (Feature, Fix, Refactor, Chore, Spike), a title and the
kind's parts instead of one brief. The server checks them, makes the brief (`briefOf`: `# Fix:
<title>`, then each part with text under its heading, Done when last), and keeps kind, title and
parts in the record beside it; the list gives kind and title. The prompt adds the kind's one
line after the brief. Branch prefixes are per kind (`features.branchPrefixes`). Nothing in the
dialog changed yet: it still posts one brief, which makes a record exactly as before.

**Learned**:
- One table of headings in the brief's order gives every kind's order, so the server's list of
  kinds for the dialog and the brief agree by construction; the dialog will render that list
  rather than keep a copy (the viewer may not import runtime code from core).
- "`pnpm run check` passes" and "the project's checks pass" need different verbs: the Done when
  token is `{checks pass}`, verb included, never at the start of a sentence.
- Turning an old `{ brief }` request into a Feature would have changed what an old client's agent
  is told (its whole brief under "## Goal"); it stays a record as before V24.
- A spike's prompt cannot keep "Commit your work … the person reviews the branch": it contradicts
  the spike's line. Its closing paragraph says to commit nothing unless asked.

**Verification**: tests first — 9 new unit tests and the changed options test red before the code
(`briefOf is not a function`, missing fields, no kind line), green after; 740 unit tests, lint,
typecheck, build, 104 of 104 e2e (the dialog still posts one brief). No analysis code changed: no
regression sets. Not verified yet: a real agent given a kind's brief (V24c).

## V24b — The check guess (2026-10-19, branch `milestone/v24-structured-brief`)

`GET /api/features/check?at=<commit>` answers the check command guessed from that commit's root
files and where it came from (`{ command, source }`, or `{}`), for the start dialog's Done when.
The rules are the plan's, first match wins: `package.json`'s `check` then `test` script with its
package manager, a Makefile's `check` then `test` target, `scripts/test.sh`, `cargo test`
(`--workspace` with a `[workspace]` table), `go test ./...`, `pytest` (through `uv` with
`uv.lock`).

**Learned**:
- Timing a blobless clone measures the network: ripgrep and axum took 697 and 491 ms the first
  time, because git fetched `Cargo.toml`, never read before; 14 ms once it was local. Measured
  again on a full clone.
- A Makefile line `test := …` sets a variable, yet matches `^test\s*:`; a target is `test:`
  not followed by `=`.

**Verification**: tests first — 7 `guessCheck`/`treeAt` tests (the module did not exist), the
service's `check` and the endpoint red, green after; `treeAt` reads the commit, not an uncommitted
change. 749 unit tests, lint, typecheck, build. On the 16 repositories of the V24 spike, the same
16 commands as planned; 13–17 ms per guess on full clones (Bitwarden 15–17 ms). Not verified: the
dialog showing it (V24c).

## V24c — The structured dialog (2026-10-19, branch `milestone/v24-structured-brief`)

"Start a workspace" asks for a kind (Feature, Fix, Refactor, Chore, Spike), a title, the kind's
one required part, Done when (filled in for four kinds, with the guessed check command) and, under
More, the kind's optional parts. Switching kind keeps every text. The branch follows the title and
the kind's prefix. The form is a draft `symbiote view` keeps until the workspace starts. The list, the
panel and the review page name a workspace by its title, its kind tagged before it.

**Learned**:
- **A draft in `localStorage` would not survive the next `symbiote view`**: each run takes a free port,
  and browser storage is per origin — the reason review state moved to the server in decision 17.
  The draft is kept in Symbiote's cache instead (decision 128), with the last kind.
- **Saving a draft and clearing it race**: the dialog's unmount (after a start) and the starter's
  "clear" would both post, in an order React decides. The dialog owns it: Start saves the form at
  once, and its unmount after a successful start saves only the kind.
- **Five kinds need 329 px**; a 390 px phone gives the picker 308. Tighter padding under 480 px
  puts them on one line (289 px).
- **The `.link` class sets a monospace font**: the More toggle needed its family back.
- **"An agent's report is drawn as Markdown" raced on `main` too** (2 of 6 alone): it replied as
  soon as the report was drawn, while the list, read every 5 s, still said the agent worked, so
  the panel asked "Stop it and send" instead of sending. Filling two fields shifted the timing
  (5 of 6 on this branch); the test now waits for "Plan ready" first (8 of 8).
- **A real agent reads more than the brief**: in the scratch repository, Haiku's plans also noted
  what did not match it (a brief saying "several" test files where there was one, a date bug the
  Spike was not asked about but found), and asked rather than guessed.

**Verification**: unit tests first for the pure parts (`brief.ts`: 7 red, the module missing; the
server's draft and its endpoint: 2 red) and a test that the dialog's count of the brief is the
server's `briefOf` length; `featureName` was written with its test, not before. 761 unit tests,
lint, typecheck, build. E2E: the 22 workspace tests moved to the new fields; 5 new (each kind's
brief and line, the guess and kind switches, the draft through Escape, reload and a start, the
keyboard, a pre-V24 record): 4 red on V24b's build, the fifth guards what stays; 109 of 109,
twice.
Screenshots at 1440 × 900 and 390 × 844, light and dark, each kind, More closed and open: fits
without scrolling with More closed (645 and 685 px); with More open it scrolls inside the window.
With a real Claude Code (Haiku, `claude -p` with Symbiote's own prompt, read-only, plan first) for each
kind: each plan follows its kind's line (PLAN.md, V24 results). Not verified: `claude --bg` from
the dialog with a real agent (its trust prompt, V18), Firefox and Safari, a screen reader on the
radio group.

### V24c, then: what each kind is for

Asked once V24c was built: "an info tooltip after the Workspace type selection with a little
description for each type". An ⓘ after the kinds shows each kind's line (Feature: something new;
Fix: something that goes wrong, reproduced with a failing test first; Refactor: a better shape,
behaviour and tests' assertions kept; Chore: upkeep, nothing else changes; Spike: a question,
answered in a report, nothing committed), the picked one marked. It shows on hover, while the
button has the focus, or once tapped, and Escape hides it without closing the dialog.

**Learned**: the tooltip spans the dialog under the kinds, over the title; taking the pointer, it
kept the title from being hovered (the e2e timed out), so it takes none. On a phone the ⓘ pushed
"Spike" to a second line again: the kinds' padding is 6 px there.

**Verification**: the tooltip's e2e (hover, focus, Escape, a tap) and the keyboard e2e's new tab
stop red first, green after; 761 unit tests, 110 of 110 e2e; screenshots at 1440 × 900 and
390 × 844, light and dark: the kinds and the ⓘ on one line, the tooltip inside the dialog.

Merged into main (2026-10-19): V24a–c, no conflicts (`main` had not moved since the branch
started; the merge's tree is the branch's). `main` verified after the merge: 761 unit tests, lint,
typecheck, build, 110 of 110 e2e.
