# Fix — A mistyped option prints its error and where help is, not the whole help

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S10)

**Status:** planned (2026-11-06), to be built on branch `fix/cli-usage-errors` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/cli-usage-errors` · **Size** S · **Depends on** none · **Plan** P40
of 51 (the audit's order)

## The brief

**What happens**: a usage error (an unknown option, a missing `<base>`, a bad `--depth`) prints
its one-line error, then the command's whole help: 20 lines for `diff`, 30 for `pr`. The line
that says what went wrong scrolls out of a short terminal.

**How to reproduce**: in any git repository,
`node packages/cli/dist/bin.js diff HEAD~1 --frobnicate`. It prints "symbiote diff: Unknown
option '--frobnicate'…", a blank line, and the 20 lines of `DIFF_HELP`; exit code 2.

**Where to look**:
- `packages/cli/src/main.ts:374-378`: `UsageError` is printed as `${error.message}\n\n${error.help}`.
- `main.ts:387`: an unknown command prints the top-level `HELP` (25 lines) the same way.
- `main.ts:391-399` (`UsageError`), `main.ts:401-416` (`parse`, which turns `parseArgs`'
  `ERR_PARSE_ARGS_*` into a `UsageError`).
- Tests: `packages/cli/test/main.test.ts:62-76`, `:296`, `:406-407`, `:602-603`.

**Out of scope**: the help texts' words (P23 and P24 fix those); `--help` itself, which still
prints the whole help on stdout with exit code 0; the commands' options.

**Done when**:
- A usage error prints two lines on stderr: `symbiote <command>: <error>` and
  `Run symbiote <command> --help for its options.` Exit code stays 2.
- An unknown command prints its error and `Run symbiote --help for the commands.`
- `--help` output is unchanged.

## Evidence

**Reproduced** (the audit's CLI pass): `diff HEAD~1 --frobnicate`, `diff HEAD~1 --depth abc`,
`diff HEAD~1 --fail-on bogus`, `diff` with no base and `pr --summary` outside a CI job each
printed the full help after the error. `--depth abc` gave 22 lines for one wrong value.

## Approach

1. In `main.ts`'s `catch`, print `error.message` and one pointer line instead of `error.help`.
   Keep `UsageError.help` only if another caller needs it; else drop the field and the `help`
   argument of `parse`, `checkPort`, `checkDepth`, `checkFailOn` (one change, the same shape).
2. The unknown command: `symbiote: unknown command 'x'` and the pointer to `symbiote --help`.
3. Keep Node's `parseArgs` message: it already names the option.

## Tests first

In `packages/cli/test/main.test.ts`, before the change:
- `diff --bogus main` (exists at `:407`): add `expect(stderr.split('\n').filter(Boolean)).toHaveLength(2)`
  and `toContain('symbiote diff --help')`. It fails today (22 lines).
- `nope` (`:72-76`): stderr has no `Usage:` line. It fails today.
- `diff --help`: stdout still contains `Usage: symbiote diff` (passes before and after).

## Verification

- `pnpm check`; `pnpm build`.
- By hand: the five commands above, each two lines on stderr, exit 2.
- `docs/reference/commands.md` says nothing about usage errors' output (grep "usage error"): no
  doc change expected; check it.
