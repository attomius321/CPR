# Fix — The nexus in a browser can be light

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding N1)

**Status:** planned (2026-11-06), to be built on branch `fix/nexus-theme` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/nexus-theme` · **Size** S · **Depends on** none (P33, V97, may
later share the viewer's choices across origins) · **Plan** P22 of 51 (the audit's order)

## The brief

**What happens**: `symbiote-nexus --browser` always draws dark. Its page reads
`symbiote.viewer.theme` from its own origin's storage, which nothing sets: the nexus has no
Settings and no theme choice. In Symbiote's window the app hands the page the person's choices
(`symbiote:choices`), so there it follows the viewer's theme.

**How to reproduce**: `symbiote-nexus --port 0 --browser` in a browser set to the light scheme.
The page is dark, and there is no control to change it.

**Where to look**:
- `packages/nexus/page/index.html:13-21`: the inline script, `theme === 'light' || theme ===
  'system' ? theme : 'dark'`.
- `packages/viewer/src/ui/base.css:75-83,214,306-307`: `dark`, `light` and `system` (by
  `prefers-color-scheme`).
- `packages/desktop/src/main.ts:427-434`: the app's choices, given to a server's page.
- `packages/nexus/src/page/main.ts`: the page's head and its actions (Browse…).

**Out of scope**: the default. Decision 179 (`docs/plan/v29-workbench.md:329`): "Dark by
default; light and system kept, chosen per browser". The viewer's own Settings stays as it is.

**Done when**: the nexus's head has a theme choice (Dark, Light, System), the same words and
control as Settings → Appearance. It is kept in the nexus origin's storage and applied before
the first paint. In Symbiote's window the app's choice still wins.

## Evidence

- **Reproduced**: [shot](../images/chore-improvement-audit/nexus-light-scheme.png), a Playwright
  context with `colorScheme: 'light'`: the page drew dark.
- **Correction to the audit's suggested fix**: "default to system" would replace decision 179.
  A choice of its own keeps it. Since NX6 the nexus serves on a fixed port (7347, decision 923),
  so its origin, and a choice kept in it, lasts across runs.

## Approach

- A small segmented control in the nexus's page head, drawn with the viewer's classes (the nexus
  rule: its markup in the viewer's classes, `test/page.test.ts` guards them). It sets
  `document.documentElement.dataset.theme` and `localStorage['symbiote.viewer.theme']`, the key
  `index.html` already reads.
- In the app, leave the stored value to the app's preload: the choices it gives are written
  before the page's scripts run. A change made in the nexus goes back to the app through the same
  key (`symbiote:keep-choices`).
- Repaint the window's title bar on change: `paintTitleBar` (`page/main.ts:1252`) already reads
  the tokens.

## Tests first

1. `packages/nexus/e2e/nexus.spec.ts`: pick Light in the head. `html[data-theme]` becomes
   `light` and `--bg` resolves to the light token. Reload: still light. It fails today (no
   control).
2. `packages/nexus/test/page.test.ts` passes with any new viewer class added to its list.

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e` (the nexus specs run after the viewer's).
- Screenshots of the nexus in Dark, Light and System (with the browser's scheme light), at 1x,
  against the `symbiote-style` skill.
- In the desktop window on Xvfb (`:160` up, stopped by PID): the app's light choice shows the
  nexus light.
