---
name: viewer-check
description: Verifies CPR viewer changes in a real browser — Playwright end-to-end tests, screenshots, and first paint, select, mark-reviewed and pan timings on real graph JSON (e.g. Bitwarden's 1,288-symbol change). Use after changing packages/viewer (layout, nodes, sidebar, styles, performance), when a graph looks wrong, or when the user asks to see the viewer.
---

# Viewer check

Unit tests cover the pure layout (`packages/viewer/test/flow.test.ts`); what a reviewer sees and
feels only shows in a browser. V6's worst bugs (the selection half under the panel, file names
catching clicks, a group opened off screen) were found there, not in unit tests.

## Workflow

```
- [ ] 1. pnpm check && pnpm build
- [ ] 2. pnpm test:e2e (all specs; one spec: cd packages/viewer && npx playwright test e2e/<spec>.ts)
- [ ] 3. New behavior → a spec in packages/viewer/e2e (fixture served by e2e/cpr.ts), asserting
         no page errors
- [ ] 4. Real graphs: measure before (baseline build) and after; screenshot; look at them
- [ ] 5. Record numbers in JOURNAL "Verification"; send screenshots to the user when they show the change
```

## Real graphs

Make graph JSON with the CLI (`--out`) on a real repo, e.g. the regression clones:

```sh
cd ~/.cache/cpr-regression/bitwarden
node /path/to/CPR/packages/cli/dist/bin.js diff 737ee3f~1 737ee3f --no-merge-base --plugin angular --out /tmp/g/737ee3f.json
```

Then measure and screenshot (serves `packages/viewer/dist` with the graph via `?graph=`):

```sh
node scripts/viewer/measure.mjs /tmp/g/737ee3f.json [more.json…] --shot /tmp/shots
```

One JSON line per graph: `firstPaint`, `select` (open the first change from the list), `review`
(press r), `panFps`, DOM counts, page `errors`. Reference (V6, idle 4-core container, Bitwarden
`737ee3f` with the Angular plugin): first paint ≈ 0.65 s, mark reviewed ≈ 72 ms, pan ≈ 60 fps,
≈ 3,900 page elements. Run the same graphs on the baseline build (`git worktree add --detach`, as
in the regression-check skill) for a before/after; timings vary ±30 % under load, so compare runs
made back to back.

For how interactions feel — open, pan, zoom, select, j, mark, context, project — run
`node scripts/viewer/interactions.mjs <graph.json>… [--dist <other build>] [--rounds 3]`: per
interaction the time, the main-thread blocking (long animation frames over 50 ms) and the worst
frame, plus on the map the share of file-box clicks reaching the file and the page elements by
kind. Compare against `main`'s build (`--dist` of a worktree) back to back; use medians — runs
vary up to 3× on a busy machine.

For a custom view (a zoom level, a selection), write a short Playwright script on the same page;
`page.goto(<base>/index.html?graph=<url>)` loads any graph.

## Checks that are easy to forget

- Selecting or marking a symbol must not move the canvas (layout is not decorated state).
- Large graphs: the map mode below 45 % zoom stays readable; summaries open and close in place.
- Older graph JSON (no new fields) still opens.
- No page errors in any spec (each spec's `afterEach` checks it).
- Playwright uses the preinstalled Chromium (`/opt/pw-browsers/chromium`); never run
  `playwright install` in such a container.
