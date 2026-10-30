# Journal: Fix — no Hive tendrils in the sidenav

[Index](../JOURNAL.md)

## Fix — no Hive tendrils in the sidenav (2026-10-31, branch `fix/remove-hive-tendrils-from-sidenav`)

The person: "let's remove this tendrils from the sidenav. We dont need it", about the
`canvas.hive-tendrils` that Hive tentacles put at the sidenav's foot (decision 633). Plan in
[V82's plan](../plan/v82-hive-mode.md#fix-no-tendrils-in-the-sidenav-fixremove-hive-tendrils-from-sidenav).

**Learned**:
- **The sidenav's drawing had its own code all the way down**: a scene (`sidenavScene`, its rise),
  a painter (`Painter.sidenav`, the webbing between roots, `edgeAt` used only there), a fit of its
  own in `paint` (`bottom`) and three CSS rules, two of them only to give the canvas a place
  (`isolation` on the sidenav, `position: relative` on the workspaces). Removed with it: 303 lines
  of source out, 12 in. The question's tendrils and the arrival share none of it.
- **The arrival ended with the sidenav's rise**: without it, it ends with the streak; its timing
  (decision 632) is unchanged.

**Verification**: `e2e/hive.spec.ts` now expects no canvas in the sidenav with Hive on — turned
on, after a reload, with reduced motion: red on `main` (3 of 5 tests, "expected 0, received 1"),
green after. `pnpm check` (2,481 unit tests), `pnpm build`, `pnpm test:e2e` (351 viewer, 20 nexus,
all passed). Screenshots with Hive on, dark and light, at 1280 and 700 px: no canvas on the page,
the sidenav's glow kept. Not verified: the app's window (Electron).
