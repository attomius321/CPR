# Journal: Working rules for Claude Code

[Index](../JOURNAL.md)

## Working rules for Claude Code (2026-10-03, branch `chore/agent-guidance`)

Asked where the session's learning is kept: only in the repo. The docs held *what* was learned,
but not *how* work is done here, and the real-repo checks lived in a scratch folder that dies with
the container. Now:

- `CLAUDE.md` at the root (what Symbiote is, commands, code and test rules, how to verify each kind of
  change, the milestone and merge workflow, environment traps) and one per package
  (`core`, `viewer`, `plugin-angular`, `plugin-qwik`), loaded when working there.
- Skills in `.claude/skills/`: `milestone` (with the PLAN section template), `regression-check`,
  `framework-plugin`, `viewer-check`.
- `scripts/regression/`: the comparison sets with pinned commits (`r1`: the 29 R1 comparisons;
  Bitwarden ×10 and ×8 multi-project; Qwik's docs site ×30), `setup.mjs` (blobless clones; the 3
  RealWorld experiments, which existed only locally, recreated from patches), `run.mjs`,
  `compare.mjs`. `scripts/viewer/measure.mjs`: first paint, select, review and pan timings and
  screenshots on any graph JSON.

**Learned**: totals depend on whether the clones have `node_modules` — fresh clones give 927 edges
on `r1` where W1's installed clones gave 932 (ky and RealWorld differ, vite with its install does
not). Only runs on the same clones compare. The first run on new clones also creates Symbiote's
worktrees (159 s, then 92 s): time warm runs only.

**Verification**: `setup.mjs r1` from scratch (clones, patched branches); `r1` on `main` and on
this branch: identical (29 comparisons, 927 edges); `compare.mjs` on a doctored result shows a
dropped edge, a new finding and an error; the `qwik-docs` set with the plugin: the same findings
as the CLI's earlier run on all 30 commits, no error; `measure.mjs` on two Bitwarden graphs
(`737ee3f`: first paint 1.1 s under load, no page error).

Merged into main (2026-10-03).
