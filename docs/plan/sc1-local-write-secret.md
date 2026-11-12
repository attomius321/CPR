# SC1 — A per-run secret for symbiote view's writes, the Confirm and Nucleus's identity

[Index](../PLAN.md) · [Journal](../journal/sc1-local-write-secret.md)

**Status:** built, ready for review (2026-11-12), on branch `feature/sc1-local-write-secret` (the
workspace's, from `main` at d2abb65); planned 2026-11-06 by the improvement audit
(`chore/improvement-audit`). Decision 930 as built differs from its first text: a header and the
page's storage, not a cookie (the person's choice, 2026-11-12); see "As built".

## The brief

**Kind** milestone · **Branch** `feature/sc1-local-write-secret` · **Size** M · **Depends on**
none · **Plan** P04 of 51 (the audit's order)

**What to change**: today any process on this machine that can run `curl` can do what the page
does in `symbiote view`. That includes answering the person's Confirm on a start, a merge or a
clean-up, and calling Symbiote's MCP as Nucleus, which skips the Confirm when "Start workspaces
without a Confirm" is on. Writes, the Confirm's answer and Nucleus's identity must need a secret
the server hands out per run, through a way an agent does not find by calling the API.

**Where to look**:
- `packages/cli/src/server.ts`:
  - `writable` and `sameSite` (`:2321-2333`)
  - `/api/mcp/asks` and `/api/mcp/answer` (`:795-805`)
  - `callerOf` (`:832-840`)
  - the page's index (served from memory, `:649`)
  - `/api/events/ping` (`:490`)
- `packages/cli/src/mcp-bridge.ts:120-130`: the bridge's headers (`x-symbiote-caller: nucleus` from
  `--as`).
- `packages/cli/src/page-agent.ts:433`: Nucleus's bridge arguments, written to
  `symbiote/nucleus-mcp.json`.
- `packages/cli/src/mcp.ts:1402-1410` (`startsAtOnce`).
- `packages/cli/src/events-ping.ts:72`: the agents' hooks.
- `packages/viewer/src/ui/http.ts:3` (`WRITE_HEADERS`) and every inline copy of it
  (`diff/store.ts:31`, `diff/comments.ts:255`).
- The desktop app's `--url` (`packages/desktop/src/main.ts`) and the nexus's frames (`NX7`).

**Out of scope**:
- The nexus's own server (NX7, built after this).
- Isolation from a process that reads another process's memory, arguments or files as the same
  user; decision 932 says what SC1 claims.
- Reads (`GET`): unchanged.

**Done when**:
- `curl -X POST …/api/mcp/answer` with the custom header and no Origin answers 403.
- `GET /api/mcp/asks` from `curl` answers 403.
- An MCP call with `x-symbiote-caller: nucleus` but no Nucleus token is an agent's call.
- The page, the desktop window, the nexus's frames, the bridge and the hooks work as today: every
  e2e passes.

## Problem

Measured by the audit, on its own `symbiote view` (2026-11-06):

```
curl -s -o /dev/null -w '%{http_code}' ${U}api/mcp/asks                     → 200
curl -X POST -H 'x-symbiote: 1' -H 'content-type: application/json' \
     -d '{"id":"nope","yes":true}' ${U}api/mcp/answer                       → 404 {"error":"no ask nope"}  (the gate let it through)
same, with -H 'origin: http://evil.example'                                 → 403 forbidden
```

- **Browsers are kept out**: the Host allow-list, `Sec-Fetch-*`, the custom header and no CORS
  stop cross-site requests and DNS rebinding.
- **Local processes are not**: a missing Origin counts as the page's own (`sameSite`). A workspace's
  agent runs with Bash as the same user, so `GET /api/mcp/asks` then
  `POST /api/mcp/answer {id, yes:true}` approves its own `start_workspace`, `clean_workspace` or
  merge.
- **Nucleus's identity is one header**: `x-symbiote-caller: nucleus` (`callerOf`). Its bridge's
  arguments (`--as nucleus --view …`) are written to `symbiote/nucleus-mcp.json`, which any agent
  can read and run.

## Goal

- Writes from the page, and the Confirm's answer above all, need a page secret that the server
  never serves to a process that did not open the page.
- MCP calls need a bridge secret, and Nucleus's calls need a Nucleus secret.
- What the person sees does not change: the page, the window, the nexus and the agents' tools work
  as today.

## The secrets

- **Page secret** (one per run, never written to disk):
  - `symbiote view` makes it at start and hands it out only in the address it opens: the
    browser, Symbiote's window or the printed URL with `--no-open`, as `…/#k=<secret>` (a fragment,
    never sent in a request's line or logged).
  - The page's first script trades it once, with `POST /api/session {k}`, for an HttpOnly,
    `SameSite=Strict` cookie, then removes the fragment with `replaceState`.
  - Writes and `/api/mcp/asks|answer` need the cookie.
  - A page opened without it (a bookmark, a second tab) reads as today and asks "Open from
    Symbiote" before its first write. Its Retry asks the server for a fresh open: the window, or
    a new address printed.
- **Bridge secret**: written in the view record (`<cache>/views/<hash>.json`, mode 0600) next to
  the URL the bridge already reads there. It lets `/api/mcp` calls through and nothing else: no
  page writes, no Confirm answers.
- **Nucleus secret**:
  - Symbiote passes it to Nucleus's own process only, in the MCP config's `env` for
    `SYMBIOTE_NUCLEUS_KEY`, written to the cache (0600), no longer to `symbiote/nucleus-mcp.json`.
  - The bridge sends it.
  - `callerOf` treats `via: 'nucleus'` as true only with it; `x-symbiote-caller` alone is an
    agent's.
- **Hooks**: `/api/events/ping` stays open. It only wakes the stream, and the hooks run in agents'
  shells.

## Clients to change

- **The viewer**: one `writeHeaders()` in `ui/http.ts`, which sends nothing new because the cookie
  goes with each request. Remove the three inline copies.
- **The desktop app**: it opens `--url` with the fragment and keeps the cookie in its session; the
  `choices` copy is unchanged.
- **The nexus's frames**: the nexus reads the view record, which holds the bridge secret, not the
  page secret. So a framed view asks the view for an open address
  (`GET /api/open?bridge=<bridge secret>` → a one-time page token). Same-user readable, by design:
  decision 932.
- **`symbiote mcp`** and Nucleus's bridge: send their secrets as `x-symbiote-key`.

## Verification

1. **Unit** (red before), `packages/cli/test/server-*.test.ts`:
   - a write without the cookie → 403;
   - `/api/mcp/answer` with the bridge secret → 403;
   - `/api/mcp` with it → 200;
   - `x-symbiote-caller: nucleus` without the Nucleus secret → `via` is an agent;
   - `POST /api/session` with a wrong `k` → 403, and a second use of the same `k` → 403.
2. **e2e**: `startSymbiote` (`packages/viewer/e2e/symbiote.ts:89`) opens the printed address with
   its fragment. Every spec passes unchanged otherwise. A new spec: a tab opened on the bare address
   reads, and its first write says "Open from Symbiote".
3. **The nexus and the window**: `app.spec.ts`, `nexus.spec.ts`, `folders.spec.ts` pass.
4. **By hand**: the audit's three `curl` lines answer 403, 403, 403.

**Risks**

| Risk | Mitigation |
|---|---|
| A person who opens the printed URL without its fragment can no longer write | Print the full address; the page says how to get a writable one; Symbiote's window and the nexus never show the bare one |
| Every e2e spec breaks at once | Change `startSymbiote` first (SC1a), all specs green before any refusal is turned on |
| The cookie leaks between two views on one host | The cookie name carries the port; `SameSite=Strict`, `Path=/` |
| It is read as full isolation | Decision 932, in `docs/reference/configuration.md` and the area page |

**Order**: the secrets and the e2e harness first, with nothing refused (SC1a). Then the refusals,
one route family at a time (SC1b). Nucleus's identity last (SC1c).

## Milestones

| # | Milestone | Output |
|---|---|---|
| SC1a | Secrets made and handed out; the harness, window, nexus and bridge use them; nothing refused yet | all specs green, the secrets in every request |
| SC1b | Writes and the Confirm's routes refuse requests without the page cookie; MCP without the bridge secret | the audit's `curl` lines → 403 |
| SC1c | Nucleus's identity from its own secret; `nucleus-mcp.json` out of `symbiote/` | a header alone no longer skips the Confirm |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 930 | How the page proves it is the page | **A per-run page key, handed out only by trading a one-time token from the opened address's fragment; kept in the origin's storage and sent as `x-symbiote-key` with every write and the Confirm's reads** (as built; first written: an HttpOnly, SameSite=Strict cookie) | The audit's `curl` reached `/api/mcp/answer` with no Origin; a fragment is never sent or logged. A cookie of `127.0.0.1` goes to every port of it (RFC 6265 §8.5): a dev server an agent runs, opened in the same browser, would get it; storage is per origin, port included |
| 931 | Who is Nucleus | **The caller whose bridge sends the Nucleus secret, given to Nucleus's process alone; `x-symbiote-caller` no longer decides** | `nucleus-mcp.json` with `--as nucleus` is readable and runnable by any agent |
| 932 | What SC1 protects | **The API: no documented or discoverable HTTP call answers a Confirm or acts as Nucleus. A same-user process that reads files, process arguments or memory is not kept out, and the docs say so** | Agents run as the person's user; full isolation needs another user or a sandbox, a later step |

**Not in SC1 (later)**: running agents as another user or in a sandbox that cannot reach
127.0.0.1; the nexus (NX7); signing the records Symbiote writes in `symbiote/`.

## As built (SC1)

The person's choices at the plan's OK (2026-11-12): Q1 a header, not a cookie; Q2 a known key
for the e2e harness; Q3 the nexus's frames through a write of the nexus's, its gap until NX7 said.

- **A header and the page's storage, not a cookie (decision 930 as built).** Cookies are not kept
  apart by port, so an agent's dev server on `127.0.0.1` opened in the same browser would receive
  a cookie of Symbiote's. The page trades the fragment's token (`POST /api/session {k}`) for the
  page key, keeps it in `localStorage` (per origin, so per port) and sends it as `x-symbiote-key`
  through one `write()`/`pageHeaders()` in `ui/http.ts`; the ten files that built their own
  headers use it. A failed trade (a reload of the opened address) keeps the stored key.
- **Tokens, one each.** `server-keys.ts` keeps at most 20 open tokens, each traded once. The
  window or browser tab Symbiote opens and the printed line each get their own; a tab's
  **Open again** (`POST /api/session/again`, bare, once per 3 s) opens a fresh one in the
  browser when the run opened the browser, else prints it. `GET /api/session` says `{ page }`.
- **The refusal says why.** A write shaped as the page's (JSON, `x-symbiote: 1`, own origin) but
  without the key answers 403 with `x-symbiote-refused: key`; the page shows **Open from
  Symbiote** (`ui/KeyNotice.tsx`), on load when `GET /api/session` says `page: false` too. Any
  other refusal stays a bare `forbidden`.
- **Open without a key**: `/api/events/ping` (the hooks) and `/api/logs` (a tab that reads only
  reports its errors too), through `writtenOpen`. Reads stay open, but for `/api/mcp/asks` and
  `/api/workspaces/shells` (which already needed the page's header).
- **The stream no longer carries the asks.** `/api/events` is a read anyone may open; its `asks`
  part is now `{ changes: n }`, and the page reads `/api/mcp/asks` with its key when it changes.
  Decision 996 (MC3) said the asks go "through `/api/mcp/asks` and the stream"; the stream now
  only signals them.
- **The bridge key** is in both records, `<cache>/views/<hash>.json` and
  `<cache>/running/<pid>.json`, written 0600. `/api/mcp` needs it and nothing else takes it. The
  nexus reads it from the running record only (`recordKey`), never as part of a `Running`, so
  `GET /api/symbiotes` never serves it. The nexus asks a view for a frame's token with
  `POST /api/session/open` (a POST, not the plan's `GET ?bridge=`: no key in a URL), behind its
  own write `POST /api/symbiotes/open {url}`, listed in `WRITES` so NX7's key covers it.
- **Nucleus's key** goes to its bridge in the MCP server's `env` (`SYMBIOTE_NUCLEUS_KEY`): in
  Claude Code's MCP file, now `<cache>/mcp/<hash>/nucleus-mcp.json` (0600; the old
  `symbiote/nucleus-mcp.json` is removed at the next start), and in Codex's `mcp_servers`. The
  bridge sends it as `x-symbiote-nucleus`. `x-symbiote-caller` no longer decides (a bridge from
  before NU1 saying `scout` is an agent's now, decision 590's reading ends here).
- **The e2e harness (Q2).** `startSymbiote` gives every server `SYMBIOTE_PAGE_KEY` and
  `SYMBIOTE_NUCLEUS_KEY`; the viewer's Playwright config sends the page key with every request,
  so 75 specs are unchanged. `symbiote view` reads both at start and takes them out of its
  environment and `process.env` (`runKeys`): no agent or terminal it starts inherits them.
  The real path is the specs': `page-key.spec.ts` (the bare tab, the opened address, its token
  used once), the window's `app.spec.ts` (opened with a fresh token, its key checked), the
  nexus's frames (`nexus.spec.ts` checks a framed page holds a key), `nucleus.spec.ts` (the MCP
  file in the cache, 0600, with the key).
- **Logs and output carry no token**: the window's `Symbiote window:` line and its log lines strip
  the fragment (`withoutFragment` in `policy.ts`); `symbiote view` logs the bare address.
  `scripts/viewer/diverged-diffs.mjs` trades its printed token before it posts.

## Results (SC1)

- **The audit's lines, on this branch's own `symbiote view`** (a scratch repository, its own
  cache; main measured the same way first, 2026-11-12):

  | Request | main d2abb65 | this branch |
  |---|---|---|
  | `GET /api/mcp/asks` | 200 | 403 |
  | `POST /api/mcp/answer`, `x-symbiote: 1`, no Origin | 404 (through the gate) | 403 |
  | the same with `origin: http://evil.example` | 403 | 403 |
  | `POST /api/mcp`, `x-symbiote-caller: nucleus` | 200, as Nucleus | 403 |
  | the same with the bridge key | — | 200, an agent's call |
  | `POST /api/mcp/answer` with the bridge key | — | 403 |
  | `POST /api/events/ping` (the hooks) | 204 | 204 |

  `GET /api/events` sends `"asks":{"changes":0}`. Both records are `-rw-------`.
- **Tests**: 3,684 unit tests (`pnpm check`), new: `server-keys`, `server-session` (10, the three
  refusal families red first with the refusals switched off), `page-opener`, `frame-address`,
  `page-key` (viewer), the bridge's headers, the records' key and mode, Nucleus's MCP file.
  `pnpm test:e2e`: viewer 488 passed (`app.spec.ts` and the new `page-key.spec.ts` included),
  nexus 32 passed. The route table changed by one row in each table with an MCP:
  `GET /api/mcp/asks → 403`.
- **Not verified**: a real Nucleus, Claude Code or Codex, reaching its tools with the new MCP file
  (it writes main's `symbiote/`; the fake Claude Code's start and the real bridge in `mcp.spec.ts`
  with the key cover the path); a browser on Windows framing a WSL view through the nexus.

