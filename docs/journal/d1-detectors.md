# Journal: D1 — Detectors from real reviews

[Index](../JOURNAL.md) · [Plan](../plan/design.md#8-detectors-v1)

## D1 — Detectors from real reviews (2026-10-01)

**What landed**
- `signature-changed` splits users into production code and tests (`isTestFile`: `*.test.*`,
  `*.spec.*`, `*.test-d.*`, `__tests__/`, `__mocks__/`, `test/`, `tests/`, `e2e/`). Only an
  untouched production user in another file makes it a warning — a stale test fails the test run
  by itself. Messages count test users apart (`2 of 2 users not updated · 1 test user`); data
  gains `tests` and `untouchedTests` (existing counts keep their meaning, tests included).
- New rule `exported-api-changed` (warning): a symbol exported from the entry of a published
  package (nearest package.json without `"private": true`) is removed, is no longer exported,
  or gets a `breaking`/`unknown` signature. Private class members (`private`, `#x`) are not API.
  A removal that `removed-still-referenced` already reports is not repeated. New adapter
  method `publicApi(revision, symbol)`, asked only for removed and modified symbols.
- Graph schema 0.3.0. New fixture `public-api`. Vitest no longer collects `*.test.ts` files
  inside test fixtures (the new fixture has one, as code under analysis).

**Dogfood** (last 12 TS commits each, before → after)

| Repo | Findings | Warnings | What changed |
|---|---|---|---|
| ky | 28 → 28 | 11 → 11 | One message now counts its test user apart: "2 of 2 users not updated · 1 test user" (was "2 of 3"). |
| zod | 4 → 6 | 3 → 5 | Two new `exported-api-changed`, both real: the revert of `z.currencyCode()` removes a public export; `ZodInstanceOf.properties()` got a stricter generic constraint (the commit says non-matching schemas now error). |
| vite | 3 → 3 | 0 → 0 | A helper used only by tests reads "(1 test user)". |

The test-user split dropped no warning in these 36 commits. On the commit behind V5's note
(zod 413cce9a) it does what it is for: `_properties` goes from warning to info ("its only user
was updated · 3 test users, 1 not updated"), and `$ZodTypes` lists its production users first
instead of `assignability.test.ts (top level)`. Warnings there: 3 → 2.

**Open**: removing only a re-export from the entry (the symbol itself unchanged) is not
detected; packages without a source entry (only `dist/` in `main`) have no public API for Symbiote.
