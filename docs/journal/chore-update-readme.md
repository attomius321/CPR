# Journal: README rewrite

[Index](../JOURNAL.md)

## README rewrite (2026-10-15, branch `chore/update-readme`)

Asked: the README was stale; make it readable, without emojis, and the name now stands for
Coordinated Programming Runtime (decision 119; dropped with the rename to Symbiote, decision 223).
What it was:

- Each milestone had appended a paragraph: the commits page took 10 lines, starting a feature 25.
- Its three screenshots were from 2026-10-01 (V1, V3, G2): no map, no project frames, no commits
  page, no features.
- The sample `symbiote diff` output, copied from PLAN §9, predated D1: no `orphan-added`, and
  `signature-changed` a warning where a compatible change is now `info`.
- Feature worktrees were said to be `../<repo>.worktrees/<branch>`; the code turns the branch's
  slashes into dashes.
- No install steps, findings, keys, configuration keys or environment variables in one place.

Now: the name and a short pitch, then a quick start; commands with one options table; the four
findings; the viewer (a change, the commits page, VS Code, keys); reviewing a branch; features
and agents; pull and merge requests; CI; plugins; configuration; limits; development.

Five screenshots at 1440 × 900 from a fresh build, taken by a throwaway Playwright script outside
the repository:

- The V17 branch (`9ffd5ac`'s two parents: 49 symbols in 3 packages, 17 findings), reviewed in a
  clone of this repository whose `main` was reset to before its merge: the graph zoomed in on
  `@symbiote/core`, the detail of `Verdict`, and the Review tab with two comments.
- This repository's history for the commits page, the branches panel open on `milestone/`.
- The e2e suite's fake Claude Code for the Features tab, so no real session and nothing from
  `symbiote/` is in an image.

**Learned**: the README is where drift collected. Milestones kept it current by appending, which
kept every fact and lost the order. The sample output came from the plan, which nothing
regenerates. Stale text found outside the README is V22 in the plan, not part of this change.

**Verification**: a script checked every flag the README names against the CLI's help (all
there; `--bg` is Claude Code's), every configuration key, permission mode and environment
variable against the code, the action's inputs against `action.yml`, and every relative link
and anchor. No emoji outside code: the glyphs left (`✖ ⚠ ℹ` in the sample, `✓ ✗ ↻` as badges)
are what Symbiote prints, kept in code formatting. The sample output is a real run on the `callers`
fixture. `pnpm check` and `pnpm build` pass.

Merged into main (2026-10-18), after V21 and two fixes, resolved on the branch first: V21 and
decisions 111–118 had been taken on `main`, so the proposed fixes are V22 and the name is decision
119; the journal kept whole, `main`'s entries first; the README rewrite kept, with V21's Terminal,
the thread drawn as Markdown, Talk only without the terminal, `SYMBIOTE_TERMINAL` and `node-pty`
carried into it. The images are from before V21: the Features tab shows the thread with its box,
not the terminal. `main` verified after the merge (same tree as the branch): 723 unit tests,
build, 102 e2e.

**Features screenshot retaken after V21** (2026-10-18, same branch): `features.png` now shows the
Terminal tab with a real Claude Code (2.1.302, Haiku 5.5, the person's Pro subscription), not
the e2e fake, whose `attach` only prints its ID. Three throwaway features in a small repository
(`src/math.ts`, three tests) served by this branch's `symbiote view`: one plan first (its plan in 10
s), one in `auto` that stopped at a permission prompt, one that wrote `clamp`, ran the tests and
committed (30 s); the picked one's plan in the terminal. A feature's worktree takes its trust
from the main repository's folder (the parent folder `/` being trusted did not count: refused in
`/tmp`), so the repository was made at the path the person had trusted for the V18c spike.
Everything removed after: Symbiote's Clean up (sessions and worktrees), the folders, and Claude Code's
records of the three worktrees (`claude purge`); the repository folder's older records and trust
entry left as they were. The image shows the person's status line (model, folder, context) and
nothing personal. The README re-checked against the CLI's help and the code: every flag and
environment variable there (`SYMBIOTE_VIEWER_DIR`, for tests, left out).

Merged into main (2026-10-18), the screenshot after the rewrite: no conflicts (`main` had not
moved). `main` verified after the merge (same tree as the branch): 723 unit tests, build, 102
e2e.
