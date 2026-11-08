# Journal: V96 — Project names never cover file names on the map

[Index](../JOURNAL.md) · [Plan](../plan/v96-map-labels.md)

## V96 spike (2026-11-06, from chore/improvement-audit)

The improvement audit opened Bitwarden 737ee3f's graph (Angular plugin; 31 files, 86 changed
symbols, 6 projects) with `scripts/viewer/measure.mjs --shot`, at 1440×900 and 1x, three rounds.
The timings were first paint 307–340 ms, select 103–104 ms, mark reviewed 34 ms, pan 63 fps, no
page errors.

In the shot, at the opening zoom (a map):
- "desktop" covers the file name "vault-l…" in its frame's first row
  ([shot](../images/chore-improvement-audit/bitwarden-map-desktop-label.png)).
- "storybook", a context-only frame, is drawn over a file label inside its small frame
  ([shot](../images/chore-improvement-audit/bitwarden-map-storybook-label.png)).
- "@bitwarden/components", also context only, runs out of its frame over another label.

The cause, from the code: on the map a name is ~28 px on screen (`map.css:145-162`) while a frame
keeps 46 graph px over its first row (`flow.ts:161`), ~9 px on screen at zoom 0.2. A context
frame's name has no width clamp (`map.css:164-168`).

Not started.
