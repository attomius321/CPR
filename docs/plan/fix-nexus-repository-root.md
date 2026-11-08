# Fix — A slow or refused git never reads as "no repository" in the nexus

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding N3)

**Status:** planned (2026-11-06), to be built on branch `fix/nexus-repository-root` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/nexus-repository-root` · **Size** S · **Depends on** none ·
**Plan** P41 of 51 (the audit's order)

## The brief

**What happens**: the nexus asks `git rev-parse --show-toplevel` (1 s timeout) to tell whether a
folder is in a repository. Any error, the timeout included, reads as "no repository". For a
subfolder of a repository (which has no `.git` of its own), the nexus then answers 409 `init` and
offers `git init`. A yes makes a repository nested inside the other one.

**How to reproduce**: hard to hit by chance; two ways to force it.
1. A repository owned by another user: git refuses with "detected dubious ownership". Open one of
   its subfolders in the nexus: it is offered `git init`.
2. A slow git: put a wrapper first on the nexus's `PATH` that sleeps 2 s and then runs git; open a
   subfolder of any repository.
On WSL, `/mnt/c` makes git slow enough without a wrapper (the nexus CLAUDE.md measured Windows'
drives at 7 to over 30 s for a scan).

**Where to look**:
- `packages/nexus/src/folders.ts:184-192`: `repositoryRoot` maps every `execFile` error to `null`.
- `packages/nexus/src/init.ts:79` (`repositoryOf(outside)`), `:85` (`checkoutOf(path)`: only the
  folder's own `.git`), `:94` (409 `init`).
- `packages/nexus/src/folders.ts:107-117` (`checkoutOf`).
- Callers of `repositoryRoot`: `src/main.ts:139,157`, `src/folders.ts:149`, `src/pins.ts:95`.
- Tests: `test/folders.test.ts:242-251`, `test/init.test.ts`.

**Out of scope**: the scan (`scan.ts`); the guards for home, `/` and drives (decision 928 stands);
the page's question.

**Done when**:
- Only git's "not a git repository" answer (exit 128 with that message) reads as none.
- A timeout, a refusal (dubious ownership) or a missing git answers an error the page shows
  ("git could not tell within 1 s whether … is in a repository"), and `git init` is not offered.
- Before git is asked, the folder's parents are walked for a `.git` (no process): a folder under a
  `.git`-holding parent is never offered `git init`.

## Evidence

**Code** (the audit's ops review, read again for this plan): `repositoryRoot`'s callback is
`(error, stdout) => done(error ? null : …)`. `init.ts` then has `root === null`, and `checkoutOf`
finds no `.git` in a subfolder, so the flow reaches `:94`. Not reproduced by the audit.

## Approach

1. `repositoryRoot` answers `{ root } | { none: true } | { unknown: string }`: `none` only for
   exit 128 whose stderr says "not a git repository"; anything else `unknown` with git's words or
   "timed out".
2. A pure `gitAbove(folder)`: the nearest parent holding `.git` (stat only, stops at home or `/`).
   `init.ts` refuses `init` when it finds one, whatever git said.
3. `init.ts` answers 503 (or 422) with the words for `unknown`; the page shows them as it shows
   other refusals.
4. The other callers keep treating `unknown` as "not known to be a repository", as today, but never
   offer `init`.

## Tests first

- `test/folders.test.ts`: a fake `execFile` (or a `PATH` with a script that exits 128 with "fatal:
  detected dubious ownership") → `unknown`, not `none`. A script that sleeps past the timeout →
  `unknown`. Both fail today (they return `null`).
- `test/init.test.ts`: a subfolder of a repository with `repositoryOf` answering `unknown` → not 409
  `init`. Fails today.
- `gitAbove` on nested folders, home and `/`.

## Verification

- `pnpm check`; `pnpm build`; `pnpm test:e2e` (the nexus's `explorer.spec.ts` still asks and runs
  `git init` on a plain folder).
- By hand, on a nexus with `--port 0` and a home of its own: the slow-git wrapper, a subfolder: an
  error, no question.
