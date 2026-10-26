# Journal: V59 — Scout's link, whole, when it waits for you

[Index](../JOURNAL.md) · [Plan](../plan/v59-scout-waiting-mark.md)

## V59 spike — how a waiting Scout looks today (2026-10-26, branch `feature/scout-waiting-for-you`)

Screenshots of `main` at `00d88e1` by a Playwright spec outside the repository on e2e's
`serveWorkspaces` (the fake Claude Code): Scout's session set to wait (`waitingFor: 'permission
prompt'`, read as `needs-you`), Scribe's too, and a workspace blocked on a permission beside them;
1440×900, device scale 1, dark and light; the sidenav open, folded, and on Scout's page.

**Learned**:
- Scout waiting is a 7 px amber dot (11 px with its 2 px halo) at the right end of its 32 px link,
  ~220 px wide in the default 240 px sidenav. The link itself is as at rest — muted words, a faint
  icon, no background — and says "Waits for you" only in its tooltip.
- A waiting workspace a few rows below is a band: the amber wash, edge and bell of Waiting for you
  (V48), with what it asks in words. Beside it the Scout dot is the quieter of the two signs for the
  same thing.
- Scribe waiting on a permission shows a **green** dot on Skills: `nextScoutMark` takes `needs-you`
  as one of the turns that end on the person, and the sidenav draws that as answered. Only Scout's
  link had a waiting state (`scoutWaits`, MC1).
- Folded, the dot sits on the icon's corner, 11 px on a 36×32 px link.
- The sidenav stays across the shell's pages (they open in place, V29a): an animation keyed on
  `data-state` runs once when the state comes, not on each page.

## V59 — Scout's and Scribe's links, whole, an amber band while they wait (2026-10-26, branch `feature/scout-waiting-for-you`)

Built as planned (decisions 422–425): waiting on the person, Scout's link and Skills' (Scribe) are
Waiting for you's band — an amber wash, a 1 px ring drawn as an inset shadow, the icon amber, the
words at full strength, "Waits" for the dot, the name saying it —, the dot kept for the folded
rail, one 1.2 s flash as it starts.

**Learned**:
- **A wait was read once, then not again.** The workspaces, Scout and Scribe are read every 5 s
  only while something works or a terminal is open (V48, V27b). A waiting workspace counted;
  Scout or Scribe waiting did not. Skills' e2e showed it: Scribe stopped waiting while the page was
  on History and its band stayed. Answered in its own terminal it was read (the open terminal
  keeps the reads on), so the person rarely met it; a louder mark makes a stale one worse. Now
  `readEvery` counts `needs-you` for both.
- **Chromium gives a colour in a transition or an animation as `oklab()`**, at rest a
  `color-mix(in srgb …)` as `color(srgb …)`: the test reads a colour only once it is `rgb()` or
  `color(srgb)`, which also waits out the 150 ms transition and the 1.2 s flash.
- **Turning reduced motion off again replays the flash**: `animation-name` comes back from
  `none`, and a new animation starts.
- **A ring as a shadow keeps the link's box**: measured equal before and while it waits (the e2e
  compares the bounding boxes), so neither the links below nor the rail move.
- **Two waiting links one above the other** (Scout and Skills) are 2 px apart, their rings not
  touching: two bands, not one block (screenshots, both themes).

**Verification**: tests first, red for the right reasons (Scout's e2e: its name; Skills' e2e:
"answered" for "waiting"; `readEvery` 2), then green. `pnpm check`: 1,799 of 1,799 unit tests.
`pnpm build`. `pnpm test:e2e`: 277 of 277 (4.5 min). Screenshots at 1440×900, 1×, dark and light,
before and after: the sidenav with Scout, Scribe and a workspace waiting, hovered, folded, on
Scout's page and at rest; the narrow drawer at 420 px. Not verified: the desktop app on WSLg, a
touch screen, a real Claude Code dialog in Scout's terminal.
