# V86 — Nucleus becomes Alpha Ceph in the sidenav as Hive turns on

[Index](../PLAN.md) · [Journal](../journal/v86-alpha-ceph-transform.md)

**Status:** built, ready for review (2026-11-01), on branch `feature/alpha-ceph-transform` (a
workspace started in Symbiote, from `main` at `6aed550`). The person asked to start building after
the plan without waiting for an OK, so films of the built sidenav stand in for a mockup made
first. Open: whether turning Hive off should play the change backwards (decision 734). Its "As
built" and results are below.

**Problem** (asked: "I want an animation of Nucleus transforming to Alpha Ceph, after Hive mode
activation, in sidenav").

| What | Today (`main` at `6aed550`) |
|---|---|
| When the name and icon change | In `swap()` (`shell/hive-arrival.ts`), at 1.0 s of the arrival, in the frame the shutter covers the whole window (decision 673) |
| What the person sees | The shutter opens from the Mind out to the edges (still by 1.9 s), then the streak crosses the main area (to about 2.45 s); the sidenav already says Alpha Ceph, with the Hive Mind as its icon. The change itself is never seen |
| Who reads Hive for the name | `useNucleusName()` and `NucleusIcon` (`useHive()`), in the sidenav, Nucleus's page, its tabs, the window's title and Settings' prebuilt agents (decision 687) |
| The sidenav's width | A grid column (`--sidenav-width`, 300 px open, 48 px folded): the longer name cannot widen it |

**Goal**: turning Hive on in this window, once the arrival is still, the sidenav's Nucleus link
shows Nucleus becoming Alpha Ceph in about 1.2 s, open and folded, both themes. A reload or a new
window with Hive on shows Alpha Ceph still. Reduced motion: the change at once, as the arrival.
Unchanged: the arrival, Hive off, Hive on at load, every other page's look.

## When it plays

- **A hold, then the change.** A small store, `shell/alpha-ceph.ts`: a phase `held`, `becoming` or
  none. `setHive(true)` holds Nucleus before the arrival starts (only on the path that runs the
  arrival: not with reduced motion, not when Hive is already on). While held, Nucleus keeps its
  name and icon everywhere, though the rest of the look turned Hive at the swap. When `arrive()`
  resolves (all still, the streak's end included), the phase becomes `becoming` for 1,250 ms, then
  none.
- **Everywhere follows the hold, only the sidenav plays.** `useNucleusName()` and `NucleusIcon` read
  "Hive on and not held" (`useAlphaCeph()`), so the page head, the title and Settings say Nucleus
  until the sidenav's link starts to change, then Alpha Ceph at once. Without the hold, Settings'
  prebuilt agents would say Alpha Ceph behind the opening shutter while the sidenav still said
  Nucleus.
- **Turning Hive off** clears the phase (a turn-off during the hold or the play ends it). It
  changes at once under today's fade; whether it should play backwards is the person's choice
  (asked in the report).

## How it moves (1.2 s, CSS on the icon's SVG; nothing runs once it ends)

The icon is `HiveMindIcon` with a `becoming` class and Nucleus's ring and dot drawn under its
cells. Every animation ends on the still icon's own values (`animation-fill-mode: both`), so the
switch to the still icon at 1,250 ms changes no pixel.

| ms | The icon | The name (open sidenav only) |
|---|---|---|
| 0–350 | Nucleus's ring breaks into six arcs, one on each ring cell's place, and contracts onto them; the dot swells and heats from the link's colour to white | "Nucleus" starts to scramble, left to right |
| 250–550 | The core cell lands (its plate grows from a third), its chamber flares white-hot; the dot is gone into it; the arcs fade as the cells take their places | letters lock into "Alpha Ceph", left to right, 65 ms apart |
| 400–1,000 | The six ring cells boot clockwise from the top, 80 ms apart, each with the Mind's boot flicker (`FLICKER` in `hive-art.ts`) | "Alpha Ceph" whole by about 850 ms |
| 1,000–1,200 | The core pulses once and settles to the still icon | — |

- **The name**: each letter cycles through random letters and locks into Alpha Ceph's, at about
  25 updates a second for 850 ms, then stops; the link's `aria-label` and tooltip say Alpha Ceph
  from the start. The label is left-aligned and the column fixed, so nothing beside it moves but
  the label's own end.
- **The link stays usable**: nothing covers it; a click while it plays opens Alpha Ceph's page.
- **Reduced motion**: no hold, so no play; and `.becoming`'s animations are off under
  `prefers-reduced-motion` as a second guard.

## Verification

1. **Unit** (red first): the store's phases (`hold` → `become` → none after `BECOMING_MS`; `become`
   without a hold does nothing; `settle` ends either); the ring cells' boot order clockwise from
   the top.
2. **e2e** (`alpha-ceph.spec.ts`, red first): turning Hive on from Settings, the link says Nucleus
   with lucide's icon until the arrival ends, then `.becoming` on its icon, then the still Hive Mind
   and "Alpha Ceph", open and folded; a reload with Hive on and a new tab: Alpha Ceph, never
   `.becoming`; reduced motion: Alpha Ceph at once, never `.becoming`; turning Hive off: Nucleus at
   once.
3. **The suite**: `pnpm check`, `pnpm build`, `pnpm test:e2e`.
4. **Looks** (`viewer-check`, `symbiote-style`): films and frames of the sidenav at 1×, open and
   folded, dark and light, the link idle and current; every frame's crop checked for clipping.
5. **Cost**: the arrival's frame rate at 2560×1440 against `main`'s build, three runs each,
   alternated; the play's frames (the main thread's long tasks while it runs); nothing animating
   after it (`document.getAnimations()` empty).

**Risks**

| Risk | Mitigation |
|---|---|
| The play is missed: it starts 2.45 s after the click, at the window's left edge | It is the brief's "after its arrival"; the films show whether it reads. Starting it as the shutter opens past the sidenav (1.5 s) is the fallback |
| The still icon jumps at the switch | Every keyframe ends on the still values; a frame before and after the switch compared pixel for pixel |
| SVG `transform` on cells at 18 px blurs | `transform-box: fill-box`; frames at 1× checked |
| The scramble's random letters widen the label | Clipped by its ellipsis like any label; the column is fixed |

**Order**: the store and its tests; the e2e (red); the icon's CSS, filmed; the name; the films and
measurements; docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V86 | The hold, the icon's and the name's change, the e2e, films | this branch |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 730 | When it plays | **After `arrive()` resolves (the shutter gone and the streak over), only when this window ran the arrival; never at load, with Hive already on, or with reduced motion** | the brief: "after its arrival", "never on a reload or a new window" |
| 731 | Nucleus between the swap and the play | **Held as Nucleus everywhere (name and icon), then Alpha Ceph everywhere as the sidenav starts to play; only the sidenav animates** | one name on screen at a time; the page head and Settings are out of the brief's scope to animate |
| 732 | The icon's motion | **CSS animations on the SVG's elements: the ring breaks into six arcs onto the ring cells, the dot ignites into the core, the cells boot clockwise with the Mind's flicker; 1.2 s, ending on the still icon's values** | the brief's own sketch; nothing drawn once it ends; no canvas next to the arrival's |
| 733 | The name's motion | **Letters scramble and lock left to right into "Alpha Ceph" in about 850 ms; `aria-label` and tooltip the new name from the start** | "the name's letters changing over"; the machined, circuit look of decision 665 |
| 734 | Turning Hive off | **At once, under today's fade** (pending the person's answer) | the fade covers the whole page; a reverse play is cheap to add if asked |

**Not in V86 (later)**: the change on Nucleus's page head and in Settings; a transform in other
windows of the same repository when Hive turns on elsewhere (they learn it on reload today).

## As built (V86)

- **The timings** (films at 1×, every 50 ms): the ring's arcs faded by 550 ms while the first ring
  cell booted at 480 ms, which left a lone dot for 250 ms. The ring now takes 760 ms (whole,
  six arcs by 270 ms, faded from 530 to 760 ms) and the ring cells boot at 340 ms + 80 ms each
  (420 to 1,080 ms). The core lands at 250–570 ms; its flare runs 250–1,200 ms; all end by
  1,200 ms, inside `BECOMING_MS` (1,250 ms, checked by a unit test that reads `hive.css`).
- **The ignition's colours**: a white dot and a flat white flare vanished on the light sidenav. The
  dot heats to the icon's crimson lamp (`--art-icon-lamp`), and the flare is the core chamber's
  gradient over the whole core plate: white-hot in the middle, crimson at the rim, on ink and on
  white.
- **The scramble** uses letters only: digits read as a hash.
- **Settings** named Nucleus with `useHive()`: `promptGroups` takes `alpha` for the name beside
  `hive` for Hive's own prompts, and the agent page reads `useAlphaCeph()`.
- **The ring cells' order**: `iconCells()` gives each cell its `order` (the core 0, the ring 1–6
  clockwise from the upper right); the cells sit at 0°, ±60°, ±120° and 180°, where the ring's arcs
  break.

**Results.** 9 unit tests and 3 e2e tests, red first; `pnpm check` 2,685 unit tests; `pnpm test:e2e` 379 of 379 and the nexus 20 of 20. The play's
last frame equals the still icon pixel for pixel, open and folded, both themes. The arrival at
2560×1440, three runs each against `main`'s build, alternated: 59.6 / 59.6 / 59.6 fps on `main`,
59.1 / 59.6 / 59.6 on the branch, 1.91 s long on both; the play 60.1 fps for 1,248 ms with no
long task; no animation running afterwards. Films and frames:
[the review page](https://claude.ai/artifact/82gJ3c1J9DNpbnQeFw4u1g) (private to the person).
