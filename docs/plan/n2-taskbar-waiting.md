# N2 — The taskbar's icon says something waits for you

[Index](../PLAN.md) · [Journal](../journal/n2-taskbar-waiting.md)

**Status:** merged into `main` on 2026-10-27 (built 2026-10-27), on branch `feature/desktop-app-waiting-for-you`; plan
agreed by the person ("1. Yes, everything. 2. Yes 3. Yes, blink is mandatory where it can do it.
OK"). Its "As built" and results below.

**Problem** (asked: "Is there a way to make the icon from the desktop bar to warn you that
something is waiting for you?"; then "Should at least work in linux", first). Today the only sign
outside the window is its title: "(2) History · repo — Symbiote" when two workspaces wait (V48).
Read on this machine (WSL2, WSLg 1.0.71, its weston at `2318fec`, Electron 44.9, X11 through
XWayland):

| What | Today |
|---|---|
| Windows taskbar button (WSLg) | the S, whatever waits; the title only in its hover preview |
| Counted in the title | workspaces in Waiting for you only: not Scout or Scribe waiting, an agent's ask (MC1), a merge that needs you |
| The page's reads while the window is minimized (`document.visibilityState` hidden) | none: `useWorkspaces.ts` and `useAsks.ts` skip them until the page shows |

What WSLg passes to Windows, from its source at the commit it runs:
- **The window's icon, each time it changes.** Its X11 window manager re-reads `_NET_WM_ICON` on
  every change of the property (`xwayland/window-manager.c`, `weston_wm_window_set_icon`) and the
  RDP shell sends it to the taskbar (`rdp_rail_set_window_icon`, a `WINDOW_ICON_ORDER`). It blends
  its own Linux mark over the icon's bottom-right quarter (`shell_blend_overlay_icon`).
- **No urgency.** Neither its window manager nor its RDP shell reads `WM_HINTS`' urgency or
  `_NET_WM_STATE_DEMANDS_ATTENTION` (no "urgen", "attention" or "flash" in either): a window that
  asks for attention does not blink its Windows taskbar button.

**Goal**: while anything waits for the person, Symbiote's taskbar icon carries an amber dot, and
when something new starts waiting while they are in another window, its taskbar button blinks
wherever the desktop can blink one. Linux first, WSLg included. In a browser nothing changes but
the title's count, which counts the same things as the icon.

## What waits

- One count, `waitingCount` (a pure module beside the shell): each workspace in Waiting for you
  (an agent's question or permission, interrupted, a plan to read), each merge that needs the
  person (`needs-you`: a question, a resolution to review, conflicts the merger left), Scout when
  it waits (its ask or a dialog in its terminal, as its link's band), Scribe when it waits, and
  each ask of an agent through `symbiote mcp` (the ask bar's).
- The window's title says it: "(3) History · repo — Symbiote". The sidenav's count beside
  Workspaces counts what its section lists: the workspaces and merges that wait. Scout, Scribe
  and the asks keep their own marks (their links' band, the ask bar).

## The page tells the app

- The preload gives Symbiote's server pages `symbioteApp.waiting(count)`, sent as
  `symbiote:waiting`. The main process takes it only from the window's own server (`fromServer`)
  and only as a whole number from 0 to 999 (`readWaiting`).
- The shell's pages and a diff's page (both draw the sidenav) say the count each time it changes.
  The window's start page has none: showing it puts the count back to 0.
- In the app the readers of the workspaces and of the asks go on while the page is hidden: the
  icon depends on them. In a browser they keep today's rule (none while hidden).
- Chromium slows a hidden page's timers (to 1 s, and to once a minute after 5 minutes hidden).
  Measured in the real app with its window hidden; if the dot comes more than 10 s late, the
  fix is chosen on the numbers and recorded here.

## The icon and the blink

- **The dot**: an amber disc (`#f5b32a`, the dark theme's `--warning`, the colour of Waiting for
  you) in a ring of the app's `--bg` (`#090b0e`) so it stands off the S, at the icon's top-right
  (WSLg's mark takes the bottom-right). About 38 % of the icon across: 9 px on a 24 px taskbar
  icon. No number: a digit would be 7 px there; the title says how many.
- Drawn once, when first needed, from `icons/symbiote.png` in the main process: a pure function
  over the image's pixels (`badge.ts`, premultiplied BGRA as Electron's `nativeImage` gives
  them). No new dependency, no second image to keep in step with `scripts/desktop/icon.mjs`.
- **The window's icon**: `setIcon` with the dot while the count is above 0, the plain S at 0. Each
  window its own (each its repository).
- **The blink**: when the count rises while the window does not have the focus, `flashFrame(true)`;
  on focus, `flashFrame(false)`. On X11 Electron sets the window's urgency hint: XFCE, KDE,
  Cinnamon and MATE blink its task, GNOME says "Symbiote is ready". Windows blinks the button.
  WSLg reads no urgency (above): there the dot is the warning.

## Verification

1. **Unit tests, first** (red before): the dot's pixels (its centre amber, its ring dark, the S
   and the transparent corners outside the dot unchanged, its edge blended); `readWaiting`
   (whole numbers 0–999; anything else refused); what a new count does (icon, blink) by count
   before, after and focus; `waitingCount` from workspaces, merges, Scout, Scribe and asks.
2. **The viewer's e2e**: with a stand-in `symbioteApp` (an init script), a workspace that starts
   waiting is said (1), then 0 once it is answered; an ask and Scout's wait add to it; a diff's
   page says it too; the title's count is the same number.
3. **The real app's e2e** (`app.spec.ts`, on its own Xvfb): with a waiting workspace the window's
   `_NET_WM_ICON` (read with `xprop`) is amber at the top-right and plain once nothing waits;
   `WM_HINTS` has the urgency flag after a rise while not focused, and not after focus.
4. **Hidden**: the time from an agent's wait to the dot, the window hidden, at once and after
   6 minutes hidden.
5. **On the person's desktop** (WSLg), with their OK at the time: a Symbiote window for a minute,
   a workspace made to wait, the person looks at the Windows taskbar.
6. `pnpm check`, `pnpm build`, `pnpm test:e2e`. No analysis or graph change: no regression set.

**Risks**

| Risk | Mitigation |
|---|---|
| `nativeImage`'s bitmap is not BGRA on some system: the dot comes out blue | The real app's e2e reads the icon back from X11 and checks amber |
| A hidden page's reads come a minute late | Measured (4); the fix chosen on the numbers |
| Reading while hidden costs the app more | Only while something works or waits (today's `readEvery`); asks every 2 s, one small request |
| A count that never goes back to 0 (a page that stops saying it) | The start page and a stopped server put it to 0; each page says it on its first read |

**Order**: the desktop's pure parts and their tests, the viewer's count and its tests, then the
wiring, the e2e, the measurements.

## Milestones

| # | Milestone | Output |
|---|---|---|
| N2 | The dot and the blink, Linux first | `badge.ts`, the preload's `waiting`, the main process's icon and blink, `waitingCount`, reads while hidden in the app |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 465 | What counts as waiting | **Everything that waits on the person**: workspaces in Waiting for you, merges that need you, Scout and Scribe waiting, each ask through `symbiote mcp`; the title says the same number, the sidenav's Workspaces count its own section's (workspaces and merges) | The person: "Yes, everything"; Scout, Scribe and the asks have their own marks in the sidenav |
| 466 | How the app learns it | **The page says it** (`symbioteApp.waiting`), from the window's own server only, a whole number 0–999; 0 on the start page | The count is the viewer's (`workspaceGroups`, merges, asks); the main process reading the API itself would copy that logic |
| 467 | What the icon shows | **An amber dot, top-right, no number**, drawn at run time from `symbiote.png` | The person chose the dot; WSLg's mark takes the bottom-right; one source image |
| 468 | When it blinks | **When the count rises while the window is not focused**, until it is | The person: "blink is mandatory where it can do it"; a blink for every read would never stop |
| 469 | Reads while hidden | **In the app, on**; in a browser as before | A minimized window would otherwise never get its dot |
| 470 | A page hidden for 5 minutes | **Chromium's intensive wake-up throttling off in the app** (`--disable-features=IntensiveWakeUpThrottling`) | Measured (As built): with it, a hidden page's 5 s reads came once a minute after 5 minutes |

**Not in N2 (later)**: Windows' own overlay icon (`setOverlayIcon`) and the macOS Dock's badge
(`app.dock.setBadge`), not testable here; Electron's `app.setBadgeCount`, which on Linux works
under Unity only; a blink on WSLg (it would take a Windows process calling `FlashWindowEx` on
WSLg's window); the count in a diff page's title.

## As built (N2)

- **A page hidden for 5 minutes** (decision 470): the plan's step 4 measured it. A 5 s timer chain
  in a hidden Electron 44.9 window (Xvfb, transparent and opaque alike) woke every 6 s for 5
  minutes, then once a minute: 3 wake-ups from 5 to 8 minutes. So a minimized Symbiote's dot came
  up to 60 s late. The app turns that throttling off; a hidden page still wakes at most once a
  second and draws nothing, unlike `backgroundThrottling: false`, which would keep it drawing (an
  agent's terminal, the spinners) while minimized. With it off, a hidden page woke every 6 s from
  5 to 8 minutes too: 30 wake-ups, 3 before.
- **Measured outside Playwright**: under Playwright's control the app's page stayed `visible` after
  `BrowserWindow.hide()`; a plain Electron script's page goes `hidden`. The hidden timings come from
  such a script, the same timer chain as the viewer's readers.
- **The sidenav's count** adds its section's merges that need you, as planned; nothing else in the
  sidenav changed. Scout's and Scribe's waits are one rule now (`scoutWaiting`, `scribeWaiting`),
  read by the sidenav and by the count.
- **The dot** as planned: centre (0.77, 0.23), radius 0.19, ring 0.04 of the icon's side; drawn
  the first time something waits, 512×512.

**Results.** Unit: 8 tests for the dot, the page's number and what a change does; 6 for the count;
`pnpm check` 1,918 tests. E2E, with `main` merged in (V64, Settings at the sidenav's bottom,
then V65): 309 passed in 4.6 min. One run before failed one, a starting card 72.00003 px high
against 72, which passed 4 of 4 alone and in every run since. The new ones, each red
first for the right reason: the page says 0, 1 when an agent asks, 1 again from a diff's page, 0
when answered while hidden (red with the hidden reads off: it stayed 1); the real app's icon on X11
is the S's black (`ff000000`) at the dot's place, `fff5b32a` while the agent waits, with `WM_HINTS`'
urgency bit (256) while another window has the focus, cleared on focus, plain once answered (red
with `setIcon` cut from the build); the switch of decision 470 is on (red before it). Timing, the
window shown: the dot 2.1–5.3 s after the agent waits and gone 5.1 s after it is answered, the
5 s reads.

Not verified: the dot on the Windows taskbar through WSLg by eye (WSLg's source says it is sent;
the person's check is pending); the blink on KDE, XFCE or GNOME (the hint is set on X11; the
desktops were not run); a Wayland session (GNOME's default), not run: its docks usually take an
app's icon from its desktop entry, so the dot may not show there; Windows and macOS.
