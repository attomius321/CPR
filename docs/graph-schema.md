# CPR Graph Schema (draft v0.1.0)

The graph JSON is the contract between the engine (`@cpr/core`) and every consumer
(viewer, CLI summary, GitHub Action). It is **language-neutral**: nothing in it is
TypeScript-specific except the `language` value.

## Conventions

- **Paths** are repo-relative, POSIX-style (`src/user/service.ts`).
- **Positions** are 1-based `line` and `col`. Ranges are start-inclusive, end-exclusive.
- **IDs** for symbols: `<path>#<qualified name>` (see [PLAN.md §6.2](./PLAN.md#62-stable-ids)).
- Fields not listed here may appear. Consumers **must ignore unknown fields**.

## Versioning

`schemaVersion` follows semver.

| Change | Bump |
|---|---|
| New optional field, new enum value consumers can ignore | minor |
| Removed/renamed field, changed meaning | major |

A consumer accepts any version with the same major. A JSON Schema file will live at
`packages/core/schema/graph.schema.json` and is the source of truth once it exists.

## Top level

```jsonc
{
  "schemaVersion": "0.1.0",
  "generator": { "name": "cpr", "version": "0.1.0" },
  "revisions": {
    "base": { "ref": "main", "sha": "a1b2c3d", "mergeBase": "9f8e7d6" },
    "head": { "ref": "feature/users", "sha": "d4e5f6a" }
  },
  "nodes": [ /* Node */ ],
  "edges": [ /* Edge */ ],
  "findings": [ /* Finding */ ],
  "stats": {
    "filesChanged": 6,
    "symbols": { "added": 3, "removed": 1, "modified": 10, "context": 12 },
    "durationMs": 4210
  }
}
```

## Node

One per symbol in the graph: every changed symbol, plus unchanged **context** symbols
(direct callers and callees of changed ones).

```jsonc
{
  "id": "src/user/service.ts#UserService.getUser",
  "kind": "method",
  "name": "getUser",
  "container": "src/user/service.ts#UserService",   // parent symbol, or null
  "language": "typescript",
  "exported": true,
  "status": "modified",                              // see below
  "delta": { "signature": true, "body": false, "moved": false },
  "previousId": null,                                // set when moved/renamed
  "base": {
    "file": "src/user/service.ts",
    "range": { "start": { "line": 12, "col": 3 }, "end": { "line": 20, "col": 4 } },
    "signature": "getUser(id: string): Promise<User>",
    "hashes": { "signature": "8c1f…", "body": "2a9e…" }
  },
  "head": {
    "file": "src/user/service.ts",
    "range": { "start": { "line": 14, "col": 3 }, "end": { "line": 24, "col": 4 } },
    "signature": "getUser(id: string, opts?: GetOpts): Promise<User | null>",
    "hashes": { "signature": "b71d…", "body": "2a9e…" }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `kind` | enum | `function` `class` `method` `constructor` `accessor` `property` `interface` `type` `enum` `variable` `namespace` `module` `external` `unknown` |
| `status` | enum | `added` `removed` `modified` `unchanged` |
| `delta` | object \| absent | Present only when `status` is `modified`. At least one flag is `true`. |
| `base` / `head` | object \| null | `base` is null for `added`, `head` is null for `removed`. |
| `previousId` | string \| null | The base ID when the symbol was moved or renamed. |
| `hashes` | object | `signature` and `body`, 16 hex chars each. `body` is `""` when the symbol has no body (interfaces, types, enums, abstract methods). |

`unchanged` nodes are context only. Special node IDs, all leaves without `base`/`head`:

| Kind | ID | Meaning |
|---|---|---|
| `module` | `src/app.ts#(module)` | Top-level code of a file, outside any declaration. |
| `external` | `react#useState`, `node:fs#readFileSync`, `express#Response.json` | A package symbol: package name, then its dotted name. Standard-library globals are not included. |
| `unknown` | `unknown:obj[name]`, `unknown:target.go` | A call the checker cannot resolve (dynamic or `any`); the ID holds the callee text. |

## Edge

A directed relation `from` → `to` ("from uses to").

```jsonc
{
  "id": "e12",
  "from": "src/api/routes.ts#listUsers",
  "to": "src/user/service.ts#UserService.getUser",
  "kind": "call",
  "side": "both",
  "resolution": "resolved",
  "sites": {
    "base": [{ "file": "src/api/routes.ts", "line": 40, "col": 18 }],
    "head": [{ "file": "src/api/routes.ts", "line": 42, "col": 18 }]
  },
  "via": ["src/user/index.ts"]   // barrel / re-export hops (not emitted yet)
}
```

| Field | Type | Notes |
|---|---|---|
| `kind` | enum | `call` `new` `reference` `type-reference` `extends` `implements`. `type-reference` edges are always emitted; viewers should hide them by default. |
| `side` | enum | `base` (edge removed), `head` (edge added), `both` (kept) |
| `resolution` | enum | `resolved` — the checker found the target. `unknown` — dynamic call or untyped JS; `to` is a best guess and may be an `unknown` node. |
| `sites` | object | Call/reference locations per side. Missing side = no sites there. |
| `via` | string[] | Files the reference passed through (re-exports). Optional. |

## Finding

```jsonc
{
  "id": "f3",
  "rule": "signature-changed",
  "severity": "warning",
  "symbol": "src/user/service.ts#UserService.getUser",
  "related": [
    "src/api/routes.ts#listUsers",
    "src/jobs/sync.ts#syncUsers"
  ],
  "message": "Signature changed; 3 of 5 callers were not updated in this change.",
  "data": { "callers": 5, "updated": 2, "untouched": 3 }
}
```

| Field | Type | Notes |
|---|---|---|
| `rule` | string | `removed-still-referenced` `orphan-added` `signature-changed` (v1) |
| `severity` | enum | `error` `warning` `info` |
| `symbol` | string | The node the finding is about. |
| `related` | string[] | Other nodes to highlight (callers, blast radius). |
| `data` | object | Rule-specific details. Shape is documented per rule. |

### Rule `data` shapes (v1)

| Rule | `data` |
|---|---|
| `removed-still-referenced` | `{ "referencedBy": string[], "certainty": "resolved" \| "unknown", "sites": Site[] }` |
| `orphan-added` | `{ "exportedFromEntry": boolean, "exposure": "entry-export" \| "default-export" \| null }` |
| `signature-changed` | `{ "callers": number, "updated": number, "untouched": number }` — `related` lists untouched users first |
