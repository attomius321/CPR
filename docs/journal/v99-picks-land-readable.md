# Journal: V99 — A picked symbol lands readable

[Index](../JOURNAL.md) · [Plan](../plan/v99-picks-land-readable.md)

## V99 spike — picks that stay unreadable (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

On the last 26 merges into `main` with code, 24 open with names under 11 px (median zoom 0.16, 1.9
px). A pick zooms only from the map (decision 886): between zoom 0.45 and 0.92 it stays where it is,
and 5 of 26 merges open there. On the small fix (`fix/e2e-flakes`), the picked `MergerOptions`
stayed at 5.9 px ([shot](../../spikes/graph-usability/shots/p03-pick-keeps-the-zoom-dark.png)). From
the map a pick lands at zoom 1, where names are 12 px, under the person's 15 px. In the walks,
"follow callers" took 6–21 wheel notches to make a name readable.

Not started.
