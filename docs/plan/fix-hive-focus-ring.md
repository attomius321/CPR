# Fix — Hive's focus ring does not read as an error

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V11)

**Status:** planned (2026-11-06), to be built on branch `fix/hive-focus-ring` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/hive-focus-ring` · **Size** S · **Depends on** none · **Plan** P37
of 51 (the audit's order)

## The brief

**What happens**: in Hive mode, Start's New goal page opens with its empty, required Title focused,
and the field's ring is crimson. A red ring around an empty required field reads as "this field is
wrong". The focus ring takes Hive's accent: `--focus: #ff8090` dark, `#b30f2a` light.

**How to reproduce**: `serveWorkspaces()`, a check set (`symbiote/config.json`
`merge.checks`), `POST /api/hive {on:true}`, open `/start` (the audit's `hive-new-goal` shots;
`e2e/hive-pages.spec.ts:230`).

**Where to look**:
- `packages/viewer/src/ui/base.css:400-460` (Hive's tokens; `--focus` set to the accent at `:419`
  and `:452`) and `--ring` (`:172`, `:270`, a mix of `--focus`).
- Decision 814: Hive's crimson is "identity only: the mark, the mode, the picked tab, its accent's
  text, one constructive primary a page; never a state or a surface".
- The `symbiote-style` skill: focus is `--focus` and a 3 px `--ring`.
- `test/tokens.test.ts` (contrast of every token pair).

**Out of scope**: Hive's crimson elsewhere (814 stands); normal mode's violet focus.

**Done when**:
- In Hive mode the focus ring is not the error colour nor Hive's crimson: either normal mode's
  focus (`#9886ff` dark, `#5b3fd9` light) or a neutral one.
- It passes `tokens.test.ts`' contrast for a focus indicator (3:1 against the field and the
  ground).
- Screenshots of New goal and Settings' Hive page, both themes.

## Evidence

Reproduced in the audit (Hive mode, light theme, New goal at 1440×900, the shot
`hive-new-goal-light.png` in the audit's scratch): Title's ring crimson with no input typed.
Whether it reads as an error is a judgement; decision 814 says crimson is never a state, and a
focus ring is one.

## Approach

Drop `--focus` from Hive's two token blocks so normal mode's comes through, or set a Hive focus
from the warm ink (a light warm grey in dark, the ink in light). Pick by contrast numbers
(`tokens.test.ts` prints them) and a screenshot. Check that no rule in `ui/hive.css` reads
`--focus` for a crimson identity mark.

## Tests first

`tokens.test.ts`: in Hive's blocks `--focus` is not `--accent`, nor the error token. Red today.

## Verification

`pnpm check`; `e2e/hive-pages.spec.ts`, `e2e/targets.spec.ts`; screenshots (both themes) of New
goal, Settings' Hive page and the Run tab with a focused control.
