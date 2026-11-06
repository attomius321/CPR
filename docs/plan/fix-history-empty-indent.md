# Fix — History's empty state: both lines at one indent

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V9)

**Status:** planned (2026-11-06), to be built on branch `fix/history-empty-indent` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/history-empty-indent` · **Size** S · **Depends on** none ·
**Plan** P20 of 51 (the audit's order)

## The brief

**What happens**: on History (`/workspace-history`) with no finished workspace, the card's
first line, "No finished workspace yet.", starts 12 px in. The second, "A workspace comes here
when you clean it up…", starts 24 px further in and 24 px lower. The card's own rule asks for
6 px between them.

**How to reproduce**: `symbiote view` in a repository with no cleaned-up workspace, then press
`h`. Both themes, at 1x.

**Where to look**:
- `packages/viewer/src/workspaces/WorkspaceHistory.tsx:176-181`: the second `<p>` has
  `className="hint"`.
- `packages/viewer/src/ui/controls.css:313-316`: the global `.hint { padding: 24px; color:
  var(--muted) }`.
- `packages/viewer/src/workspaces/WorkspaceHistory.css:48-58`: `.history-none` gives its card
  `--card-pad` and `p + p { margin-top: 6px }`.
- `:228` uses `hint` too, with its own `.history-none-found` padding (`:133-136`).

**Out of scope**: History's list, its search and a picked workspace's page; the global `.hint`
rule, which other pages rely on.

**Done when**: both lines start at the card's inset (`--card-pad`, 12 px) and are 6 px apart,
in both themes. `page-frame.spec.ts` and `workspace-history.spec.ts` pass.

## Evidence

- **Reproduced**: [shot](../images/chore-improvement-audit/history-empty-indent.png), light
  theme at 1x, enlarged 1.5×. The DOM gave both `<p>` boxes at x 285, so the offset is the
  `.hint` padding inside the box.

## Approach

- Keep the muted colour, drop the padding: give the second line a class of its own
  (`history-none-hint`, after checking with `grep -rn '^\.history-none-hint' src` that the name
  is free) with `color: var(--muted)`. Remove `hint` from it.
- Do not change `.hint` globally: 7 other rules in `src` build on it (8 lines from
  `grep -rn "\.hint" src --include=*.css`, the global one among them).
- Follow the `symbiote-style` skill: a card's words start at `--card-pad`, and spacing comes
  from the layout tokens.

## Tests first

`packages/viewer/e2e/workspace-history.spec.ts`, beside its empty case (`:210`): measure both
paragraphs' first text node x (a `Range` box). Expect them equal, and the second paragraph's top
6 px (±1) below the first's bottom. It fails today (24 px apart in x).

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e` (`page-frame.spec.ts` measures History, empty).
- `viewer-check`: screenshots of History, empty, in dark and light at 1x. Compare with the
  audit's shot.
