# IS1 — An Issues page: the repository's GitHub or GitLab issues, read only

[Index](../PLAN.md) · [Journal](../journal/is1-issues-page.md)

**Status:** built (2026-11-08), on branch `feature/issues-page` (a workspace started in Symbiote,
from `main` at `c2aa5c4`); the plan OK'd by the person with the three choices as recommended:
public repositories read without a token, the key `u`, an issue's first 100 comments. As built and
results under "As built (IS1)" below.

**Problem** (asked: "A new **Issues** page in `symbiote view` … the issues of the repository's
GitHub or GitLab (origin's forge), read only"). Symbiote reads pull and merge requests only: the
`Forge` interface (`packages/forge/src/types.ts`) has no issue. The first step of issues starting
workspaces later is to read them, and to show them where the person works. Measured on
2026-11-08, read only:

| | GitHub (vitejs/vite, sindresorhus/ky) | GitLab (gitlab-org/gitlab-runner) |
|---|---|---|
| A list page (100 items; 50 issues) | 1.09 s, 520 KB | 1.01 s |
| Pull requests among the items | 64 of 100 (vite, open); 55 of 100 (ky, all) | none: merge requests are a list of their own |
| Paging | `Link` with an `after=` cursor, not page numbers alone | `Link`, `x-next-page`, `x-total` (2,591 open) |
| Read without a token | the list and the comments (60 requests an hour) | the list; an issue's notes answer **401** |
| Conditional refresh | 304, `x-ratelimit-remaining` 4995 before and after | ETag sent |
| Title search | search API, 1.36 s, its own limit (30 a minute) | `search=&in=title`, 4.2 s |
| The author's role | `author_association`, on the issue and each comment | none on the issue |
| HTML in bodies | 20 of 36 issues hold a tag (6 `<details>`, 2 `<img>`) | 16 of 50; 6 hold `<!-- -->` |

CPR, origin, has 0 issues: its endpoint lists one item, HV8's pull request.

**Goal**: an Issues page (`/issues`, key `u`) beside the Monitor: the list (number, title,
labels, author, state, updated, comments), open by default, a state filter (open, closed, all), a
search on titles, 30 a page with Load more; one issue with its text, its comments and a link to it
on the forge. Nothing written to the forge. Every other page unchanged.

## The forge package

- `types.ts`: `IssueSummary` (forge, number, title, url, state `open | closed`, labels
  `{ name, color? }`, author `{ login, role?, bot? }`, comments, created, updated) and `Issue` (the
  summary, `body`, `comments: IssueComment[]`, `moreComments`, `commentsNeedToken?`). Shaped for a
  later brief and workspace record: number, title, link, labels, author and role.
- `Forge` gains `listIssues({ state, search?, cursor? }) → { issues, next? }` and
  `getIssue(number) → Issue`. Tokens by the rules there are (`githubToken`, `gitlabHeaders`).
- GitHub: `/issues?state=&sort=updated&per_page=100`, items with `pull_request` dropped; to fill a
  page of 30 issues, up to 3 API pages; the cursor is the `Link` next's `after` or `page`. Search:
  `/search/issues?q=repo:<p> is:issue in:title <text>` (`is:issue` keeps pull requests out).
  Comments: `/issues/<n>/comments?per_page=100`, the first page.
- GitLab: `/issues?state=opened|closed|all&order_by=updated_at&per_page=30`, `search=&in=title`;
  notes `?sort=asc&order_by=created_at&per_page=100`, system notes dropped; read only with a token
  (gitlab.com answers 401 without). The issue author's role: `members/all/<id>`'s access level,
  for the issue read whole, with a token.
- `http.ts`: a GET that returns the body with its `Link`, and a cache of ETags and answers (100
  entries, in the process) that sends `If-None-Match` and takes a 304 from it. A rate limit
  (403 or 429 with `x-ratelimit-remaining: 0`) says so, with its reset and what to set.
- The cursor the page sends back is checked: only digits for `page`, only base64url for `after`.

## The server

- `/issues` (the page), `GET /api/issues?state=&q=&cursor=`, `GET /api/issues/<number>`, as the
  Monitor's (`packages/cli/src/server.ts`). The service (`issues.ts`) finds the forge with HV8's
  `originForge` (git's `insteadOf` taken), once per read.
- Answers: `{ forge: { kind, host, project }, token, issues, next? }`, `{ forge, token, issue }`,
  or `{ problem: { kind: 'no-forge' | 'forge', message }, forge?, token }`. A number that is not a
  positive whole number is 400; anything but GET, 405.

## The page

- `packages/viewer/src/issues/`: `IssuesPage.tsx`, `issues.ts` (pure: words, the list's state),
  `issue-text.ts` (pure: an issue's HTML made safe), `IssuesPage.css`. Route
  `{ page: 'issues', number? }`, `/issues?number=12`; the sidenav entry under Monitor, key `u`.
- `PageHead` (the forge under the title, Refresh), two cards with a `Resizer`: the list (line
  tabs Open, Closed, All; a search that waits 400 ms; rows `#12`, title, label chips, author ·
  updated · comments, state with `StatusLabel`; "30 shown · Load more"), and the issue (title,
  state, author and role, Open on GitHub, body, comments oldest first, "N more on GitHub").
- Problems in words, in the list's card: no origin, origin on neither forge, no token (HV8's
  hint, as a note while public issues still read), a forge error or rate limit with Retry.
- No polling: a read on opening, on Refresh, on a filter or search change; every read is
  conditional on the server.

## Untrusted text

Anyone can open an issue on a public repository. Bodies and comments go through
`ui/markdown.ts` (no HTML string is ever made; only `http(s):` and `mailto:` linked;
`target=_blank rel=noreferrer`). Before it, `issue-text.ts` handles an issue's HTML: comments
dropped, `<img>` a link to its `src`, `<br>` a line break, any other tag removed with its text
kept. Nothing remote is loaded: no avatar, no image. A label's colour is a dot only, and only a
valid `#rrggbb`; its chip keeps Symbiote's tokens.

## Verification

1. **Forge**: `packages/forge/test/issues.test.ts` on responses recorded from vite and
   gitlab-runner (trimmed): pull requests out, a page filled from at most 3 calls, the cursor,
   comments (system notes out), a 304 from the cache, the rate limit, no token header without
   one, GitLab's role.
2. **Server**: each problem, a bad number, a cursor that is not the forge's.
3. **Viewer**: `issue-text.ts` (script, `onerror`, comments, img, details) and the list's words;
   `e2e/issues.spec.ts` on the fake forge (GitHub and GitLab): the list, filter, search, Load
   more, one issue, its link, no token, no forge, an error; `page-frame.spec.ts`,
   `targets.spec.ts`; `viewer-check` screenshots, both themes, the text sizes.
4. **Real**: a scratch repository with origin `https://github.com/vitejs/vite`, one with
   gitlab-runner, CPR itself (empty); read only.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| Issue text runs script or loads a tracker | no HTML string; images as links; tests with hostile bodies |
| GitHub's search limit (30 a minute; 10 without a token) | 400 ms wait; the 403 says the limit and its reset |
| 60 requests an hour without a token | conditional reads; the note says what to set |
| A page of items that are all pull requests | up to 3 calls, then the cursor goes on |

## Milestones

| # | Milestone | Output |
|---|---|---|
| IS1a | The forge reads issues | `listIssues`, `getIssue`, the conditional cache; tests |
| IS1b | The server | `/api/issues…`; tests |
| IS1c | The page | the route, sidenav, list, issue, problems; unit and e2e tests |
| IS1d | Docs, screenshots | README, guide, reference |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 944 | How are issues read? | **Through the `Forge` interface, `listIssues` and `getIssue`, with the token rules there are** | one place for both forges; HV8's origin and hints reused |
| 945 | Without a token? | **Public repositories are read anyway; the page says what to set** | GitHub reads 60 an hour, GitLab lists without one; the person's choice |
| 946 | Long lists? | **30 issues a page; GitHub's pull requests dropped, up to 3 API pages to fill one; Load more with a checked cursor** | 64 of 100 items were pull requests on vite |
| 947 | The search? | **On titles, at the forge: GitHub's search API (`is:issue in:title`), GitLab's `search` `in=title`; 400 ms after typing** | it covers every issue, not the ones loaded |
| 948 | Comments? | **The first 100, oldest first, then a link; GitLab's system notes dropped; GitLab's notes need a token** | gitlab.com answered 401 without one; the person's choice |
| 949 | Issue text? | **Markdown with no HTML string; HTML comments dropped, `<img>` a link, other tags removed with their text; nothing remote loaded** | anyone opens an issue on a public repository |
| 950 | Refreshes? | **No polling; every read conditional (ETag, a 100-entry cache)** | GitHub's 304 left the limit unchanged |
| 951 | The author's role? | **GitHub's `author_association` in words; GitLab's access level for the issue read whole, with a token; else absent** | what a later brief needs; GitLab's issue lacks it |
| 952 | The key? | **`u`** | free; the person's choice |

**Not in IS1 (later)**: a watcher, a start queue, Nucleus tools, a workspace from an issue,
issue numbers as IDs; writing anything to the forge.

## As built (IS1)

- **The types are core's** (`packages/core/src/issues.ts`), not the forge's: the viewer imports
  types from `@symbiote/core` only, as `HiveLandingSetting` is. The forge re-exports them. The
  answers carry `forge`, `token`, `tokenHint` and `problem` (`no-origin`, `no-forge`, `forge`).
- **The cursor is `page~after~skip`**: GitHub's list goes on from an `after=` cursor, and a page of
  30 cut inside an API page of 100 goes on from that page, skipping the issues shown. The server
  refuses any other shape (400) before the forge is asked; the forge checks it again.
- **`originForge` says what is missing** (`missing: 'origin' | 'forge' | 'token'`), so the page
  does not read HV8's sentence. The service keeps origin's forge 30 s: without a token in the
  environment, GitHub's is `gh auth token`, a process a read.
- **A rate limit says so** (`http.ts`): a 403 or 429 with the limit used up, or a `retry-after`,
  says it is used up and when it resets. Before, a 403 read "not found, or no access".
- **Scripts and styles are dropped whole**, their text too: the first screenshots showed a
  `<script>`'s text as a line of the issue. GitHub's sanitizer drops them.
- **A row shows 4 labels and +N** (5 whole): gitlab-org/gitlab-runner's issues carry 9 to 12
  scoped labels, and a row ran to five lines of chips. The issue shows them all.
- **The forge's link moved** from the head's line into its actions (**Issues on GitHub**): the
  targets check found the link 19 px high beside the title.
- **The state's colour**: open is `--ok` with lucide's circle-dot, closed `--muted` with a check;
  the shapes differ and each says its word (a row's icon is an image named Open or Closed).

**Results.**

- Tests: the forge's 19 on recorded responses (`packages/forge/test/issues.test.ts`); the
  service's 5 and the server's 2; the viewer's 10 words, 8 on hostile issue text and the route's;
  `e2e/issues.spec.ts`, 7 on the fake forge (GitHub and GitLab, now with issues), and the page in
  `page-frame`, `targets`, `title-bar` and `tooltips`. `pnpm check`: 3,457 tests passed. The full
  e2e: 434 of 438, then the two sidenav counts this branch moved fixed; `changes.spec.ts:139` and
  `hermes.spec.ts:29` fail under load on `main`'s export too.
- Real, read only, through the built `symbiote view` on scratch repositories:
  - vitejs/vite with the person's `gh` token: 30 open issues in 1.19 s (the first API page of
    100 held 36), the next 30 in 1.52 s by cursor, a search ("watcher") 4 in 0.47 s, #23965 with
    its 7 comments in 0.67 s. Six reads asked before cost nothing: `core.remaining` 4988 before
    and after; a new one cost 1.
  - gitlab-org/gitlab-runner without a token: 30 open issues in 0.73 s, a search in 3.2 s, an
    issue without its 7 notes and the note that they need `GITLAB_TOKEN`.
  - attomius321/CPR: 0 issues open and 0 in all (its one item is HV8's pull request #1);
    `/api/issues/1` says it is a pull request.
  - The page drew the list and an issue in 0.84–1.39 s, no `img` in it.
- Screenshots: both themes, the three text sizes at 1440 × 900, 800 px wide, on the fake forge
  and on vite and gitlab-runner.

