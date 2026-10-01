# CPR

Local-first code review that turns a change into a graph of changed symbols and the calls between them, so you review decisions instead of lines.

- [Plan](docs/PLAN.md)
- [Graph schema](docs/graph-schema.md)

## Development

Requires Node ≥ 22.12 and pnpm 12.

```sh
pnpm install
pnpm check        # format, lint, typecheck, test
pnpm build        # compile packages to dist/
node packages/cli/dist/bin.js --help
```

| Package | Role |
|---|---|
| `packages/core` | Analysis engine |
| `packages/cli` | `cpr` command line |
| `packages/viewer` | Graph UI (phase 2) |
