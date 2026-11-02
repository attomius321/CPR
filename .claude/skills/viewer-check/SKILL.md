---
name: viewer-check
description: Verifies Symbiote viewer changes in a real browser — Playwright end-to-end tests, screenshots, and first paint, select, mark-reviewed and pan timings on real graph JSON (e.g. Bitwarden's 1,288-symbol change). Use after changing packages/viewer (layout, nodes, sidebar, styles, performance), when a graph looks wrong, or when the user asks to see the viewer.
---

# Viewer check

Unit tests cover the pure layout (`packages/viewer/test/flow.test.ts`); what a reviewer sees and
feels only shows in a browser. V6's worst bugs (the selection half under the panel, file names
catching clicks, a group opened off screen) were found there, not in unit tests.

## Workflow

```
- [ ] 1. pnpm check && pnpm build
- [ ] 2. pnpm test:e2e (all specs; one spec: cd packages/viewer && npx playwright test e2e/<spec>.ts)
- [ ] 3. New behavior → a spec in packages/viewer/e2e (fixture served by e2e/symbiote.ts), asserting
         no page errors
- [ ] 4. Real graphs: measure before (baseline build) and after; screenshot; look at them
- [ ] 5. Record numbers in the journal entry's "Verification"; send screenshots to the user when they show the change
```

## Real graphs

Make graph JSON with the CLI (`--out`) on a real repo, e.g. the regression clones:

```sh
out=$(mktemp -d /tmp/viewer-check-XXXXXX) && echo "$out"   # a folder of your own: sessions run side by side
cd ~/.cache/symbiote-regression/bitwarden
node /path/to/Symbiote/packages/cli/dist/bin.js diff 737ee3f~1 737ee3f --no-merge-base --plugin angular --out "$out/737ee3f.json"
```

No graph JSON is kept in the clones: making Bitwarden's takes about a minute. Then measure and
screenshot (serves the `packages/viewer/dist` beside the script, with the graph via `?graph=`):

```sh
node scripts/viewer/measure.mjs "$out/737ee3f.json" [more.json…] --shot "$out/shots"
```

One JSON line per graph: `firstPaint`, `select` (open the first change from the list), `review`
(press r), `panFps`, DOM counts, page `errors`. A graph with no changes has nothing to open: the
script waits until killed. Reference (V6, idle 4-core container, Bitwarden `737ee3f` with the
Angular plugin): first paint ≈ 0.65 s, mark reviewed ≈ 72 ms, pan ≈ 60 fps, ≈ 3,900 page
elements.

For a before/after, build `main` from `git archive` in a folder of your own (the regression-check
skill's step 2: a workspace may not add a worktree) and run **that copy's**
`scripts/viewer/measure.mjs` on the same graphs: each script serves its own build. Timings vary
±30 % under load, so alternate the two builds, 3 rounds each, back to back.

For how interactions feel — open, pan, zoom, select, j, mark, context, project — run
`node scripts/viewer/interactions.mjs <graph.json>… [--dist <other build>] [--rounds 3]`: per
interaction the time, the main-thread blocking (long animation frames over 50 ms) and the worst
frame, plus on the map the share of file-box clicks reaching the file and the page elements by
kind. Compare against `main`'s build (`--dist "$base/packages/viewer/dist"`, the `git archive`
copy) back to back; use medians — runs vary up to 3× on a busy machine.

For a custom view (a zoom level, a selection), write a short Playwright script on the same page;
`page.goto(<base>/index.html?graph=<url>)` loads any graph.

## Checks that are easy to forget

- A regression seen in one run: confirm it another way (open each build in turn, 5 rounds) before
  fixing it. Performance entries (long frames) arrive after the frame ends: read them once the
  page is idle (V8c: a 3× "regression" on open was the script reading too early).
- Selecting or marking a symbol must not move the canvas (layout is not decorated state).
- Large graphs: the map mode below 45 % zoom stays readable; summaries open and close in place.
- Older graph JSON (no new fields) still opens.
- No page errors in any spec (each spec's `afterEach` checks it).
- Playwright uses the preinstalled Chromium (`/opt/pw-browsers/chromium`); never run
  `playwright install` in such a container.

## Side by side with other workspaces

Other workspaces run their checks on the same machine while you run yours.

- A timing spec that fails only under their load (`intro.spec.ts`'s animation against the wall
  clock; journals `hv2-hive-runner.md`, `ar2-defaults-from-ar1.md`) is not your branch's fault until
  it fails alone too: run it alone, repeated (`--repeat-each 5`), then the whole check. If it
  passes, report it as flaky; do not change tests outside your brief.
- `app.spec.ts` starts an Xvfb from `:99` up. A spike's own display takes a number from 160 up
  whose `/tmp/.X<n>-lock` is absent, and is stopped by its PID, never `pkill` by name: that can
  stop another session's run.
