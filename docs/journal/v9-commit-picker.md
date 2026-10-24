# Journal: V9 — Pick two commits

[Index](../JOURNAL.md) · [Plan](../plan/v9-commit-picker.md)

## V9 spike — what picking two commits costs (2026-10-13, branch `milestone/v9-commit-picker`)

Measured on the regression clones before planning a commits page for `symbiote view`. Listing 100
commits with `git log` takes 9–66 ms, even on Bitwarden's 23,236 (628 ms once, with a cold disk).
Analyzing one commit against its parent takes 0.6 s (vite, no TypeScript changed) to 59 s
(Bitwarden with the Angular plugin; 46 s on a second run, with the worktrees made); 20 commits
5.6–87 s. Two consequences for the plan: the page must show progress and keep results, and the
analysis cannot run in the server's process — ts-morph is synchronous, so the server would not
answer for up to 90 s. A child process per analysis is safe to stop: worktree locks hold the
owner's pid and stale ones are recovered.

## V9 — Pick two commits (2026-10-13, branch `milestone/v9-commit-picker`)

`symbiote view` without revisions opens at once on the current branch's commits; two picked (or one
against its parent) are compared directly, analyzed then in a child process, and served at
`/diff/<base>..<head>/`. `symbiote view <base> [head]` analyzes first as before and opens that diff;
`symbiote pr` is unchanged.

**Learned**:
- The viewer already used relative URLs for its API and files (`./api/…`, Vite `base: './'`),
  so serving one viewer per diff under its own path took no change to how it calls the server;
  only the commits page's two endpoints are absolute. Every existing e2e spec passed unchanged
  once `symbiote view HEAD~1 HEAD` opened `/diff/<pair>/`.
- IPC messages from a child arrive while it runs synchronous code (a 1.5 s busy loop delayed
  nothing), so phases sent just before the synchronous parts (extract, references) are
  accurate. On these repos loading is nearly the whole run: the page says "loading base" and
  "loading head" for 93 % of Qwik's 14 s.
- The viewer's stylesheet is flat: `.progress` was already the review sidebar's bar, and the
  progress page's rules would have moved it on every graph page. Check a class name before using
  it.
- A list with `white-space: nowrap` subjects inside the app's grid widened the page to its
  longest subject (Qwik has some): `min-width: 0` on flex items does not lower their min-content
  contribution. `contain: inline-size` on the page does. Short fixture subjects hid it; the e2e
  fixture now has a long one.
- CI failed on macOS only: `src/commits.ts` and `src/Commits.tsx` differ only by case. macOS
  file systems ignore case, so TypeScript resolved `./Commits.js` to `commits.ts` and never
  loaded the component (ESLint: "not found by the project service"). Linux, where every local
  run happened, tells them apart. The component is `CommitsPage.tsx`; a unit test now fails on
  any two tracked names that differ only by case.
- A flaky e2e (1 run in 75): "x" pressed as soon as the rows showed was lost, because the key
  listener for that render was attached in a `useEffect`, after the paint. The commits page
  attaches it in a `useLayoutEffect`, in the same task as the rows; 125 runs then passed.
- Counting "N commits" by rows between the picks is wrong with merges (other lines' commits sit
  between them by date); walking the listed commits' parents gives `git rev-list --count`
  (checked on Qwik: 5 and 5).
- Stop signals the node child only: a `git checkout` it started finishes, so no worktree slot is
  left half checked out, and the slot's pid lock is recovered as stale. Ctrl+C in a terminal is
  different: it reaches git too, and a checkout interrupted mid-way can leave a slot whose HEAD
  is the old commit and whose files are partly the new one; reusing it for the old commit skips
  the checkout. Pre-existing (`symbiote diff` has it), not fixed here.

**Verification**: tests first — `parseLog` (merges, the root commit, refs, a subject holding the
separators), `listCommits` (pages, a tag, a detached HEAD, a repo without commits), `isCommit`;
`onPhase` in order with the same analysis; `Diffs` (one at a time in order, failures kept until
asked again, Stop, close, the last N by use); `childRunner` with a fake CLI (args, phases, the
CLI's message, Stop); the server (`/api/commits` pages, `POST /api/diffs` refusals, 202 → 200,
sources and state per diff, 502, Stop, 404); `symbiote view` without revisions; `src/commits.ts`
(picks, base by list position, one commit, the count with a merge, `api/graph` answers). E2E: five
commits served by `symbiote view` — the list, two picked → "Analyzing" → the graph, a reload kept,
← Commits, This commit, the keyboard, Stop, a diff URL opened anew, no sideways scroll, the
sidebar bar untouched. 464 unit tests (31 new), 45 e2e (5 new). `r1`: 29 comparisons identical
(859 edges, no finding changed), time 0.97 of `main`'s. Real repos (warm, 2 rounds): the URL in
0.58–0.64 s, `/api/commits` 33–166 ms, 100 rows drawn 0.24–0.26 s after opening Qwik; a pair
through the server Qwik 13.8–14.3 s (`symbiote diff` 14.2–15.1 s), Bitwarden 41.6–43.2 s (`symbiote diff`
39.8–40.2 s, +3.5 to +8.4 %); status requests meanwhile 1.8 ms median, 20 ms at most; a kept pair
in 1.4–10 ms. `symbiote view HEAD~1 HEAD` on Qwik to its URL: `main` 13.1–14.5 s, V9 13.2–14.5 s. Not
verified: Windows and macOS.

Merged into main (2026-10-13), after two fixes found at merge time: macOS CI (a component named
like `commits.ts` but for case) and a flaky e2e (a key listener attached after the paint). Left
for later: a ref picker and history search, uncommitted changes as a head, graphs kept on disk;
the pre-existing hazard of a checkout interrupted by Ctrl+C (see above).
