# Journal: V74 — The Activity tab in colour

[Index](../JOURNAL.md) · [Plan](../plan/v74-activity-colours.md)

## V74 spike — what makes the Activity tab hard to read (2026-10-28, branch `feature/workspace-activity-improvements`)

Screenshots of V73's tab on copies of three of the person's recorded workspaces
(`workspace-activity`, 299 calls; `layout-fixing`, 355; `extend-view-with-wrapper`, 60, the first
recorded with V73's fields), served by this branch's `symbiote view` in a scratch repository, at
1440 and 760 px, dark and light, 1×. Then a preview of the plan's look: CSS added to the running
page by Playwright, nothing in the repository changed.

**Learned**:
- **Every phase is drawn alike**: the same `--muted` icon and `--faint` ring; on a 12-row screen
  only the test badges carry colour. The person's V73 mockup gave each phase a coloured tile; V73
  left them out ("colour is for state").
- **History's lanes cannot be a kind's colour**: lanes 5 and 6 change hue between the themes
  (`#ce9178` tan dark, `#4d7a00` olive light; `#8ccf3e` lime dark, `#9a6700` brown light). The
  Monitor uses lanes 1–3, which keep theirs.
- **A copied record that is `finished` is not listed**: the page says "No workspace …" until
  `finished` is dropped from the copy.
- **The preview**: tiles on the rail, the person's messages in bubbles and two-line reports read
  apart from the work in both themes; neutral titles read better than titles in the kind's colour
  (tried first); about 11 rows fit on a 900 px window against 12.
