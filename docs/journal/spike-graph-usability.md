# Journal: Spike — the graph's usability for a reviewer

[Index](../JOURNAL.md) · [The answer](../../spikes/graph-usability/README.md)

## Spike — what gets in the way of a reviewer, ranked (2026-11-10, branch `spike/graph-usability`)

The person asked where the graph gets in the way of someone reviewing a change, and which
improvements would help most, judged by what a reviewer does with it. The spike walked seven
tasks on five real changes, each served by a real `symbiote view` of this branch's build:

- `fix/e2e-flakes`, a small fix;
- `feature/issues-page`, a feature over 9 projects;
- `refactor/cli-services`, a big refactor;
- Bitwarden 737ee3f, a multi-project change, with the Angular plugin;
- Qwik 65661bf49, with the Qwik plugin.

The seven tasks: open the diff, find the riskiest change, follow callers, get from a finding to
its code, comment, mark reviewed, know when done. It then measured the first view of 84 graphs:
the last 30 merges into `main` (26 with code), r1's 25 real commits, 3 of Bitwarden's
multi-project commits and Qwik's 30. No product code changed. The answer, its twelve ranked
briefs and 40 screenshots (20 problems, both themes, 1x at 2560 × 1440) are in
`spikes/graph-usability/`.

**Learned**:
- **The first view cannot be read on the changes the person reviews.** On 24 of 26 merges with
  code, the first fit draws names under 9 px (median zoom 0.16, 1.9 px), and 19 open on the map.
  r1's library commits are the opposite: 23 of 25 readable. Reading a merge whole at zoom 1
  takes a median of 30 screens.
- **The graph's type is fixed below the app's.** `.react-flow` sets 11, 12 and 13 px (decision
  438), so names are 12 px at zoom 1 and Settings' Text size does not reach the graph. Contrast
  is fine: 5.5:1 or more in both themes.
- **A pick between zoom 0.45 and 0.92 stays unreadable.** Decision 886 zooms a pick only from
  the map. 5 of 26 merges open in that band, and the small fix's picked card stays at 5.9 px.
- **The canvas hides the links findings talk about.** Type references are off by default. 22 %
  of symbols with findings (90 of 405) have only type-reference links, so Focus draws them
  alone. Bitwarden's warned constructor shows 1 card while its panel lists 8 links.
- **The map hides every finding.** `map.css` hides a symbol's contents on the map, its findings
  count included. The head counts errors and warnings while the tab counts all: they disagree on
  33 of 37 graphs with findings. 86 % of findings are infos.
- **Files opens on a docs file on 30 of 30 merges** and shows no findings. The top finding's
  file is at a median position of 28. `g` from a picked symbol shows whatever file was open (5
  of 5 walks).
- **Stylesheet rules are 46 % of the changed symbols on the person's merges** (2,487 of 5,425):
  33–94 % on the 7 redesign merges.
- **The person's records**: 169 verdicts in 4 weeks, all Approve; 1 comment; 2 marked symbols.
  The ranking puts readable picks and visible findings first, and marking progress last.
- **Speed is not the problem.** Open is 217–908 ms, a pick 59–283 ms, a mark 7–11 ms. The wait a
  reviewer feels is the analysis: 5.9–11.3 s cold, 26 s on Bitwarden.

**Ranked**, as briefs in the answer:
1. a pick lands readable (S, amends 886);
2. findings where the reviewer looks (S–M, includes fix-finding-counts);
3. draw a pick's type-reference links (S–M);
4. Files in order of risk (M);
5. the panel's code whole (S);
6. Graph and Files follow the pick (S–M);
7. one card per stylesheet (M);
8. context quieter than the change (S);
9. back after following a link (S);
10. V96 as planned (M);
11. one review progress (M);
12. open on the riskiest finding (M).

fix-code-point-order and fix-graph-file-check are not about reviewing and stay as planned.

**Verification**: each number comes from a script in `spikes/graph-usability/walk/` on the runs
above, with its output in `spikes/graph-usability/data/`. `scripts/viewer/interactions.mjs` ran
3 rounds on the five graphs. Every problem was seen in a screenshot in both themes. `git diff
main --stat -- packages scripts` is empty, and `pnpm check` passed (3,462 tests). The README was
measured with the `writing-docs` script: 12.0 words a sentence, the longest 30. A fresh agent
with only the README answered 10 of 10 reader questions right, each with a quote. Its list of
terms used before they were explained became the README's "Words used here", and the six
sentences it read twice were rewritten. A second reader test was not run.

Not verified:
- A person's time: the estimates come from the keystroke-level model plus measured waits.
- The desktop window: headless Chromium.
- Edge contrast: the stroke's colour did not parse.
- 5 of Bitwarden's 8 multi-project commits: their blobs are fetched lazily from GitHub, which
  the offline scratch copy cannot do.
- Which page the person reads (Files or Graph): the logs record writes only.
- On the refactor, `interactions.mjs`'s "close a group" step timed out. It looks like the script
  losing the group's card, not the product, and was not chased.
