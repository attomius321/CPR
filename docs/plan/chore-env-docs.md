# Chore — configuration.md lists every variable Symbiote reads

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (the docs findings)

**Status:** planned (2026-11-06), to be built on branch `chore/env-docs` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/env-docs` · **Size** S · **Depends on** none · **Plan** P49 of
51 (the audit's order)

## The brief

**What to change**: `docs/reference/configuration.md`'s table of environment variables (from
`:600`) misses some that Symbiote reads, and describes two narrower than the code. Add or correct
each, in the page's words; leave the test-only ones out and say so in a comment in the code.

**Where to look** (each checked by grep on `main` at c2aa5c4; "doc" is whether `configuration.md`
names it):

| Variable | Read at | Doc | Do |
|---|---|---|---|
| `GITHUB_ENTERPRISE_TOKEN` | `packages/forge/src/github.ts:181` (`GH_ENTERPRISE_TOKEN \|\| GITHUB_ENTERPRISE_TOKEN`); redacted in `cli/src/nucleus-record.ts:28` | no (`GH_ENTERPRISE_TOKEN` yes) | add beside `GH_ENTERPRISE_TOKEN`, same row |
| `SYMBIOTE_APP` | `packages/cli/src/app.ts:30-32`: `off`, or a command run instead of the app | `:607` says `off` only | add "or a command to run instead of Symbiote's window" |
| `SYMBIOTE_LOG_LEVEL` | `packages/log/src/log.ts:33`: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `:610` lists four | list the seven |
| `CLAUDE_CONFIG_DIR` | `packages/cli/src/usage.ts:146-147,250`: where Claude Code keeps its files, read for usage | no | add: Symbiote reads Claude Code's account and usage there, as Claude Code does |
| `CODEX_HOME` | `packages/cli/src/usage.ts:403`: Codex's sessions for its usage | no | add, the same way |
| `XDG_DATA_HOME` | `packages/cli/src/app.ts:152`: where `app install` writes the launcher | no | add to the app's row or the folders' paragraph (`:175`) |
| `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` | `app.ts:153`, `intro.ts:25`; `nexus/src/registry.ts:36` | yes (`:175`, `:608`) | nothing |
| `XDG_BIN_HOME` | `scripts/install.mjs:36` | no (the README's install says it) | add a line where the install is described, or leave to the README: decide and say |
| `ANTHROPIC_API_KEY` | `packages/cli/src/workspaces.ts:1205`: a start says it bills the API, not the plan (`viewer/src/workspaces/StartAgent.tsx:224`) | no | add: what Symbiote does when it is set |
| `SYMBIOTE_VIEWER_DIR` | `packages/cli/src/main.ts:1608`, `packages/nexus/src/main.ts:276`: another viewer build | no | test and development only: leave out of the user's page; a comment at both reads says so |
| `SYMBIOTE_STDIN_STOPS` | `packages/cli/src/main.ts:170`; set by `packages/desktop/src/launcher.ts:53` | no | internal (the app sets it): leave out; comment |
| `SYMBIOTE_CLAUDE_USAGE_URL` | `packages/cli/src/usage.ts:186` | no | a test hook: leave out; comment |

**Out of scope**: renaming or removing any variable; the README (it documents the install's
`XDG_BIN_HOME` already: check, do not duplicate); behaviour.

**Done when**:
- Every row marked "add" or "list" is in `configuration.md`, in its table's order and voice.
- The three internal variables have a one-line comment at their read saying they are for tests or
  the app, and are not in the user's page.
- A script (`grep -rhoE 'env\.[A-Z_]+|process\.env\.[A-Z_]+' packages/*/src scripts`) lists no
  variable that is neither documented nor commented as internal; its output is in the journal.

## Evidence

**Code**: the grep in the table, run for this plan. The audit's docs findings named
`GITHUB_ENTERPRISE_TOKEN`, `SYMBIOTE_APP=<command>` and `SYMBIOTE_VIEWER_DIR`; the cli review
added `SYMBIOTE_STDIN_STOPS`, `SYMBIOTE_CLAUDE_USAGE_URL`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
`XDG_*` and `ANTHROPIC_API_KEY`, and the extra log levels (`log.ts:33`).

## Approach

Edit the one table; a comment at three reads. Follow the `writing-docs` skill's checks: every
variable named is grepped in the code in the same commit.

## Tests first

None: a docs change, plus three comments.

## Verification

- The script above, before and after.
- `pnpm check`.
