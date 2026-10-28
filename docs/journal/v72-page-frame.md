# Journal: V72 — One page frame: every page the whole main area, one spacing everywhere

[Index](../JOURNAL.md) · [Plan](../plan/v72-page-frame.md)

## V72 spike — every page's margins, gutters, head and insets (2026-10-28, branch `feature/layout-fixing`)

Opened every page with the e2e harness (`serveWorkspaces`: two workspaces, one reviewed, approved
and merging; terminals on and off) in a spec kept outside the repository, at 1440 × 900 and
1920 × 1080, device scale 1, both themes; measured each card's box against the main area's, the
head's title, the first text's inset in each card, and each label and field.

**Learned**:
- **Three frames**: Git, a workspace and a review have V61's 8 px gutters; Settings and Skills the
  mockup's 24 / 16 (V62, V64); Start a workspace 16, the merge page 16, the Monitor 8 to 23.
- **Two pages stop short of the area**: Start at 1,312 px, centred (172 px of ground each side at
  1920), and 72 px lower on a window 1,080 high (V49's room above the cards); Settings at 1,400
  (128 each side at 1920).
- **Nine heads**: the title at x 16, 31, 60, 68 or 80; the cards from y 52 to 170. Scout's head
  wraps at 1440 (its model and stepper do not fit beside the state and New conversation: 80 px
  high, 52 at 1920); a review's bar wraps on the Graph page only (84 against Files' 52), so its
  cards jump when one switches.
- **Inside cards**: the words 12, 16, 20 or 24 px in; card heads 40, 48 or 64 px; a label 9 px
  over its field on Start, 5 on Skills, 13 on Scout's question; Scout's select 28 px high.
- **Free numbers**: V72 and decisions from 507 (V71 and 502–506 are `feature/review-analyzing-loading`'s).

## V72a–e — one page frame on every page (2026-10-28, branch `feature/layout-fixing`)

Every page of the shell, a review's two views and a merge now share one frame. A page fills the
main area at any width. Its head is `PageHead`: the icon, the title at x 60, a line under it, the
actions at the right. Its cards start at y 76, 16 px from the area's sides and bottom and 16 px
apart. Inside a card the words start 16 px in, a card's head is 48 px, and a form's label sits
8 px over its field with 20 px to the next label. Start a workspace and Settings are no longer
centred. Decisions 507–512.

**Learned**:
- **A handle between two cards doubles a flex gap.** The `Resizer` takes no room (it straddles
  the edge with `margin: -4px`), so a 16 px gap on each side of it made 32 px. It now takes
  `gutter` and is the gap itself.
- **A page's old rules outlive its new class.** The merge head kept a 6 px `gap` from
  `.merge-row-head`, and the title stood at x 54; Scribe's pane shares `.scout-top`, so Scout's
  new head took the name `scout-head`. Grep a class's rules before giving it to `PageHead`.
- **A card's head counts its hairline.** With `box-sizing: border-box`, a 48 px `min-height` and
  16 px of padding around 32 px controls made 49 px. Heads of controls take 7 px of padding.
- **Removing `.brand` from the diff's CSS reached the sidenav.** The narrow shell's "Symbiote"
  took its weight from that rule; `Shell.css` has its own now.
- **Every threshold set in a page's width moved again** (as at V61): the terminal's columns
  (127 → 124), rows (40 → 38) and share of the window, the rail's canvas width, the canvas's
  narrowest (its card now holds it), and a map label's ratio to its frame (1.496 against 1.5).
  Each test now gives the new value and its reason.
- **The V72e commit message is wrong on one point**: Git's file layer does not share the
  review's `.file-head`; its own head (`.git-shown-head`) was 48 px already.
- **A plain diff named its commits twice.** With no branch review and no pull request, the
  revisions became the head's title and stayed in the line under it. Bitwarden's graph showed it
  (`78ee234` leaves them out of the line).

**Verification**: tests first for each part. `e2e/page-frame.spec.ts` went red on today's pages
(Git's and a workspace's cards 8 px from the edge), then on the dialog and the review's file
head, before each was fixed; it now passes, 3 tests over every page at 1440 × 900 and
1920 × 1080. `pnpm check`: 2,008 unit tests. The full e2e suite: 326 passed, run without
`WAYLAND_DISPLAY` (the headless GPU hang on this machine). After the last fix, the commits,
Angular, reviews, pull request, interdiff, title-bar and frame specs: 35 passed. Screenshots of
every page and state (Git with a commit and its new-branch dialog; a workspace's four tabs,
working, ready and approved; a review's Files, Graph and Review tab; a merge; Scout with its
terminal; Skills; the Monitor; Settings and its 13 entries) in both themes at 1440 × 900 and
1920 × 1080, device scale 1. Start and Settings also at 2560 × 1440, and the pages at 1,024, 800
and 480 px wide. A head's words zoomed 3×: even gaps between letters. The plan's results table
lists every page's measures before and after.

`viewer-check` on Bitwarden's `737ee3f` with the Angular plugin, against `main` built from a
`git archive` copy, alternated, 3 rounds each: first paint 298–318 ms (main 298–326), select
104–106 ms (104–105), mark reviewed 50–51 ms (32–67), pan 63 fps (62–63), 3,158 page elements
(3,151: the head and the canvas card). After the last fix one more run: 322 ms, 119, 68, 62 fps.

Not verified: `/git`'s first paint (no font changed); the desktop app's window (only
`title-bar.spec.ts`'s stand-in for it); macOS and Windows; Scout's question form with a real
agent (the fake's terminal-off form was measured); a merge with conflicts (its Files view kept
its own spacing, under the frame's head); the README's images, which still show the old frame.
