# Journal: Fix — an agent's terminal fits its box

[Index](../JOURNAL.md)

## Fix — an agent's terminal fits its box: no scrollbars coming and going on Scribe's pane (2026-10-27, branch `fix/scribe-terminal-problem`)

The person: "The scribe terminal have a problem now in rendering, the scrollers keep rendering with
different lengths, making it visibly disturbing"; the plan OK'd as written, the merge log
included.

**Learned**:
- **The fit add-on measures the box xterm opens in with its padding.** It counts the rows from
  that element's computed height, and under `* { box-sizing: border-box }` that height holds the
  element's own padding. `AgentTerminal` opened xterm in `.agent-terminal-screen` (8 px of padding
  on top): at 8 of every 19 window heights (a row is 19 px) it drew one row more than the box
  held, 1–8 px past it. The merge log opened in `.merge-terminal` (8 px top and bottom): up to
  16 px past, at 16 of 19 heights.
- **Where the box clips, a row is cut; where it scrolls, it loops.** Scout's page hides the
  overflow (`.scout-terminal { overflow: hidden }`): the last row's bottom was cut off (measured;
  a workspace's terminal is the same component, not measured before the fix). Scribe's pane is a
  card that scrolls (`.skills-pane { overflow: auto }`, for a skill's text): the overflow gave it
  a vertical scrollbar, 10 px that narrowed the screen; its 90 columns then reached 2 px past it,
  so a horizontal scrollbar took 10 px of height; the fit dropped to 89×36, nothing overflowed,
  both scrollbars went, and it fitted 90×37 again. At 1440×892–899 it drew two sizes within 20
  frames (810×703 and 801×684 px), so fast that the 100 ms debounce never told the agent a size.
- **Headless Chromium hides scrollbars** (`--hide-scrollbars`, Playwright's default): a scrollbar
  that takes no room cannot start the loop, so the suite never saw it. `terminal-fit.spec.ts`
  launches without that flag, over the config's own launch options (a worker fixture that reads
  `launchOptions`: `test.use` of a worker option is refused inside a `describe`).
- **The fix is where xterm opens**, not the pane's scroll: xterm opens in `.agent-terminal-fit`
  (`.merge-terminal-fit`), a flex child filling the screen's content box, the padding staying on
  the screen. Its size comes from the layout alone, and the add-on measures exactly the rows'
  room.
- **Rows that fit leave room under them, and the merge log showed what was there.** Its
  `.merge-terminal .xterm { height: 100% }` (V46a, no reason recorded) stretched xterm, and so
  its viewport, to the box; the rows had covered it. Fitted, the 12 px under the last row showed
  the viewport's own black and a native scrollbar's arrow (screenshots with real scrollbars,
  compared with `main`'s). The rule is gone: xterm is as tall as its rows, as in an agent's
  terminal, the room under them the box's black.

**Verification**: tests first, red for the right reasons on `main`'s code (each sweeps
1440×881–899, one cycle of a row): `terminal-fit.spec.ts`'s Scribe test at 892–899 (two sizes,
rows 14–18 px and columns 2 px past the padding, the pane scrolling; at 894 the agent told 36 rows
of 37), its Scout test at 881 and 893–899 (rows past the padding); `merges.spec.ts`'s log test at
881–883 and 887–899 (1–16 px). Then green: `pnpm check` (136 files, 1,897 unit tests), `pnpm build`,
`pnpm test:e2e` 305 of 305. With real scrollbars over the same 19 heights, every terminal's rows
end inside its padding: Scribe 0.06 px short, Scout and the merge log on it, a workspace's agent
and its shell 0.7 px short. Screenshots at 1440×896, dark and light, of Scribe, Scout, a
workspace's agent and a shell, and the merge log: no page error, no scrollbar on Scribe's pane,
each last row whole.

Not verified: a real agent in Scribe's terminal (a run from a worktree writes into the main
checkout's `symbiote/`); the desktop app's window (the e2e run with real scrollbars stands in for
its scrollbars); window widths other than 1440 (the sweeps change the height; a width moves only
the columns, which the add-on keeps 14 px clear of the edge for xterm's scrollbar).

Merged into main (2026-10-27), one conflict in `docs/JOURNAL.md` (both lines kept). `main` after
the merge: build passes; unit tests pass except the 3 `loadPty` tests in `packages/cli/test/terminal.test.ts`,
which need node-pty's native build, missing in the container; e2e not run.
