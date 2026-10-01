# Spike S1 — TypeScript 7 (Go) compiler API

**Question:** can `typescript@7`'s compiler API replace ts-morph (TS 6.0) for CPR's reference
search, and is it worth it?

**Answer (2026-10-01): not yet.** Results match ts-morph almost exactly, loading is ~4–7× faster,
but reference search is only ~1.6–3.5× faster because every query is an IPC round trip, and the
API lives under `typescript/unstable/*`. Keep ts-morph for v1; revisit when the API is stable or
offers batched reference search.

## Run it

This folder is outside the pnpm workspace on purpose (TS 7 would replace the toolchain's TS 6).

```sh
cd spikes/ts7
npm install
node spike.mjs <path/to/tsconfig.json> [...more]
```

The script loads the same tsconfig in both engines, takes every top-level function, class,
interface and variable as a target, finds its references in both, and compares the **use sites**
(definitions and import/export sites excluded, as CPR does).

## API used

```js
import { getTouchingToken } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

const api = new API({ cwd });                              // spawns the bundled tsgo binary
const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
const project = snapshot.getProjects()[0];                 // .program, .checker
const name = getTouchingToken(project.program.getSourceFile(file), pos);
project.checker.getReferencedSymbolsForNode(name, pos);   // [{ definition, symbol, references: NodeHandle[] }]
handle.resolve();                                          // NodeHandle → AST node
```

Gotcha: passing the `SourceFile` instead of the identifier returns no references.

## Results

| Project | Program files | Symbols | ts-morph load | TS 7 load | ts-morph search | TS 7 search | Use sites (ts-morph / TS 7) | Identical per symbol |
|---|---|---|---|---|---|---|---|---|
| CPR `packages/core` | 226 | 156 | 1075 ms | 156 ms | 496 ms | 141 ms | 588 / 587 | 153 / 156 |
| zod `packages/zod` | 380 | 2517 | 1521 ms | 404 ms | 13 858 ms | 8 721 ms | 30 421 / 30 396 | 2461 / 2517 |

Differences seen: positions shifted by leading comments (the spike's own offset math), and
JSDoc `{@link X}` references that ts-morph reports and TS 7 does not.

## What a TS 7 adapter would take

- A second implementation of extraction and reference classification on the TS 7 AST
  (`typescript/unstable/ast`; `SyntaxKind` numbering differs from TS 6).
- Hashing and naming code is AST-shaped and would need porting, not just re-wiring.
- The checker lives in another process: every `getSymbolAtLocation` / type query is a round
  trip, so outgoing-reference resolution (one query per identifier) needs batching
  (`getSymbolAtLocation(nodes[])` exists) to be fast.
