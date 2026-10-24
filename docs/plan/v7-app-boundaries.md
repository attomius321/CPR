# V7 — Apps in the graph

[Index](../PLAN.md) · [Journal](../journal/v7-app-boundaries.md)

**Status:** V7a merged into main (2026-10-04, from branch `milestone/v7a-projects-in-graph`, with
the plan's branch `milestone/v7-app-boundaries`); V7b merged into main (2026-10-04, from branch
`milestone/v7b-project-frames`); V7c merged into main (2026-10-04, from branch
`milestone/v7c-projects-sidebar`). V7 is complete.

**Problem** (asked: "In the UI view, the boundary between applications is visible?"). Not really.
In a repo with several apps and libraries the viewer draws one box per file, labelled with its
path, and places boxes by what calls what: two apps' files sit side by side, a library and the
apps it reaches are not grouped, on the map (zoomed out) only file names show — two apps'
`header.tsx` look the same — the change list is one flat list of paths, and the graph JSON does
not say which app a file belongs to. The only "package" boxes are npm packages.

Measured with the viewer's own layout (V6, `layoutFlow`) on real changes, a project being what
the rules below make of it:

| Repo, change | Symbols drawn (changed) | File boxes | Projects (only context) | Edges drawn (between projects) | Canvas |
|---|---|---|---|---|---|
| Bitwarden `737ee3f` | 168 (86) | 59 | 6 (2) | 336 (79) | 10,904 × 7,183 |
| Bitwarden `cbf86c2` | 303 (115) | 123 | 16 (7) | 672 (293) | 17,456 × 15,905 |
| Bitwarden `787bad6` | 80 (34) | 33 | 9 (3) | 166 (72) | 9,632 × 2,662 |
| Bitwarden `9014aef` | 75 (36) | 25 | 6 (3) | 97 (25) | 6,812 × 2,976 |
| Bitwarden `58af82a` | 39 (15) | 23 | 7 (4) | 45 (18) | 4,476 × 2,128 |
| Bitwarden `31dda4f` | 46 (20) | 25 | 4 (1) | 73 (12) | 3,119 × 2,165 |
| Bitwarden `12b0923` | 31 (8) | 18 | 9 (6) | 38 (17) | 3,581 × 2,005 |
| Bitwarden `9ce55cd` | 23 (7) | 15 | 5 (1) | 24 (6) | 2,968 × 825 |
| Qwik `f7ed58cfc` | 685 (367) | 192 | 6 (0) | 1,944 (0) | 35,051 × 25,081 |
| Qwik `65661bf49` | 152 (62) | 39 | 3 (0) | 226 (0) | 8,165 × 3,658 |

(npm packages and dynamic calls, outside every project, are not counted as projects.)
Two kinds of monorepo, and the design must serve both: in Bitwarden a change spreads over 4–16
projects and 16–45 % of the edges drawn cross projects (apps into `@bitwarden/common`, `auth`,
`vault`…); in Qwik's repo each project's part of a change is its own island (no edge between
projects drawn) — boundaries there separate unrelated work. A third to two thirds of Bitwarden's
projects in a view hold only unchanged neighbours, often one or two (`guid`, `storybook`,
`ui-common`): frames must stay light for those.

**Goal**: when a graph's symbols come from two or more projects, each project is a labelled frame
holding its files; edges between projects stand out; the map keeps project names readable; the
change list groups by project, shows review progress per project and can show one project only.
A single-project graph is drawn exactly as today.

## What a project is (core)

Measured on Bitwarden (60 `package.json`, 54 Nx `project.json`, an `angular.json` with 6
projects, workspaces `apps/*` and `libs/**/*`) and Qwik's repo (pnpm workspaces). "The nearest
`package.json`" alone is wrong: `apps/desktop/src/package.json` is the desktop app's Electron
manifest and `apps/browser/src/autofill/content/components` holds a `lit-components` package —
it would split two apps; and `bitwarden_license/bit-*` have no `package.json` at all (only a
`tsconfig.json` and a path alias). The rule, in order:

1. **Declared projects**: workspace members (`package.json` `workspaces`, `pnpm-workspace.yaml`,
   `**` globs included), Nx `project.json` files, and projects a plugin declares (Angular:
   `angular.json` `projects` and their `root` — `bit-web` exists only there).
2. **Packages**, when the repo declares nothing: the nearest `package.json` with a name,
   dependencies or scripts (not a `{ "type": "module" }` marker) — the user's repo with two apps
   two folders down and nothing at the root.
3. **TypeScript projects nobody declared**: for a file outside every project above, the nearest
   folder with its own `tsconfig.json` (not the root's) — `bitwarden_license/bit-common`. Inside a
   declared project such a folder is not a project of its own (an app's `e2e/` stays the app's).
4. **The root**, for everything else.

A file belongs to the project with the longest folder prefix. One folder declared several ways is
one project (Bitwarden's `apps/web`: workspace member `@bitwarden/web-vault`, Nx `web`, Angular
`web`). Name: the Nx or plugin name (`web`), else the package name (`@bitwarden/common`), else the
folder's name (`bit-common`); the root: its package's name, else "repository root". Kind
(`application`/`library`) when declared (Nx or Angular `projectType`), else none.

**Plugin hook** (optional, generic): `projects?: (revision: PluginContext) => { folder: string;
name: string; kind?: 'application' | 'library' }[]`. The Angular plugin returns `angular.json`
projects — an Angular CLI workspace with one `package.json` and `projects/*` has no other marker.
Nx stays in core: it is build tooling, not a framework.

**In the analysis**: core reads the markers of the folders of the graph's files from the head
checkout (the base checkout for files only base has), cached per folder; the workspace globs
reader moves out of the TypeScript adapter (`project.ts`) into a shared core module. The
`LanguageAdapter` gets an optional `projects(revision)` for plugin-declared ones.

**In the graph** (schema 0.6.0, minor — a new optional field): a top-level list, only when the
graph's symbols span two or more projects:

```jsonc
"projects": [
  { "folder": "apps/web", "name": "web", "kind": "application", "source": "nx" },
  { "folder": "libs/common", "name": "@bitwarden/common", "source": "workspace" },
  { "folder": "bitwarden_license/bit-common", "name": "bit-common", "source": "tsconfig" },
  { "folder": "", "name": "@bitwarden/clients", "source": "root" }
]
```

No field on nodes: a consumer puts a file in the project with the longest folder prefix (one rule,
documented with the schema; base-only files work the same). `source`: `workspace`, `nx`,
`plugin` (with the plugin's name), `package`, `tsconfig`, `root`. Older graphs have no list: one
project, today's drawing.

## Frames (viewer)

- **Layout, one level more** (pure, in `layoutFlow`): symbols → file boxes as today; a project's
  file boxes packed into its frame with the V6 cluster packing (clusters of boxes linked inside
  the project, to the page aspect); frames and the boxes outside every project (npm packages,
  dynamic calls) laid out together by the links between them — dagre left to right, callers
  before what they call, so apps sit left of the libraries they use; groups of frames with no
  link between them packed like V6 clusters. Prototype check before going on: on `cbf86c2` (16
  projects) and `737ee3f` the canvas stays within about 2:1 and no wider than today's; if dagre
  over frames runs too wide, frames are packed by size instead and only edges show the links.
- **Frame node** (`project`, React Flow parent of its file boxes, which stay parents of their
  symbols): name, kind (app/lib), folder, and "12 changed" in its top band; a frame holding only
  unchanged neighbours is drawn lighter and smaller-headed. Neutral colours: status colours
  keep meaning added/removed/modified.
- **Edges between projects** get their own class (heavier, a distinct dash) and stand out more
  when one end is selected; the legend explains them.
- **Map** (below 45 % zoom): the frame's name scales with `--symbiote-zoom` at about twice a file
  name's size, so projects read first, files second; clicking a frame on the map zooms into it,
  as a file box does. The minimap draws frames as outlines.
- **Summaries** ("390 users in 220 files") also say "across 5 projects" when they do; expanded,
  their members are drawn in their own frames.
- **One project** (or a graph without `projects`): no frame, layout identical to today's — every
  existing viewer test and screenshot unchanged.

## By project in the sidebar (viewer)

- **Change list grouped by project** (only with two or more): a header per project (name, kind,
  "4/12 reviewed"), collapsible; file paths under it relative to the project's folder
  (`src/components/header.tsx`); projects with changes first, in folder order; j/k follow the
  list's order; search also matches project names ("web button").
- **Show one project**: a filter on the project header (and `p` cycles projects): the canvas and
  the list keep that project's changed symbols and what they are linked to directly in other
  projects (the impact across the boundary stays visible), as focus does for one symbol.
- **Findings and detail**: a finding row names its symbol's project; the detail panel's file line
  reads `web › src/app/foo.ts`.

## Verification

1. **Core**: project rules on fixtures for each kind (workspaces with `**` globs, pnpm, Nx,
   plugin-declared, no declaration, a `{ "type": "module" }` marker, an undeclared nested
   package inside a declared one, a tsconfig-only folder, the root), names and kinds, one folder
   declared three ways; the graph has `projects` only with two or more; goldens unchanged except
   `schemaVersion`; schema validation. The 29 R1 comparisons identical apart from the new field.
2. **Angular plugin**: `angular.json` projects (an Angular CLI workspace with `projects/*`, and the
   W1 multi-project fixture).
3. **Viewer units** (`flow.test.ts`): one project → positions identical to today's; two or more →
   every file box inside its frame, frames not overlapping, boxes outside projects outside
   frames, edges between projects classed; filter by project; grouped change list and j/k order.
4. **E2E**: a monorepo fixture (two apps and a shared library, plain TypeScript, npm workspaces):
   frames with names, the map showing project names, the grouped list, the project filter;
   screenshot. Existing e2e tests unchanged.
5. **Real repos**: Bitwarden's 8 changes above and Qwik `f7ed58cfc`: project assignment matches
   the rule (no `apps/desktop/src` split, `bit-common` its own project, `bit-web` from
   `angular.json`), canvas size and first paint against today's (+10 % at most), screenshots of
   `737ee3f` and `cbf86c2`. The user's two-app layout (W1 replica): two frames.

**Risks**

| Risk | Mitigation |
|---|---|
| Frames waste space (a project of one box still has a band and padding) | Light frames for context-only projects; inside a frame the V6 packing; measured canvas against today's. |
| Dagre over 16 frames runs wide | Prototype on `cbf86c2` first; fallback: frames packed by size, links shown by edges only. |
| Wrong boundaries | Rules from three real layouts; `source` in the graph says why; a plugin can declare projects. |
| Nested React Flow parents cost render time | Frames are few (at most 16 measured); first paint measured on the largest graphs. |

**Order**: V7a (core and schema, fixtures red first) → V7b (frames; prototype the frame layout on
`cbf86c2` before the rest) → V7c (sidebar). Each merged after its checks.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V7a ✅ | Projects in the graph | Core project rules (declared, packages, tsconfig-only, root), the optional plugin hook and the Angular plugin's `angular.json` projects, `projects` in the graph (schema 0.6.0), shared workspace-globs reader. |
| V7b ✅ | Frames | `layoutFlow` one level deeper (files in project frames, frames by the links between them), `project` frame node, edges between projects, project names on the map and minimap, summaries across projects, legend; one project = today. |
| V7c ✅ | By project in the sidebar | Change list grouped by project with progress and relative paths, the project filter (canvas and list), project names in findings and the detail panel, search by project name. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 33 | What a project is | **Declared first** (workspace members, Nx `project.json`, plugin-declared such as `angular.json`), **packages when nothing is declared**, **tsconfig-only folders outside every project**, the root last; the longest folder prefix wins | "Nearest `package.json`" splits Bitwarden's desktop and browser apps over nested packages and leaves `bit-common` (no `package.json`) at the root; repos that declare nothing (two apps two folders down) still get one frame per app. |
| 34 | How the graph says it | **A top-level `projects` list, no field on nodes**; consumers use the longest folder prefix | Nodes stay as they are (smaller graphs, no change for single-project repos); base-only files resolve the same way. |
| 35 | When frames are drawn | **Only with two or more projects**; otherwise today's layout, unchanged | A single-app repo gains nothing from one frame around everything, and every existing view stays as reviewers know it. |
| 36 | Where frames go | **Files packed inside their project; frames laid out by the links between them, callers left of what they call**; size-packing if that runs too wide. *As built: frames in rows in dagre's rank order (callers first), packages inside their main user's frame — see As built — V7b.* | Bitwarden's changes run from apps into shared libraries (16–45 % of drawn edges cross projects); Qwik's projects are islands — both read best with each project in one place. |

## As built — V7a

- **Which projects are listed**: those holding every file the graph names — changed files (also
  non-code and ignored ones, and old paths of renames) and the files of its nodes — not only the
  symbols' files. The longest-folder rule must give the right answer for every path in the graph:
  listing only the symbols' projects would put a changed `apps/web/README.md` into the root
  project when `apps/web` holds no symbol. The list appears with two or more of them; the viewer
  decides when to draw frames (V7b: by the projects of what it draws).
- **"The repo declares"** (rule 2's condition): workspace globs, an `nx.json` at the root, or a
  plugin's projects. An Nx `project.json` counts only with `nx.json`, so a stray `project.json`
  in another kind of repo is not a project.
- **Nx before plugins** for the name and kind of a folder declared both ways: Bitwarden's
  `libs/components` is an `application` in `angular.json` (its Storybook) and a `library` in Nx,
  which is what it is.
- **The workspace globs reader** (`src/workspace.ts`) is shared with the TypeScript adapter, and
  `**` now also matches no folder: `libs/**/*` holds `libs/common`, as in npm. The old pattern
  missed every direct child, so Bitwarden's `libs/common` was not a workspace member for the
  adapter's package mapping either. It reads `package.json` with `JSON.parse` (npm's rule) where
  the adapter used TypeScript's lenient config reader.
- **Hook**: `TsPlugin.projects(context) → { folder, name, kind? }[]` (plugin API stays 1);
  `LanguageAdapter.projects?(revision)` adds the plugin's name. Folders are normalized
  (`./src/` → `src`, `.` → `''`); one outside the repository is skipped with a warning.
- **Base-only files** are read from base; when head and base give a project for the same folder,
  head's is listed (a renamed package shows its new name).

**Results (V7a)**: graphs, edges and findings identical to `main` apart from the new field and
`schemaVersion` — `r1` 29 comparisons (859 edges), Bitwarden 10 (4,862 edges) and the 8
multi-project changes (10,803 edges), Qwik's 30 (5,530 edges); run time ×0.97–1.015. Goldens:
only `schemaVersion`. On Bitwarden every project is what the rules say: apps and libraries by
their Nx names and kinds (`web`, `@bitwarden/common`), `bitwarden_license/bit-common`,
`bit-browser`, `bit-cli` by their tsconfig, `bit-web` from `angular.json`, nothing split at
`apps/desktop/src` or the browser's `lit-components`. The graphs list 8–45 projects there, far more
than the 4–16 the viewer draws: all but 3–10 come from context symbols, which V6 folds into
summaries — V7b frames what it draws, and a summary can say "across 5 projects" from the list.
Qwik: 19 of 30 changes span 2–7 projects (`f7ed58cfc`: 7, with the root). The new phase costs
250 ms of 66 s on Bitwarden `cbf86c2`, 7 ms on Qwik `f7ed58cfc`.

## As built — V7b

- **Frames follow what is drawn**: a frame per project of the file boxes drawn, when they belong
  to two or more (the graph's `projects`, longest folder; `src/projects.ts`). Focus, context and
  opened summaries change what is drawn, so they can add or remove frames. One project, or a graph
  without `projects`: the layout equals the one without (a unit test compares them).
- **Rows in rank order, not dagre's columns** (decision 36 changed): the prototype ran dagre over
  frames 3–8 times wider than high on Bitwarden (`cbf86c2` 23,924 × 7,549, `737ee3f` 15,557 ×
  3,158). Frames are ranked by dagre (callers before what they call) and placed in rows in that
  order, the tallest first within a rank, frames linked to nothing last. Packing by size alone
  fitted as well but put a callee before its caller for 202 of 338 links on `cbf86c2` (rank
  order: 109).
- **Packages and the dynamic calls are drawn in the frame they have the most links with**, still
  in no project (no relative path, never `edge-cross`). Placed after the frames, or in a column
  beside their main user, Qwik `f7ed58cfc`'s `@qwik.dev/core` (461 edges, 403 from the e2e apps)
  pulled fans of long edges across the canvas: React Flow draws every edge whose bounding box meets
  the view, and panning at the first change fell from 22 to 3 fps. Inside its main user's frame the
  package joins its users into one cluster, as without frames.
- **Edges between projects** are heavier (3 px, 4.5 px when an end is selected) and less faded on
  the map; no distinct dash, since dashes already mean "removed" and "type reference / unknown".
- **Frame**: name, kind (app/lib), folder (unless it is the name), "N changed" (changed symbols
  drawn in it) or "context only" — then lighter, dashed and with a smaller head. Wide enough for
  its name. Only the name band takes the pointer: a click inside a frame is a click on the canvas
  (it closes the detail panel), a drag pans.
- **Map**: a frame is drawn over its files there, transparent, with a ring that keeps 2 screen px;
  its name is 26 px on screen, smaller only to fit the frame's width and never below a file name's
  13 px; a click on it zooms into the frame. A context-only frame's name is a file name's size.
- **Paths in a frame** start at the project's folder (`src/page.ts`); the full path is the title.
  Summaries say "across N projects" when their neighbours span two or more (from the graph's list,
  frames drawn or not); they are 250 px wide then, 190 otherwise.

**Results (V7b)**, with the Angular and Qwik plugins, against V7a's viewer (no frames), measured
back to back (two rounds, 1440 × 900 Chromium):

| Change | Frames (context only) | Canvas, today → frames | Edges in view, median (p90), today → frames | First paint | Pan |
|---|---|---|---|---|---|
| Bitwarden `cbf86c2` | 17 (8) | 17,044 × 15,230 → 8,921 × 8,964 | 121 (177) → 131 (190) | 1,514 → 1,168 ms | 63 → 63 fps |
| Bitwarden `737ee3f` | 6 (2) | 9,587 × 7,819 → 7,566 × 5,859 | 53 (120) → 67 (112) | 922 → 900 ms | 64 → 59 fps |
| Bitwarden `787bad6` | 10 (4) | 9,632 × 2,662 → 4,037 × 4,024 | 42 (59) → 49 (68) | 676 → 667 ms | 64 → 62 fps |
| Qwik `f7ed58cfc` | 6 (0) | 35,051 × 25,081 → 27,896 × 22,196 | 136 (318) → 106 (260) | 2,726 → 2,910 ms | 23 → 30 fps |
| Qwik `65661bf49` | 3 (0) | 8,165 × 3,658 → 8,092 × 4,585 | 45 (50) → 42 (53) | 764 → 654 ms | 62 → 62 fps |

"Edges in view": edges React Flow draws in a zoom-1.1 view centred on each changed symbol. On all
8 Bitwarden changes the canvas is 1.00–1.46 times wider than high and 0.42–1.01 times today's
width; on the three Bitwarden changes above a view holds 10–19 % more edges on average (the page
is denser), on Qwik's fewer. Marking a symbol
reviewed took 84 → 134 ms (`737ee3f`) and 154 → 230 ms (`f7ed58cfc`), within the ±30 % these
timings vary by; no page errors. Layout time fell (Bitwarden `cbf86c2` 443 → 243 ms): dagre runs
per frame. Not changed: the largest Qwik graph opens at the minimum zoom (0.05) and does not fit,
as before.

## As built — V7c

- **By project when the changes span two or more** (as frames, decision 35): `changeList` gives
  each file its project and orders by project folder (stable, so files stay in path order within
  one); `byProject` cuts the list into groups. Folder order puts the root and a nested project
  (`apps/web/e2e` after `apps/web`) where the folders say, not where the paths sort.
- **Header**: name, kind, "n/m reviewed" over the project's whole change (not what the search
  leaves); it stays at the top while its files scroll. A click folds the project; j/k walk the
  list without folded projects, as they walk only what a search leaves.
- **One project**: "only" on a header, or `p` / `P` (next / previous, then all). The list keeps
  that project; the canvas keeps its changed symbols and everything one edge away, in it or in
  another project (`projectNeighbourhood`), and fits them once — walking the project's symbols
  then centres each, as without the filter. Focus on a symbol (`f`) narrows further. When the
  project's neighbours are all its own, one project is drawn: no frame (Qwik's router).
- **Search** matches project names too ("acme/ui"). **Findings** name their symbol's project;
  the **detail panel** reads `@acme/ui › src/index.ts`, the full path as its title. Packages and
  dynamic calls are in no project and stay as they were.
- **Fixed on the way**: V7b's e2e "a click inside a frame" measured the frame while the canvas
  still panned to the selection; 3 of 12 runs failed. It waits for the canvas to settle (20 of 20).

**Results (V7c)**: change lists on real graphs span 3–9 projects (Bitwarden `cbf86c2`: 115
changes in 32 files, 9 projects, `@bitwarden/common` 55 and `@bitwarden/auth` 32; Qwik `f7ed58cfc`:
367 in 113 files, 6 projects). Showing one project takes 623 ms on `cbf86c2` (`@bitwarden/auth`:
153 nodes drawn), 369 ms on Qwik `f7ed58cfc`; back to all, 914 and 1,617 ms (the whole layout
again). Against `main` (V7b), two rounds back to back: first paint +4–5 % on Bitwarden, select and
mark reviewed within their noise, no page errors.

**Not in V7 (later)**: collapsing a whole frame into one node (V6's summaries already cut
context); grouping findings by project in the CLI summary and PR comments; colouring projects.
