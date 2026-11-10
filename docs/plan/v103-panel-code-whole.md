# V103 — The panel's code shown whole

[Index](../PLAN.md) · [Journal](../journal/v103-panel-code-whole.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v103-panel-code-whole` in its own
workspace; written by the graph usability spike (`spike/graph-usability`). Not started. One choice
is the person's (below): wrap the code (keeps decision 887), or a wide toggle (amends it).

**Kind** feature (milestone) · **Branch** `feature/v103-panel-code-whole` · **Size** S ·
**Depends on** none · **Rank** 5 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**:
1. **The detail panel's code wraps** its long lines at the panel's width. A wrapped line continues
   under its code, not under its line numbers, and keeps its diff colour.
2. **A changed signature shows once**, with the removed words struck and the added words marked,
   instead of the old and new signatures as two whole blocks.

**Where to look**:
- `packages/viewer/src/diff/DetailPanel.tsx`: the signatures (:265–275, `sig-del` and `sig-add`),
  the code (:378, `.code`, `.code-rows`, `.more`).
- `src/diff/DetailPanel.css` (:172 `.code { overflow-x: auto }`, `.code-rows { width:
  max-content }`, `.row { white-space: pre }`).
- `src/diff/detail.ts` (the excerpt and its rows), where a word diff goes: pure, with a test.
- Decision 887 (V93: the panel 336 px by default).

**Out of scope**: the Files page's diff (it has the page's width); the panel's other sections.

**Done when**:
- No line of the five walked changes' excerpts is cut at 336 px.
- Bitwarden 737ee3f's `AssignCollectionsComponent.constructor` shows one signature, with
  `private configService: ConfigService` struck.
- A 2,000-row excerpt still opens within today's time (V93 measured the tokenizer on one).

## Problem (the spike's G9)

The panel is 336 px wide (decision 887), and its code does not wrap. In the five walks, 48 of the
70 lines it showed were cut (69 %), so reading a change in the panel means scrolling it sideways
([shot](../../spikes/graph-usability/shots/p09-panel-code-cut-dark.png)). A changed signature
shows the old and new as two whole blocks, with nothing marking the difference. On Bitwarden the
old block is cut with "…" right before `configService`, the one parameter the change removed
([shot](../../spikes/graph-usability/shots/p09-signature-no-diff-dark.png)).

**Goal**: the panel shows a symbol's change whole, and a signature's change at a glance.

## Design

- **Wrapping**: `.row` becomes `white-space: pre-wrap` with `overflow-wrap: anywhere` in its code
  cell. The grid's line-number columns stay; `.code-rows` drops `width: max-content`. A wrapped
  line's continuation gets a hanging indent of its own leading spaces, so nested code stays
  readable.
- **The signature's word diff**: a pure `signatureDiff(before, after)` in `detail.ts`, a diff of
  tokens (words, punctuation, spaces), returning runs of same, removed and added. The panel draws
  one signature from the runs. With no `base` or no `head`, the panel shows the one signature as
  today.
- **The person's choice**: the alternative is a wide toggle that widens the panel to the longest
  line, up to half the window, which would amend 887. This plan proposes wrapping, which keeps 887;
  the workspace asks before choosing the other.

## Verification

1. Unit (red first): `signatureDiff` on Bitwarden's constructor (one parameter removed), an added
   parameter, a renamed type, identical signatures.
2. e2e: a fixture symbol with a 200-character line: its row's text is inside the panel's box; the
   signature of a changed function shows struck and marked runs.
3. Shots: the small fix's panel and Bitwarden's signature, both themes, before and after.

**Risks**

| Risk | Mitigation |
|---|---|
| Wrapped code is harder to scan than a scroll | Hanging indent; colours kept per row; the wide toggle stays an option |
| A word diff of a long signature is noisy | Token runs merge; if more than half differs, the two blocks are shown as today |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 975 | The panel's long lines (keeps 887) | **Wrapped at the panel's width, the continuation under the code with a hanging indent** | 69 % of the walks' panel lines were cut at 336 px |
| 976 | A changed signature in the panel | **One signature, removed words struck and added words marked; two blocks only when more than half differs** | Bitwarden's removed parameter was cut out of the old block |
