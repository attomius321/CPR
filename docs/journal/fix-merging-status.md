# Journal: Fix — A merge at work spins; the spinner a comet; Merging first

[Index](../JOURNAL.md)

## Fix — a merge at work spins; the spinner a comet; Merging first (2026-10-25, branch `fix/merging-status`)

The person: a merge's status in the sidenav should show it loads, "it is a work in progress"; then,
while it was planned, "make the spinner more attractive" and "workspaces that are merging should
stay at top of the list under Merging".

**Learned**:
- **A merge card's dot had a colour only.** `MergeCard` draws `state-dot merge-tone-<tone>`, and
  V53's spinner was keyed to the workspace tones `tone-working` and `tone-starting`: a merge being
  checked drew the same still cyan dot as one queued. The tone `wait` is exactly the merger's own
  states (queued, merging, resolving, checking), so the spinner rule now takes
  `.state-dot.merge-tone-wait`; ready, needs-you, landed and failed stay still dots in their
  colours. Nothing in `merges.ts` changed.
- **A comet at 11 px needs a long body.** Four shapes against V53's arc, at 1× and 4× in both
  themes: a comet whose tail fades over the whole ring and a faint track under a ¼ or ⅓ arc were
  fainter than the arc at 1× (the dark theme's 16–22 % track hardly shows on `--side`). Full for
  140° behind its head and fading over the rest, the comet keeps the ring's outline and reads at
  1×; 13 px read better still, but would end 1 px from the name and change V53's footprint.
  Its round head (a radial gradient over the ring's top) shows from 2×.
- **Drawn by gradients, not borders**: a conic gradient for the tail, a radial one for the head,
  a radial mask for the 2 px ring (its edges soft by half a pixel). Still only the transform
  turns. Measured in a page of four dots, headless Chromium 1243, 10 s a round, three rounds,
  arc and comet alternated in one run: 0 style recalculations and 0 layouts for either; main
  thread 6, 6, 6 ms for the arc and 10, 6, 6 ms for the comet; still, 0–1 ms.
- **Still, its head at the top right** (rotated 45°, V53's arc −45°): the gap just ahead of the
  head sits where Loader2's does, not a "C" opening on the name.
- **Merging first** reverses V48's order (decision 368: Waiting for you, then Merging, the
  person's choice then); the person's choice now. A merging workspace's own card stays in its
  group (To review: "Approved: ask your agent to merge it"): asked in the plan, the default taken
  with the person's OK. The keys follow the cards as drawn, so `w` and the arrows reach the
  merges first.
- The e2e spinner helper is shared now (`e2e/spinner.ts`): it reads the comet from the
  `::after`'s gradients and mask, where V53's read the arc from its borders.

**Verification**: tests first, red for the right reason (4): the merge card's dot `none 0s` and
nothing drawn while its check runs (`merges.spec.ts`); Waiting for you before Merging
(`shell.spec.ts`); V53's two spinner tests finding the arc, not a comet (`workspaces.spec.ts`);
then green. `pnpm check` (1,739 tests), `pnpm build`, `pnpm test:e2e`: 263 of 263. Screenshots
of the sidenav at 1× and 3×, both themes, moving and still, open and folded: a merge checking (a
comet) above a ready one (a still amber dot), above Waiting for you, To review and Working (a
comet).

Not verified: the desktop app on WSLg (its window opens on the person's desktop: not run unasked);
a real merge's queued state, which lasts while another merge runs (the e2e's routed queue and a
real check cover `checking`; the rule is the tone's, as `mergeState`'s unit tests give it).
