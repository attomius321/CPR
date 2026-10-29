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

## NU1 — Nucleus: Scout renamed, the agents' web tools, Scout's names still read (2026-10-29, branch `feature/nucleus`)

Scout's code was renamed first, with no behaviour change: identifiers through TypeScript's AST,
comments' "Scout", never strings (`page-agent.ts` and `nucleus.ts` in the CLI, `page-agent.ts` in
core, `nucleus/` in the viewer; the classes Scribe's pane shares became `page-agent-*`). Then the
tests, red, then the behaviour: the page Nucleus at `/nucleus`, its files, keys and `via`; Claude
Code's WebSearch and WebFetch through the gate with `--web`, Codex's `web_search: "live"`;
`nucleus.web`; Scout's record, keys, `via`, bridge caller and hook read. Decisions 589–595.

**Learned**:
- **A rename by AST still renames data.** Object keys in tests that stood for JSON on disk
  (`{ prompts: { scout: … } }`, `{ scout: { effort } }`) were identifiers to the parser:
  renamed, they would have tested the behaviour before it was built. A diff of every `scout:` key
  the script changed found 13; typecheck found only the ones tied to a type (`PromptKey`,
  `McpVia`, Settings' agents).
- **The person's settings were Scout's**: this repository's committed `symbiote/config.json` has
  `scout: { effort: xhigh, model: opus }`, and the real Nucleus started on opus at xhigh from them.
  A save in Settings moves them; nothing else rewrites the committed file.
- **Running a worktree's view without touching `symbiote/`**: with no `user.email`, reviews and
  page agents' records go to Symbiote's cache. `GIT_CONFIG_GLOBAL=/dev/null` and a job-local
  `SYMBIOTE_CACHE_DIR` kept the real run off the person's live Scout record; only a copy of it was
  read.
- **npmjs.com answered 403 to both agents' page reads**; Claude Code's Nucleus read
  `registry.npmjs.org/vite/latest` instead, Codex's said it could not check. Both named pages.
- **A resumed Claude Code session reconnects its MCP server**: the turn right after a wake said
  "Symbiote's tools are reconnecting right now". The next turn had them (the gate test's).

**Verification**: tests first, red for the right reason (48 CLI, 8 viewer, `nucleus.spec.ts` 10
of 10 on the old build), then `pnpm check` 2,288 tests, build, e2e 343 of 343 and the nexus 15 of
15; after `main` (V79) was merged in, `pnpm check` 2,290, e2e 343 of 343, the nexus 15 of 15.
Real runs in this repository's worktree (the plan's Results): the person's Scout conversation read as Nucleus's; a web answer in 47 s on
Claude Code (1 search, 5 pages) and 9.1 s on Codex (2 searches, 2 pages); a write declined, the
gate refusing `echo >` and `curl`, no Write tool; New conversation over a Scout record in 1.6 s.
Screenshots of the page with the note, 1440×900 dark and light and 390 px.

Not verified: the person's own Scout conversation ended by New conversation (read only, by
choice); a Codex Scout thread with the real Codex; Codex's terminal on Nucleus's thread; WebFetch
to an address on the person's network; macOS and Windows; the docs' reader test.
