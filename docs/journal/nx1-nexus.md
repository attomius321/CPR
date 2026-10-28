# Journal: NX1 — Symbiote nexus: every running Symbiote in one window

[Index](../JOURNAL.md) · [Plan](../plan/nx1-nexus.md)

## NX1 spike — what finds a running Symbiote, and a viewer in a frame (2026-10-28, branch `feature/extend-view-with-wrapper`)

Asked for an app that lists the running Symbiotes and opens one, in the desktop and the browser,
in a package of its own, with `symbiote view` standalone and discoverable. Read: the desktop app
(`packages/desktop`, its `--url` mode and preload), `symbiote view` (`packages/cli/src/main.ts`),
MC1's view record (`mcp-bridge.ts`), the viewer's server checks (`server.ts`: hosts, writes) and
its title bar and frame. Measured on this machine: the running servers (`pgrep`, `/proc/<pid>/cwd`,
their listening ports), the records in `~/.cache/symbiote/views/`, `/api/status`; then a spike in
the job's folder: two throwaway repositories served by main's build (`2e30fa9`) with a cache, a
config folder, the intro, usage and terminals of their own, framed by a page on a third port, in
Playwright's headless Chromium at 1440×900.

**Learned**:
- **Four servers ran, one record**: the person's (`~/projects/Symbiote`, recorded) and three
  left by e2e runs of Oct 25–27, in `/tmp/symbiote-e2e-*` with `SYMBIOTE_CACHE_DIR` of their own.
  So reading the person's cache lists only real Symbiotes. But MC1's record is keyed by git's
  common folder: a second `symbiote view` of one repository overwrites it, hence a record per
  server (decision 520).
- **`/api/status` tells a live one**: 17 ms, `{ branch, head, changed, operation }`.
- **The viewer works in a frame**: no `X-Frame-Options`; the server's host check sees its own
  `127.0.0.1:<port>`; a POST from the frame passed the same-origin check (it came back 400 for the
  spike's body, after the 403 check). The Git page drew whole; its only failed response, the
  `/api/graph` 404, is there in a tab of its own too.
- **Kept frames switch at once**: History's first row 121–208 ms framed against 138–143 ms in a
  tab; a frame loaded while hidden showed its row 17–24 ms after being shown.
- **Memory**: the browser's processes 415 MB with a blank page, 587 MB with the page and two
  framed viewers (about 86 MB each, tiny repositories; one viewer in a tab of its own 580 MB with
  the blank page: framed viewers share the page's process).
- **What the app's `--url` mode gives a page served over http**: `symbioteApp` (its platform,
  who draws the frame, the window's buttons, the overlay's colours, the waiting count) and the
  viewer's kept choices in the page's storage, given back before its scripts run. A frame gets
  none of it: a framed viewer draws itself as in a browser.
- **The person's theme is dark**, the viewer's default: a framed viewer, which starts with empty
  storage in the app's per-run profile, matches it.

Not verified in the spike: the app's window (no Electron run), a real repository's viewer in a
frame, the clipboard in a frame.

## NX1 — Symbiote nexus, built: the records, the command, the page, the window (2026-10-28, branch `feature/extend-view-with-wrapper`)

Built after the person's OK, with their answers: the name `symbiote-nexus`, a record per server,
kept frames, tabs, the viewer's styling (decisions 519–523). NX1a: `@symbiote/nexus`, its
registry, `symbiote view` writing its record, the live list, the server and the command. NX1b: the
page, its tabs and kept frames, the list, stopped tabs. NX1c: the app's specs, screenshots, the
numbers on a clone of this repository, the docs. Decisions 519–527.

**Learned**:
- **The viewer's built stylesheet is enough to look like the viewer**: 180 KB with the tokens,
  Geist (its font files beside it), line tabs, the page head, buttons and the app's frame. The
  page links it and draws in its classes; a test checks each class is still the viewer's.
- **Two S marks, one under the other**: the row's own S sat 50 px above the list's head and each
  framed viewer's brand row. Dropped from the row after the first screenshots.
- **A frame needs the clipboard granted**: without `allow="clipboard-read; clipboard-write"` a
  framed viewer's Copy SHA is refused by the permissions policy; the spec copies a SHA.
- **A hidden panel keeps its words**: the stopped panel, hidden, still held "gamma stopped" and a
  spec found two empty states. The panel is emptied once it is not shown.
- **Playwright's `pageerror` covers frames**: checked with a page that frames one on another port
  and throws there; the specs' "no page errors" includes every frame.
- **The rounded clip costs nothing measurable here**: `j` 48 ms framed with the clip against 49 ms
  in the app on the diff itself (103 symbols, Xvfb, software rendering).
- **Switching is the next paint**: 26–32 ms from the click to two frames after it. A Playwright
  click measured it at 83 ms, its own checks included.
- **A text locator can match the viewer's hidden copy of a row**: `getByText('second').first()`
  waited on a hidden span in one repository; the specs and scripts wait on `.commit` or a visible
  match.

**Verification**: tests first (red: no modules; `symbiote view` wrote no `running/` record), 46
nexus unit tests and 1 CLI test; `pnpm check` passes (2,114 tests, 2,100 before NX1b); e2e: the 8
nexus specs (6 in a browser, 2 in Symbiote's window under Xvfb) and the whole suite passes (`pnpm
test:e2e`: the viewer's 335 specs in 5.0 min, then the nexus's 8 in 20.1 s). Screenshots at 1×, dark
and light: the list, a tab, a stopped tab, none running, 800 px wide, the app's window. Numbers in
the plan's results: the list's first row 56–72 ms, a kept Symbiote shown again in 26–32 ms, memory
about a tab's worth per framed Symbiote, `j` as in a tab. `git diff --stat main` touches no file of
`packages/desktop`, the viewer or the engine. No analysis change: no regression-check.

Not verified: macOS, Windows, the person's WSLg window (Xvfb only), more than two Symbiotes, a
Bitwarden-sized graph in a frame, an agent's terminal in a frame hidden and shown again.
