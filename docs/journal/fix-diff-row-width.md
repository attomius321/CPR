# Journal: Fix — diff colours across the full line

[Index](../JOURNAL.md)

## Fix — diff colours across the full line (2026-10-02, branch `fix/diff-row-width`)

Reported from a real review: in the detail panel, a long line made the code scroll sideways and
the green/red row colour stopped at the panel's edge. Rows were as wide as the visible box, not as
the code. They now sit in a wrapper `width: max-content; min-width: 100%`, so every row spans the
longest line. An e2e test opens the panel in a 700 px window and checks each row is as wide as the
scrollable content (it failed before: 280 px rows, 447 px of code).
