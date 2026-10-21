---
name: symbiote-review
description: Acts on a Symbiote branch review — the verdict a person left on your commits in symbiote/reviews/<branch>/<reviewer>.json (Request changes, Comment, or Approve, which means merge the approved commit into the default branch). Use when asked to check, read, address or act on a review, before continuing work on a branch someone reviews with Symbiote, or when symbiote/reviews/ exists.
---

# Acting on a Symbiote review

Symbiote writes the rules into `symbiote/AGENTS.md`, beside the reviews, in every repository it reviews:
read it and follow it. This skill only points there, so the rules stay Symbiote's, in one place
(`AGENTS` in `packages/cli/src/reviews.ts`).

- Reviews: `symbiote/reviews/<branch>/<reviewer email>.json` (the branch's slashes are folders).
  Working in a worktree of your own: look in the main checkout (`git worktree list`, first line).
- Act on the last entry of `verdicts`, and only when the user asks. An `approve` with `into` is
  the user's yes to merge that commit (`head`) into `into` — in this repository, then the
  merge's checks and pushes as CLAUDE.md's workflow says.
- No `symbiote/AGENTS.md` yet (Symbiote writes it when it saves a review): `AGENTS` in
  `packages/cli/src/reviews.ts` is the same text.
