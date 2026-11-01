# Journal: Chore — Living docs' gaps

[Index](../JOURNAL.md) · [Plan of the chore it follows](../plan/chore-living-docs.md)

## Living docs' gaps: AGENTS.md, the lookup, stale pages, Prettier (2026-11-01, branch `chore/living-docs-gaps`)

Asked whether every agent working here now knows what to do, then "Repair these problems". Four of
the five gaps found are fixed here; the person keeps the fifth (the HV4 workspace, started before
`chore/living-docs` merged, has the old CLAUDE.md until `main` is merged into it).

- **Codex and Hermes read no CLAUDE.md.** 4 of the 134 workspaces here ran them (3 Codex, 1
  Hermes), and the repository had no `AGENTS.md`. A root `AGENTS.md` now sends every agent to
  CLAUDE.md, the packages' CLAUDE.md files, the skills as files, and the area pages. A pointer,
  not a copy: one text to keep current.
- **A replacement was invisible until `consolidate.mjs` ran on `main`.** Symbiote's merger leaves
  the docs as they were, so an older row stays unmarked until someone makes "Docs: merged". The
  decision lookup in CLAUDE.md, PLAN.md and the milestone skill now finds the newer rows too:
  `grep -rnE '^\| 246 \||^\| [0-9]+ \|.*(supersedes|replaces)[^|]*\b246\b' docs/plan`. On 80 it
  returns 80 and 82; on 149, 149 and 473 (`replaces 82's and 149's target`); on 446, 446 and 507;
  on 246, its row alone.
- **Nothing said when an area page fell behind its code.** `consolidate.mjs` now notes each page
  whose named files changed in commits after the page's last commit: `area/merger.md: 2 commits
  since the page last changed touch …: reread it against them`. Git decides "after", so a page
  changed in the same commit as its code is current. A note, not a failure.
- **Shared files would have made the note useless.** Every area touches `server.ts`: 101 of 990
  commits since 2026-10-01. Watching it, both pages would have been flagged on 19 of 32 days. A
  file that more than 1 in 20 of the last 500 commits touch is now left out (judged from 40
  commits on); here 14 files, `server.ts` among them. The reviews page also named all of
  `prompts.ts` (20 of 500) for one prompt in it; it now names the prompt. Then the merger page
  watches 9 files and the reviews page 6.
- **The rule is relative to recent work.** This week `workspaces.ts` is shared (36 of 500): a
  Workspaces page would not be warned about it. A missed note is safer than a noisy one; revisit
  when that page is written.
- **`pnpm check` failed in the main checkout, never in a clean one.** `prettier --check .` read
  Symbiote's own files there, git-ignored by `symbiote/.gitignore`, which Prettier does not read:
  13 workspace and Hive records failed. `.prettierignore` now leaves out `symbiote/*` but
  `symbiote/config.json`, the one committed file.
- **Prettier's failure hid ESLint's.** With Prettier passing in the main checkout, `eslint .`
  stopped on 2 test files Hive's reviewer had written in its throwaway copies, kept in
  `symbiote/hive/<branch>/r1/packages/…` ("not found by the project service"). Found only after the
  first merge, by running `pnpm check` in the main checkout. `eslint.config.js` now ignores
  `symbiote/**`. Typecheck (root `*.ts` and the packages) and Vitest (`packages/*/test`) never
  read `symbiote/`.
- **A format without a placeholder is a preset's name to git**: `--format=@` failed with "invalid
  --pretty format"; `tformat:@` works. And a `let` read by a function called before its line is a
  ReferenceError in a script whose top-level code runs in order.
- **The pages' headers give a date now**, not a commit: the stale note uses git, and a page cannot
  name the commit that changes it.

**Verification**:
- Tests first: 2 new in `plan-consolidate.test.ts` (a stale page and its files; a shared file
  left out), each red for its reason (no note; `src/server.ts` still watched), then green. 10 in
  the file.
- On this repository: `consolidate.mjs --check` passes with no note (no named file changed since
  the pages' commit). The lookup run as written in CLAUDE.md, on 80, 149, 446 and 246.
- Prettier: Symbiote's 492 local files copied into this worktree, `prettier --check .` passes;
  with `main`'s `.prettierignore`, the same 13 warnings as in the main checkout.
  `symbiote/config.json` is still checked (`--file-info`: not ignored).
- ESLint: Hive's and the workspaces' local files copied in (150), `eslint .` passes; with the old
  config, the same 2 parsing errors. Then `pnpm check` in the main checkout itself.
- `pnpm check`: 2,749 tests, format, lint, typecheck. `pnpm build`. Links in the changed files:
  0 broken.

Not verified: a real Codex or Hermes run reading `AGENTS.md` (Codex's documentation says it reads
it; Hermes's, through secondary sources, says it loads `AGENTS.md` or `HERMES.md`); the note on a
real stale page, only in the tests.

Merged into main (2026-11-01).
