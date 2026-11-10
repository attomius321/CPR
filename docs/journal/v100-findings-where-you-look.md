# Journal: V100 — Findings where the reviewer looks

[Index](../JOURNAL.md) · [Plan](../plan/v100-findings-where-you-look.md)

## V100 spike — findings out of sight (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

In 84 graphs, the head and the Findings tab disagree on 33 of the 37 with findings; on 14 the head
shows nothing. 352 of 407 findings are infos, and 303 of those are signature changes with nothing
left to update. On the map, the first view of 19 of 26 merges, no finding is drawn: `map.css:71`
hides a symbol's badge ([shot](../../spikes/graph-usability/shots/p05-map-hides-findings-dark.png)).

Not started.
