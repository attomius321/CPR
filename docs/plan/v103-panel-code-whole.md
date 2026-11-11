# V103 — The panel's code shown whole

[Index](../PLAN.md) · [Journal](../journal/v103-panel-code-whole.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v103-panel-code-whole` (the
workspace's, from `main` at 7e4a36e); planned by the graph usability spike
(`spike/graph-usability`). The code wraps, as proposed: decision 887 kept.

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
| 975 | The panel's long lines (keeps 887) | **Wrapped at the panel's width: a wrapped line goes on under its own code, at its indent (at most 8 columns); its row keeps its colour, its gutter, and its line number beside its first line** | 69 % of the walks' panel lines were cut at 336 px |
| 976 | A changed signature in the panel | **One signature, removed words struck and added words marked; two blocks only when more than half differs. Over 400 characters it folds to 60 around each change (an unchanged one to its first 300), with "Show the whole signature". Core cuts a signature at 2,000 characters, not 300** | Bitwarden's removed parameter was past core's 300-character cut; cut to the same 300, a changed type drew as unchanged |

## As built

Built with the wrap, as proposed (887 kept). Decisions 975–976; 976 grew by two parts the plan
did not foresee, both found on the walked changes. Tests first: the unit tests, the core test and
`e2e/panel-code.spec.ts` failed on `main`'s code for the right reasons, then passed.

- **The "…" on Bitwarden was core's, not the panel's.** Core cut every signature at 300
  characters (`MAX_DISPLAY` in `lang/typescript/extract.ts`, since M2), so the graph itself held
  `…, private c…`: no diff in the panel could strike `configService`. The cut is 2,000 now. On
  737ee3f, 22 of 1,561 signatures were over 300 (7 of them on symbols whose signature changed);
  uncut, the longest is 1,693, and the graph grows by 6.5 KB (0.2 % of 3.10 MB). The same cut
  hid a change outright: `feature/issues-page`'s `Route` type drew as one unchanged signature on
  `main`, because its two versions cut to the same 300 characters. The field keeps its shape, so
  no `SCHEMA_VERSION` change; `docs/graph-schema.md` says where it is cut.
- **A long signature folds.** Uncut, `Route`'s signature is 1,150 characters, drawn whole above
  its own code. Over 400 characters `foldSignature` keeps 60 characters of kept words around each
  change, in whole words, and folds the rest to "…"; an unchanged one keeps its first 300, as
  core's cut drew it. **Show the whole signature** draws it all. Bitwarden's constructor (327
  characters) is drawn whole.
- **A lone change slides.** jsdiff placed the added union member as `p20' } | { page: '`. A
  lone removed or added run between kept words moves, among the places it can sit with the same
  text drawn, to one with its brackets balanced, a space first and a word or a closing bracket
  last: ` | { page: 'p20' }`. Spaces and punctuation that a removed and an added run share at
  their ends are kept text, and changes split only by spaces or punctuation are one run.
- **The panel's own class.** `.code`, `.row`, `.ln` and `.mark` are shared by the panel, the
  Files page and Git's diff and blame, so the wrap is under `.symbol-code`. The Files page and
  Git already wrapped (`pre-wrap`, `minmax(0, 1fr)`); the panel follows their recipe and adds the
  hanging indent: `--hang` on the row, from `hangOf` (the line's indent in columns, a tab 2, at
  most 8), as `padding-left` and a negative `text-indent`. `.code-rows`, as wide as the longest
  line so a scrolled row kept its colour, is gone.
- **A line number centred itself** in a wrapped row, 116 px under its line on the fixture: a
  button centres its content. `.symbol-code .ln-open` is a flex box with its number at the top.
  The Files page draws the same buttons in rows that wrap; it is out of scope and left as it is.
- **A space at a wrap hangs past the line's end** (`pre-wrap`). It is not drawn and does not
  scroll the box, but a measure of the text's right edge counts it: the spec and the walk script
  measure words.
- **Tests changed with the behaviour**: `review.spec.ts`'s "colours a changed line across its
  full width when the code scrolls" is replaced by `panel-code.spec.ts`'s wrap test at 700 px
  (the code no longer scrolls); `angular-v11.spec.ts`'s `getHeroes` reads one signature with
  `limit: number` marked.

## Results

The five walks' symbols, served by `symbiote view` at 2560 × 1440, 1x, `main`'s `git archive`
build against this branch's (`coverage/v103/panel.mjs`, not committed).

| Measure | `main` (7e4a36e) | V103 |
|---|---|---|
| The walks' panel lines cut at 336 px | 48 of 70: the small fix 15 of 21, the feature 20 of 29, the refactor 2 of 2, Bitwarden 8 of 10, Qwik 3 of 8; every panel's code scrolls sideways | 0 of 70; none scrolls; 48 lines wrap |
| Bitwarden 737ee3f, `AssignCollectionsComponent.constructor` | two blocks, the old one cut at 300 characters before `configService` | one signature, `, private configService: ConfigService` struck ([dark](../images/v103-panel-code-whole/bitwarden-after-dark.png), [light](../images/v103-panel-code-whole/bitwarden-after-light.png); before: [dark](../images/v103-panel-code-whole/bitwarden-before-dark.png), [light](../images/v103-panel-code-whole/bitwarden-before-light.png)) |
| The small fix's `MergerOptions` | 15 of 21 lines cut | wrapped, each continuation at its line's indent ([dark](../images/v103-panel-code-whole/small-fix-after-dark.png), [light](../images/v103-panel-code-whole/small-fix-after-light.png); before: [dark](../images/v103-panel-code-whole/small-fix-before-dark.png), [light](../images/v103-panel-code-whole/small-fix-before-light.png)) |
| The feature's `Route` signature | one, as unchanged: both versions cut to the same 300 characters ([dark](../images/v103-panel-code-whole/route-before-dark.png), [light](../images/v103-panel-code-whole/route-before-light.png)) | one, the added page marked, folded with two gaps to 400 of its 1,150 characters ([dark](../images/v103-panel-code-whole/route-after-dark.png), [light](../images/v103-panel-code-whole/route-after-light.png)) |
| A 2,100-line symbol: pick to its first 300 rows painted; **Show all** to 2,104 rows painted (median of 7, builds alternated) | 69 ms; 246 ms | 69 ms; 229 ms |
| Regression check against `main`'s build: r1; Bitwarden; Qwik | — | identical: 29 comparisons, 859 edges; 10, 4,912; 30, 6,360; no finding changed. Time 0.88×; 1.31× then 1.05×; 1.14× then 1.02× (`main` first under the e2e run, then this branch first) |

Cost: none measurable. The rows lay out at the panel's width instead of the longest line's.

Tests: `detail.test.ts` (`signatureDiff` 7, `hangOf` 2, `foldSignature` 4), `extract.test.ts`
(1), `e2e/panel-code.spec.ts` (4, on the new `panel-code` fixture); `pnpm check` (3,480 unit
tests); `pnpm build`; `pnpm test:e2e`: the viewer's 449 and the nexus's 32 passed on the first
run, `page-frame.spec.ts` and `targets.spec.ts` among them.
