# Journal: Fix — Suggest settings could not read the agents' models

[Index](../JOURNAL.md)

## Fix — `symbiote view` serves the pages it started with (2026-10-29, branch `fix/suggest-settings-models`)

Settings' Suggest settings page (V75c) said "Claude Code's models and levels could not be read:
not found", and the same for Codex (the person's screenshot, 09:12).

**Learned**:
- **The code was right; the server was older than its page.** A `symbiote view` started from
  main's build (9cbf20c) in a scratch repository answered `/api/workspaces/advisor/claude/efforts`
  with Claude Code's models (Opus 5.5, Fable 5.1, Sonnet 5.5, …) and `/codex/efforts` with 3 of
  Codex's. The one in the screenshot (pid 5289, `/home/anton/projects/Symbiote`) started at
  07:44:38; V75c was merged at 07:59 and built at 08:06. Node keeps the server code it started
  with, but the server read the viewer's files from disk at each request: it served V75c's
  Settings page on a pre-V75c API, which has no `/api/workspaces/advisor/…` route. `curl` there:
  404, `not found`, the words on the page; Scout's `/api/scout/efforts` on the same server: 200.
- **It came back at every merge that adds a route.** A merge is checked with `pnpm build` in the
  checkout whose `symbiote view` the person uses. The other way broke too: Vite empties `dist/`
  (`emptyOutDir`), so a page opened before a build lost the chunks it loads later.
- **The fix**: `startViewServer` reads the built viewer into memory as it starts (28 files,
  2.1 MB, 3 ms measured on the real `dist/`) and serves only that copy. Page and API come from
  one build. After a build, a running `symbiote view` keeps its pages until it is started again
  (`docs/reference/commands.md`, the viewer's `CLAUDE.md`).

**Verification**: the test first (`packages/cli/test/server.test.ts`, a build under a running
server: its page and its chunks), red for the right reason: the new build's page was served.
A real run, each server on a copy of the built viewer, the copy then replaced as Vite builds
(emptied, a new page naming a new chunk): on main's build, Suggest settings is gone, the new page
served; on this branch's, Settings' Suggest settings shows both agents' Model and Effort (Claude
Code's select with 13 options, Codex's with 4), no page error, no warning. Claude Code's models
take 1.2 s to read the first time, Codex's 0.06 s.
`pnpm check` (2,205 tests), `pnpm build`, and `pnpm test:e2e`: the viewer's 338 specs in 5.0 min,
the nexus's 15 in 17.2 s.
The `symbiote view` behind the screenshot still runs the pre-V75c server: it reads the models
once started again.
