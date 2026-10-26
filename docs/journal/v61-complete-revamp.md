# Journal: V61 — The black theme of the mockup, the new S, bigger text

[Index](../JOURNAL.md) · [Plan](../plan/v61-complete-revamp.md)

## V61 spike — the mockup's colours against today's (2026-10-26, branch `feature/complete-revamp`)

The person's mockup (1586×992) is the README's workspace screenshot (`docs/images/workspace.png`,
1440×900) redrawn at 1.1×: the same workspaces, plan and panels. Its colours were read with a
small PNG decoder (Node's zlib, no image library in the repository): the most common colour of
each region, then the darkest, brightest and most saturated pixels of its text and controls.

**Learned**:
- **The mockup is compressed**: one flat region holds four to ten neighbouring colours (`#0d1015`,
  `#0e1015`, `#0e1115`…). The tokens are the region's most common colour, rounded to the palette's
  steps, not a single pixel.
- **The primary's text is dark**: "Respond" is `#020214` on `#7d68fd`. White on that violet is
  4.01:1, under the 4.5 `tokens.test.ts` asks; the dark text is 4.89. V42's rule (a darker hover,
  as white needs) turns around: the hover is lighter.
- **History's first lane** (`#b66dff`) is 1.09:1 from the new violet accent: a branch would read as
  selected.
- **The mockup's text is larger than today's**: its body lines are 26 px apart at 1.1×, 23.6 at 1×
  (today 20.3, 14 px at 1.45); nav rows 35.5 px apart at 1× (today 34).
- `palette-check.mjs` with the sampled values: every rule passes (text 15.24, muted 7.53, accent
  5.96, faint 4.05, edge 3.16, line 1.21 at their lowest).
