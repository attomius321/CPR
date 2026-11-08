# V98 — Pages loaded on demand: a smaller first script

[Index](../PLAN.md) · [Journal](../journal/v98-pages-on-demand.md)

**Status:** planned (2026-11-06), to be built on branch `feature/v98-pages-on-demand` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** feature (milestone) · **Branch** `feature/v98-pages-on-demand` · **Size** M · **Depends
on** none · **Plan** P39 of 51 (the audit's order)

## The brief

**What to change**: every page of `symbiote view` loads one 1.16 MB script (364 kB gzipped)
before it draws, whatever the page. Load each page's code when it is first opened, keeping the
first page's first paint as fast or faster.

**Where to look**:
- `packages/viewer/vite.config.ts` (no `build.rolldownOptions`, no chunking).
- `packages/viewer/src/shell/Shell.tsx:3-40`: every page imported statically (`HistoryPage`,
  `MergeView`, `NucleusPage`, `OverviewPage`, `SettingsPage`, `SkillsPage`, `MonitorPage`,
  `StartPage`, `WorkspaceHistory`, `WorkspaceView`).
- `src/main.tsx` (imports `diff/App.tsx`, which brings React Flow and dagre).
- What is already split: `intro/play.ts`, xterm (`AgentTerminal.tsx:154`, `StepLog.tsx:140`),
  `marked` (`ui/markdown.ts:144`).
- The viewer's `CLAUDE.md`: the stylesheet is one list in `styles.css`, never imported by a
  component (`test/styles.test.ts`); fonts and first paint (`/git`, Bitwarden).

**Out of scope**: the stylesheet (260 kB, one file by design); the layout worker; the intro's
chunk.

**Done when**:
- The script loaded before the first page draws is ≤ 450 kB (≤ 150 kB gzipped).
- Each other page arrives as its own chunk on first navigation, shown with the shared `Loading`
  while it loads.
- Vite's "chunks larger than 500 kB" warning is gone.
- First paint on `/git`, `/overview` and Bitwarden's graph is no slower than `main`'s, over 3
  rounds back to back.

## Problem (asked: "find what can be improved"; finding V12 of the audit)

Measured from `pnpm build` on `main` c2aa5c4:

| Asset | Size | gzip |
|---|---|---|
| `index-C32ADK0U.js` | 1,158.8 kB | 363.6 kB |
| `xterm-ScmBfeDI.js` (split) | 331.2 kB | 83.0 kB |
| `play-CIz0ZEKD.js` (the intro, split) | 65.8 kB | 28.0 kB |
| `marked.esm-CAMd3wer.js` (split) | 46.1 kB | 13.7 kB |
| `index-Cc_R1sFv.css` | 260.3 kB | 44.6 kB |

Vite warns: "Some chunks are larger than 500 kB after minification." First paint today is fast on
this machine:
- the fixture pages: 44–130 ms to the page head;
- Bitwarden 737ee3f: 307–340 ms first paint, 103–104 ms select, 34 ms mark, 63 fps pan.

So this is about load on slower machines and parse time, not a measured slowness here. Measure
parse and compile time first (V98a). If the first page's script costs under ~30 ms there,
consider stopping after V98a's numbers.

**Goal**: the first page parses only its own code. A page opened later loads in one round trip
from localhost (no visible wait at 1x on this machine). Nothing on screen changes.

## Design

### What splits

- The shell's pages through `React.lazy`: Settings, Skills, Monitor, History, Nucleus, Start, a
  workspace's page, a merge page, the Overview, Git. The shell, the sidenav, the status bar and
  the title bar stay in the first chunk.
- A diff's Graph page (React Flow, dagre, `graph/`) splits from its Files page. A diff opens on
  Files (V60), so React Flow loads only when Graph is opened. `?view=graph` and `measure.mjs` load
  it at once.
- Each `lazy` page is wrapped in a `Suspense` whose fallback is `ui/Loading` inside the page frame
  (`PageHead`'s place kept), so the frame does not jump.

### The stylesheet

It stays one file, in `styles.css`' order (`test/styles.test.ts`). A lazy page imports no CSS.

### Prefetch

Once the first page has drawn and the browser is idle (`requestIdleCallback`), import the other
pages' chunks, so a navigation never waits on the network, only on parse.

## Verification

1. **Size**: `pnpm build`'s table. The entry chunk ≤ 450 kB (≤ 150 kB gzip); a test reads
   `dist/assets/*.js` sizes from the build manifest (new, `scripts/viewer/chunks.mjs`) and fails
   above the budget.
2. **e2e**: every spec as it is. `page-frame.spec.ts` and `title-bar.spec.ts` show the frames
   unchanged. A new spec: navigate through every page with the network throttled
   (`page.route` delaying `/assets/*.js` 300 ms) and see `Loading` in the frame, then the page,
   with no page error.
3. **First paint**: `measure.mjs` on Bitwarden 737ee3f and the `/git` and `/overview` timings,
   3 rounds alternating with `main`'s build (viewer-check skill); today 307–340 ms on Bitwarden.
4. **Parse time**: Chromium's performance trace, script evaluation before the first paint, before
   and after (V98a).

**Risks**

| Risk | Mitigation |
|---|---|
| A page flashes its `Loading` on every first visit | Idle prefetch; localhost is ~1 ms a chunk |
| A lazy boundary splits a module both sides use, so it loads twice | Rolldown's shared chunks; the size test lists every chunk |
| The worker's URL (`new URL('./layout-worker.ts', import.meta.url)`) moves with the Graph chunk | The worker is its own entry already; `layouts.test.ts` and the graph specs |

**Order**: V98a measures. Then the Graph page split (the largest dependency), then the shell's
pages, then the prefetch.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V98a | Measure: chunk sizes and script evaluation before first paint, today | numbers in the journal; go or stop |
| V98b | The Graph page on demand | React Flow and dagre out of the first chunk |
| V98c | The shell's pages on demand, idle prefetch | `React.lazy` per page; the size test |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 942 | What loads before the first page draws | **The shell and the page asked for; every other page, and React Flow, on demand through `React.lazy`, prefetched once idle** | One 1.16 MB script for every page; Vite's 500 kB warning |
| 943 | Where a page loads | **In the page frame, with the shared `Loading` in its body; the head's place kept** | The frame never jumps (V72, `page-frame.spec.ts`) |

**Not in V98 (later)**: splitting the stylesheet; code-splitting inside a page (Settings' entries).
