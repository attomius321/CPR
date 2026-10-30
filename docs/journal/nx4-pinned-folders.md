# Journal: NX4 — Pinned folders in the nexus

[Index](../JOURNAL.md) · [Plan](../plan/nx4-pinned-folders.md)

## NX4 spike — how the person uses the nexus, and what Folders offers to come back to (2026-10-30, branch `feature/pinned-in-symbiote-nexus`)

Asked for "pinned" in the nexus, with no more said. Read NX1–NX3's plans and journals and the
page (`src/page/`). Then the person's logs (`~/.cache/symbiote/logs`, 2026-10-28 to 30) for the
nexus's runs and the Symbiotes it started and stopped, and `folders()` over their folders, run
with `node --experimental-strip-types`. The first plan pinned Symbiotes as tabs in the row; to its
questions the person answered "Folders", "Wait for my start" and "As you wish", and the plan was
rewritten for pinned folders before any code.

**Learned**:
- **Nothing the person chooses is kept**: 14 runs of the nexus in three days, each on a new port,
  so a page's own storage (per origin) would start empty at each. Pins belong in Symbiote's
  settings folder, beside `hive.json`.
- **The same folders, again and again**: of 10 Symbiotes started from the nexus, 9 were in
  `~/projects/Symbiote`. With nothing running, Folders' places are Home, `/`, `C:` and `D:`;
  `projects` is a place only while a Symbiote in it runs, and `Symbiote.worktrees` never is.
- **Most stops are restarts**: 6 of 7 stops from the nexus were followed by a start of the same
  repository 4–22 s later. Not NX4's; a Restart button is left for later.
- **A Symbiote costs 229 MB** resident here: nothing a pin shows starts by itself.

## NX4 — pinned folders in Folders' places, kept in the settings folder (2026-10-30, branch `feature/pinned-in-symbiote-nexus`)

Built after the person's OK, with their answers: pin folders, "Wait for my start", and a
repository's pin "as you wish" (taken: in its card's corner). NX4a: `nexus.json` in Symbiote's
settings folder, `GET /api/folders`' `pinned`, `POST /api/pinned`. NX4b: Pinned under the places,
the head's and the cards' pins, a pin's row and its unpin. NX4c: screenshots, numbers, docs.
Decisions 617–620.

**Learned**:
- **`pnpm --filter @symbiote/nexus build` builds nothing**, as the CLI's: the nexus has no `build`
  script. An e2e run went green on the first build's `dist/page/*.js`; `page/nexus.css` is served
  from the source folder, so the screenshots had the new CSS and the old script. Built with
  `tsc -b tsconfig.build.json` and run again.
- **Reserving the unpin's room beside the row cut the names and the wash**: at the places card's
  220 px "Symbiote.worktrees" read "Symbiote.worktr…", and the row's hover ended 30 px short of
  the places'. The sidenav's bin (V55) had the answer: over the row's end, the row keeping its
  room, `@media (hover: hover)` and `:has(:focus-visible)`; the card is 260 px.
- **The places come with a listing**: after a Symbiote started from Folders, its folder is no
  place until Folders lists again. The spec of a running Symbiote's folder pinned assumed it was.
- **The machine's drives are places** (`C:`, `D:` under WSL): a spec that lists the places names
  only the one it means.
- **The light shots came out dark**: the nexus's page takes its theme from the viewer's
  `localStorage` key (`symbiote.viewer.theme`), not from the browser's colour scheme. The
  screenshot script sets it before the page loads.
- **The hidden Symbiotes panel draws the same cards** (NX3's trap again): a locator of a card
  needs `.nexus-folders`.
- **An eyeball misread an alignment**: the narrow hint looked 14 px left of its head; measured,
  both start at x 33.

**Verification**: tests first (red: no `pins.ts`, no route; the page's pure functions missing),
the nexus's unit tests 94 → 108; `pnpm check` passes (2,465 tests); e2e: `pins.spec.ts`'s 3 specs,
the nexus's 18 (the 3 in Symbiote's window under Xvfb) and the whole suite (`pnpm test:e2e`: the
viewer's 349 in 5.3 min, the nexus's 18 in 21.7 s). The pins read with each
listing: 0.1–0.4 ms with none, 0.6–0.7 ms with five (one on `/mnt/c`, one gone) beside the
3.3–4.3 ms of `~/projects`' listing; a pin 0.7–2.7 ms. 48 screenshots at 1×, dark, light and Hive
mode, 1440 and 800 px. `git diff --stat main`: `packages/nexus`, the docs, the README.

Not verified: macOS and Windows outside WSL; the person's WSLg window (Xvfb only); two nexuses
pinning in the same few milliseconds; a reader test of the README's paragraph.
