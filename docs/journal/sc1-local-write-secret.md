# Journal: SC1 — A per-run secret for symbiote view's writes

[Index](../JOURNAL.md) · [Plan](../plan/sc1-local-write-secret.md)

## SC1 spike (2026-11-06, from chore/improvement-audit)

The improvement audit ([its journal](chore-improvement-audit.md), finding S1) probed the write gate
of its own `symbiote view` (a scratch repository, its own cache) with `curl`:

- `GET /api/mcp/asks` → 200: the pending Confirms are listed to any local process.
- `POST /api/mcp/answer` with `x-symbiote: 1`, a JSON content type and no Origin → 404
  `{"error":"no ask nope"}`. The gate let it through; only the made-up id was refused.
- The same POST with `origin: http://evil.example` → 403: browsers are kept out.
- `callerOf` (`server.ts:836`) takes `x-symbiote-caller: nucleus` as Nucleus, and
  `symbiote/nucleus-mcp.json` shows the bridge's `--as nucleus` arguments to any agent.


## SC1 — a key for the page, the bridge and Nucleus (2026-11-12)

On main at d2abb65 the audit's lines read as on 2026-11-06: asks 200, an answer with no Origin
through the gate (404 for the made-up id), a call with `x-symbiote-caller: nucleus` taken as
Nucleus's. Decisions 930–932 were free on main and every branch.

- **A cookie would have leaked.** Cookies of `127.0.0.1` go to every port of it, so an agent's
  dev server opened in the person's browser would have received the page's. The page keeps the
  key in its origin's storage and sends a header instead (930 as built, the person's choice).
- **The stream was a second way to the asks.** `/api/events` carried the asks whole to any
  reader; it now says only that they changed, and the page reads them with its key.
- **The view's environment reaches every agent it starts.** A key given by environment (the e2e
  harness's) is taken out of it at the start, `process.env` included, before anything spawns.
- **75 specs, unchanged**: a known key in the harness and Playwright's `extraHTTPHeaders`; the
  real trade is `page-key.spec.ts`, the window's `app.spec.ts`, the nexus's frames and the
  Nucleus specs. `nucleus-activity.spec.ts` called `/api/mcp` as Nucleus by header alone and
  failed as it should; it now sends the keys Nucleus's bridge does.
- **Verified**: `pnpm check` (3,684 tests), `pnpm build`, `pnpm test:e2e` (viewer 488, nexus 32),
  the curl lines above 403/403/403. The nexus can still hand any local caller a framed address
  until NX7; configuration.md says so.

After the merge the person restarts `symbiote view` (its window and Nucleus with it), the running
agents' MCP servers (a bridge from before SC1 sends no key: 403), and `symbiote-nexus`.

