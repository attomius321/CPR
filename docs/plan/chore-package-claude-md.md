# Chore — The packages' CLAUDE.md files name what they hold

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (the docs findings)

**Status:** planned (2026-11-06), to be built on branch `chore/package-claude-md` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/package-claude-md` · **Size** S · **Depends on** none · **Plan**
P50 of 51 (the audit's order)

## The brief

**What to change**: the agents working here read the root `CLAUDE.md` and a package's own before
touching it. Several no longer say what their package holds. Bring each up to date with its `src`
and `test` folders; add the root map's missing package.

**Where to look** (each `CLAUDE.md` compared with its `src` listing on `main` at c2aa5c4, by
file name):

| File | What is missing |
|---|---|
| `CLAUDE.md` (root), "Repository map" | `packages/desktop` is not listed at all (0 matches for "desktop"), though it is a shipped app (the window, `pnpm app:setup`); `packages/cli`, `packages/forge` and `packages/desktop` have no `CLAUDE.md` of their own (the map says so for none) |
| `packages/core/CLAUDE.md` | calls core "the engine", but 33 of its 71 source files are not named: the 25 `git/` modules for Git's page and the merger (`operations`, `stash`, `sync`, `ref-edits`, `line-staging`, `merging`, `working-changes`, …) and the record types the CLI and viewer share (`workspaces.ts` 1,121 lines, `prompts.ts`, `merges.ts`, `mcp.ts`, `skills.ts`, `page-agent.ts`, `usage.ts`, `nucleus-*.ts`); its fixture list (`:64`) leaves out `test/fixtures/projects` |
| `packages/plugin-angular/CLAUDE.md` | `src/styles.ts`; the fixtures `styles` and `workspace` (`:34` lists six of eight) |
| `packages/plugin-qwik/CLAUDE.md` | `src/styles.ts`, `src/imports.ts`; the fixture `qwik-styles` (`:32` names `qwik-v1`, `qwik-v2`) |
| `packages/viewer/CLAUDE.md` | 83 of 221 source files are not named, but it is a map by folder: check only that each folder's line still describes it (e.g. `monitor/` names `MonitorPage.tsx`? `shell/` the status bar, `AskBar`, `useWaiting`) |
| `packages/nexus/CLAUDE.md`, `packages/log/CLAUDE.md`, `packages/monitor/CLAUDE.md` | complete (only `index.ts` unnamed) |

**Out of scope**: writing `CLAUDE.md` files for `cli`, `forge` and `desktop` (say in the root map
where their rules are instead; a new file each is a choice for the person); `docs/area/` pages;
code.

**Done when**:
- The root map lists `packages/desktop` with one line (what it is, `pnpm app:setup`, its e2e
  `app.spec.ts` needing Xvfb), and says which packages have no `CLAUDE.md`.
- Core's file says, in a short section, that it also holds `git/` (Git's page, the merger,
  worktrees) and the shared record types, with the folder and the files' groups.
- The two plugins' files name their style modules and every fixture folder.
- A script (in the journal) lists, per package, the `src` files a `CLAUDE.md` does not name; the
  list holds only `index.ts` files and files the viewer's folder lines cover.

## Evidence

**Code**: the comparison above, run for this plan (`find src -name '*.ts*'` per package against a
grep of its `CLAUDE.md`). The core review measured 3,677 lines in `git/` and 2,024 lines of
shared record types out of 13,401.

## Approach

Edit each file in its own voice (short lines, tables as they are). For core, one new section
after "the engine" rather than a rewrite. Keep the root `CLAUDE.md`'s length: one line for
`desktop`.

## Tests first

None: docs only.

## Verification

- The script above, before and after.
- `pnpm check`.
- A fresh agent reading only the root map and core's file can say where `git stash` support lives
  (the `writing-docs` skill's reader test).
