# Journal: V82 — Hive mode: a dangerous switch and an ink and crimson look

[Index](../JOURNAL.md) · [Plan](../plan/v82-hive-mode.md)

## V82 mockups — two looks tried on the running viewer (2026-10-30, branch `feature/hive-mode-setting`)

Both mockups were real screenshots: `symbiote view` on this worktree, 1440×900 at 1×, both themes,
a trial stylesheet and the new Settings page added in the browser by a Playwright script (outside
the repository). The first, a neutral ink tint with white highlights and faint line tendrils, was
too quiet: "more like this, but redish and black", with a picture of glossy black liquid. The
second (ink and crimson, glossy tapered tendrils, the dialog always in the look with tendrils
joining into a hexagon) was approved.

**Learned**:
- **A token overridden for dark Hive under `:root[data-hive]` alone also reaches light**: the
  first mockup's dialog was dark on the light theme (`--dialog-bg`), its words dark on dark. Dark
  Hive's block is `:root[data-hive]:not([data-theme='light'])`.
- **Line tendrils read as wires on near-black**: only their rims showed. Filled, tapered shapes
  (a centreline offset by a width that thins to a point) with a crimson edge and a white
  highlight read as glossy liquid.
- **A trial `--edge` of `#6e575b` was 2.995:1** on `--side`, under the 3:1 rule by rounding;
  `#725b5f` is 3.07.
- **Opening `/nucleus` in a worktree's `symbiote view` shows the person's live Nucleus
  conversation** and touched the main checkout's `symbiote/` files: screenshots leave Nucleus out.

## V82 — Hive mode in Settings and its ink and crimson look (2026-10-30, branch `feature/hive-mode-setting`)

Built as planned (decisions 611–616): `hive.json` in Symbiote's config folder and `/api/hive`;
the server writes `data-hive` on `<html>` with every page, the nexus with its own; Settings' Hive
mode entry, its warning and danger button, the question in Hive's own look with tendrils joining
into a hexagon; the tokens, the sheen, the tendrils at the sidenav's foot and the crimson S while
it is on.

**Learned**:
- **An ink element in a light page needs the whole dark set**: Hive's names alone left light
  Hive's sidenav with light states (amber `#9a6700` on near black). The theme's dark block also
  matches `:root[data-hive] .sidenav` and `.hive-ink`, Hive's after it. Two tests looked the dark
  block up by its selector (`tokens.test.ts`, `icons.test.ts`): both follow it.
- **`position: relative` for the tendrils broke the narrow drawer on paper**: Shell.css's
  `.shell.drawer-open .sidenav { position: fixed }` has the same specificity and comes earlier.
  `:where(:root[data-hive]) .sidenav` has none; the drawer measured `fixed` in both themes.
- **The tendrils showed through the workspace cards** in a 700 px window: a card is a 3.5 % wash.
  They take at most 45 % of the sidenav, their tops cut (`slice`) and faded by a mask.
- **`pgrep -f`'s pattern matched the shell running it twice**, once through a restart later in
  the same command line: find a server by its port (`ss -ltnp`), stop it by PID.
- **"Off is main" needs a baseline of noise**: `main` against itself differs on Workspace History
  (a live timeline, ~175,000 px), Git (times, ~120–220 px), a graph's corners (57–74 px) and the
  working spinner (~115 px); the branch against `main` differs by those and Settings' new entry
  only.

**Verification**: tests first (red: the record, `/api/hive`, the nexus's page, the Hive token
blocks; the geometry test's straight line was wrong, not the code: a cubic's parameter is not its
length unless its control points are evenly spaced). `pnpm check` 2,451 tests (once 2,450:
`nucleus.test.ts`'s temp folder removed while a file was written, `ENOTEMPTY`; three reruns
passed, a file this branch does not touch); `pnpm build`;
`pnpm test:e2e` 349 viewer and 15 nexus
tests (the Hive, Settings, shell and look specs again on the final build: 39). Every page with Hive off and on, dark and light,
1440×900 at 1×, no page errors; the drawer at 820 px; 3× zooms of the new page's text. Pan of a
3,468-symbol diff: 60–61 fps on and off, three runs each, alternated (headless).

Not verified: an open workspace's page and Nucleus's page (they attach to live agents'
terminals); the nexus's page in a browser; the app's window; panning on a GPU.
