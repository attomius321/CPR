# V90 — Redesign step 3: a review's pages (Graph, Files, opening a review)

[Index](../PLAN.md) · [Journal](../journal/v90-redesign-reviews.md)

**Status:** planned (3 November 2026), on branch `feature/redesign-reviews` (the workspace's, from
`main` at `c99afc6`); the person's OK given, with choices 1a, 2a, 3b and 4a.

**Problem** (the brief: "Bring a review's pages to the designs in both themes": the Graph page,
the Files page, opening a review). The designs are on `main`: `spikes/normal-redesign` (proofs
03-review-graph, 04-review-files, 10-review-loading, 07-kit; `src/normal.css`). V88 built the
tokens and the shared parts, V89 the workspace page. Today, on `c99afc6`:

| | Today | The proofs |
|---|---|---|
| A graph node | Tinted ground and border in its kind's colour (V31); the file and `body`/`signature` tags on line 2; one badge per severity | A neutral card: the kind in caps, one count of findings and a mark for the kind (`+ − ~`); the name in mono; the signature |
| The picked symbol | The accent's outline; its edges marked `edge-active`, drawn under the nodes | A violet ring; its calls drawn above the other nodes |
| A file's box | `.file-box` | `.frame`: 10 px radius, the card's fill, the path in faint mono |
| The head | Focus, Context, Type references toggles; symbol counts `+6 −1 ~3` | Pills for errors and warnings, ← Workspace, Files/Graph; git's lines (`+47 −2`) |
| The sidebar | Changes `0/10`, a 2 px bar, finding rows | A progress row in words, finding cards, a foot with the drafts and Finish review |
| The detail | Kind · tone, findings, signature, code, comments, Used by / Uses | The kind's pill, the finding as an alert, Still used by / Used before by, the code, the comment box with Mark reviewed |
| The Files page | Tabs Files and Review | One card: the files (viewed, open, comments), then Your review; the file's head with `2 of 5`, ↑↓, Viewed; comments "You · on X · draft" with Edit and Delete |
| Opening a review | `DiffProgress`: a card on the start page's arcs, a comet, six dots, the seconds, Stop; nothing to read | The six steps as a timeline with their times and a bar; From the agent (report, commits); Ready now (files, brief, what waits for the graph) |

**Goal**: the three pages as the proofs draw them, in both themes, from what Symbiote records. The
layout (frames, clusters, summaries, the map) stays as it is: only how nodes, edges and frames are
drawn changes. Bitwarden's graph (737ee3f, Angular) no slower than `main`: first paint, select,
mark reviewed, pan.

## The Graph page (decisions 835–841)

- **`SymbolNode`**: three lines in today's 58 px. The kind in caps, then the count of findings and
  the mark (`+` added, `−` removed, `~` modified, an arrow icon for moved: no proof draws one), V42's
  colours on a 16 % tint; the name in mono (struck through when removed); the signature in faint
  mono, cut to 80 characters in `SymbolData` so a long one is never laid out whole. The count is
  one number in the colour of the worst severity, its tip giving each. Reviewed nodes dimmed with
  a small ✓; context nodes transparent, external and unknown dashed. The tags move to the detail
  only. The mark and count: pure `nodeMarks()`, unit-tested.
- **The picked symbol's calls above the nodes**: `decorateEdges` gives only its edges a `zIndex`
  above the elevated selected node and the class that takes their pointer away. React Flow 12
  draws each edge in its own `<svg style="z-index">` (`@xyflow/react` 12.12.0): every other edge
  keeps its identity, so nothing else renders again on selection.
- **Edges**: context `--line-2`, added at 75 %, removed dashed red, the picked symbol's at 2.25 px.
  Frames, summaries, project frames, minimap and zoom controls in `normal.css`'s recipes; the map's
  label mechanics untouched.
- **The legend**: the marks, moved, added call, removed call, and projects and groups where they
  apply; the view toggles (Focus `f`, Context, Type references, Only changes since) as compact
  toggles at its right end (choice 4a). The keys stay in the head's Help.
- **The head**: the line "‹workspace› · first review · 7017d22 → b3fbfe0 · 5 files +47 −2" (git's
  lines where `./api/files` is served, else the symbol counts); errors and warnings as pills.
- **The sidebar**: Changes, Findings, Review with counts; the progress row; finding cards (icon,
  message, rule in mono; the picked one violet). A finding records one `message`: the proof's
  title and "why" are not split. A foot with the drafts and Finish review (to the Review tab). The
  Changes list takes the same marks.
- **The detail**: the head (kind, name, the kind's pill, file · line at sha, Open in VS Code); the
  findings as alerts; the uses split by side (pure `neighbourGroups()`: "Still used by" for head
  edges into a removed symbol, "Used before by" / "No longer uses" for base-only edges, else "Used
  by" / "Uses"); signature, members, the code; the comment box with Mark reviewed `r` and Comment
  last.

## The Files page (decisions 842–845)

- **One card**: the files (each its state: viewed ✓, open 👁; git's letter; name and folder; "· n
  comments"; lines), then "Your review" under them, replacing 435's tabs.
- **Viewed** (choice 1a): a mark in the review's `marks`, `file:<path>`, keyed by the file's head
  blob (its base blob for a deleted file), read by `git diff --raw` and given by `./api/files` as
  `blob`. A file changed since shows unviewed again. `v` and the file head's Viewed toggle it.
- **`ReviewTab`** restyled for both pages: comments as cards "on **Symbol** · line N", the summary,
  the verdicts as option cards with their consequences in words, Finish review (Ctrl/⌘ ↵ in the
  summary), the merge line; Merge into keeps V76's behaviour.
- **The file's head**: path, the kind's pill, lines, `2 of 5`, ↑↓ (`j`/`k`), Open in VS Code,
  Viewed. The diff: the proof's gutters, grounds and folds; comments as cards with Edit (the text
  back in the line's box) and Delete.
- **No syntax colours** (choice 3b): the proofs draw them; the viewer has none, and this keeps it so.

## Opening a review (decisions 846–847)

- **The head while it is analyzed**: the title and line; a status label "Analyzing · step 4 of 6"
  (amber), Failed or Stopped; Files and Graph, a spinner on Graph.
- **Reading the change**: the time (the server's `elapsedMs`), a bar in six, the step now ("3
  done, 3 to come"), Stop; the timeline, each step its sentence and its time from pure
  `stepTimes(previous, phase, now)`: from the poll that first saw it to the poll that first saw a
  later one; the running one counting. A step never seen (opened late, or between two polls) has
  no time; its neighbour's includes it. Failed: the steps stop at the last seen, marked failed,
  the error, Analyze again. Stopped: "Stopped at ‹step›".
- **From the agent** (a workspace's branch): its newest report in full (`/api/workspaces/thread`),
  the agent and when; its commits (`/api/workspaces/changes`), only when that read's `base` is the
  review's.
- **Ready now**: the files with their lines; Read the files; the brief (the workspace's `brief`);
  "Waits for the graph: Findings, the graph".
- **The server** (choice 2a): while a diff is analyzed, `./api/files` and `./api/file` answer from
  the pair (core's `listChangedFiles`, `listLineCounts` and the file's diff), the same rows the
  graph's site gives once it is done. The Files page opens read only meanwhile: no comments, no
  Viewed, "Comments open once the graph is built".

## Verification

1. **Tests first, seen red**: `nodeMarks`, the picked edges' z-index and identity,
   `neighbourGroups`, `stepTimes`, a file's viewed mark; the CLI's files during analysis and `blob`;
   e2e: the loading page (timeline, times, files, the workspace's report and commits; failed;
   stopped), the picked symbol's calls above a node (`elementFromPoint`), Files' Viewed, Edit and
   Ctrl ↵.
2. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
3. **Speed** against `main` (built from `git archive`), `viewer-check`: Bitwarden 737ee3f with
   Angular and the r1 set's graphs: first paint, select, mark reviewed, pan fps, edges in view.
4. **Audit at 1×, both themes**: small and big graphs, the map, summaries, several projects, a
   removed symbol still used, no findings, `symbiote pr`, loading, failed, stopped; the larger text
   size.
5. **Screenshots** before and after beside each proof, on one page.

**Risks**

| Risk | Mitigation |
|---|---|
| Three lines in 58 px at the larger text size | Audited; cut, never laid out again |
| Raised edges take a node's click | No pointer on them |
| Edges in view grow | Only the picked symbol's few edges change |
| The review file gains `file:` marks an older Symbiote drops | Marks are a plain record: an older viewer keeps only node marks, as for a symbol gone |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V90 | A review's pages: opening, Graph, Files | This branch |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 835 | A graph node (replaces V31's tinted ground) | **A neutral card: the kind in caps, one count of findings in the worst severity's colour, a mark for the kind (`+ − ~`, an arrow for moved); the name; the signature** | proof 03 and the kit: "a mark for the kind, never a side bar" |
| 836 | The picked symbol (replaces 280's outline for the selected node) | **A violet ring; its edges above every node, taking no pointer** | the proof; one decoration, no other edge rendered again |
| 837 | Frames and edges | **`normal.css`'s frame, edge strokes, minimap and zoom; the map's mechanics as they are** | the brief: only how they are drawn |
| 838 | The graph's view toggles | **Compact toggles at the legend bar's right end; the keys in the head's Help** | the person's choice 4a |
| 839 | The review's head line | **git's lines where served, else the symbol counts; errors and warnings as pills** | the proof; what a row counts is git's (432) |
| 840 | The sidebar | **The progress row in words, finding cards (message and rule), a foot with the drafts and Finish review** | the proof; a finding records one message |
| 841 | The detail | **Head, alerts, uses by side, signature, members, code, comment box last** | the proof's order |
| 842 | The Files page's list (replaces 435's tabs) | **One card: the files, then Your review** | proof 04 |
| 843 | A file viewed | **A `file:<path>` mark keyed by its blob from `git diff --raw`** | the person's choice 1a: exact, and a change since shows |
| 844 | Comments on lines | **Cards "You · on X · draft" with Edit and Delete; Ctrl/⌘ ↵ in the summary finishes** | the proof |
| 845 | Syntax colours | **None** | the person's choice 3b |
| 846 | Opening a review (supersedes 502, 503, 504) | **The six steps as a timeline with their times as the page sees them, a bar, Stop; failed and stopped in the same frame; no arcs, no comet** | proof 10; the page asks every 500 ms |
| 847 | What needs no graph | **Files from `./api/files`/`./api/file` served from the pair while analyzing, the Files page read only; a workspace's report, commits (same base only) and brief from today's endpoints** | the person's choice 2a; no new record |

**Not in V90 (later)**: the Overviews (step 4), Hive's pages (step 5), Merge and Start; syntax
colours; a finding's title apart from its message.
