# NX1 — Symbiote nexus: every running Symbiote in one window

[Index](../PLAN.md) · [Journal](../journal/nx1-nexus.md)

**Status:** built (2026-10-28), merged into `main` on 2026-10-28, on branch `feature/extend-view-with-wrapper` (a
workspace started in Symbiote). Planned and OK'd by the person the same day, with their answers
(decisions 519–523); NX1a–c built. "As built" and results at the end.

**Problem** (asked: "I need an app, that opens an interface from where i can select current
running symbiotes. Should be desktop and browser, like symbiote view"; then "Should be done in
it's own package, in this monorepo..i wouldn't touch the current desktop app..etc. I want symbiote
view to still work standalone, but one more connector that abstract multiple symbiotes"; and "The
symbiote view apps should be discovarable"). Measured on this machine (WSL2, 2026-10-28):

| What | Today |
|---|---|
| `symbiote view` servers running | 4: the person's (`~/projects/Symbiote`, port 38571), and 3 left by e2e runs of Oct 25–27, in temporary repositories with cache folders of their own |
| Where a server says where it is | `<cache>/views/<hash>.json` (MC1, decision 358: the MCP bridge's): url, pid, root, started. One per repository, keyed by git's common folder; removed when the server stops |
| What that misses | A second `symbiote view` of one repository (another worktree) overwrites the first's record; a killed server leaves its record |
| Telling a live server | `GET /api/status`: 17 ms, the branch, the head commit, the count of uncommitted changes |
| One place to pick a Symbiote | None: each `symbiote view` is its own window or tab, found by its port |

A spike framed `symbiote view` (main's build at `2e30fa9`) in a page served from another port, two
throwaway repositories, headless Chromium at 1440×900:

| Measured | Result |
|---|---|
| The Git page in a frame | Drawn whole (screenshot); the same failed responses as in a tab of its own (`/api/graph` 404, which the Git page asks for) |
| A write from a framed viewer | Passed the server's same-origin check (its origin is its own) |
| First History row | 121–208 ms framed; 138–143 ms in a tab of its own |
| Showing a Symbiote loaded in a hidden frame | 17–24 ms |
| Memory (the browser's processes) | 415 MB with a blank page; 587 MB with two framed viewers: about 86 MB each, on tiny repositories |

What causes the problem:
- Each `symbiote view` serves one repository on a port of its own; nothing lists them.
- MC1's record is one per repository, so it cannot list two servers of one.

**Goal**: one command, `symbiote-nexus`, opens a page that lists every running `symbiote view` on
this machine as tabs; picking one shows it, switching back is instant. Like `symbiote view`, it
opens Symbiote's window when the app is set up, else the browser. **Unchanged**: `symbiote view`
runs alone as today (it only writes one more small file); `packages/desktop`, the viewer and the
engine are not touched.

## Discovery

- **Each `symbiote view` says it runs**: `<cache>/running/<pid>.json` — url, pid, root, name (the
  root's folder, as the viewer names it), started — written when it serves, removed when it stops.
  One per server, so two servers of one repository are both found. Writing it also removes the
  records of servers whose process is gone (a killed one's).
- **One module for the format**: `@symbiote/nexus/registry` (`packages/nexus/src/registry.ts`,
  Node's modules only) writes and reads the records; `symbiote view` calls it. One format, nothing
  to keep in step.
- **The nexus reads** `<cache>/running/*.json`, and MC1's `<cache>/views/*.json` for servers built
  before this change (the same server in both is one). A record counts while its process lives and
  its `/api/status` answers within 1 s; anything else is left out (precise beats complete).
- **The cache folder** is `symbiote view`'s (`SYMBIOTE_CACHE_DIR`, else `XDG_CACHE_HOME`, else
  `~/.cache/symbiote`; macOS's Caches). Servers with a cache of their own (the e2e runs') are not
  listed.
- **One tab per folder**: a Symbiote is its root. Restarted on a new port, it is the same tab,
  reloaded there. Two live servers of one folder: the newest.

## The command and its server

- `symbiote-nexus` (`node packages/nexus/dist/bin.js`), anywhere, no repository needed:
  `--browser` (a tab), `--no-open` (the address only), `--port <n>` (default any free one), as
  `symbiote view`. It prints `Symbiote nexus: <url>  (Ctrl+C to stop)`.
- **The window**: the existing app in its `--url` mode, started as `symbiote view` starts it
  (Electron's binary from `pnpm app:setup`, `SYMBIOTE_APP`); its window's close ends the command.
  Without the app, or when its window does not open, the browser. No Electron code of the
  nexus's own.
- **The server** (`node:http` on 127.0.0.1): the page, its scripts and the viewer's stylesheet,
  and `GET /api/symbiotes` (the live ones, with their branch and uncommitted count). Only
  `127.0.0.1:<port>` and `localhost:<port>` as hosts, as the viewer's server. It never starts,
  stops or writes to a Symbiote; the Symbiotes outlive it.
- **Its logs** (LG1): `openLog({ process: 'nexus' })`, its lines beside the servers'.

## The page

- **The viewer's styling** (the person: "Keep the styling of symbiote view"): the page links the
  viewer's own built stylesheet (`@symbiote/viewer/dist/assets/index-*.css`, found from its
  `index.html`), with its tokens, Geist, controls and the app's frame, and draws its markup in
  the viewer's classes (`page-head`, cards, line tabs, `icon-button`, `window-buttons`). A small
  stylesheet of its own lays out the row and the frames.
- **The row** at the top (`--side`, a `--line` hairline under it): Symbiote's S, then line tabs —
  the first, Symbiotes, the list; then one per running Symbiote, its name and its branch in
  `--muted`. In the app the free space moves the window and the window's buttons are at its end
  (Linux; elsewhere the system's, kept clear as the viewer's title bar keeps them).
- **A Symbiote's tab** shows it in a frame filling the rest. Opened once, its frame stays loaded,
  hidden while another tab is shown, so switching back is instant and keeps its page. The frame
  takes the keyboard's focus, so `j`/`k` work at once, and may use the clipboard (Copy SHA, an
  image pasted in a terminal).
- **Symbiotes** (the first tab): the page's head (the S, "Symbiotes", how many run) and a card of
  rows — name, folder, branch, uncommitted changes, since when — each opening its tab. With none
  running: "No Symbiote is running", and how to start one (`symbiote view` in a repository).
- **Live**: the page reads `/api/symbiotes` every 2 s. A new Symbiote gets a tab; one that stops
  keeps its tab, marked stopped, its frame unloaded and a line saying so; it comes back by itself
  when its folder is served again.
- **The address** keeps the open tab (its hash, replaced, no history entry): a reload comes back
  to it. The window's title is the open Symbiote's name and branch, then "Symbiote nexus".
- **Code**: plain TypeScript compiled by `tsc` to ES modules served as they are; the page's pure
  part (the tabs from each read, the selection) in a module of its own, unit-tested.

## Verification

1. **Unit tests first** (red before): the records written, read and pruned (broken, foreign,
   dead); MC1's records joined; the live check (a dead pid, a status that does not answer); the
   cache folder against core's `defaultCacheDir`; the server's hosts and routes; the command's
   options, app or browser; the tabs from successive reads (new, stopped, back on another port,
   the selection from the address); `symbiote view` writing and removing its record.
2. **e2e** (`packages/nexus/e2e`, Playwright, after `pnpm build`; joined to `pnpm test:e2e`): real
   `symbiote view` servers on fixture repositories, a cache of their own. Both listed; a tab shows
   its Git page; switching keeps the first's state; a third appears within 3 s; a stopped one is
   marked and comes back; none running; a write from a framed viewer; the clipboard; no page
   errors in any frame. The app under Xvfb (`_electron`): the window, its buttons, a framed
   viewer, closing ends `symbiote-nexus`.
3. **Nothing else changes**: `git diff --stat main` shows `packages/nexus`, `symbiote view`'s
   record, the root's scripts and the docs; `pnpm check`, `pnpm build`, every e2e spec. No analysis
   change: no regression-check.
4. **The look** (`symbiote-style`, `viewer-check`): screenshots at 1×, dark and light — the row,
   Symbiotes, none running, a stopped one, in the browser and in the app.
5. **Real numbers**, on a copy of this repository (`git archive main`) and a throwaway, not on the
   person's running Symbiote: first paint, switching, memory for each framed viewer, `j` on a
   framed diff against a tab of its own.

**Risks**

| Risk | Mitigation |
|---|---|
| The browser's Back steps the frames' history, a hidden one's too | The nexus's own selection adds no entry; an e2e spec shows what Back does; recorded |
| Each kept frame costs memory (~86 MB on a tiny repository) | Measured on a real repository; unloading hidden frames is a small change if it matters |
| In the app a framed viewer's choices last one run (the app keeps the top page's only) | The defaults are the person's (dark, sidenav open) |
| A framed viewer's new-tab links open in the browser in the app (the window's home is the nexus) | Checked in the app's spec |
| The rounded window's bottom corners over a frame (Linux) | The frames' box takes the corners; `j` measured framed against a tab |
| The viewer's class names change | The nexus's e2e and screenshots run with every change |

**Order**: NX1a discovery, the server and the command (usable in a browser); NX1b the page;
NX1c the window, the look, the numbers and the docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| NX1a | Discovery and the command | `@symbiote/nexus`: the registry, `symbiote view`'s record, the live list, the server, `symbiote-nexus` |
| NX1b | The page | The row and its tabs, kept frames, Symbiotes, none running, stopped, the address; e2e |
| NX1c | The window, the look, the docs | The app's spec, screenshots, real numbers; README, commands, CLAUDE.md |

**Decisions** (the person's answers to the plan's questions, 2026-10-28):

| # | Question | Decision | Why |
|---|---|---|---|
| 519 | Where it lives, its name | **A package of its own, `packages/nexus` (`@symbiote/nexus`), the command `symbiote-nexus`** (the person: "name it symbiote-nexus") | "its own package … i wouldn't touch the current desktop app"; `symbiote view` stays standalone |
| 520 | How a running Symbiote is found | **Each `symbiote view` writes `<cache>/running/<pid>.json` through `@symbiote/nexus/registry`; MC1's records read too; live = its process and `/api/status`** (the person: the recommendation) | "should be discoverable": MC1's record is one per repository; one module keeps one format |
| 521 | One loaded, or all | **Opened Symbiotes stay loaded in hidden frames** (the person: "Keep them loaded") | 17–24 ms to show one again, its page kept; ~86 MB each on tiny repositories |
| 522 | The switcher | **Line tabs in a row at the top; Symbiotes first** (the person: "Yes, tabs") | The viewer has its sidenav at the left; tabs are the browser's way |
| 523 | The look | **The viewer's own built stylesheet, its class names** (the person: "Keep the styling of symbiote view") | One look, no copy of tokens to keep in step |
| 524 | The desktop window | **The existing app's `--url` mode, started as `symbiote view` starts it** | Not touching `packages/desktop`; its window, frame, keys and links as they are |
| 525 | The page's code | **Plain TypeScript, compiled by `tsc` to ES modules** | A small page: no bundler, no new dependency |
| 526 | What the nexus may do | **Read only: records and `/api/status`** | It connects Symbiotes; each stays its own |
| 527 | The CLI's small parts (cache folder, starting the app, opening the browser) | **Copied, tested against the originals' behaviour** | The CLI's modules load the engine (ts-morph) through `@symbiote/core` |

**Not in NX1 (later)**: starting or stopping a Symbiote from the nexus; what waits for the person
in each (the viewer's `whatWaits` reads five of its APIs) and the taskbar's dot; the nexus's own
keys and Back/Forward (a page cannot reach a cross-origin frame's history); `symbiote nexus` as a
command of the CLI; `symbiote pr`'s servers; Symbiotes on other machines.

## As built (NX1)

- **Discovery** (NX1a, decision 520): as planned. `symbiote view` writes its record right after
  MC1's, with the same `started`, and removes it in the same `finally`; MC1's record is unchanged.
  The CLI reaches the registry as `@symbiote/nexus/registry` (the package's one export; a vitest
  alias and a `paths` entry, as for the other packages). A status counts only with `version` text
  and a numeric `changed`, so another server on a recorded port is not taken for a Symbiote.
- **The row has no S of its own** (NX1b): the screenshots showed it doubled, by the list's head
  right under it and by each framed viewer's sidenav. The tabs start where the page's words do,
  16 px in.
- **A stopped Symbiote keeps its tab only if it was opened**: one never opened just leaves (the
  plan kept every one). An opened one keeps its tab, marked stopped, with a **Close tab**; its
  frame is unloaded; served again on another port, the same tab loads it there.
- **The clipboard in a frame** needs the frame's `allow="clipboard-read; clipboard-write"`: Copy
  SHA (and an image pasted in a terminal) would otherwise be refused by the permissions policy.
  An e2e spec copies a SHA from a frame.
- **The page's guard** (`test/page.test.ts`): every viewer class the page uses is checked against
  the viewer's CSS sources, so a renamed class fails a test instead of a look; `nexus.css`'s text
  sizes are `--size-*` tokens; the page's scripts import only their siblings at run time.
- **The keys**: ←, →, Home and End on the tabs (a tab list's). No keys of the nexus's own reach it
  from inside a frame: a cross-origin frame keeps its key events.
- **The window's title** follows the open tab (`ky · main — Symbiote nexus`), and the desktop app
  shows the page's title, so the taskbar and Alt+Tab say which Symbiote is open.
- **The rounded window's bottom corners** (Linux, decision 524's frame): the frames' box clips to
  them. Its cost was the plan's risk; measured, none (`j` below).
- **macOS's traffic lights**: the row keeps 76 px clear, a guess from the viewer's 78 px; not
  verified (no Mac).

**Results (NX1).** Tests first, red for the right reasons (no modules; `symbiote view` wrote no
`running/` record): 46 nexus unit tests (registry, discovery, server, command, the app's start, the
tabs, the page's guards) and 1 CLI test; `pnpm check` passes (2,114 tests, 2,100 before NX1b). e2e:
8 nexus specs (6 in a browser, 2 in Symbiote's window under Xvfb), and the whole suite passes (`pnpm
test:e2e`: the viewer's 335 specs in 5.0 min, then the nexus's 8 in 20.1 s). Playwright's
`pageerror` reports a frame's uncaught errors too (checked), so every spec's "no page errors" covers
the frames. Measured on a shallow clone of this repository (300 commits, `2e30fa9`) and a throwaway,
headless Chromium at 1440×900 unless said:

| What | Result |
|---|---|
| The list's first row, from opening the nexus | 56, 57, 72 ms |
| The clone's Git page, first row: in the nexus (from the tab's click) / in a tab of its own (from the address) | 237–249 ms / 149–238 ms |
| Showing a kept Symbiote again, from the click to two frames after it | 26–32 ms (the next paint) |
| Memory, the browser's processes | 409–411 MB blank; 663–704 MB with the nexus and two framed Symbiotes (the clone and the throwaway); 586 MB with the clone alone in a tab |
| `j` on the clone's 12-commit diff (103 symbols on the graph), median of 10, in Symbiote's window (Xvfb, the frame's rounded clip on) | framed 48 ms, the app on the diff itself 49 ms |
| … in Chromium | framed 49 ms, in a tab 35 ms (both 32–34 ms once warm; the first four presses 57–108 ms in either) |
| A real run here | the person's running Symbiote (built before NX1, found through MC1's record) listed in 24 ms |

Not verified: macOS and Windows (the traffic lights' room, Windows' overlay colours); the
person's own window on WSLg (Xvfb only); more than two Symbiotes at once (memory grows by about
a tab's worth each); a framed graph of Bitwarden's size; an agent's terminal in a frame hidden and
shown again (the e2e specs run no agent).
