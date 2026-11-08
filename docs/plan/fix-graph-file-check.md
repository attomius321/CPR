# Fix — A file that is not a graph says so; an error boundary around each page

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V1)

**Status:** planned (2026-11-06), to be built on branch `fix/graph-file-check` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/graph-file-check` · **Size** M · **Depends on** none · **Plan** P06
of 51 (the audit's order)

## The brief

**What happens**: a JSON file that is not a Symbiote graph turns the whole page white. This applies
to a file dropped on the drop page and to one given with `?graph=`. React unmounts the root on the
first render error, and no part of the viewer catches one.

**How to reproduce**: serve `{}` and open `<any symbiote view>/?graph=<its URL>`, or drop a
`package.json` on the "Review a change as a graph" page. The page goes white, and the console shows
"Cannot read properties of undefined (reading 'filter')".

**Where to look**:
- `packages/viewer/src/diff/App.tsx:278-292` (`load`: `JSON.parse(...) as Graph`, then
  `setState`)
- `src/history/commits.ts:374-378` (`graphLoaded`: any 200 object is `{ kind: 'graph' }`)
- `src/main.tsx:46-55` (`createRoot` with only `onUncaughtError`)
- `src/diff/review.ts:24` (`graph.nodes.filter`), `App.tsx:563` (`graph.findings.length`)
- The graph contract: `docs/graph-schema.md`, `packages/core/schema/graph.schema.json:7-14`
  (required: `schemaVersion`, `generator`, `revisions`, `files`, `nodes`, `edges`, …)

**Out of scope**: validating every field against the JSON Schema in the browser (the viewer imports
only types from core); reads other than the graph (P08, V95); the server's error page (P07).

**Done when**:
- `?graph=` with `{}`, with `{"schemaVersion":"0.1.0"}` or with a `package.json` shows a message
  in the page: "This file is not a Symbiote graph" plus what is missing. The drop page shows it as
  well, and stays usable.
- A graph whose `schemaVersion` major is newer than the viewer's says "made by a newer Symbiote".
- A render error in any page shows that page's error card with Reload, not a white page.
- Older graphs still open (CLAUDE.md: "Graphs from older Symbiote versions must still open").

## Evidence

Reproduced (the audit's `boundary.mjs` on its own view, 2026-11-06):

```
audit-empty.json | elements under #root: 0 | text: "" | errors: [ "Cannot read properties of undefined (reading 'filter')" ]
audit-old.json   | elements under #root: 0 | text: "" | errors: [ "Cannot read properties of undefined (reading 'length')" ]
```

`grep -rn "ErrorBoundary\|getDerivedStateFromError" packages/viewer/src` finds 0 matches.

## Approach

- **A shape check**: a pure `graphProblem(value: unknown): string | null` in a new
  `src/diff/graph-check.ts`. It checks that the value is an object, that `schemaVersion` is a string
  whose major is ≤ the viewer's, and that `files`, `nodes` and `edges` are arrays, `revisions` an
  object and `findings` an array or absent. It does not deep-check every node: a few hundred µs on
  Bitwarden at most, measured.
- Call it in `load` (the dropped file) and in `graphLoaded` (`?graph=` and `api/graph`). A problem
  becomes a new `Loaded` kind, `{ kind: 'invalid'; reason }`, drawn by the drop page and the diff
  page in words.
- **An error boundary**: one small class component in `src/ui/PageBoundary.tsx` around each shell
  page and the diff page. It shows the page's head, an error card (StatusLabel, the message, Reload),
  and reports to the logs through the same `reportError` `main.tsx` uses. Keep it a card on the page
  frame (page-frame.spec's rules).

## Tests first

- `packages/viewer/test/graph-check.test.ts`:
  - `{}`, `[]`, `null` and a `package.json` give a reason;
  - a 0.1.0 graph missing `findings` gives none;
  - a `9.0.0` graph gives "newer";
  - each of the core golden graphs (`packages/core/test/__snapshots__/*.json`) gives none.
  These fail today: the module does not exist.
- `e2e/open.spec.ts` (or a new `graph-file.spec.ts`): `?graph=` serving `{}` shows the message,
  with no page error. It fails today: page error, empty `#root`.
- A spec that throws in a page (through `page.route` answering a malformed workspace record) shows
  the error card.

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e`.
- `viewer-check` skill: `scripts/viewer/measure.mjs` on Bitwarden 737ee3f. First paint within the
  noise of the audit's 307–340 ms.
- Both themes for the message and the error card: screenshots at 1×.
