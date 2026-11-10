# Journal: Refactor — The tab a workspace's page shows

[Index](../JOURNAL.md)

## The tab shown, a pure function with tests (2026-11-09, branch `refactor/workspace-tabs`)

`WorkspacePanel` (`packages/viewer/src/workspaces/Workspace.tsx`) has the most branches in the
repository: 969 lines and 147 branches on `main`. Its tab was picked in 27 lines of nested
conditionals, and nothing tested them except e2e specs through a page. They are now
`shownTab` in `shells.ts`, moved word for word beside `shellAfter`, which they use. The component
is 950 lines with 128 branches.

**Learned**:
- **Hooks and JSX stay where they are.** The viewer's CLAUDE.md says the agent's terminal pane
  stays at one place in the tree, because a remount attaches the agent again (a Claude Code
  process each time). Moving JSX into new components changes the tree. Moving a pure derivation
  out does not, so this step is the safe kind.
- **The inputs say what the tab depends on**: the tab picked, the shells (null until read), the
  shell picked, Split's shell, whether the agent has a terminal, whether shells can run, and
  whether Hive drove the workspace. `splitCan` and the fallback tab stay in the component too,
  because its key handling and its tab strip read them.
- **Next candidates in `WorkspacePanel`**: the shells' state (read, picked, closing, Split; about
  200 lines of state and effects) could become a `useShells` hook, which keeps the tree as it is.
  The `more` menu's actions (60 lines) are another. Neither was started.

**Verification**:
- Six tests in `shells.test.ts` cover nine states: nothing picked, no terminal, Run without Hive,
  a shell that went, none left, shells not read yet, shells that cannot run, Split, and Split's
  shell gone. The expectations were traced from the component's code. Written first, they failed
  for the missing function; they pass on the moved code.
- `pnpm check`: 245 test files and 3,434 tests (`main`'s 3,428 and these 6). `pnpm build` passes.
  E2E: the viewer's 436 and the nexus's 32 pass. `workspaces.spec.ts`, `terminal-view.spec.ts` and
  `shell.spec.ts` are among them and open shells, Split and Focus in a real page.

Merged into main (2026-11-10).
