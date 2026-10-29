# Journal: Fix — security and bugs across the app

[Index](../JOURNAL.md)

## Fix — eight problems found by inspection and reproduced (2026-10-29, branch `feature/security-and-bugs`)

The person asked for every security issue and bug across the app, each reproduced. The servers
(the viewer's, the nexus's), the desktop window, the agents' launches and gates, git's arguments,
the forges, the action and the CI template, the installer and the logs were read; seven problems
were reproduced on a scratch repository with a `symbiote view` of its own cache, an eighth (the
gate) shown on the built module. Plan-first: the plan was the OK'd message, the forge's rule its
option A. One commit each, `Fix: …`.

| # | What | Before | After |
|---|---|---|---|
| 1 | Two saves of one file at once shared `<file>.<pid>.tmp` (13 writers) | 8 review saves at once, 20 rounds: 134 of 160 answered 500, 8 rounds read back broken; drafts 42 of 60 answered 500 | 160 of 160 answered 204, 0 broken; drafts 60 of 60 |
| 2 | `symbiote pr` sent GITHUB_TOKEN/GITLAB_TOKEN to any host whose name holds "github"/"gitlab" | `Bearer ghp_…` to `github.com.evil.example`, the GitLab token to `gitlab.attacker.io` | no token to either |
| 3 | Any site could frame Symbiote's pages | Chromium: `/git` framed from another site, 20 buttons, a write from the frame 200 | refused from evil.example (`chrome-error`); the nexus still frames |
| 4 | Claude Code read a prompt or reply starting with `-` as an option | `"- also fix the tests"`: session woke idle, exit 0; `"--version"` ran the flag | after `--`: Claude Code shows it as the prompt |
| 5 | Scout's and Scribe's gate let files outside the repository be read | `\| tail ~/.bashrc`, `\| grep -r … /home`, `blame --contents=` allowed | refused, with blame's `--ignore-revs-file`, `-S`, grep's `-f` |
| 6 | Another site's image or script could start work with a GET | `GET /review/main/` (no headers): 200, analysis started | 403 for cross-site; a link followed and this machine's pages served |
| 7 | A broken `%` in a path | 500 `URIError: URI malformed` | 400 `not a path` |
| 8 | A body over its limit was cut before the refusal | 2 MB POST: no answer (curl exit 56), "review too large" everywhere | 413 `a request of at most 1 MB` |

**Learned**:
- **The servers' existing rules held.** Every request must name the server as its host (DNS
  rebinding); a write needs JSON, `x-symbiote: 1` and its own origin; about 25 endpoints answered
  400 to every malformed body sent; static files and `/api/source` stay in their folders; git's
  arguments are SHAs checked, `--` and `check-ref-format`. What got through was around them: the
  frame, a plain GET, the forge's host, and the shape of an agent's argument list.
- **A temporary name must be the write's own, not the process's.** `<file>.<pid>.tmp` is unique
  between processes but shared by two writes in one; the server answers concurrent requests, so
  the second write's rename found no file (ENOENT, 500) and the first's could land half-written.
  `writeFileWhole` (`packages/cli/src/file-write.ts`) names it with 6 random bytes, hidden beside
  the target. The desktop's state (synchronous) and the nexus registry (one file per process) cannot
  overlap and keep their way.
- **A remote's host is the repository's to name.** The forge is still told by the host, but a
  token from the environment goes only where the environment says it is for: github.com,
  `GITHUB_SERVER_URL` (Actions), `GITHUB_API_URL` when set (the requests then go there), and
  `GH_ENTERPRISE_TOKEN` to `GH_HOST`'s host, as gh has it; else gh's token for exactly that host.
  GitLab: gitlab.com, `CI_SERVER_HOST`, `GITLAB_API_URL`, `GITLAB_HOST`; the job token to CI's
  server or `GITLAB_API_URL`. A GitHub Enterprise user who only set `GITHUB_TOKEN` is now told what
  to set (`authentication failed (set GH_ENTERPRISE_TOKEN with GH_HOST=…)`).
- **This machine's pages are another site to the browser.** The nexus frames each Symbiote at
  127.0.0.1, and `localhost` and `127.0.0.1` are two sites: `frame-ancestors` names both with any
  port, and the cross-site refusal serves a request whose `Referer` is a page on this machine (a
  page cannot set its own). The first in-browser check used a `localhost` page as the "other
  site" and could not tell the fix from the bug; `--host-resolver-rules=MAP evil.example
  127.0.0.1` gives Chromium a real other site, and a page without the header frames from there.
- **Claude Code's options.** Its command line takes `-x`-looking words as options anywhere before
  `--`, also `--name=value` in one word. `--bg --resume <id> "<text>"` with option-like text wakes
  the session idle and exits 0. Injected `--settings` and `--mcp-config` (a hook or a server
  that touches a file) did not run in an idle background session; not counted on. MCP's `reply`
  stays unasked (decision 360): the text is now only a message. Codex already passed `--`, Hermes
  `--query=`.
- **The gate's filters read files too.** `head`, `tail`, `wc` and `grep` after a pipe take files
  as operands, `~` expands, and grep recurses; git's `blame --contents` prints any file, and
  `--ignore-revs-file` and blame's `-S` print its first line in their error ("fatal: invalid object
  name: <line>"). git bundles short options (`-wS`), as the `-O` rule already knew.
- **Not changed, for the person to know**: a repository's `symbiote/config.json` runs code
  (`plugins` paths are imported, `merge.checks` are shell commands), so Symbiote on an untrusted
  clone runs that clone's code, as `npm install` would. The action is safe with `on: pull_request`,
  as the guide says; it must not run on `pull_request_target` with the pull request's code.

**Verification**: each fix's failing test first (a state store taking 20 writes at once; the
token rules; both servers' headers and cross-site refusals; the three launches' `--`; 20 new gate
refusals; 400 and 413), then the reproduction rerun on a built `symbiote view` or in Chromium
(numbers in the table). Claude Code 2.1.312 checked live with an unknown model, so no turn ran.
`pnpm check`: 2,245 tests in 162 files (2,204 in 161 before). `pnpm build`, then `pnpm test:e2e`:
the viewer's 338 specs in 5.0 min, the nexus's 15 in 17.1 s. No analysis change: the regression
comparison was not run.
