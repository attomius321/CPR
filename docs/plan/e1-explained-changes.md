# E1 — Decisions and their ripples (measured)

[Index](../PLAN.md) · [Journal](../journal/e1-explained-changes.md)

**Status:** measured (2026-10-04) with a spike (`spikes/e1-ripples`); merged into main
(2026-10-12, from branch `milestone/e1-explained-changes`); not planned for implementation — see
the recommendation.

**Hypothesis** (asked: "What this app could have to be disruptive?", then "I want a more precise
explanation for #1"): much of a pull request is mechanical — a rename and the call sites it
touches, moves, an argument added at every call, the same edit repeated — and could be verified
instead of read, leaving the reviewer the decisions. North Star: review decisions, not lines.

**How it was measured** (`measure.mjs`): Symbiote's analysis of each change, then a token diff of
every modified symbol's two versions (Symbiote's normalization: no formatting or comments). A changed
symbol is verified when it is:

- **moved**: Symbiote matched it under a new ID with identical code;
- **renamed**: a removed and an added symbol (or a moved one) equal under the change's renames;
- **ripple**: every difference is one of the change's renames, an import path, or the argument
  list of a call to a symbol whose signature changed — `linked` when it references that symbol;
- **repeat**: its edit, string and number values masked, is another symbol's edit in the same
  change (zod's 40 locales gaining `currency_code: "…"`), or new code shaped like other new code.

Renames are inferred only from the change itself: symbols Symbiote matched as moved under a new name,
renamed files and folders, and removed + added pairs (12 tokens or more) equal under their name
difference — as word substitutions, several per word (one change renamed `errorBoundaryName` →
`caughtErrorName` and `ErrorBoundary` → `Catch`). Everything else is a decision.

**Measured** on 165 unique changes — the pinned regression sets, the latest 15 commits touching
TypeScript of ky, zod, vite, Bitwarden and Qwik, and 35 whose subject says rename, move or
refactor (one zod change, reverted and re-applied, counted once):

| Sample | Changes | Changed symbols verified | Diff lines verified | Changes with ≥ 25 % of their lines verified |
|---|---|---|---|---|
| Pinned sets (`r1`, Bitwarden ×17, Qwik ×30) | 76 | 343 of 1,270 (27.0 %) | 1,235 of 14,080 (8.8 %) | 5 |
| Latest commits | 54 | 87 of 514 (16.9 %) | 160 of 4,068 (3.9 %) | 5 |
| Subject says rename, move or refactor | 35 | 58 of 654 (8.9 %) | 133 of 10,365 (1.3 %) | 0 |
| **All** | 165 | 488 of 2,438 (20.0 %) | 1,528 of 28,513 (5.4 %) | 10 |
| All but Qwik `f7ed58cfc` | 164 | 225 of 2,071 (10.9 %) | 740 of 26,636 (2.8 %) | 9 |

By class (all): repeated edits 148 symbols, moved 119, renamed 105, ripples 98 (31 of them an
argument added or removed at a call), repeated new code 18. One change carries most renames:
Qwik `f7ed58cfc` (Suspense → Pending, ErrorBoundary → Catch), 263 of its 367 changed symbols
verified (71.7 %). Precision: 40 verified symbols drawn at random (moves left out) and read by
hand were all mechanical — 0 false.

**What this says**

- Typical changes are decisions. Outside one large rename, a reviewer would skip 2.8 % of the
  diff lines; changes titled "refactor" restructure code rather than rename it (1.3 %).
- Verified symbols are many and small: a fifth of the change list's items, a twentieth of its
  lines. The win is fewer items to open and tick, not fewer lines to read.
- When it applies, it applies strongly: 6 of 165 changes have half their lines or more verified
  (a rename across a repo, a feature added to 40 locales, a prop changed in 24 files).

**Recommendation**: not the disruptive feature #1 was meant to be. A smaller version is worth a
viewer milestone when the change list grows long: group repeated edits ("the same edit in 24
files — values: …") and renames with their call sites, collapsed, with the proof one click away.
Without the rename inference and the argument rule, `repeat` and `moved` alone cover 285 of the 488
verified symbols, at much lower risk.

**Not measured**: member renames (an enum or interface member renamed; Qwik's `suspense` →
`pendingBoundary` flag stayed a decision), call-site rewrites beyond one argument list, and
whether the old spelling of a rename is left anywhere (an incomplete rename would be a finding).
