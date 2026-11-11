# Journal: V103 — The panel's code shown whole

[Index](../JOURNAL.md) · [Plan](../plan/v103-panel-code-whole.md)

## V103 spike — the detail panel's cut code (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

At the panel's 336 px (decision 887), 48 of the 70 lines shown in the five walks were cut (69 %). On
Bitwarden 737ee3f, the old signature is cut right before the removed parameter
([shot](../../spikes/graph-usability/shots/p09-signature-no-diff-dark.png)).

Not started.

## V103 — the panel's code shown whole (2026-11-11, branch `feature/v103-panel-code-whole`)

The detail panel's code wraps at its width: a wrapped line goes on under its own code, at its
indent, in its row's colour, its line number beside its first line. A changed signature is one,
its removed words struck and its added words marked; past 400 characters it folds to the words
around its changes. Core cuts a signature at 2,000 characters, not 300. Decisions 975–976; 887
kept.

**Learned**:
- **The "…" the spike saw on Bitwarden was in the graph.** Core cut every signature at 300
  characters, right before `private configService: ConfigService`: no diff in the viewer could
  strike it. On 737ee3f, 22 of 1,561 signatures were over 300 (7 of them changed ones); uncut,
  the longest is 1,693 and the graph grows by 6.5 KB of 3.10 MB.
- **The same cut hid a change.** `feature/issues-page` added a page to `Route`. Both versions cut
  to the same 300 characters, so the panel on `main` drew one signature, as if unchanged.
- **Lifting the cut makes signatures long.** `Route`'s is 1,150 characters, drawn above its own
  code. A long one now folds to 60 characters around each change; an unchanged one to its first
  300, as core drew it.
- **jsdiff's word alignment is not the reader's.** It placed the added union member as
  `p20' } | { page: '`. A lone change now slides to where its brackets balance.
- **`.code`, `.row`, `.ln` and `.mark` are four pages' classes.** The panel, the Files page, Git's
  diff and its blame share them: the wrap is under the panel's own `.symbol-code`.
- **A button centres its content.** A wrapped row's line number, a button that opens the line,
  sat 116 px under its line on the fixture. The first shot showed it; a spec now checks it. The
  Files page draws the same buttons in wrapping rows and was left as it is.
- **A space at a wrap hangs past the line's end** (`pre-wrap`): unseen, but a measure of the
  text's right edge counts it. Measure words.

**Verification**: tests first. `detail.test.ts`: `signatureDiff`, `hangOf` and `foldSignature`
failed as not functions; the folded `Route`-shaped case failed again on jsdiff's alignment until the
slide. `extract.test.ts`'s 12-parameter constructor failed at 300. `e2e/panel-code.spec.ts`, on a
new fixture with a 211-character line, failed on `main`'s code at 2560 and 700 px: the code
scrolled. Its line-number check failed without the alignment rule (116 px). `pnpm check`: 3,480 unit
tests. `pnpm build`. `pnpm test:e2e`: 449 and 32 passed, first run. The five walks, `main`'s build
against this branch's at 2560 × 1440: 48 of 70 panel lines cut before, 0 after; Bitwarden's
constructor shows one signature with `, private configService: ConfigService` struck. The regression
check against `main`'s build: r1 29 comparisons, Bitwarden 10, Qwik 30, identical (859, 4,912 and
6,360 edges; no finding changed). Their times were 0.88×, 1.31× and 1.14× with `main` run first
while the e2e ran, and 1.05× and 1.02× for Bitwarden and Qwik with this branch first: the order and
the load, not the cut, which is a constant in a slice. A 2,100-line symbol opens its first 300 rows
in 69 ms on both builds; **Show all** paints 2,104 rows in 246 ms on `main` and 229 ms here (medians
of 7).

Not verified: the app's window (Electron); every shot is headless Chromium. The Files page's
line numbers in wrapped rows were not changed.
