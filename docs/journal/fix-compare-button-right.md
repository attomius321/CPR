# Journal: Fix — Compare mode at the header's right

[Index](../JOURNAL.md)

## Fix — Compare mode at the header's right (2026-10-14, branch `fix/compare-button-right`)

Asked: "Move the compare mode button on the right side". It sat between the branch scopes and the
HEAD chip (on this repository at 1440 px, its right edge 745 px short of the list's), and turning
it on widened it ("x" → "Esc"), moving the HEAD chip. It is now last in the header, its right edge
in line with the list's; the keys' help fills the space before it and wraps inside it (compare
mode's longer help: two lines at 1440 px, the header 42 px instead of 49), so the toggle stays in
place when turned on. Narrower (900 px), it goes to the second line, still at the right.

**Verification**: an e2e test at 1280 and 760 px — the toggle's right edge within 1 px of the
list's, the same right edge and height on and off (red before: 713 px off). 599 unit tests,
70 e2e. Screenshots at 1440 and 900 px, on and off, no page errors.

Merged into main (2026-10-14). `main` verified after the merge: 599 unit tests, build, 70 e2e.
