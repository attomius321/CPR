# V59 — Scout's link, whole, when it waits for you

[Index](../PLAN.md) · [Journal](../journal/v59-scout-waiting-mark.md)

**Status:** ready for review (2026-10-26), on branch `feature/scout-waiting-for-you` (a
workspace started in Symbiote, from `main` at `00d88e1`). The person OK'd the plan with "1. b 2.
a 3. a. Go": Skills takes the same band when Scribe waits, a 1.2 s flash when it starts to wait,
the window's title as it is. Built as planned, with the reads kept on while one waits; "As built"
and results at the end.

**Problem** (asked: "Right now, the scout waiting for my response is not that visible..maybe
change the style of the entire menu item."). On `main` at `00d88e1`, with the e2e fake agent
(screenshots at 1440×900, 1×, both themes, in the journal):

- When Scout waits on the person — an ask of its own through Symbiote's MCP (MC1) or a dialog in
  its terminal (`needs-you`) — its link in the sidenav's pages shows a **7 px amber dot**, 11 px
  with its halo, at the right end of a 32 px row about 220 px wide (`shell/Sidenav.tsx`,
  `state-dot tone-waiting`). The row is as at rest: muted words, a faint icon, no background.
  "Waits for you" is only in the tooltip, on hover.
- Folded, the same dot on the icon's corner.
- The sidenav's Waiting for you group (V48) is an amber band — a 7 % wash, a 28 % edge, 10 px
  corners — with a bell: the same "your move" reads much louder for a workspace than for Scout.
- Scribe (Skills, V41) waiting on a permission shows a green dot: `nextScoutMark` takes
  `needs-you` as an answer.

**Goal**: an agent of a page waiting on the person is seen at once from any page, by the whole
link, in the amber that already means "your move". **Unchanged**: how Scout's and Scribe's states
are read, the tooltips' words, `data-state`, the working spinner and the answered dot, the
link's size (nothing moves), the other links, the window's title.

## The link (`shell/Sidenav.tsx`, `shell/Sidenav.css`)

- **The band**, while it waits (`data-state="waiting"`): the link's background an amber wash, a
  1 px amber ring drawn as an inset `box-shadow` (no border: nothing moves), its words in
  `--text`, its icon in `--warning` at stroke 1.8. On hover the wash a step stronger. The
  proportions are Waiting for you's (V48): one amber for "your move" in the sidenav.
- **"Waits"** in place of the dot: a round badge as the count by "Workspaces" (the warning's tint,
  caption size, 600). The state in a word, not only a colour. The link's accessible name says it
  too ("Scout, waits for you"): visible words belong in the name.
- **Folded**: the band and the amber icon on the icon's square, and the amber dot on its corner as
  today; no "Waits" (the rail hides every word).
- **When it starts to wait**: one 1.2 s flash of a stronger wash, as a new workspace's card
  flashes; then still (waiting is still, V48; motion is work). None with reduced motion.
- **On its own page**: the current page's look (the selection's wash, the accent icon) with the
  ring and "Waits".
- **Scribe** (the person's "1. b"): Skills takes the same band, "Waits" and name when Scribe's
  conversation is `needs-you` ("Skills\nScribe waits for you" in its tip, warn tone); today's
  green dot for it goes.

## Verification

1. **Tests first** (red for the right reason), with the e2e fake Claude Code (`setSession` with
   `waitingFor`, which Scout reads as `needs-you`):
   - `e2e/scout.spec.ts`: Scout waiting, on History — the link's background a tint of
     `--warning`, its ring, its icon in `--warning`, "Waits" shown and the dot not, its name
     "Scout, waits for you", its box as before; the flash (and none with reduced motion);
     answered: as before. Folded: the band, the dot, no "Waits". On Scout's page: the selection's
     wash, the ring and "Waits".
   - `e2e/skills.spec.ts`: Scribe waiting — Skills' band, "Waits", its name and tip.
   - `e2e/mcp.spec.ts` (Scout's ask on History) stays green.
2. `pnpm check` (the stylesheet's guards: tokens, contrast, radii, no side bar, `--accent`'s
   roles), `pnpm build`, the whole `pnpm test:e2e`.
3. **The look** (`symbiote-style`, `viewer-check`): screenshots before and after at 1440×900, 1×,
   dark and light — the sidenav open and folded, on History and on Scout's page, Scout and Scribe
   waiting beside a waiting workspace, hovered; the other pages for uneven spacing.
4. No analysis or graph change: no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| The band reads as the current page | Amber, not the selection's blue; "Waits" in words |
| A flash on every page load while Scout waits | One per document (the sidenav stays across the shell's pages); a diff's page is a document of its own: one flash there too, accepted |
| Amber icon and words under the contrast floor in light | `--warning` is tested ≥ 3:1 as a state; the words stay `--text` |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V59 | Scout's and Scribe's links as an amber band while they wait | CSS, the links' marks, e2e tests, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 422 | How a page's agent waiting on the person is drawn in the sidenav | **The whole link as Waiting for you's band: amber wash, 1 px ring as a shadow, amber icon, words at full strength, "Waits" for the dot; folded, the band and the dot** | The person asked for the whole item; one amber already means "your move" there (V48); a ring as a shadow moves nothing |
| 423 | Motion | **One 1.2 s flash when it starts to wait, then still; none with reduced motion** | The person: "2. a"; waiting stays still as V48 decided, the flash only catches the eye |
| 424 | Which links | **Scout's and Skills' (Scribe's `needs-you`)** | The person: "1. b"; Scribe asks for permissions the same way |
| 425 | The window's title | **As it is: it counts waiting workspaces only** | The person: "3. a" |

## As built (V59)

- **The reads go on while Scout or Scribe waits** (`workspaces/useWorkspaces.ts`, `readEvery`):
  every 5 s, as for a waiting workspace. Not in the plan; Skills' e2e found it. The workspaces,
  Scout and Scribe were read every 5 s only while one of them *worked* or a terminal was open:
  a wait that ended with neither — answered from another Claude Code window, say — left the band
  up until the next read (the window focused, the page shown again). Answered in Scout's or
  Scribe's own terminal it was already read (an open terminal keeps the reads on). A band that
  stays is a wrong "your move"; the dot had the same flaw, too small to notice. MC1's asks are
  read on their own, every 2 s, and were not affected.
- **One mark for both links**: `AgentMark` (`shell/Sidenav.tsx`) draws the spinner, the answered
  dot, or "Waits" and the rail's dot; Scout's and Skills' links each had their own copy of the dot.
- **"Waits" and the dot side by side in the page**: the dot is hidden beside "Waits" and shown on
  the rail only (`.sidenav-waits + .state-dot`), so the rail needs no other markup.
- **The flash plays again** when reduced motion is turned off while it waits: the animation's name
  comes back. Rare; the e2e checks reduced motion before waiting the flash out.
- **README**: one sentence under "See what needs you".

**Results.** Tests first, red for the right reasons: Scout's e2e (its name "Scout", no band),
Skills' (`data-state` "answered" where "waiting" was expected), then `readEvery` 2 (no read while
Scout or Scribe waits). Then green: `e2e/scout.spec.ts` (waiting: a 10 % tint of `--warning`, its
1 px inset ring at 32 %, the icon `--warning`, the words `--text`, "Waits" and no dot, the name
"Scout, waits for you", the box as before, `wait-flash` and none with reduced motion; folded: the
band and the dot, no word; on its page: `--selected`, the ring, the accent icon, "Waits";
answered: at rest), `e2e/skills.spec.ts` (Scribe waiting: the band, "Waits", the name and the
warn tip), `test/useWorkspaces.test.ts`. `pnpm check`: format, lint and typecheck clean, 1,799 of
1,799 unit tests. `pnpm build`. `pnpm test:e2e`: 277 of 277 (4.5 min; 276 on `main`). Screenshots
at 1440×900, 1×, both themes, before and after: the sidenav with Scout, Scribe and a workspace
waiting, hovered, folded, on Scout's page, at rest; the narrow drawer at 420 px. Not verified: the
desktop app on WSLg, a touch screen, a real Claude Code dialog in Scout's terminal (the fake's
`waitingFor` stands for it, read by the same `scoutState`).
