# Journal: Fix — the start page named the plan Claude Code's token kept from login

[Index](../JOURNAL.md)

## Fix — the start page named the plan Claude Code's token kept from login (2026-10-24, branch `fix/workspace-start`)

Asked: "'your Pro subscription' is wrong now... it seems hardcoded. Use real subscription like you
use in the bottom status bar." The person had moved from Pro to Max; the status bar said Claude Max,
the start page "your Pro subscription".

**Learned**:
- **Not hardcoded: two sources for one plan.** The start page took it from `claude auth status`'s
  `subscriptionType`; the status bar (V29c) from `oauthAccount.organizationType` in
  `.claude.json`. `auth status` takes `subscriptionType` from the token file
  (`.credentials.json`, `subscriptionType: "pro"`), written at login and not rewritten since.
  Everything else it prints (email, `orgId`, `orgName`) is the profile's, which Claude Code
  refreshes (`profileFetchedAt` a day old, `claude_max`, rate limit tier
  `default_claude_max_5x`). Claude Code 2.1.310.
- **The e2e servers gave Symbiote the person's `~/.claude.json`** except in the usage specs:
  only those set a CLAUDE_CONFIG_DIR of the test's. Harmless while only usage read it; the start
  page reading it would have made `workspaces.spec` say the plan of whoever ran it.

**Fixed**: one reader of Claude Code's profile, `readClaudeProfile` (`packages/cli/src/usage.ts`),
for the status bar and the start page. `claudeCode()` takes a `plan` reader (`main.ts` passes the
profile's: `usage.ts` imports from `workspaces.ts`); `parseAccount` names that plan for a
`claude.ai` login, else `subscriptionType` as before. An API key, a token, a cloud provider or a
signed-out login read as before. `serveWorkspaces` always runs with a Claude Code config folder of
the test's, with a `plan` option.

**Verification**: tests first, red for the right reason: `parseAccount` and `claudeCode().account()`
with `auth status` saying `pro` and the profile Max ("your Pro subscription" before),
`readClaudeProfile` (not exported before); e2e `usage.spec`'s "the start page names the plan the
status bar names": before (`main.ts` without the reader), the status bar said `ClaudeMax5h12%`
and the start page "your Pro subscription". On the person's account, the built `claudeCode`:
"your Pro subscription" without the profile, "your Max subscription" with it, the status bar's
plan Max. `pnpm check`: 1,384 tests in 100 files; build; e2e 218 of 218; after a last tidy
(no change in behaviour), `usage`, `workspaces` and `codex` specs again: 41 of 41.

Not verified: macOS and Windows (the profile is read from the file the status bar reads there).

Merged into main (2026-10-24). Symbiote's first merge failed its checks on `shell.spec`'s keys
test (217 of 218): the race V44 fixed on `main` at the same time (`b447ce3`, ArrowDown before the
second card was listed). Measured here before that fix: 15 of 64 runs on 8 workers failed at
ArrowDown; a probe found 1 card listed at the key in 21 of 64. With the wait, a second, rarer
cause, **not fixed**: a workspace's terminal takes the focus once it has opened
(`AgentTerminal.tsx`, `shown.focus()` at the end of its setup), even after a click elsewhere, so
the next key goes to the agent. 1 of 64 runs lost its `h` at line 154 that way; a variant of the
test without `h`, `s`, `h` before `w` lost its `w` in 20 of 256, the terminal focused each time.
