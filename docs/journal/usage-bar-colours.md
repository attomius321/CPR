# Journal: Feature — the usage bars' colours back

[Index](../JOURNAL.md)

## Feature — the usage bars' colours back (2026-10-22, branch `feature/bottom-statuses-of-models`)

The person: the status bar's usage bars used to be coloured by how full they are; they want that
back, with V29c's thresholds.

**Learned**:
- **V31a greyed the green, not the tones.** `usageTone` still gives `ok` under 80 %, `high` from
  80 % or a vendor's warning, `full` at 100 % or a reached limit; V31a ("usage bars grey until
  they near the limit") changed only `.tone-ok`'s fill to a muted grey. Most of the time a window
  is under 80 %, so the colours looked gone. `tone-ok` is `--added` again.
- **The style skill said a third thing**: grey under 60 %, amber from 60 %, red from 80 % — never
  built. `components.md` now states V29c's tones, so the next restyle keeps them.
- The usage spec checked the tone classes only, so a fill's colour could change unseen.

**Verification**: the usage spec now compares each bar's computed fill with its token as the page
resolves it (green 59 %, amber 84 %, and a new test with a window at 100 %: red bar and number);
red first on the green checks only. `--added` against `--raised` was already in the contrast test.
`pnpm check`: 1,110 tests; build; e2e 174 of 174. Screenshots of the status bar at 1440×900,
dark and light, at 59/84 % (green, amber) and 100/30 % (red, green). Not verified: other browsers;
real usage numbers (the spec's fake endpoint only).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `b73a965`, no conflicts
(`main` had not moved since the branch).
