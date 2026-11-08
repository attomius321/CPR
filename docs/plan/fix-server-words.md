# Fix — The server's refusals in words, never its JSON

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V5)

**Status:** planned (2026-11-06), to be built on branch `fix/server-words` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/server-words` · **Size** S · **Depends on** none (P08, V95, builds on
it) · **Plan** P09 of 51 (the audit's order)

## The brief

**What happens**: three helpers that read JSON throw the server's body as it came. `symbiote
view` refuses with `{"error":"…"}`, so a page that shows the error shows `{"error":"…"}` to the
person. History's picked workspace is one: its message is rendered as is.

**How to reproduce**: in the History page's spec, answer
`/api/workspaces/history?branch=x` with `404 {"error":"no workspace x"}` and open
`/workspace-history?branch=x`. The page reads `{"error":"no workspace x"}`.

**Where to look**:
- `packages/viewer/src/ui/http.ts:27-31`: `getJson` throws `new Error(await response.text())`.
  `serverWords` is 10 lines above it, in the same file.
- `src/history/api.ts:66-70` (`fetchJson`); `src/history/git-api.ts:35-39` (`read`).
- `src/workspaces/WorkspaceHistory.tsx:84-98` (`useSummary`: the message kept and drawn).
- The server's refusals: `packages/cli/src/server.ts:2100-2106`
  (`json(res, error.status, { error: error.message })`).
- The copies that do it right by hand: `history/api.ts:84-90` (`postCheckout`),
  `git-api.ts:76`, `:106`, `diff/comments.ts:261`, `:278`.

**Out of scope**: what pages do with an error (P08, V95); the hand copies' structure (P08 folds
them into one module).

**Done when**:
- `getJson`, `fetchJson` and `read` throw `serverWords(text)`.
- The five hand copies call `serverWords` instead of their own try/parse.
- No page shows a JSON object as its error. `grep -rn "JSON.parse(text) as { error" src` finds
  none.

## Evidence

Code. `http.ts:28` throws the raw text. `server.ts:2106` answers every refusal as
`{ error: message }`. `WorkspaceHistory.tsx:96` stores `(e as Error).message` and draws it. The
audit's probe of `/workspace-history?branch=nope` on an empty repository showed the empty state,
not this path, because the list was empty. Its seeded case was not run.

## Approach

- One line each in `getJson`, `fetchJson` and `read`: `throw new Error(serverWords(await response.text()))`.
- Replace the five hand-parsed refusals with `serverWords`. They give the same words, with less
  code.

## Tests first

- `test/http.test.ts`: a `getJson` case with `fetch` stubbed to answer `404 {"error":"no workspace x"}`
  rejects with `"no workspace x"`. Today it rejects with the JSON.
- `e2e/workspace-history.spec.ts`: a `page.route` answering the history read with
  `404 {"error":"no workspace x"}` shows `no workspace x`, and not the text `{"error"`.

## Verification

- `pnpm check`, `pnpm build`.
- `pnpm test:e2e`: `workspace-history.spec.ts`, `git.spec.ts` and `git-writes.spec.ts`, whose
  refusals pass through these helpers.
