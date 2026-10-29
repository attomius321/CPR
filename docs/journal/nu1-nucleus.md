# Journal: NU1 — Nucleus: Scout renamed, with network access

[Index](../JOURNAL.md) · [Plan](../plan/nu1-nucleus.md)

## NU1 spike — what the agents' web tools do in Scout's modes (2026-10-29, branch `feature/nucleus`)

Read on `main` at `3af5243`: Scout's code (`scout.ts`, `scout-gate.ts`, `scout-hook.ts`, `mcp.ts`,
`prompts.ts`), its plans (V35, MC1, V50, V52, V78) and what is on disk in this repository's
`symbiote/`. Measured in a scratch folder under the job's tmp, no repository: Claude Code 2.1.312
(`claude -p --model haiku`, Scout's flags with WebSearch and WebFetch added, a PreToolUse hook
logging each call and answering `allow` for the two), and Codex 0.163 (`codex exec -s read-only`,
and `codex app-server` on stdio with a thread started as Scout's: `sandbox: read-only`,
`approvalPolicy: never`). Two Claude Code runs ($0.017 in all) and four Codex turns.

**Learned**:
- **Codex already searches the web in Scout's thread.** With nothing in the person's
  `config.toml`, a read-only thread (`{"type":"readOnly","networkAccess":false}`) ran a
  `webSearch` and answered in 7.2 s; `codex exec` did the same in 9 s. Its shell had no network
  (`curl`: "Could not resolve host"). So NU1 sets `web_search` in the thread's `config` rather
  than relying on the default, and the sandbox is not touched.
- **Without search, Codex's model made an answer up.** With `web_search: "disabled"` it gave
  "pnpm 12.15.0" and a release URL it could not have checked, where it was asked to say "no web
  search". Nucleus's prompt asks it to say what it could not check.
- **WebFetch connects from this machine, to any address.** Asked for `http://127.0.0.1:47811/`, it
  upgraded to `https` and the local server got a TLS handshake (not an HTTP request: its log stayed
  empty), so the failure was "WRONG_VERSION_NUMBER", not a refusal. `file:///etc/hostname` was
  "Invalid URL" in Claude Code itself. Public JSON APIs read fine by GET (npm's
  `registry.npmjs.org/vite/latest`, GitHub's `releases/latest`).
- **The hook sees `{query, mode}` for WebSearch and `{url, prompt}` for WebFetch**, and its `allow`
  runs them in `dontAsk`, as it runs Symbiote's MCP tools (MC1).
- **When WebFetch failed, the agent reached for `curl`** in Bash; the gate refused it. Keeping Bash
  to git's reads is what keeps the shell off the network on Claude Code.
- **The person's Scout conversation cannot gain the web in place**: a session keeps its start's
  `--tools`, `--settings` and `--mcp-config` (V35). V50's copy would carry its turns over; the person
  chose New conversation instead.
