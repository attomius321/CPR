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
