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
