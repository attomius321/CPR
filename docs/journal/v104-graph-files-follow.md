# Journal: V104 — Graph and Files follow the pick

[Index](../JOURNAL.md) · [Plan](../plan/v104-graph-files-follow.md)

## V104 spike — `g` forgets the pick (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

In 5 of 5 walks, `g` from a picked symbol showed whatever file Files had open, a docs file; the
symbol's file was at position 5 to 48. On the refactor (`refactor/cli-services`), the warned symbol
had moved and its deleted line was not in the file Files opened
([shot](../../spikes/graph-usability/shots/p08-g-forgets-the-symbol-dark.png)).

## V104 — `g` follows the pick, both ways (2026-11-11, branch `feature/v104-graph-files-follow`)

`g` with a symbol picked opens its file on Files with its first changed row centred and marked:
the first added row, or for a removed symbol and one moved to another file, the first deleted
row in the file it left. `g` on Files picks the symbol holding the line last clicked or commented,
while its file is shown. The panel's **Show its lines** does what `g` does. The page switch does
too. Decisions 977–978. `useKeptOpen` (V102) gave way to two lines in `App.tsx`.

**Learned**:
- **A graph node does not say which of its lines changed.** It has its lines on each side. The
  first changed row exists only once the Files page has read the file's diff, so the target is
  found in two steps: the file and the symbol's lines (`symbolFocus`), then the row
  (`firstChangedRow`).
- **Git pairs lines by text, not by symbol.** On the fixture, 84 lines added above `area` made
  git list `area`'s two old lines at the top of the file. "The first changed row on either side"
  was line 1, 85 rows from `area`'s new code. The first added row in its head lines comes
  first; removed rows count only when it has no added one.
- **A reset in an effect loses to a fast key.** The clicked line was first cleared in an effect
  when the file shown changed. In the e2e test, `g` ran before React had run it and picked the
  symbol of a line in the file left. The same steps by hand passed. The line is now checked
  against the file shown when `g` is pressed, and cleared in `showPage`.
- **On `main`, the refactor's `g` landed near the symbol by chance.** V102 opens the riskiest
  file first, and `version`'s warnings are in `command-context.ts`, its new file. Its deleted
  line 106 in `main.ts`, the place the warnings are about, was 29th in the list.
- **The open file across the graph's arrival is two lines in App.** A new graph resets it only
  when it replaces another, and App holds Files' first file by path while the change is
  analyzed. V102 kept it in `FilesPage.tsx` because V101 was working in `App.tsx`. Taking out
  either half fails `files-order.spec.ts` (2 tests, then 1).

**Verification**: tests first. On stubs, 9 unit tests failed (`test/file-diff.test.ts`, 22
tests now). `e2e/follow.spec.ts` failed 4 of its 5 tests on the build before the change; the
fifth, `g` without a pick, passed before and after. `pnpm check`: 3,518 of 3,519 unit tests
passed. The one failure was `packages/cli/test/editor.test.ts`, a timing test (3,245 ms against
3,000), at a load average of 7.5; it passed alone, 18 of 18. `pnpm build`. `pnpm test:e2e`: the
viewer's 463 and the nexus's 32 passed, `page-frame.spec.ts`, `targets.spec.ts` and
`follow.spec.ts` among them. Then `targets.spec.ts` with the panel open, 5 of 5. By hand, on the
refactor's merge (eb807773): `g` from `version` showed `main.ts` with its deleted line 106
centred and marked, in both themes, with no page error. `main`'s build showed
`command-context.ts`. Shots in the plan's Results.

Not verified: the time of a pick on Bitwarden. A pick now looks its node up among the graph's
nodes and its file among the files, which was not measured. Not checked under `symbiote pr`,
which draws the same page, nor on a graph opened from a file: there `g` opens the symbol's file,
which has no diff to show.
