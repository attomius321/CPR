# Journal: IS1 — An Issues page: the repository's GitHub or GitLab issues, read only

[Index](../JOURNAL.md) · [Plan](../plan/is1-issues-page.md)

## IS1 spike — both forges' issues, read only (2026-11-08, branch `feature/issues-page`)

GitHub's API on vitejs/vite (open) and sindresorhus/ky (all), with and without the person's
`gh` token, and gitlab.com's on gitlab-org/gitlab-runner, without a token: a list page, one
issue's comments, a conditional read, a title search. Nothing was written.

**Learned**:
- **Most of GitHub's issue list is pull requests**: 64 of vite's first 100 open items, 55 of ky's
  100. A page of issues takes several API pages, so the page asks for 30 and reads up to 3.
- **GitHub pages by a cursor**: the `Link` next carries `after=`, so paging follows the `Link`,
  not a page number.
- **GitLab's notes need a token**: the list reads without one, an issue's notes answer 401.
- **A 304 costs nothing**: `x-ratelimit-remaining` 4995 before and after a conditional read.
- **Issue bodies hold HTML**: 20 of 36 vite issues, 16 of 50 gitlab-runner's (6 `<details>`,
  2 `<img>`, 6 HTML comments). Shown as text it would read badly; it is stripped to its text.
- **GitLab's search is slow**: 4.2 s for a title search against 1.0 s for a list.
- CPR has 0 issues; its endpoint lists HV8's pull request alone.

## IS1 — the forge reads issues, `/api/issues`, the Issues page (2026-11-08, branch `feature/issues-page`)

`listIssues` and `getIssue` on the `Forge` interface for both forges, a service and two routes in
`symbiote view`, and the Issues page at `/issues` (key `u`): the list, its state and search, Load
more, one issue with its comments and its link. Decisions 944–952.

**Learned**:
- **Recorded responses caught the test, not the code**: the recorded list's first three items are
  pull requests; tests that took `[0]` as an issue failed until they took the first issue.
- **A changed address is not a new forge**: the service keeps origin's forge 30 s, so a test that
  served a second fake API at a new address was still asking the first.
- **`<script>` text reads as the issue's**: dropping tags kept their text, and a script's text
  showed as a line. Scripts and styles go whole now, inline too (their tags are separate tokens
  there, the text between them).
- **The targets check found the head's link**: a link in a page's line is 19 px high, under the
  24 px WCAG asks. It became a button among the head's actions.
- **GitLab's labels**: 9 to 12 a row on gitlab-runner. A row shows 4 and +N.
- **Conditional reads hold up for real**: 6 repeated reads on vite cost 0 of the rate limit.

**Verification**: tests first, red for the right reason (the methods missing; the issue text's 6
of 7 failing with its handling turned off). `pnpm check`: 3,457 tests passed. `pnpm build`.
`e2e/issues.spec.ts` 7 passed. The full e2e: 434 of 438 passed. Two failures were this branch's:
`shell.spec.ts` and `workspace-history.spec.ts` count the sidenav's pages (Issues is the sixth,
History the seventh now), fixed and passing. Two are not: `changes.spec.ts:139` and
`hermes.spec.ts:29` pass alone, and fail under `--repeat-each=3` on this branch and on a
`git archive` export of `main` alike (5 of 18 and 3 of 18 runs on `main`). Real, read only: vite (with a token),
gitlab-runner (without one) and CPR through the built `symbiote view`; numbers in the plan's
results. Screenshots in both themes and at each text size.

Not verified: GitHub Enterprise and self-managed GitLab (their API addresses are the pull
requests' and are unit-tested there); GitLab with a token on a real project (no token here: the
notes and the role are tested on recorded shapes and the fake forge); a real rate limit used up
(tested on a 403 made in GitHub's shape).

