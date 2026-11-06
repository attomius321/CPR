# Fix — Shell pages stop asking for /api/graph

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V3)

**Status:** planned (2026-11-06), to be built on branch `fix/no-graph-probe` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/no-graph-probe` · **Size** S · **Depends on** none; not at the
same time as P07 (`fix/api-error-page`): both edit `useDiffGraph.ts` · **Plan** P18 of 51 (the
audit's order)

## The brief

**What happens**: every load of a shell page (the Overview, Git, Settings…) under
`symbiote view` reads `./api/graph`. That gets a 404 ("no graph here: pick two commits"), and
the browser logs "Failed to load resource: the server responded with a status of 404". Only
then does the page fall back to the shell.

**How to reproduce**: `symbiote view` in any repository, open `/overview` with the console open:
one `GET /api/graph 404` and one console error per load.

**Where to look**:
- `packages/viewer/src/diff/useDiffGraph.ts:101-150`: `fetchCapabilities()`, then
  `poll()` → `fetchGraph('./api/graph')`, then the 404's `missing` → `status: 'shell'`.
- `packages/cli/src/server.ts:1205-1228`: capabilities say `sources: site !== undefined || diff`,
  and `/api/graph` answers 404 when there is no `site`.

**Out of scope**: what the page shows when the server fails (P07), a diff page's analysis
states, `?graph=` pages (no server).

**Done when**: a shell page under `symbiote view` makes no `/api/graph` request and logs no
console error. A diff's page (`/diff/<pair>/`) and `symbiote view <base>` still load their graph.

## Evidence

- **Measured**: the audit's tour logged 25 × `GET /api/graph 404` and 25 console errors in 25
  page loads on a fresh repository, and 39 of each in the workspace tour.
- It also shows in the desktop window: one console error at its first page.

## Approach

- In `useDiffGraph`, when the page is served (`url === './api/graph'`), capabilities answered,
  `capabilities.commits` is set and `capabilities.sources` is false: set
  `{ status: 'shell', repo }` at once, with no graph read.
- `sources` is false exactly when the server has no `site` and the page is not a diff's
  (`server.ts:1207`). Do not decide from the page's path: the shell's routes and a diff's `base:
  './'` are relative.
- Keep the `fetchGraph` path for every other case: a diff's page, `symbiote view <base>`,
  `symbiote pr`.

## Tests first

1. `packages/viewer/e2e/shell.spec.ts` (or `page-frame.spec.ts`): open `/overview`, `/git` and
   `/settings` on `serveWorkspaces()`. Record requests and console messages. Expect no request
   to `/api/graph` and no `console.error`. It fails today (one of each per page).
2. Keep green: `serveFixture` opens `/diff/<pair>/` and shows its Files page; `servePullRequest`
   shows its graph.

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e` (all specs: every spec checks for page errors, and
  `app.spec.ts` covers the window).
- First paint of `/git` and `/overview`, before and after (the `viewer-check` skill): one fewer
  round trip before the shell draws. Expect equal or faster.
