# Fix — Timeouts on forge calls and the merger's push

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S4)

> What holds now: [The merger](../area/merger.md). This plan is kept as it was written.

**Status:** planned (2026-11-06), to be built on branch `fix/network-timeouts` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/network-timeouts` · **Size** S · **Depends on** none · **Plan** P13 of
51 (the audit's order)

## The brief

**What happens**: two network calls have no limit.
- **Every forge API call**, in `symbiote pr`, `--post-findings` and Hive's pull-request polling.
  Its `fetch` has no `AbortSignal`, so a stalled GitHub or GitLab holds it until undici's 300 s
  header timeout, and longer while a body trickles in.
- **The normal-mode merger's push** (`pushCommit`). It runs `git push` without the timeout and
  `BatchMode` that Hive's `pushBranch` gets. An ssh prompt (a host key, a passphrase) or a stalled
  network holds the merge queue with no end.

**How to reproduce**:
- **Forge**: point `GITHUB_API_URL` at a local server that accepts and never answers, then run
  `symbiote pr 1 --summary`. It waits about 300 s.
- **Push**: a remote `ssh://` to a host whose key is unknown, with `merge.push: true`. The merge
  stays "pushing", or the terminal running `symbiote view` shows ssh's prompt.

**Where to look**:
- `packages/forge/src/http.ts:12-60`: `api<T>`, `fetch` with no `signal`.
- `packages/core/src/git/merging.ts:164-175` (`pushCommit`).
- `packages/core/src/git/sync.ts:30` (`NETWORK_MS = 120_000`) and `:42-50` (`network(repo)`: the
  timeout, and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'` unless the person set their own).
- `packages/cli/src/merges.ts:1011`: `(hive ? pushBranch : pushCommit)`.
- `packages/core/src/git/exec.ts:46-50`: `git()` takes `{ timeout, env }`.

**Out of scope**: shape checks of the forge's answers (P45); retrying; any other git network call
(they already use `network()`).

**Done when**:
- A forge call that does not answer within 30 s fails with "GitHub did not answer within 30 s"
  (the forge's name). `symbiote pr` exits 1 with it.
- `pushCommit` runs with `network(repo)`: an ssh prompt fails at once with git's words, and a
  stalled push fails after 120 s. The merge entry says why (with P14, its log line too).

## Evidence

Code (finding S4), read on `main` c2aa5c4:
- `http.ts:18` calls `fetch(url, { method, headers, body })` with no `signal`.
- `merging.ts:171` calls `git(repo.root, ['push', '--quiet', remote, …])` with no options.
- `sync.ts:42-50` shows what Hive's pushes get. The audit did not run a stalled server.

## Approach

- `http.ts`: `signal: AbortSignal.timeout(FORGE_MS)` with `FORGE_MS = 30_000`. A `TimeoutError`
  becomes a `ForgeError` naming the forge and the time. Let callers pass a longer limit where an
  upload needs one; none does today.
- `merging.ts`: export `network` from `sync.ts` (or move it next to `git()` in `exec.ts`), and pass
  its options to `pushCommit`'s `git` call.

## Tests first

- `packages/forge/test/requests.test.ts`: with a `node:http` server that never answers, and the
  limit set to 100 ms through an exported seam, `api()` rejects with the forge's name and the time.
  It hangs today: give the test a 2 s vitest timeout, so it fails rather than hanging.
- `packages/core/test/merging.test.ts` (new): `pushCommit` to a remote whose push command sleeps,
  through `GIT_SSH_COMMAND` or an `ext::` remote, fails within the limit, set short through the
  seam.

## Verification

- `pnpm check`, `pnpm build`.
- `pnpm test:e2e`: `pr.spec.ts` and `merges.spec.ts` (the fake forge answers at once: unchanged).
- By hand: the "How to reproduce" server, before (300 s) and after (30 s).
