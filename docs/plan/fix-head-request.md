# Fix — symbiote view answers HEAD; opening a nexus tab logs no 405

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding N2)

**Status:** planned (2026-11-06), to be built on branch `fix/head-request` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/head-request` · **Size** S · **Depends on** none · **Plan** P19 of
51 (the audit's order)

## The brief

**What happens**: the nexus asks whether a Symbiote is reachable with a `HEAD` to its address
(decision 625). `symbiote view` answers `HEAD /` with 405, so every Symbiote tab opened in the
nexus logs "Failed to load resource: the server responded with a status of 405".

**How to reproduce**: `curl -sI http://127.0.0.1:<port>/` against a running `symbiote view`
answers `HTTP/1.1 405 Method Not Allowed`. Open that Symbiote's tab in the nexus: one console
error.

**Where to look**:
- `packages/nexus/src/page/reach.ts:38-50` (`answers`): `fetch(url, { method: 'HEAD', mode:
  'no-cors' })`. Any answer counts, so the 405 already "works".
- `packages/cli/src/server.ts:1203`: `if (req.method !== 'GET') return send(res, 405, …)` before
  the page and the static files.

**Out of scope**: the nexus's reach logic (decision 625: asked every 500 ms for 10 s), and HEAD
on `/api/*` writes.

**Done when**: `HEAD /` and `HEAD` on any static file answer 200 (or 404 for a missing file)
with no body; a nexus tab opens with no console error; every `/api/` route answers as today.

## Evidence

- **Reproduced**: `curl -sI` gave `HTTP/1.1 405 Method Not Allowed`. The nexus tour logged
  `http 405 /` and one console error per theme, at each tab opened.

## Approach

- In `server.ts`'s GET-only guard (`:1203`), let `HEAD` through for every path that does not
  start with `/api/`. Node's `ServerResponse` sends no body to a HEAD request, so the page and
  file handlers need no change.
- Keep `HEAD` on `/api/*` at 405: those reads can be costly (a graph, git), and nothing needs
  them.
- Do not change the nexus to `GET`: the HEAD was chosen to read nothing (`reach.ts`'s comment),
  and the fix belongs to the server that refuses a plain HTTP method.

## Tests first

`packages/cli/test/server.test.ts`, beside "serves the viewer files" (`:131`):
1. `fetch(new URL('/', server.url), { method: 'HEAD' })` → 200, `content-type` text/html, empty
   body. It fails today (405).
2. `HEAD /assets/<a built file>` → 200; `HEAD /missing.js` → 404.
3. `HEAD /api/graph` → 405, as today.

## Verification

- `pnpm check`, `pnpm build`.
- `pnpm test:e2e`: the nexus specs (`nexus.spec.ts` frames real Symbiotes) with a console-error
  check if one is cheap to add there.
- By hand: `curl -sI` on `/` gives 200; the nexus opens a tab with a clean console.
