# Journal: Fix — The nexus's tabs lost their look with V89

[Index](../JOURNAL.md)

## Fix — The nexus's tabs lost their look with V89 (2026-11-03, branch `fix/fix-nexus-top-left`)

The person, in the nexus: the tabs at the top left are too small, and there is a grey area
around Symbiotes. Their screenshot shows the Symbiotes tab in a grey box and the running
Symbiote's tab on a second line under it, both as high as their words.

**Learned**:
- **The nexus has no tab styles of its own** (decision 523): it draws the viewer's markup and
  links the viewer's built stylesheet. V61's tabs were `.workspace-views button`: a flex row,
  32 px tabs, no ground. V89 moved that look to the session tabs, `.workspace-tabs` (the flex
  row) and `.stab` (the tab), and V93 gave it back only to `.workspace-views > [role='tab']`
  (History's and Nucleus's tabs), with no height.
- **Each part of the screenshot is one lost rule.** The Symbiotes tab sits in `.nexus-own`, not
  straight in the strip, so no rule matched it: the browser's own button, grey with a border. The
  Symbiotes' tabs matched V93's rule but have no height, so they were as high as their words.
  `.workspace-views` was no flex row any more, so the block `.nexus-own` put them on a second
  line: the bar 51.4 px high, not 41.
- **`test/page.test.ts` could not see it**: it checks that each class the page uses is still in
  the viewer's CSS, and `.workspace-views` still is. A class that stays while its rules move
  passes. It now names `workspace-tabs` and `stab`; the e2e measures the row.
- **The fix is the viewer's current markup**: the strip is `.workspace-tabs.nexus-tabs`, each tab
  `button.stab` (`.selected` when picked), so the look, the picked tab's line, the hover and a
  stopped tab's × (`.shell-tab`, `.shell-close`) are the session tabs' own. `nexus.css` keeps the
  layout only: the strip `--card-head` (40 px) high in the bar, the own group stretched and
  sticky. Its tab, icon and divider rules (and the `nexus-divider` class), now the viewer's, are
  gone. The tabs are 40 px with 14 px words (`--size-small`), as a workspace's session tabs, not
  V61's 32 px tabs in a 48 px bar.
- **A trap seen on the way, not fixed here**: in a window under ~300 px high, a stopped
  Symbiote's centred message is taller than the main area and covers the bar, and its tab can't
  be clicked. It is the same on `main`.

**Verification**: a new e2e (`nexus.spec.ts`, "draws its tabs as the viewer's line tabs"), with
two Symbiotes running, checks four things: the bar is `--card-head` + 1 px; each tab is on one
row and as high as the strip; no tab has a ground or border; only the picked one has its line.
Red first on `main`'s markup (bar 51.4 px, not 41); green with the fix. `page.test.ts` red first
(`workspace-tabs` not in the page), green with the fix. The nexus's e2e: 21 of 21, with
`app.spec.ts`'s 3 in Symbiote's window (Electron on Xvfb). Screenshots (a spec in the ignored
`coverage/`) at 1400 px in both themes: Symbiotes and six Symbiotes on one row, the picked line,
hover. At 560 px the Symbiotes scroll under the sticky own group. A stopped tab shows its ×.
`pnpm check`: 225 files, 3,060 tests. Not verified: WSLg's own display, where the person saw it.

### The merge's check: Split's attach count under load

Symbiote's merge of this fix into `main` ran `pnpm test:e2e`: 422 passed, 2 failed in the
viewer, `terminal-view.spec.ts:165` (Split) and `hive.spec.ts:332` (Hive with reduced motion).
Neither reaches the nexus: both passed alone on this branch, 3 of 3. The person asked for the
test fixed here.

**Learned**:
- **Split's count read the reload's own attach too early.** A reload attaches the agent's pane
  once (1 → 2 attaches, measured), and the test took its count once the shell's pane showed
  `right-2`. Under load the agent's pane attached after that, so the reload's attach was counted
  as Split's: `["fake0", "fake0"]` against 1, the check's error at line 207. It is the "known
  flake" of V93's and fix/hive-question-reappears' checks. The test now waits for the agent's
  pane to draw (the fake writes it after recording the attach), checks the reload attached
  exactly once, then counts.
- **Load reproduces it here**: 96 busy loops on 32 cores and 16 workers, 24 runs of each test:
  Split failed 5 of 24 with the check's error, Hive passed 24 of 24.

**Verification**: under that load, Split 24 of 24 with the fix, then 64 of 64; the file alone 6 of
6. Hive's test was not reproduced (24 runs alone, and 60 runs of `hive.spec.ts` and
`hive-pages.spec.ts` together, under that load) and its error was not kept. With reduced
motion `arrive()` swaps the look at once, and its other checks retry for 15 s, so it is left as it
is: no change without a cause.
