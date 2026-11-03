# Journal: V92 — Redesign step 5: Hive's pages

[Index](../JOURNAL.md) · [Plan](../plan/v92-redesign-hive-pages.md)

## V92 spike — Hive's pages against the proofs (3 November 2026, branch `feature/redesign-hive-pages`)

Read `spikes/hive-redesign` (proofs 01–09, `09-turn-on.html`, `run.css`, `kit.css`) against
`20c06e8`'s viewer, server and record types, and measured today's arrival in a `symbiote view` of a
scratch repository (Hive off, no workspace), headless Chromium 1440 × 900.

**Learned**:
- **The Run tab needs no new record**: each check's commands and their times (`HiveCheck.steps`),
  the last passing check's (`HiveLive.expected`), the log (decision 695), findings with their
  reruns, landings, pushes and spend are all in `WorkspaceHiveDetail`. A round's writer lines
  are not: `WorkspaceCommit` has no counts (choice 2: `--shortstat` in the changes read).
- **The viewer never reads the check**: `merge.checks` is not served; the runner finds the check
  with `projectCheck()`, which `/api/hive/state` can call for the question and Start.
- **`hive.json` holds `on` alone**: "since 2 Nov, 09:02" needs `since` (choice 1).
- **No Hive pill exists**: V88 left the S and the project's name; the arrival's last step lights a
  pill, so V92 adds it.
- **The prototype's arrival is two pages**: two iframes, the new one revealed by a `clip-path`
  circle. In one page that is a View Transition, the new look's snapshot clipped.
- **Today's arrival, headless**: 120 frames in its first 2 s, every gap 16.7–16.8 ms (60 fps), the
  look swapped at 1.08 s; the same with `--disable-gpu --disable-gpu-compositing`. Headless
  `requestAnimationFrame` is paced at 60 whatever the compositor does, so the comparison that
  counts is the app's window (Electron on a private Xvfb), measured with V92's build.
