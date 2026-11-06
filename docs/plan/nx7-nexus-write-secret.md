# NX7 — The nexus's writes behind a per-run secret

[Index](../PLAN.md) · [Journal](../journal/nx7-nexus-write-secret.md)

**Status:** planned (2026-11-06), to be built on branch `feature/nx7-nexus-write-secret` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

## The brief

**Kind** milestone · **Branch** `feature/nx7-nexus-write-secret` · **Size** M · **Depends on** P04
(SC1: the same scheme, built first) · **Plan** P05 of 51 (the audit's order)

**What to change**: the nexus serves on a fixed, known port (7347, decision 923). Its writes need
only `x-symbiote: 1`, a JSON content type and no Origin, so any local process can:
- start or stop a Symbiote;
- pin folders;
- rescan home;
- run `git init` in a folder with `POST /api/symbiotes {"folder":…,"init":true}`, without the
  person's yes.

Decision 928's yes is enforced by the page alone. Put the nexus's writes behind a page secret, as
SC1 does for `symbiote view`.

**Where to look**:
- `packages/nexus/src/server.ts`:
  - `WRITES` (`:75`), the four write routes
  - `writable` (`:214-222`)
  - the page's index (`page/index.html`, filled by the server)
- `packages/nexus/src/init.ts:79-94` (`init: true`)
- `packages/nexus/src/main.ts:210-240`: a second `symbiote-nexus` opens the running one
- `packages/nexus/src/app-window.ts`: the window's `--url`
- `packages/nexus/src/page/main.ts`: every `fetch` with `x-symbiote`

**Out of scope**:
- `symbiote view`'s secret (SC1).
- Reads (`GET /api/folders` lists any folder, as today: a separate question, listed in
  "Not in NX7").
- The nexus's frames of Symbiotes: SC1 decides how a framed view gets its page secret.

**Done when**:
- `curl -X POST -H 'x-symbiote: 1' -H 'content-type: application/json' -d '{"folder":"/tmp/x","init":true}' http://127.0.0.1:7347/api/symbiotes`
  answers 403.
- The page, a second `symbiote-nexus` and the window work as today: every nexus e2e passes.

## Problem

From the audit (finding N4: Code, the same gate S1 reproduced on `symbiote view`):

- `packages/nexus/src/server.ts:214-222` is a copy of `symbiote view`'s `writable`: a missing Origin
  counts as the page's own.
- On `/mnt/c` or any folder, `POST /api/symbiotes {"folder":…,"init":true}` runs `git init` (no
  commit) with no question asked. The question is drawn by `page/main.ts` only.
- Since NX6 the port is 7347 for everyone, so finding the nexus takes no search.

The audit did not run the `curl` against a nexus: its own ran on `--port 0`, and running `init`
would write into a folder. The code path is the same as S1's reproduced one.

## Goal

The nexus's four write routes need a page secret that only the nexus's own opener hands out.
What the person sees is unchanged: the window, the browser tab and a second `symbiote-nexus`
opening the first.

## The secret

- **Made at start**, never served. It is handed out in the opened address's fragment (`#k=…`) and
  traded once with `POST /api/session` for an HttpOnly, `SameSite=Strict` cookie whose name holds
  the port. This is decision 930's scheme, the same code if SC1 puts it in a shared module (the
  nexus already shares `registry.ts` with the CLI).
- **A second `symbiote-nexus`** (`main.ts`) needs a fresh address for the running one. It reads a
  one-time open token from `<cache>/nexus/open.json` (0600), written by the running nexus at start,
  and asks `GET /api/open?token=…` for a new fragment. Same-user readable, as decision 932 says.
- **`git init`** also needs a nonce the server gives with its 409 `init` answer, sent back with
  `init: true`. A replayed or invented `init: true` is then refused even with the cookie.

## Verification

1. **Unit** (red before), `packages/nexus/test/server.test.ts`:
   - each of `WRITES` without the cookie → 403;
   - `init: true` without the 409's nonce → 403;
   - with the cookie and the nonce → `git init` as today.
2. **e2e**: `e2e/nexus.ts`'s `startNexus` opens the printed address with its fragment. Every spec
   passes, `explorer.spec.ts`'s `git init` question too.
3. **By hand**: the `curl` in "Done when" answers 403 on a `--port 0` nexus of the spec's own.

**Risks**

| Risk | Mitigation |
|---|---|
| A bookmark of `http://127.0.0.1:7347/` can no longer write | The page says so and offers "Open from Symbiote" (runs `symbiote-nexus` again: decision 924's second start) |
| The window's `--url` loses the fragment through Electron's navigation | `app.spec.ts` covers the window; the app keeps the cookie in its session |

**Order**: after SC1 has merged; the shared module first, then the routes.

## Milestones

| # | Milestone | Output |
|---|---|---|
| NX7a | The secret made, handed out and traded; the harness and a second start use it; nothing refused | all nexus specs green |
| NX7b | The four write routes refuse without the cookie; `init` needs the 409's nonce | the `curl` in "Done when" → 403 |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 933 | The nexus's writes | **Decision 930's page secret for the nexus's four write routes; a second start gets a fresh address through a one-time token in `<cache>/nexus/open.json`** | The fixed port (923) makes the nexus the easiest local target; one scheme for both servers |
| 934 | `git init` | **`init: true` needs the nonce the 409 answer gave, used once** | Decision 928 says "only after the person's yes"; the nonce ties the write to a question the page showed |

**Not in NX7 (later)**: limiting what `GET /api/folders` lists (today any folder the user can read,
like `ls`); signing the records under `<cache>/running/`.
