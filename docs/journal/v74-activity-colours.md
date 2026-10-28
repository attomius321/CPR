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

## V74 — the Activity tab in colour (2026-10-28, branch `feature/workspace-activity-improvements`)

Built as planned: seven `--phase-*` tokens (V74a); each group's icon on a 28 px tile on the rail in
its kind of work's colour, the status on the tile's ring and in the badge with an icon, the person's
messages in bubbles, reports two lines, events', the live strip's and raw lines' colours (V74b).
Decisions 528–531.

**Learned**:
- **`--ring` is taken**: it is the focused field's ring token. A status ring named `--ring` on a
  failed group would have recoloured the focus of any control inside it: `--status-ring`.
- **A custom property inherits into the events**: an event of no kind (a task's update) would take
  its group's colour; `--phase` is reset on events without a `phase-*` class.
- **The e2e spec caught what the screenshots had not yet**: the rule giving a message's bubble its
  padding also reset its radius to 0 (it matched the summary's rule).
- **The real records have no failures, commits or questions to show**: written before V73 kept exit
  codes, and the scratch branches have no commits. Those states were drawn with the e2e suite's fake
  agent, from a spec kept outside the repository.

**Verification**: tests first, red for the right reason (the tokens undefined, the words'
functions missing, the live strip without `kind`, the e2e tile absent). `pnpm check`: 2,073 tests.
e2e: 335 of 336 (5.0 min), the new Activity spec among them; the one failure, Scout's
`scout.spec.ts:475` (its record read before it was written), passed alone on the final build with
the five Activity specs. Screenshots before and after on three real records and the fake agent's states, 1440 and
760 px, dark and light, 1×.

Not verified: the desktop app (Electron) drawing the tab; a colour-blind reading of the seven
hues (each tile's title names its kind).
