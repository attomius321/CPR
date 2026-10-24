# Journal: RM2 — The Monitor's look: long files in heat, the folder in view as the heading, a way back

[Index](../JOURNAL.md) · [Plan](../plan/rm2-monitor-styling.md)

## RM2 spike — what the Monitor shows, and how long files are (2026-10-24, branch `feature/monitor-styling`)

Asked: "current monitor lacks the centric element. needs some styling so it would be easier to go
through the elements..color the section of files based on their number of files, also need a move
back button, or keybinding"; then, on the plan, "COlour: by nr of lines, per file.. the file
should have different colors..like normal (current) -> yellow -> orange -> red". Screenshots of the
Monitor at 1440 × 900, scale 1, both themes, on this repository (`f6e5408`) and Bitwarden's
clients (`51450a5`); file counts per section from `git ls-tree`, and lines of code per Source file
from `scanCodebase`, on this repository, Bitwarden and Qwik (`3fd543fb5`).

**Learned**:
- **One fill for every tile**: with Source alone, every tile is `--raised`; sections run together,
  and the light theme's tiles are 1.19:1 on white. Back is only Backspace, said only in the "?".
- **Files per section spread too far for a linear scale**: among a folder's children the largest
  holds 274 times the files of the smallest at Symbiote's root, 3,433 times at Bitwarden's, 1,678
  at Qwik's. The person then chose lines per file instead, which needs no scale per folder.
- **Long files are few, and hold much of the code**: 250 lines or more is 6.4–20 % of the files
  and 41–60 % of the lines; 1,000 or more is 0.4–1.7 % of the files and 10–26 % of the lines
  (medians 31–99 lines). Steps at 250, 500 and 1,000 mark them on all three.
- **The muted grey limits a light heat ramp**: held to 4.5:1 for `--muted` (`#56627a`), the light
  theme's orange and red tints came out `#fedabd` and `#fdd4d4`, hard to tell apart. The dark
  theme's washes pass with it (4.56–4.64:1). Hence the lines on a heat tile in `--text`.
