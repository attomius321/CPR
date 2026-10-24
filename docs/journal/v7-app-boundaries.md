# Journal: V7 — Apps in the graph

[Index](../JOURNAL.md) · [Plan](../plan/v7-app-boundaries.md)

## V7 spike — apps in the graph (2026-10-03, branch `milestone/v7-app-boundaries`)

Asked whether the viewer shows where one app ends and the next begins: it does not (file boxes
by path, placed by calls; a flat change list; no project in the graph JSON). Groundwork for V7
(PLAN); nothing in Symbiote changed on this branch.

**Measured** with the viewer's own layout on 8 Bitwarden changes chosen for touching several
projects and on Qwik's monorepo: a Bitwarden view holds 4–16 projects, 16–45 % of its drawn
edges cross projects, and a third to two thirds of those projects hold only unchanged
neighbours; Qwik's projects are islands (no drawn edge between them). Both need each project in
one place, light frames for context-only projects, and a layout that keeps cross-project edges
short where there are many.

**What a project is** is less obvious than "the nearest `package.json`": Bitwarden's desktop app
has its Electron manifest at `apps/desktop/src/package.json` and the browser app a
`lit-components` package inside it (both would split their app); `bitwarden_license/bit-*` have
no `package.json` or Nx file, only a `tsconfig.json` (and a path alias); `bit-web` is declared
only in `angular.json`. Declared projects first (workspaces, Nx, plugins), packages when nothing
is declared, tsconfig-only folders outside every project, the root last.

**Found on the way**: 5 of the 8 Bitwarden runs crashed. Q1's per-site props check read the parent
of a reference's node, and `findReferences` returns `{@link Class.member}` in a JSDoc comment at a
node without one. Fixed on `fix/jsdoc-reference-crash` and merged into main (see "Fix — a
doc-comment reference crashed the analysis" above).
Q1's verification had re-run the Qwik docs site and the fixtures, not Bitwarden or the 29
comparisons after changing core's references — they are part of every core change's checks
from now on.

Merged into main (2026-10-04).

## V7a — Projects in the graph (2026-10-03, branch `milestone/v7a-projects-in-graph`)

The graph JSON now says which app or library each file belongs to (`projects`, schema 0.6.0),
by the rules the V7 spike measured: declared projects (workspaces, Nx, plugins), packages when
nothing is declared, tsconfig folders, the root. The Angular plugin declares `angular.json`'s
projects through a new optional hook. Nothing in the viewer yet (V7b).

**Learned**
- The workspace glob reader turned `libs/**/*` into "at least one folder between": it never
  matched `libs/common`, so none of Bitwarden's direct `libs/*` packages were workspace members —
  for the TypeScript adapter's package mapping either. `**` now matches no folder too, as in npm.
  No Bitwarden edge changed (its tsconfig `paths` map most of those packages anyway).
- Which projects to list is a contract question: a consumer assigns paths by the longest folder,
  so the list must hold the project of *every* path the graph names (changed files included), or
  a README in an app with no symbol would land in the root project.
- The spike's "4–16 projects per Bitwarden change" counted what the viewer draws. The graph's
  nodes span 8–45: most come from context symbols V6 folds into summaries. Frames must follow
  what is drawn, not the list.
- Nx and `angular.json` disagree: Bitwarden's `libs/components` is an Angular `application`
  (Storybook) and an Nx `library`. Nx wins for name and kind.
- An Nx `project.json` is trusted only with `nx.json` at the root.

**Verification**: tests first (red for the missing module, the missing hook and the missing
field): rule fixtures (`projects/declared` — one folder declared three ways, nested packages, a
`**` member, an Nx-only and a plugin-only folder, a tsconfig folder inside and outside a declared
project; `projects/packages` — nothing declared, a `{ "type": "module" }` marker; `projects/pnpm`
— an excluded package), a monorepo change with a base-only library and a renamed root package,
W1's two-app fixture (two tsconfig projects), the plugin hook (normalized folders, one outside the
repo, a throwing hook), Angular's W1 fixture and an Angular CLI workspace (`shop` at the root,
`projects/admin`, `projects/ui-kit`; without the plugin only the library's package). Full suite
392 tests. Regression against `main`: `r1` 29 identical (859 edges), Bitwarden 10 identical
(4,862), Bitwarden multi-project 8 identical (10,803), Qwik 30 identical (5,530); no finding
changed; time ×0.97–1.015. Projects phase: 250 ms of 66 s (Bitwarden `cbf86c2`), 7 ms (Qwik
`f7ed58cfc`). Not verified: Yarn's `workspaces: { packages }` form and an Nx repo without
workspaces (no fixture, no real repo), an Angular CLI workspace on real code (fixture only).

Merged into main (2026-10-04).

## V7b — Project frames (2026-10-03, branch `milestone/v7b-project-frames`)

When what the viewer draws spans two or more apps or libraries, each is a frame around its files,
with its name, kind, folder and how many of its symbols changed; edges between projects are
heavier, project names are the largest labels on the map, and summaries say across how many
projects their symbols are. One project, or an older graph: the same layout as before.

**Learned**
- The plan's prototype check paid off: dagre over frames ran 3–8 times wider than high on
  Bitwarden (`cbf86c2` 23,924 × 7,549). Rows in dagre's rank order keep callers first and the page
  between 1.00 and 1.46 times wider than high on all 8 changes, at most as wide as before.
- Canvas size was the wrong thing to watch. Qwik `f7ed58cfc` got a smaller canvas and panned at
  3 fps instead of 22: packages placed after the frames (or beside their main user) pulled fans of
  hundreds of long edges across it, and React Flow draws every edge whose bounding box meets the
  view. Hiding the frames changed nothing, which pointed at placement, not painting. Drawing a
  package in the frame it has the most links with (it stays in no project) brought the median
  edges in view to 106, below the 136 without frames, and panning to 30 fps. "Edges in view
  around each changed symbol" is now the measure for placement changes (viewer CLAUDE.md).
- A 1.5 px border is a tenth of a pixel on the map at 7 % zoom: frames there get a ring sized by
  `--symbiote-zoom`, as file names already were.
- A frame must not take clicks: as a parent node it lies under its files, and a click between them
  would land on it instead of the canvas. Only its name band takes the pointer.

**Verification**: tests first — layout (frames around their files, parents first, paths from the
project's folder, frames apart in reading order, `edge-cross` only between two projects, the
longest folder winning, packages in their main user's frame and in no project, one project equal
to no projects, islands packed into a page, summaries across projects) were red before the code;
400 unit tests, 32 e2e (3 new on the npm-workspaces fixture: frames, a click inside a frame,
names on the map and a click zooming into one; all three fail on V7a's build, for want of
frames). Real graphs (8 Bitwarden changes with the Angular plugin, 2 Qwik changes with the
Qwik plugin) against V7a's viewer, back to back: first paint within +7 % (Bitwarden `cbf86c2`
1,514 → 1,168 ms), pan 59–63 fps on Bitwarden and 23 → 30 fps on Qwik `f7ed58cfc`, no page
errors; screenshots of the map, a selection and dark mode. Not verified: a real repository with
an Nx-only or Angular CLI layout in the browser (fixtures only).

Merged into main (2026-10-04).

## V7c — The change list by project (2026-10-04, branch `milestone/v7c-projects-sidebar`)

When a change spans two or more apps or libraries, the change list is grouped by project (name,
kind, progress, foldable, paths from the project's folder), "only" or `p` shows one project and
what it is linked to, and findings and the detail panel name the project. One project: as before.

**Learned**
- Folder order is not path order: `apps/web/e2e/a.ts` sorts before `apps/web/src/x.ts`, but its
  project comes after `apps/web`'s. The list is sorted by project folder with a stable sort, so
  files keep their path order within a project and j/k follow what is on screen.
- Fitting the whole project on every j/k step would throw away the reviewer's place: the canvas
  fits a newly shown project once, then centres each selection as before.
- A test that clicks at a measured spot must wait for the canvas to stop panning: V7b's frame
  click test failed 3 times in 12 because the selection's pan was still running. "Flake" was the
  test reading a moving target, not the viewer.
- Real change lists span 3–9 projects (Bitwarden `cbf86c2`: 9, with 55 of 115 changes in
  `@bitwarden/common`); without groups that was one list of 32 paths.

**Verification**: tests first — the list logic (grouping in folder order with a nested project
and the root, flat for one project, the search over project names, one project, folded projects,
`p` cycling, a project's neighbourhood) was red before the code; 406 unit tests. E2E 35, three new
on the npm-workspaces fixture (the grouped list with progress, folding, j/k and search; one
project on list and canvas, `p`, "Show all projects"; findings naming projects), which fail on
`main`'s build; the projects spec ran 6 times over without a failure. Real graphs: screenshots of
Bitwarden `cbf86c2` grouped and with `@bitwarden/auth` only, and Qwik `f7ed58cfc` with its router
only; timings against `main` within noise (first paint +4–5 % on Bitwarden), no page errors. Not
verified: very long project lists in a narrow sidebar beyond 9 projects.

Merged into main (2026-10-04).
