# Journal: P1 — One program for both sides

[Index](../JOURNAL.md) · [Plan](../plan/roadmap.md)

## P1 measurement — where load time goes (2026-10-02, branch `milestone/p1-shared-parsing`)

CPU profiles (inclusive time per phase) and file counts of one commit each; times are warm
(files in the OS cache), profiles inflate absolute numbers but not the shares.

| | vite `24bd3316f` | zod `f448c44d` | Bitwarden `55465e2` |
|---|---|---|---|
| Run (no profiler) | 6.4 s | ~4 s | 25.8 s |
| Loading both revisions | 66–70 % | 62 % | 79 % (12 s per side) |
| Parsing | 35 % | 26 % | 19 % |
| Binding (type checker setup) | 15 % | 10 % | 9 % |
| Module resolution | 7.5 % warm (28 % cold: `package.json` reads from disk) | 3 % | 13 % (136k `stat` calls) |
| ts-morph bookkeeping (adding files, normalizing paths) | 12 % | 4 % | ~18 % |
| Symbiote's own analysis (extract, references, detectors) | 4 % | 2 % | 4 % |

**What the two programs share** (files of head, compared with base):

| | vite | zod | Bitwarden |
|---|---|---|---|
| TypeScript lib files (same path and text) | 93, 0.23 s to parse | 89, 0.23 s | 52, 0.29 s |
| `node_modules` declarations (same path and text: linked folder) | 655, **1.25 s** | — | — (not installed) |
| Project files (same text, **different path**: separate worktrees) | 183 of 184, 0.34 s | 515 of 516, 0.51 s | 6,159 of 6,160, **4.2 s** |

**Learned**
- Symbiote's own work is 2–4 % of a run; loading is two thirds or more. P1 is the right lever.
- A first profile blamed module resolution (5.5 s on vite): that was a cold disk. Warm, it is
  7.5 %. Measure twice.
- Every file is read and parsed once per revision; nothing is shared. ts-morph keeps a private
  cache per project and offers no way to share one; TypeScript's own way is a shared
  `DocumentRegistry` across language services (what tsserver does), keyed by path.
- Sharing by path covers lib and `node_modules` files (vite: 81 % of parsing) but not project
  files, whose paths differ between the two worktrees — and those are most of Bitwarden and zod.
  One program for both sides (option A) would not share them either.

**Decision**: not pursued. Sharing lib and `node_modules` files (B1) means replacing the ts-morph
loader for ~15–30 % on projects with installed dependencies; sharing project files too (B2) adds
a virtual-path layer. The user judged the gain too small for the risk. The measurement stays as
the baseline for a later TS 7 adapter.
