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
