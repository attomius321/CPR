# Journal: V34 — Panels one can resize: the sidenav and a workspace's changes

[Index](../JOURNAL.md) · [Plan](../plan/v34-resizable-panels.md)

## V34 — panels one can resize: the sidenav and a workspace's changes (2026-10-22, branch `feature/resize-left-right-panels`)

Asked: "resize - drag - the left panel with the pages and workspaces, and also from workspaces the
right changes made". The diff's `Resizer` now also drives the shell's sidenav (180–480 px, the
main area keeping 480) and a workspace's changes (200 px up to a 480 px terminal); arrows, Home,
End and double-click as on the diff; widths kept in the browser (decisions 233–235).

**Learned**:
- **A handle need not sit between its panel and the rest.** The sidenav is a grid column, so its
  handle is a grid item over the sidenav's border, and `Resizer` takes `find` to get the panel
  and the main area instead of its siblings.
- **Folding must not lose the width**: the rail sets `--sidenav-width: 48px` on `.shell`, which
  an inline width would beat. The drag writes `--sidenav-open`, from which `--sidenav-width`
  comes unless folded.
- **One storage entry, several writers**: the diff wrote the whole `symbiote.viewer.widths`
  object from its own state, which would drop a sidenav width set on another page. Each writer
  now merges its own field (`saveWidth`).
- **The terminal follows by itself**: its `ResizeObserver` refits it as the changes widen
  (144 px fewer = 18 fewer columns, asserted).
- **The sidenav and the changes share the window**: at 1440 px, a sidenav over 240 px brings the
  workspace under 1,200 px, where V29d hides the changes (decision 186). Not changed: the person
  decides whether the threshold should follow the terminal's 480 px instead.

**Verification**: tests first, red for the right reason — `widths.test.ts` (no module) and
`e2e/panels.spec.ts` (6 of 7 on `main`'s build, waiting for the handles). `pnpm check` 1,116 tests;
e2e 180 of 180. `/history` first contentful paint, 6 rounds back to back: median 34 ms on both
builds. Screenshots at 1440×900, dark and light: defaults, narrowest, widest, the handle on hover.
Not verified: the desktop app (Electron), other browsers, touch.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `ca57f97`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md` and `docs/PLAN.md`, both resolved in the merge.
