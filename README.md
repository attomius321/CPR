# CPR

Local-first code review that turns a change into a graph of changed symbols and the calls between them, so you review decisions instead of lines.

```sh
cpr diff main            # what changed on this branch, symbol by symbol, with findings
cpr diff main --json     # the graph as JSON (docs/graph-schema.md)
cpr diff main --fail-on error   # for CI
cpr view main            # review it as a graph in the browser
cpr view                 # the history as a graph: check out, review a branch, or compare two commits
cpr pr 123               # a GitHub pull request or GitLab merge request (cpr mr 123)
```

```
main (273c27a) → HEAD (b769925), merge-base 273c27a
4 files changed · 3 symbols changed: 1 removed, 1 added, 1 modified

Findings
  ✖ removed-still-referenced  src/math.ts#legacy
      legacy was removed but is still used by 1 symbol: old
  ⚠ signature-changed         src/math.ts#add
      add changed its signature; 1 of 2 users not updated: total

M  src/math.ts
     ~ function    add  (signature, body)  · used by 2
     - function    legacy  · used by 1
     + function    triple
```

![CPR viewer: changed symbols boxed by file, colored by status, with finding badges](docs/images/viewer.png)

The viewer (`packages/viewer`) draws the same graph: one box per file, symbols colored by what
changed, findings as badges, removed edges dashed. `cpr view main` opens it; it also accepts a
graph file from `cpr diff --out` (drag and drop).

`cpr view` without revisions opens at once on the repository's history: every branch, local and
remote, drawn as a graph left of the commits, the current branch the straight line on the left
(tags show on their commits). A line spanning more than 100 rows is two arrows; a click on one
goes to its other end. "This branch" shows only the current branch's commits. The whole history
scrolls; commits load as they come into view (git orders it once: a hint names `git
commit-graph write` when that is slow). The branches panel on the left lists local branches (with
`↑2 ↓1` against their upstream, or "gone") and remote ones by folder (`fix/`, `milestone/`), with a
filter (`/`; Enter goes to the first branch listed); a click puts the selection on the branch's
newest commit, however deep in the history, and from there c and r work as on any commit. Under
900 px the panel opens from a "Branches" button. Right-click a commit (or "⋯") and point at "Check out",
or press c, to check out one of its branches, a remote branch as its local branch, a tag or the
commit itself (each named by its badge); CPR asks first, uses `git switch` (never forced: local changes come along, or git refuses and nothing changes)
and redraws the graph. A checkout made elsewhere shows when the page is back in focus.

To review a branch (an agent's, say), point at "Review" in the same menu, or press r: CPR
compares the branch from where it left the default branch to its tip. Mark symbols reviewed as
you go; after new commits, review it again and only what is new or changed since is left (marks
stay on symbols that did not change). A reviewed branch's badge shows "✓", or "+2" for commits
since, and those commits get a dot. Reviews are files in `cpr/reviews/<branch>/<your git
email>.json`. The first one writes `cpr/.gitignore`, which keeps them out of git; delete it to
commit and share them. `git clean -fdx` deletes ignored files, reviews with them. An agent that
commits with `git add -A` in your working copy skips them while that `.gitignore` is there; agents
working in their own worktree have their own `cpr/`.

Comment on lines as you review (select a symbol, c), then finish in the Review tab: Request
changes, Comment or Approve records your verdict and comments in the review's file, for the
agent; "Copy for the agent" puts it on the clipboard as text. CPR pushes and merges nothing: an
approval asks the agent to merge the commit you reviewed — that one, not newer ones — into the
repository's default branch, when you tell it to act on the review ("check my review"). Before
you approve, the Review tab says whether that merge is clean or which files conflict; on a
conflict the agent resolves it on its branch, and you review that. A branch's badge shows "✓"
approved, "✗" changes requested, "+2" for its own commits since, "…" while reviewing. The default
branch (`main`) can be reviewed for its unpushed commits, from where it was last pushed; an
approval there says they may be pushed.

**For agents**: CPR writes what to do with a review into `cpr/AGENTS.md`, beside the reviews,
and every review file's first line points there. Claude Code loads it when it reads a review.

Start the work there too: "Start a feature" (or `n`; "Start a feature here" in a commit's menu
starts it at that commit) asks what the agent should build, names a branch after it (edit it if
you like), creates the branch at the default branch's tip with its own worktree beside your
checkout — `../<repo>.worktrees/<branch>`, so your checkout and `cpr view` are untouched and
several features can run at once — records the brief in `cpr/features/<branch>.json`, and starts
Claude Code there in the background (`claude --bg`) with the brief. "Plan first and wait for my
OK" (on by default) has it stop after its plan. It runs on your own Claude Code login (the
dialog says which: your subscription, or an API key) in the permission mode you pick (Claude
Code's default, Accept edits or Auto); CPR never grants it more. If Claude Code does not start —
it must trust the repository, so run `claude` there once and accept — or is not installed (`claude`
on `PATH`, or `CPR_CLAUDE`), the branch and worktree are kept and the page offers the prompt to
copy. **Features** (the tab beside Commits, which counts what needs you) lists them by what each
needs from you — a plan to read, a permission to give, a branch to review, changes to send back —
then those working, then those merged, each with its commits, files not committed yet, your review
and whether it merges cleanly, and Review, Talk (copies `claude attach <id>` for a terminal), Open
in VS Code (its worktree), Stop or Start the agent, Copy the prompt. A feature's branch carries its
agent's mark on the commits page — a link to the feature — and the feature's branch name goes to
its commits; its commits show as the agent makes them. Review the branch as any other. In
`cpr/config.json`, `"features": { "branchPrefix": "feature/", "worktrees": "../{repo}.worktrees"
}` and `"agent": { "permissionMode": "auto", "model": "opus" }` change the defaults.

Pick a feature and its panel opens beside the list: its state and actions, then its thread —
the agent's plan and reports, your messages, what it waits on (a permission to run a command, a
question and its options) — and a box to answer it. Send continues the agent's own session with
your words (CPR stops a session that is still alive first, then resumes it); while it works,
"Stop and send" asks before ending its turn. After you finish a review of its branch, "Send the
verdict" (or "Send to the agent" in the Review tab) fills the box with what you decided. Nothing
is sent until you press Send. The thread comes from hooks CPR gives each agent it starts
(`cpr/claude-settings.json`, kept in `cpr/threads/`, out of git); they only record, so
permissions and questions are still answered in the session (Talk). Once a feature is merged,
Clean up removes its agent's sessions, its worktree and its branch; an unmerged one only after
you confirm, keeping the branch; never while files there are not committed.

A click selects a commit (j/k move the selection). To compare, turn on "Compare mode" (or press
x): click one commit and another — the older is the base — and Compare (or x, Enter); one picked
alone is compared with its parent; Escape leaves. Two commits on branches that diverged are
compared from where they forked, as a pull request is: the diff shows what one side added since,
never the other side's work as reverted. That side is the one off the default branch (else off
the branch checked out, else the newer); the bar says so — "9f8e7d6 → e4f5a6b · 5 commits ·
diverged from a1b2c3d" —, the fork point's SHA goes to its row (ringed with dashes), and Swap
compares the other side. A picked pair is analyzed then, in the background, with the same
`--plugin`, `--project` and `--depth`: its
page says what it is doing ("loading head · 12 s") and can stop it. Each diff has its own address
(`/diff/<base>..<head>/`), so it can be reloaded or bookmarked; the last 8 stay ready while
`cpr view` runs, and "← Commits" goes back to the list. `cpr view main` analyzes first, as before,
and opens that diff with the commits a click away.

Large changes stay navigable: a changed symbol with more than 8 unchanged users (or uses) shows
them as one node — "390 users in 220 files" — that opens on click; zoomed out, the canvas is a
map of file names you click to zoom into, with one edge per pair of linked files, heavier the more
symbol edges it stands for; and j/k, the change list or a finding take you to a symbol without
anything moving. While the view of a change with more than 400 edges moves, only the selected
symbol's edges are drawn; the rest come back when it stops. Layouts are made in the background:
the change list and findings show at once, a new view (context, a project, a group) is drawn
when ready — "Laying out…" meanwhile, the previous one still usable — and a view seen before
comes back at once. To find one in hundreds, search the change list (press `/`): it
keeps the symbols whose file path and name hold every word you type, Enter opens the first, and
j/k walk only the matches.

In a monorepo, when what is drawn spans two or more apps or libraries, each is a frame around its
files: its name, kind and folder, and how many of its symbols changed (a frame holding only
unchanged neighbours is drawn lighter). Frames read in order: what calls comes before what it
calls. Edges between projects are drawn heavier; on the map the projects' names are the largest
labels, and a click inside a frame, off its files, zooms into the project. A summary also says across how many projects its
symbols are ("390 users in 220 files across 5 projects"). The change list is then grouped by
project — name, kind, how many of its changes you reviewed, paths from the project's folder — and
a project folds away (j/k pass it by); the search also finds project names. "only" on a project,
or `p` (`P` back), shows one project at a time: its changes, and everything they are linked to
in other projects. Findings and the detail panel name the project (`web › src/app/foo.ts`).

Click a symbol to see what changed in it, its findings, and who uses it:

![Detail panel: findings, old and new signature, a line diff of just this method, its users and callees](docs/images/viewer-detail.png)

Under `cpr view` and `cpr pr`, "Open in VS Code" beside the file (or `o`) opens the symbol in VS
Code: in the window that has the repository open, else in a new window with it. Ctrl+click a line
(⌘+click on macOS), or click its number, to open that line. CPR finds where the line is in your
working copy now: after a checkout or an edit it opens at the line's new place and says so; a line
changed since opens where it was. It runs VS Code's `code` command, from `PATH` or the usual
install places, on the machine where `cpr` runs (WSL, Remote SSH and containers alike); set
`CPR_CODE` to use another one (Insiders, VSCodium, Cursor).

`cpr pr` works with GitHub (and GitHub Enterprise) and GitLab (gitlab.com and self-managed). It
reads the forge from the `origin` remote; tokens come from `GITHUB_TOKEN`/`GH_TOKEN` (or
`gh auth login`) and `GITLAB_TOKEN`.

Under `cpr pr` you can review without leaving the graph: write comments on symbols (press `c`;
click a +/− line to choose where it lands), then submit them from the Review tab as one review —
comment, approve, or request changes. They arrive as inline comments on those lines.

Your reviewed marks and drafts are kept per pull request. When the author pushes again, run
`cpr pr` again: symbols you reviewed that didn't change stay reviewed, the ones that did are
flagged ↻, and your drafts follow their code to its new lines. To see only what the push
changed, compare with the head you saw last — a rebase that touched nothing shows nothing:

```sh
cpr pr 123 --since 3c2b1a0   # each changed symbol: new, updated, or same as in 3c2b1a0
```

![Review tab: two draft comments on symbols, a summary, and "Request changes" ready to submit](docs/images/viewer-review.png)

In CI, post the findings instead of opening the viewer; findings already posted by an earlier
run are not repeated. Inside a pull/merge request job, `cpr pr` finds the number itself:

```sh
cpr pr --post-findings warning --fail-on error   # GitHub (GITHUB_TOKEN) or GitLab (GITLAB_TOKEN)
```

On GitHub, use the action:

```yaml
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
  cpr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - uses: attomius321/CPR@main
        with:
          post-findings: warning   # empty: don't post
          fail-on: error           # empty: never fail
```

The action builds CPR, runs it, writes the summary to the run's page, and outputs the graph
JSON's path (`steps.<id>.outputs.graph`) for upload.

On GitLab, include the template:

```yaml
include:
  - remote: https://raw.githubusercontent.com/attomius321/CPR/main/ci/gitlab/cpr.yml
```

Its `cpr` job runs on merge request pipelines. Without a token, findings appear in the merge
request's Code Quality widget; add a masked `GITLAB_TOKEN` variable (api scope) to also get them
as comments on their lines.

TypeScript and JavaScript for now. Symbols in `fixtures/`, `generated/` and similar folders are not analyzed; add a `.cprignore` (gitignore syntax) at the root of your repository to change that. It is read from your working folder, so it applies right away, even uncommitted, and to any commits you compare:

```gitignore
# every `interfaces` folder, at any depth
interfaces/
# only the top-level `tools` folder
/tools/
# but keep this one
!apps/web/interfaces/public.ts
```

In a monorepo the graph JSON also says which app or library each file belongs to (`projects`, see
the [graph schema](docs/graph-schema.md#project)): workspace members (npm, Yarn, pnpm), Nx projects
and, with `--plugin angular`, the projects of `angular.json`; when a repository declares none,
its packages and folders with their own `tsconfig.json`.

### Plugins

Framework knowledge comes as plugins, so the TypeScript/JavaScript analysis stays the same for
every project. A plugin can make CPR see what plain TypeScript cannot: a template that calls a
component's methods, a method the framework calls, decorator settings that are configuration
rather than contract. Turn one on per run or for the repository:

```sh
cpr diff main --plugin angular          # Angular templates, decorators, lifecycle hooks
cpr diff main --plugin qwik             # Qwik routes, component$ props, MDX routes
cpr diff main --plugin ./tools/my-plugin.mjs
```

With `angular`, a template is code: its edits are changes (formatting aside), and what it calls
counts as a use. A method removed while its template still calls it is an error at the template
line; a method used only by a template, a lifecycle hook or a host listener is no orphan; editing
`@Component({ imports })` no longer reads as a new signature. Templates see the repo's components,
directives and pipes too: a removed component still placed, an input renamed while still bound,
an output removed while still listened to, or a pipe whose `transform` changed under a template
that was not updated are reported. With dependencies installed, templates also see the
components, directives and pipes of Angular and its libraries (read from their typings in
`node_modules`): `x$ | async` has a type, so a field read only in `@if (org$ | async; as org)`
counts as used, and `(ngModelChange)="save($event)"` or `#f="ngForm"` are typed — in CI, install
dependencies before CPR runs. In the viewer, a template opens with its own diff, and comments on
its lines go to the `.html` file.

Repos holding several apps work too, at any depth and with nothing at the root: each file's
imports resolve with its own project's `paths` and `baseUrl` (the `tsconfig.app.json`,
`tsconfig.lib.json` or `tsconfig.json` it is built with), each template is read with its app's
Angular version and installed libraries, and an app's templates only use components of its own
Angular workspace (its `angular.json` folder) and of shared code outside every workspace.

With `qwik`, what Qwik's router calls by name is no orphan: `onGet`, `head`, `onRequest` and the
other route exports, `routeLoader$`/`routeAction$` values (also re-exported from elsewhere, also
through a form library's wrapper when Qwik is installed), server plugins' handlers, entries and
error pages — by Qwik's own file rules for 1.x (`@builder.io/qwik-city`) and 2.x
(`@qwik.dev/router`), in the routes folder its Vite config names. A helper a route module exports
but nothing calls is still an orphan. A `component$`'s props are its signature, shown as
`const Badge = component$<{ label: string; tone: string }>`: an optional prop added is
compatible, a required prop added or one removed is a warning naming the JSX that was not updated
— also when the props are a named type (`component$<CardProps>`) whose definition changed. Props
are read from the types in the code, so this works without `node_modules`. `.mdx` routes are
templates: their imports, components and `{expressions}` are code (prose edits are no change), so
a component removed while a page still renders it is an error at that line of the `.mdx`, a
required prop a page does not pass is a warning naming it, and a component only pages use is no
orphan — components the MDX provider gives (`providerImportSource`) included.

```jsonc
// cpr/config.json (or cpr.config.json, the older place), at the repository root
{ "plugins": ["angular"] }
```

A short name means `@cpr/plugin-<name>`, found in your project first, then next to cpr; a path
starts with `.` or `/`. In CI: the action's `plugins` input or GitLab's `CPR_PLUGINS` variable
(comma-separated). A plugin that fails is skipped with a warning — it never fails the review.
Writing one: the `TsPlugin` interface exported by `@cpr/core`
([plan](docs/PLAN.md#x1--plugins)), and a complete example in
[`tpl-plugin.ts`](packages/core/test/helpers/tpl-plugin.ts).

- [Plan](docs/PLAN.md) · [Journal](docs/JOURNAL.md) · [Graph schema](docs/graph-schema.md)

## Development

Requires Node ≥ 22.12 and pnpm 12.

```sh
pnpm install
pnpm check        # format, lint, typecheck, test
pnpm build        # compile packages to dist/
node packages/cli/dist/bin.js diff main
```

| Package | Role |
|---|---|
| `packages/core` | Analysis engine: git, symbols, diff, references, detectors, graph JSON |
| `packages/cli` | `cpr` command line |
| `packages/forge` | GitHub and GitLab APIs |
| `packages/viewer` | Graph viewer served by `cpr view` and `cpr pr` |
| `packages/plugin-angular`, `packages/plugin-qwik` | Framework plugins |
| `spikes/ts7` | TypeScript 7 API experiment (outside the workspace) |

Changes to the analysis are checked on real repositories, not only fixtures:
`scripts/regression/` runs pinned commits of ky, zod, vite, RealWorld, Bitwarden and Qwik on two
builds and compares edges, findings and time; `scripts/viewer/measure.mjs` times the viewer on a
graph in Chromium. `CLAUDE.md` (and one per package) and `.claude/skills/` hold the working rules
and procedures for Claude Code.
