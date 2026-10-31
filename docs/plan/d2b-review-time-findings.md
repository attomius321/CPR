# D2b — Findings at review time (spike)

[Index](../PLAN.md) · Journal: none yet

**Status:** proposed (2026-10-31) from the D2 spike; not started. It extends D2's scripts
(`spikes/d2-review-precision/`) and can run alongside D3.

**Question**: while a pull request is still under review, do Symbiote's findings point at what
reviewers then had to fix?

**Why**: D2 analyzed only each pull request's final head, after review fixes had landed. The AI
reviewers commented during review, on earlier heads: 119 comments on 21 of the 51 pull requests,
71 % of them right and worth reading by the agent's scores, and the commented lines changed before
merge for 82. Several of their catches were the kind Symbiote is built for, for example
`MAX_SELECTION_COUNT` imported from the wrong module in Bitwarden #22260 (the suite did not
compile; `removed-still-referenced` territory). D2 says nothing about Symbiote at that moment.

## Method

- **Heads**: the 21 pull requests with AI comments have 185 commits; the AI reviewers commented on
  68 distinct heads (zod 32, Bitwarden 35, vite 1). Analyze each of those 68 heads against its
  merge base, as `symbiote pr` would on that push (`gh api pulls/N/commits` lists the commits;
  `git fetch origin <sha>` for heads a force-push left behind).
- **What counts**: a finding "points at" an issue when its symbol or a related symbol is where an
  AI comment on the same head pointed, or where a later commit of the same pull request changed
  the code before merge. Each match read by hand, with the three D2 scores.
- **Also**: findings that appear on a head and are gone by the final head (fixed during review),
  and whether any later fix was named by a finding on an earlier head.
- **Cost**: zod about 8 s and Bitwarden about 25 s a run, so about 20 minutes for 68 heads,
  in the background; scoring a few hours.

**Answer wanted**: of the issues fixed during review (AI-flagged or not), how many a finding named
on the head where they first appeared; findings per head; their shares as in D2.

## What it decides

- **Findings help during review** (they name a share of what was fixed): D3 is the path, and
  Symbiote's CI comments should run on every push, with the number measured here.
- **They don't**: stop selling findings as verdicts. The next milestone feeds the graph (untouched
  users, blast radius) to an AI reviewer through `symbiote mcp` and measures, on D2's harness,
  whether that raises the reviewer's hit rate or lowers its cost — "AI review grounded in the
  change graph". A hypothesis until then.

**Risks**: force-pushed heads no longer fetchable (count them and say so); AI comments are not a
complete list of what was wrong, so later in-PR commits are read too.
