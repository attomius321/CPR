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

Not started.
