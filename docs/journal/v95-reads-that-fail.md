# Journal: V95 — Reads and saves that say when they fail

[Index](../JOURNAL.md) · [Plan](../plan/v95-reads-that-fail.md)

## V95 spike (2026-11-06, from chore/improvement-audit)

The improvement audit ([its journal](chore-improvement-audit.md), findings V2, V4 and V5) opened
every shell page with the API answering 500 and with it never answering. It also read the viewer's
failure paths:

- `ThreadTab.tsx:21-24`: a non-OK answer becomes `null`, which `:61` draws as "Reading its
  messages…" forever.
- `useWorkspaces.ts:96-99`: a non-OK answer replaces the list with `null`, so the sidenav shows its
  skeleton.
- `diff/store.ts:29-35`: review marks and drafts are `PUT` with `.catch(() => undefined)`.
- `DetailPanel.tsx:51-61`: a rejected source read is cached for the session.
- `HiveRunTab.tsx:99`: the log tail closes on its first error; `StepLog.tsx` reconnects.
- `history/api.ts:122-130`: a network error mid-analysis reads as `missing`, and polling stops.

Counted in `packages/viewer/src`: 26 `.catch(() => {})` and 13 `ok ? … : null`. Read in code, not
run path by path.

Not started.
