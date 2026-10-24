# Journal: RM1 — Code concentration: where a repository's code is

[Index](../JOURNAL.md) · [Plan](../plan/rm1-code-concentration.md)

## RM1 spike — how concentrated real repositories' code is, and what a picture of it can show (2026-10-24, branch `feature/repo-monitoring`)

Asked: "I need a new feature from where i can see each files from the repo, by code
concentration. I need a good way to visualize this, do some research on how we can represent it
easy for the human. This should be in another package, like repo monitoring or something".
Measured with a script outside the repository on four repositories at `HEAD`: this one
(`561826d`), and vite, Qwik and Bitwarden's clients cloned at depth 1 on 2026-10-24. The script
lists the tree (`git ls-tree -r -z -l HEAD`), reads every blob through one `git cat-file
--batch`, sorts files into kinds by extension and counts non-blank lines that do not start a
comment (a rough rule, enough to size the problem; the plan's counter tracks strings). Read the
literature on hierarchy and size pictures (treemaps, circle packing, sunbursts, icicles) and
what code-analysis tools draw (CodeScene, GitHub Next's repo-visualizer).

**Learned**:
- **Code is concentrated everywhere measured**: half of it is in 3–10 % of the files (vite 67 of
  2,079 files; Bitwarden 783 of 8,037), and the largest 10 % of files hold 51–77 %. This is the
  fact to show, and a sentence says it.
- **What counts changes the answer**: tests are 26–42 % of the code lines; Bitwarden's data files
  have 2,285,516 lines against 829,874 of code; lockfiles 2,624–56,890. The largest "code" files
  include a test (`packages/cli/test/workspaces.test.ts`, 2,730), a vendored parser (Qwik's
  `packages/qwik-dom/lib/HTMLParser.js`, 7,976) and a word list (Bitwarden's `wordlist.ts`,
  7,778). Kinds, with Source alone by default, are needed before any picture is honest; Qwik's
  parser is not marked vendored anywhere, so it stays source unless the repository says
  otherwise (no guessing from content).
- **A whole-repository treemap cannot show files at Bitwarden's size**: at 1200 × 700 px it gives
  0.91 px² per line, labels 28 files (≥ 70 × 20 px) and draws 1,964 smaller than 4 × 4 px. Hence
  two levels at a time, zoom by folder, a small-files tile, and a list for exact numbers.
- **Reading is cheap**: listing, reading and counting every blob took 103 ms (Symbiote), 93 ms
  (vite), 207 ms (Qwik) and 769 ms (Bitwarden, 9,583 files, 153 MB). No checkout and no
  TypeScript program are needed; a cache by commit makes a second open free.
- **The literature**: squarified treemaps use the space best and are read fast for "what is big"
  (Kong, Heer, Agrawala 2010 also found area judgments worst at extreme aspect ratios and at exact
  squares); treemaps are weaker than icicle plots on hierarchy tasks (Woodburn, Yang, Marriott
  2019), so the breadcrumb, the frames and the list carry the hierarchy. Circle packing (CodeScene,
  repo-visualizer) wastes area between circles; sunbursts compare angles.

Not verified: the counts were taken with the rough rule above, not yet against `cloc`; the
clones were at each project's current `HEAD`, not pinned commits.
