# Fix — A server that answers with errors says so; loading words that fit the page

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V2)

**Status:** planned (2026-11-06), to be built on branch `fix/api-error-page` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/api-error-page` · **Size** S · **Depends on** none; build before or
after P18 (`fix/no-graph-probe`), not at once: both change `src/diff/useDiffGraph.ts` · **Plan**
P07 of 51 (the audit's order)

## The brief

**What happens**:
- When `symbiote view`'s API answers 500, every shell page shows the drop page: "Review a change
  as a graph — Run symbiote view main, or drop a graph JSON here". That holds for the Overview,
  Git, Nucleus, Skills, Monitor, History, Start and Settings. The advice is wrong: `symbiote view`
  is running.
- While the API has not answered, all eight pages say "Loading graph…", Settings and the Overview
  included.

**How to reproduce**:
- In a Playwright page on any `symbiote view`:
  `page.route('**/api/**', r => r.fulfill({ status: 500 }))`, then open `/overview`.
- With a route that never answers: "Loading graph…".

**Where to look**:
- `packages/viewer/src/diff/useDiffGraph.ts:80-87` (`fetchCapabilities`: a 500 or a network error
  becomes `null`, the same as "no server").
- `useDiffGraph.ts:145-147` (`!capabilities?.commits` → `{ status: 'empty' }`).
- `src/diff/App.tsx:538` ("Loading graph…") and `:891` (the drop page's head).

**Out of scope**:
- Failed reads inside a page (P08, V95).
- A file that is not a graph (P06).
- Skipping `/api/graph` on shell pages (P18).

**Done when**:
- With `/api/capabilities` answering 500, the page shows "Symbiote's server answered with an error"
  with the status and a Retry. It does not show the drop page.
- With no server at all (`?graph=` pages, or connection refused), the drop page shows as today.
- While nothing has answered, the page says "Opening…", not "Loading graph…", unless the address
  is a diff's (`/diff/…`) or has `?graph=`.

## Evidence

Reproduced in the audit's tour, the test "every shell page when the API fails, and while it has
not answered":
- With every `/api/**` route answering 500, all 8 pages showed the drop page
  ([shot](../images/chore-improvement-audit/api-failing-overview.png)).
- With every route held, all 8 said "Loading graph…"
  ([shot](../images/chore-improvement-audit/api-pending-settings.png)).

## Approach

- `fetchCapabilities` returns three outcomes: the capabilities, `unreachable` (a fetch that threw:
  no server, a dropped file's page), or `failed` with the status (a non-OK answer).
- A `failed` outcome becomes `{ status: 'server-error', code }`, drawn with the page frame:
  `PageHead`, one card, a `StatusLabel`, the status and Retry, which bumps `attempt` as "Analyze
  again" does.
- The loading words come from the address: `/diff/` or `?graph=` keeps "Loading graph…"; anything
  else says "Opening…". Keep `Loading` (the arc and its words, `test/loading.test.ts`).

## Tests first

- `packages/viewer/test/` (pure): the address → loading words, for `/overview`, `/settings`,
  `/diff/a..b/` and `?graph=x.json`. This fails today: no such function.
- `e2e/shell.spec.ts`:
  - with `**/api/capabilities` → 500, `/overview` shows the error card and Retry, and not the text
    "drop a graph JSON";
  - with the route held, `/settings` says "Opening…".
  Both fail today, as the audit's screenshots show.

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e` (`open.spec.ts`, `analyzing.spec.ts` unchanged).
- The `viewer-check` skill: screenshots of the error card in both themes at 1×, checked against the
  `symbiote-style` skill.
