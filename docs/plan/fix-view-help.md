# Fix — `symbiote view --help` and `symbiote --help` name the Overview

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S5)

**Status:** planned (2026-11-06), to be built on branch `fix/view-help` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/view-help` · **Size** S · **Depends on** none · **Plan** P23 of
51 (the audit's order)

## The brief

**What happens**: the help still describes `symbiote view` as it was before V91.
- `symbiote view --help` says "It opens on Git (g): every branch, local and remote, as a graph".
- `symbiote --help` says "without revisions, Git: every branch, to compare or review…".

Since V91, `/` opens the Overview (`packages/viewer/src/shell/pages.ts:202`), as
`docs/reference/commands.md:11` and `README.md:98` say.

**How to reproduce**: `node packages/cli/dist/bin.js view --help` and `node
packages/cli/dist/bin.js --help`.

**Where to look**:
- `packages/cli/src/main.ts:196-210` (`HELP`) and `:237-247` (`VIEW_HELP`).
- `packages/cli/test/main.test.ts:41-52` **pins the stale text**:
  `toMatch(/Git[^]*every\s+branch[^]*workspaces/)` and `toMatch(/opens\s+on\s+Git\s+\(g\)/)`.
- `VIEW_HELP` (`:240`) also tells a user to run `pnpm app:setup`, a contributor's command. So do
  `app --help` (`:300`) and the "not set up" error (`:1206`). A user installs with
  `./install.sh`, which fetches Electron and runs `symbiote app install` (README,
  `scripts/install.mjs`). Name the same step in all three.

**Out of scope**: `docs/reference/commands.md` (already right), the other commands' help (P24
is `merge`'s).

**Done when**: both helps say `symbiote view` opens on the Overview (what waits for you, the
workspaces in the sidenav), mention Git and Compare mode as pages it has, and name `./install.sh`
or `symbiote app install` for the window. `main.test.ts` checks the new words.

## Evidence

- **Reproduced**: the audit's run of `view --help` printed "It opens on Git (g)". The
  Overview's address and default are in `pages.ts:37,202`.

## Approach

- Rewrite the two help texts in the help's own style (short, at most 90 columns, as the
  surrounding lines).
- Change `main.test.ts:41-52` first: the test's title names V25, V29a and V66, and it must
  follow V91 now. Keep the guards it has (`not.toMatch(/History/)`, `/current\s+branch/`).

## Tests first

`packages/cli/test/main.test.ts`, the help test (`:41`):
- `symbiote --help` and `symbiote view --help` match `/Overview/`. Both fail today.
- `view --help` matches `/opens\s+on\s+the\s+Overview/` and no longer `/opens\s+on\s+Git/`.
- `view --help` does not match `/pnpm app:setup/`. It fails today.

## Verification

- `pnpm check`, `pnpm build`, then read both helps by hand at 80 columns.
- `grep -rn "opens on Git" packages docs README.md`: no other copy left (journals and plans
  excepted, as records of their day).
