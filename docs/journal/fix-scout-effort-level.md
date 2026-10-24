# Journal: Fix — Scout starts at an effort level; every effort setter a stepper

[Index](../JOURNAL.md)

## Fix — Scout starts at an effort level; every effort setter a stepper (2026-10-22, branch `fix/scout-effort-level`)

The person: "I should have an option to put scout on a effort level from the begining of the
conversation"; then, on the plan, the default "in config.json, and from setting i can adjust that
level", and "all of the effort level setter to be drag and drop stepper, with a step being a
level".

**Learned**:
- **Not a regression: V35 left it out** ("an effort choice (the agent's default)" under "Not in
  V35"). Nothing carried a level: `ScoutAsk` had none, `startReadOnly` passed no `--effort`,
  Codex's first `turn/start` none. Scout ran at the person's own level (`xhigh` here).
- **What V30 measured holds for Scout.** With the real Claude Code 2.1.308 (Opus 5.5) in a
  throwaway clone, through `symbiote view`'s API: no level asked and `scout.effort: low` in the
  config, every assistant line of the transcript read `effort: low`, the first turn and a
  follow-up through Symbiote's reply (stop, then `--bg --resume` with no flag); an answer in 4 s.
  `effort: "high"` asked over the project's `low` read `high`. A level asked for a conversation
  that runs was refused (409). `claude agents --json` did not list the level for a Scout session,
  so the record keeps it (`scout.json`), as a workspace's does.
- **Reading the levels has a cost Scout's state cannot pay.** `/api/scout` is read with the
  workspaces on every poll; Codex's levels come from its app server, whose daemon a read starts.
  So they are read apart (`GET /api/scout/efforts`), only where a stepper shows: Scout's box for a
  new conversation, Settings' Effort. 82 ms for both agents here, cold.
- **A level the agent does not list starts it at its own**, not a refusal: the project's file may
  name another agent's level or an older one's (Claude Code ignores an unknown `--effort` without
  failing, V30). Settings says so ("scout.effort is ultra, which Claude Code does not list…").
- **jsonc-parser rewrites the line it inserts after.** `modify` formats from the start of that
  line: a new `scout` section after an inline `"prompts": { … }` spread that object over lines,
  and Reset did not give the file back. With the last section over several lines (as this
  repository's config, whose `merge.checks` is an inline list higher up) it is byte for byte. The
  prompts' writer always behaved so; the Scout level goes through the same writer (`writeConfig`
  now), and its test uses the realistic shape.
- **The stepper is the browser's range input**, so the drag, the arrows, Home and End and the
  slider role come with it; it says the level's name (`aria-valuetext`), and a stop's word picks
  it. React's `onChange` is each `input` of a drag; Settings saves on the input's own `change`,
  once a drag is let go. No fill: the first stop, the agent's own level, is not less than low.
- **A save changes the prompts' file version**: the Settings page reads the prompts again after
  one, or their next save is refused as "changed since you opened it" (an e2e checks it).
- **e2e reading a file the server writes**: Node's `writeFile` truncates, then writes; a poll that
  parsed the config mid-write threw. The spec's reader waits for whole JSON.

**Verification**: tests first, red for the right reason: `scout.test.ts` 8 (no `--effort`, no
`efforts`/`setEffort`, no level recorded or refused, none on Codex's turn), `effort.test.ts` 3
(no module), e2e 6 (no stepper, no Effort entry). `pnpm check` 1,244 tests; build. e2e, 192
tests: 190 the first run, with the new Settings test's race (fixed above, then 5 of 5) and
`shell.spec`'s "a card keeps the focus…"; 191 the second, with `shell.spec`'s "keys…". Both fail
the same way, the ArrowDown flake V35 saw (the first card keeps the focus). Alternated on `main`'s
build and this one, 10 repeats a round of "a card keeps the focus…": `main` failed it 5 of 50, the
branch 9 of 60 (0–5 of 10 a round on each): older than this fix, which does not touch the
sidenav, and not explained; left for a fix of its own. After the last change, the scout,
settings and start specs 23 of 23. Screenshots of the stepper on Scout, Settings and
the start page at 1440×900 and 390×844, dark and light: no overflow, no page error. Real runs as
above, plus `POST /api/scout/effort` (medium written, ultra refused with Claude Code's levels, null
removed). Cleaned up: the session removed by New conversation, its two transcripts deleted, the
clone and the server gone, `main`'s worktree removed. Not verified: a real Codex conversation at a
level (its first-turn level is in the unit test on the fake app server, as V30b's was); Firefox's
range pseudo-elements (styled, not run); macOS and Windows; `regression-check` (no analysis code).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `a6182a3`, no conflicts
(`main` had not moved since the branch).
