# Journal: Fix — Compare mode's toggle stays put with wider fonts

[Index](../JOURNAL.md)

## Fix — Compare mode's toggle stays put with wider fonts (2026-10-19, branch `fix/compare-toggle-wrap`)

`commits.spec.ts:161` failed on `main` in a Linux container: at 1280 px, turning Compare mode on
moved the toggle 15 px down. With the branches panel, the header's items did not fit on one line,
so the actions ("Start a workspace", added by V18, and Compare mode) wrapped to a row below the
help, and that row moved with the help's line count: one line in browse mode, two in compare mode.
The test passed where it was written because `system-ui` there is narrower than Inter, this
container's.

**Learned**: the V13 rule ("the keys wrap inside their space, the toggle stays") held only while
the actions fitted beside the keys; V18's second button broke it on wider fonts. The keys and the
actions now wrap as one unit (`.commits-tail`), the actions on the keys' first line.

**Verification**: the existing test red on `main`, green after. The toggle's top at 1440, 1280
and 760 px, browse then compare mode: 55.6/55.6, 55.6/55.6, 82.8/82.8 px (before: 82.8 → 98.0 at
1280). Cost: at 1280 px with the panel, compare mode's help wraps to four short lines beside the
actions instead of two lines above them.
