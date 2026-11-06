# Journal: V97 — The viewer's choices kept across runs in a browser

[Index](../JOURNAL.md) · [Plan](../plan/v97-choices-kept.md)

## V97 spike (2026-11-06, from chore/improvement-audit)

The improvement audit read where the viewer keeps the person's choices; it did not run two views
to watch one reset (Code):
- **The viewer**: 12 keys in `localStorage` (`symbiote.viewer.theme`, `.text-size`, `.sidenav`,
  `.sidenav.diff`, `.changes`, `.widths` and six about folds and Focus).
- **Per origin**: `symbiote view` serves on any free port by default, and each port is a new
  origin with empty storage.
- **Symbiote's window**: `packages/desktop/src/state.ts:5-14` keeps the first six in
  `<config>/app/state.json` and puts them back before the page's scripts run (`:35-37` gives the
  reason).
- **A browser tab**: nothing puts them back, so the theme, text size, sidenav fold and widths
  start over at every run.
- **The nexus**: its page reads the same theme key from its own origin, where nothing sets it.
  Asked for the light scheme, it drew dark
  ([shot](../images/chore-improvement-audit/nexus-light-scheme.png)).

Not started.
