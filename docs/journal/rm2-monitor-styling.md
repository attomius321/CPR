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

## RM2 — long files in heat, the folder in view as the heading, a way back (2026-10-24, branch `feature/monitor-styling`)

A file's colour is its lines of code: its kind's fill under 250, yellow, orange and red from 250,
500 and 1,000, on its tile and its bar in the list, with a legend; Colour: Lines or Kind (Kind is
RM1's picture). The folder in view is the heading, with Back before it; sections stand 3 px
apart and the one under the pointer is outlined; Escape lets go of a picked file, else goes up.
Decisions 332–335.

**Learned**:
- **A dark yellow is olive**: washed into the navy panel the first step read as khaki beside
  orange and red. Darkening each hue to a set luminance (`#453806`, `#5c3616`, `#7c2b2b`) keeps
  them yellow, orange and red; the order still shows as contrast with the usual fill rising.
- **`pnpm check` was red on `main`**: `monitor/Treemap.tsx` beside `monitor/treemap.ts` trips
  `files.test.ts` (macOS's one name), in place since RM1 merged. Renamed to `TreemapView.tsx`
  in a commit of its own.
- **An e2e Backspace right after `goto` does nothing**: the folder above is known only once the
  map is read. The test waits for the heading; a person cannot press before the page shows.
- **Moving the legend** to the heading's end kept the head at three rows at 1440 px; beside the
  chips it pushed itself and the Colour control onto a row of their own.

**Verification**: tests first, red for the right reasons (no `HEAT`, no `section`, no heat
tokens; e2e: no legend, no Back), then green. `pnpm check`: 1,543 tests. `monitor.spec.ts`: 6 of
6; the whole e2e suite 232 of 232. Screenshots at 1440 × 900 and 820 × 900, scale 1, both themes, on Symbiote and Bitwarden, the
states (a section outlined with a red file picked, Kind), the head at 3×; History, Settings,
Skills and Scout once. One layout at 1000 × 640, `main`'s against this one: 0.13 / 0.14 ms
(Symbiote), 0.27 / 0.27 (Bitwarden), 0.25 / 0.26 (Qwik). Bundle: CSS +1.5 kB, JS +2.1 kB.

Not verified: the desktop window (the same viewer); a screen reader.
