# Chore — React's hooks and accessibility lint rules, as warnings first

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding Q3)

**Status:** planned (2026-11-06), to be built on branch `chore/react-lint` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/react-lint` · **Size** S · **Depends on** P01 (lint's heap on
macOS: more rules use more memory) · **Plan** P46 of 51 (the audit's order)

## The brief

**What to change**: the viewer has 216 `useEffect`/`useLayoutEffect` calls with hand-kept
dependency lists (one of 25 entries, `packages/viewer/src/history/HistoryPage.tsx:1313-1338`), and
no lint rule checks them. Add `eslint-plugin-react-hooks` (`rules-of-hooks` as an error,
`exhaustive-deps` as a warning) and `eslint-plugin-jsx-a11y`'s recommended rules as warnings,
for `packages/viewer/src/**/*.tsx` only. Record the warnings found; fix none in this chore except
`rules-of-hooks` errors, if any.

**Where to look**:
- `eslint.config.js` (no React plugin today: 0 matches for `react-hooks` or `jsx-a11y`).
- `package.json` (devDependencies) and `pnpm-lock.yaml`.
- `packages/viewer/CLAUDE.md`'s Rules (a line on the new rules).

**Out of scope**: fixing the `exhaustive-deps` and a11y warnings (each needs its own look: a dep
left out on purpose is common in this code, e.g. `useDiffGraph.ts`'s effect keyed on `attempt`);
the nexus page (plain DOM, no React); turning warnings into errors.

**Done when**:
- `pnpm lint` runs both plugins on the viewer; `rules-of-hooks` errors are 0.
- The warning counts per rule are in the chore's journal entry, with the 5 files that have the
  most.
- `pnpm check` passes, on Linux and in CI's macOS job (P01 raised the heap).
- The new devDependencies' reason is written in the journal (CLAUDE.md asks it for runtime
  dependencies; these are dev only, but say it).

## Evidence

**Code**: `eslint.config.js` (read for this plan) uses `js.configs.recommended` and
`tseslint.configs.recommendedTypeChecked` only. The count of 216 effects: `grep -c
"useEffect\|useLayoutEffect"` over `packages/viewer/src`. The viewer review found no concrete
stale closure; nothing guards against one.

## Approach

1. Add the two plugins at versions that support ESLint 10 (check before adding; `pnpm outdated`
   showed eslint 10.11.0).
2. A config block for `packages/viewer/src/**/*.{ts,tsx}`: `react-hooks` recommended with
   `exhaustive-deps: 'warn'`; `jsx-a11y` recommended, every rule downgraded to `warn`.
3. Run `pnpm lint`, count warnings by rule, write them down.

## Tests first

None: a lint configuration. The check is `pnpm lint` itself: before the change it reports 0
React warnings; after, the counted ones, and 0 errors.

## Verification

- `pnpm check`; `pnpm lint` time before and after (lint is part of the 97 s `pnpm check`).
- Peak memory of `eslint .` (`/usr/bin/time -v`) before and after: it must stay under the heap P01
  set.
