# Journal: NX7 — The nexus's writes behind a per-run secret

[Index](../JOURNAL.md) · [Plan](../plan/nx7-nexus-write-secret.md)

## NX7 spike (2026-11-06, from chore/improvement-audit)

The improvement audit ([its journal](chore-improvement-audit.md), finding N4) read the nexus's
write gate: `packages/nexus/src/server.ts:214-222` lets through any request with `x-symbiote: 1`, a
JSON content type and no Origin. That is the gate the audit reproduced on `symbiote view` (finding
S1: `POST /api/mcp/answer` from `curl` reached its handler; a foreign Origin got 403).

- The four writes (`WRITES`, `:75`) include `POST /api/symbiotes {"folder", "init": true}`, which
  runs `git init`. The question decision 928 requires is drawn by the page only.
- The port is fixed at 7347 since NX6.
- The audit ran its own nexus on `--port 0` and did not send an `init`: it would have written into
  a folder. Code, not reproduced.

Not started.
