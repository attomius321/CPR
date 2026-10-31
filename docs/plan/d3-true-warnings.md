# D3 — True warnings

[Index](../PLAN.md) · Journal: none yet

**Status:** proposed (2026-10-31) from the D2 spike, on branch `spike/review-precision`; not
planned or started. Start it as its own workspace. Decision numbers are given when it is planned.

**Problem** (D2, [d2-review-precision.md](d2-review-precision.md)). On 51 merged pull requests of
zod, vite and Bitwarden, the agent scored 29 of the 36 warnings the GitHub Action would post (81 %)
wrong and 3 (8 %) right and worth reading; read literally, 7 (19 %) still say something false.
59 of the 75 `signature-changed` findings are `info` notes with nothing to act on. Every wrong
warning traces to one of these causes:

| Cause | Wrong warnings | Where |
|---|---|---|
| `signature-changed` counts every reference as a user "not updated", even one that doesn't use what changed (a type named but its changed member not read, a return value ignored, a map key or enum member others don't name) | 11 | `packages/core/src/detectors.ts:102–160` |
| `orphan-added` on a Storybook story (a named export of `*.stories.ts`) | 6 | `detectors.ts:220`, exposure in `lang/typescript/detect.ts` |
| `exported-api-changed` on a workspace package at version 0.0.0 (`@bitwarden/vault`), counted as published because it lacks `"private": true` | 4 | `lang/typescript/detect.ts:154` |
| `orphan-added` on an Angular `effect()` field, which runs without being named | 3 | `packages/plugin-angular` (its exposure hook) |
| Compatibility compares types as strings (`base.returns !== head.returns` → breaking): a widened parameter (string → PropertyKey) or a return narrowed to a subtype is called breaking; adding `export` counts as a signature change | 4 | `packages/core/src/compat.ts:53–98` |
| `orphan-added` on a member read only by its component's inline `template:`: the plugin builds no shim for a class that is not exported (`plugin-angular/src/index.ts:431`), common in specs and stories, so the template's uses are never seen | 2 | `plugin-angular/src/index.ts` |

Noise to silence: `info` findings where only parameter names changed (23, e.g. `_json` → `json`
under an unchanged `Processor<…>` type) and where every user was updated in the pull request (24);
the same call sites repeated on each override of a method (3).

**Goal**: on D2's 51 pull requests, the wrong warnings go and the three worth reading stay; on a
fresh set drawn and scored the same way, at most 10 % of posted warnings are wrong (D2's bar).
Without these cases, findings are identical to `main` (`regression-check`).

## orphan-added

- Named exports of `*.stories.*` are used by Storybook (Component Story Format, any framework):
  give them an exposure that is not reported, as the `default` export of such a file already is.
  Decide whether this is core (Storybook is not one framework) or a small `storybook` plugin.
- Angular plugin: a class field initialized with `effect()`, `afterRender()`,
  `afterNextRender()` or `afterRenderEffect()` from `@angular/core` is `framework`-exposed.
- Angular plugin: when it cannot analyze a component's template (the class is not exported), its
  members are `framework`-exposed instead of unreferenced — prefer silence to a guess. Building an
  in-file shim for unexported classes is the fuller fix; measure whether it is needed.
- Core: `export { default as x } from './file'` is a use of that file's default export (zod #6092).

## signature-changed: users that use the change

- Record what changed, not only that the signature hash changed: members added, removed or retyped
  (interfaces, types, classes), parameters, the return type, enum members, object keys.
- A user counts as "not updated" only when its sites touch that part: a property access of a
  changed member, an object literal of the type (added required members), a call whose result is
  used (return type changed), a call passing the changed parameter, a name of the removed key or
  enum member. Everything else is listed as a user but is not a reason for a warning.
- One report per call site, on the declaration the call resolves to (D2: Bitwarden #22539 reported
  the same two calls on the abstract method and on each override).
- Keep the precision case D2 found worth reading: callbacks registered without a new argument
  (#22539's shared-unlock listeners) — decide whether "a callback ignores a new argument" stays a
  warning, since the stricter rule above would drop it.

## Compatibility by assignability

- Replace string equality in `compareShapes` with the checker's assignability, asked only for
  symbols already flagged (inference stays cheap): a parameter is compatible when the old type is
  assignable to the new one, a return when the new type is assignable to the old one.
- An `export` keyword added (or a type annotation equal to the inferred type) is not a signature
  change.

## exported-api-changed

- A package is published when it is not `"private": true` and has a version other than `0.0.0`
  or a `publishConfig`; `symbiote/config.json` can name more (or fewer) public packages.
- A return narrowed to a subtype is compatible (from the assignability change above).

## Info noise

- No `signature-changed` finding when only parameter names changed (callers are positional).
- "Every user was updated" moves from findings to the change list (the graph keeps the data), so
  the findings list holds what needs a look.

## Verification

1. **Fixtures first** (red before): one per cause above, each with its precision case — what must
   stay flagged (an untouched user that reads a removed member; a real orphan in a stories folder
   that is not a story; a published package's breaking change; a callback that must use a new
   argument, if kept).
2. **D2 as a regression set**: `spikes/d2-review-precision` keeps all 97 findings with the agent's
   scores; add a set of the 51 pull requests to `scripts/regression/sets.json` and a check that
   lists, per finding key, gone / kept / new. Target: the 29 wrong warnings gone, the 3 worth
   reading kept, nothing new without a reason.
3. **A fresh, blind holdout**, since D3 is tuned on D2's 51: draw 51 pull requests merged in
   October 2026 with `select.mjs` (new window, new seed), analyze `main` and the branch, score the
   branch's findings blind. Ask for a note on each sampled item and check the answer timings
   before computing agreement (D2's sample took 65 seconds for 35 items).
4. **Nothing else changes**: `regression-check` (r1, Bitwarden, Qwik) against `main`; goldens.
5. **Cost**: assignability only for flagged symbols; time within 5 % of `main` on r1 and Bitwarden.

**Risks**

| Risk | Mitigation |
|---|---|
| Tuned to 51 pull requests | The October holdout, scored blind. |
| Stricter "users" drops real warnings | Precision cases in the fixtures; the 3 worth reading must stay. |
| After D3 Symbiote almost never speaks (projection on D2: 4 warnings in 51 pull requests) | Expected: D2b measures whether findings help during review at all. |
| Assignability needs inference | Only for symbols with a changed signature hash and users. |

**Order**: orphan-added (11 of the wrong warnings, small changes), then exported-api and
compatibility, then the users rule (largest), then the info noise.

## Milestones

| # | Milestone | Output |
|---|---|---|
| D3a | orphan-added: stories, Angular effects, untemplated classes, default re-exports | 11 wrong warnings gone on D2 |
| D3b | Compatibility by assignability; published packages | 9 gone |
| D3c | signature-changed: users that use the change; one report per call | 11 gone; the 3 kept |
| D3d | Info noise out of findings | 47 fewer info findings |
| D3e | The October holdout, scored blind | the bar, or not yet |

**Not in D3**: new detectors (D2's four later fixes were behavior — UI state, a release workflow,
type soundness — not structure); findings on heads during review (D2b).
