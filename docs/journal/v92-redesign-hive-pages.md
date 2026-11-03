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

## V92 — Hive's pages: Run, the sidenav, Settings, Start, turning on (3 November 2026, branch `feature/redesign-hive-pages`)

Built as planned, decisions 860–874: the Run tab (the round on a timeline, check commands against
the last passing run, the log's tail, defects as cards, old rounds folded, a stop or a landing
first, the run's facts and spend in the side card), the sidenav's In flight, Stopped, Landed today
and Earlier with rows of two lines and a Hive pill, Settings' Hive mode page as grouped rows (the
reviewer's model and effort moved there), Start's New goal, and the question with its readiness
and a 1.4 s arrival in one View Transition. No record changed.

**Learned**:
- **A scaled layer the window's size costs frames in software, its blur does not**: in the app
  (Electron, `disabled_software` compositing, Xvfb, 1440 × 900) the arrival dropped 3–5 single
  frames (33 ms) during the reveal, 55.6–57.5 fps over its 1.6 s. Without the ring: 58.8–59.4 fps;
  without the clip-path or the Mind: no better than with them. The ring without its blurred
  shadows, or as a gradient: still 56.9–58.1 fps. A 480 px ring scaled up to the farthest corner:
  58.8–59.4 fps over three runs, no frame of the reveal slow. Main's arrival: 60.0 fps, none slow.
- **A View Transition's capture is one slow frame**: 33–50 ms at 55–70 ms after the click, in every
  run, headless and in the app; the old shutter had none. It is where the steps begin to arm.
- **A named element's new image is live**: the question kept in the new state as a layer of its
  own lets its steps arm inside the transition, while its old image is never shown; the page's new
  root is live too, so the pill's light runs on it inside the circle.
- **`document.getAnimations()` holds the transition's pseudo-elements' animations**: pausing them
  all and setting `currentTime` gives exact frames (`coverage/v92/frames.spec.ts`), and the e2e
  reads the arrival's end (≤ 1540 ms) and its keyframes' properties from them. They exist only
  once `transition.ready` resolves; `data-hive-arriving` is set then.
- **`.run-words` was the Overview's**: a class of the Run tab took the Overview's amber; renamed
  `.run-said` (class names are global).
- **`pgrep -f` with a bracket still matched this shell**: the shell's own command line held the
  restart's text after the pattern; kill a view by a PID checked with `ps` first.
- **The token guards caught the proof's habits**: `--faint` text, 2 px radii, a 30 px row and
  `--warning` outside a warning selector, each replaced by the tokens the guards ask for.
- **A still clock is not now**: a row with nothing ticking took `useSecondsWhile(false)`'s value,
  and a pause's "goes on at 11:12" read as another day ("Tue 3 Nov at 11:12"); found by
  `hive-pacing.spec.ts`.
- **The landed row comes before Hive's record says so**: the merge reaches `main` a moment
  before Hive writes `landed`; a spec that waited on the row then read the record too early.

**Verification**: tests first (red: 4 unit files, 3 CLI tests, 8 of 8 e2e); `pnpm check` 220
files, 3,008 tests; `pnpm build`; `pnpm test:e2e` 418 passed, then the 5 failures fixed or
explained (four `alpha-ceph` on the old question, updated; `codex.spec.ts:148` passes alone). The
arrival's five frames beside the proof's; its end at 1,540 ms; reduced motion at once. In the app:
58.8–59.4 fps against main's 60.0. First paint on Bitwarden: 321–338 ms against main's own build's
325–355 ms, alternated. Screenshots before, after and the proofs, both themes and 390 px:
<https://claude.ai/artifact/FKeVN1DAvHw2jdGc2NJPia>.

Not verified: a real Hive run; WSLg's own display; the README's `hive.png` and
`hive-settings.png` are out of date (they show the pages before V92).

Merged into main (2026-11-03).
