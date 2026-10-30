# D2 spike — findings precision on real pull requests

The plan and the answer: [docs/plan/d2-review-precision.md](../../docs/plan/d2-review-precision.md).

Run from the repository root after `pnpm build`, with the clones in `<repos>` (blobless, from
GitHub) and `SYMBIOTE_CACHE_DIR` pointing somewhere disposable. Each script says its usage in its
first lines.

| Step | Script | Writes |
|---|---|---|
| 1. Draw 17 merged pull requests per project (Aug–Sep 2026, seeded) and fetch their heads | `select.mjs --repos <repos> --fetch 40` | `data/selection.json` |
| 2. Install each project's dependencies once (`--ignore-scripts`), then analyze | `analyze.mjs --repos <repos> --graphs <dir> --project <name>` | `data/runs-<project>.json`, graphs in `<dir>` |
| 3. Read reviews, inline comments, comments and timelines (`gh api`, read only) | `forge.mjs` | `data/forge/<project>-<number>.json` |
| 4. Show a finding or an AI comment with its code, to score it | `context.mjs`, `ai-context.mjs` | — |
| 5. Record the agent's scores | `score.mjs` (JSON on stdin) | `data/scores.json`, `data/causes.json` |
| 6. Later commits that may fix what a pull request did | `followups.mjs --project <name> --analyze` | `data/followups-<project>.json` |
| 7. Draw the person's blind sample | `sample.mjs --page <file.html>` | `data/sample.json`, `sample.md`, the page |
| 8. Tables and the per-pull-request list | `summarize.mjs [--answers <file>]` | `results.md`, `results.json` |

zod's `packageManager` (`nub@0.8.3`) stops pnpm: its dependencies were installed with
`packageManager` and `workspaces` removed and a temporary `pnpm-workspace.yaml`, both restored after.
