# V14 — Checkout submenu

[Index](../PLAN.md) · [Journal](../journal/v14-checkout-submenu.md)

**Status:** merged into main (2026-10-14, from branch `milestone/v14-checkout-submenu`). As built
and results: "As built — V14" below.

**Problem** (asked: "Let's make the branch name more visible when checking out...and maybe, in
the dropdown, show Check out, and when hovering over, another dropdown opens with the options").
V11's row menu lists every checkout target as a sentence, and the names are plain text inside
it. Measured in Chromium on `symbiote view` (`main` at `c2e3486`, 1440 × 900, light):

| Repo, row | Entries | Menu (px) | Longest entry | Confirmation's heading |
|---|---|---|---|---|
| Qwik, HEAD (`3fd543f`: `main` and 8 release tags) | 10 | 480 × 343 (at its max width) | "Check out tag @qwik.dev/devtools@2.0.0-rc.3 (detached HEAD)" | "Check out tag eslint-plugin-qwik@2.0.0-rc.3 (detached HEAD)?", on two lines |
| Qwik, `2cf8a7d` (a remote branch) | 2 | 480 × 112 | 117 characters: "Check out origin/dependabot/npm_and_yarn/npm_and_yarn-c03abc55da as dependabot/…", on two lines | the same sentence and "?" |
| Bitwarden, HEAD (`main`, `origin/main`) | 2 | 313 × 90 | "Check out this commit (detached HEAD)" | — |

- Every entry starts with "Check out" (10 times on Qwik's HEAD row) and 8 of those 10 end with
  "(detached HEAD)". The name the reviewer is looking for sits in the middle, the same weight
  and colour as the words around it.
- On the rows the same names are coloured badges (branch blue, tag gold, remote grey, HEAD
  green); the menu and the confirmation drop that.
- Refs per commit on the regression clones: Qwik 1–8 for 393 of 394 commits with refs and one
  with 10 or more; Bitwarden 1–5 (2,104 commits); CPython 1–2 (679). The longest ref name is 140
  characters (a Bitwarden remote branch).

**Goal**: the row menu shows one entry, "Check out ▸". Hovering it (or →, Enter) opens a
submenu beside it with the targets: each name drawn as the row draws it (the same badge), what
it is and does in muted text after it ("tag · detached HEAD"). The confirmation's heading shows
the name as a large badge: "Check out branch [wip]?". What can be checked out, the rules, the
server and the page after a checkout do not change.

## Viewer

- `src/checkout.ts`: each `CheckoutChoice` gains `ref` (`{ kind: 'branch' | 'remote' | 'tag' |
  'commit', name }`, what the badge shows) and `note` (after it). `label` stays the sentence
  ("Check out tag v1 (detached HEAD)"): the submenu entry's accessible name.

  | Target | Badge | Note |
  |---|---|---|
  | local branch | `wip` (branch) | branch (current: disabled, "checked out" under it) |
  | remote branch, no local branch of its name | `origin/topic` (remote) | remote · creates branch topic |
  | remote branch, a local branch tracks it (not on the row) | `topic` (branch) | branch · tracks origin/topic |
  | remote branch, its local name tracks something else | `origin/topic` (remote) | remote (disabled, the reason under it) |
  | tag | `v1` (tag) | tag · detached HEAD |
  | the commit | `3fd543f` (commit, monospace) | this commit · detached HEAD |

- `src/CheckoutMenu.tsx`: the menu holds "Check out ▸" (`aria-haspopup="menu"`,
  `aria-expanded`). The submenu opens on hover, on a click, or with → / Enter / Space, to the
  right of the menu (to its left when the window has no room), its first entry level with
  "Check out", moved up to stay in the window, scrolling past the window's height. In it ↑/↓
  move, Enter chooses, ← closes it (back to "Check out"); Escape or a click outside closes
  both. It is rendered inside the menu's element, so a click in it is not "outside".
- `c` opens the menu with the submenu already open and its first enabled entry active: the key
  says "checks out", so it lands on the targets (c, Enter as before for the first one).
  Right-click and "⋯" open the menu; the submenu opens on hover.
- The confirmation's heading: "Check out" and the kind ("branch", "remote branch", "tag",
  "commit"), then the badge at heading size, then "?". A long name wraps inside its badge (Bitwarden's
  140 characters); in the submenu it is cut with an ellipsis and its title holds it whole.
- `src/styles.css`: the badge styles (`.ref-branch`, `.ref-tag`, `.ref-remote`) are reused;
  new `.ref-commit` (monospace), `.submenu`, `.menu-item.has-submenu`, `.dialog-ref`. Checked
  free: none of these names is taken.

## Verification

1. **Unit** (red first), `test/checkout.test.ts`: `ref` and `note` for each kind of target
   (a branch, the current branch, a remote with no local branch, one tracked, one conflicting,
   a tag, the commit). Labels unchanged.
2. **E2E** (red first), `e2e/checkout.spec.ts`: the menu holds "Check out" alone; hovering it
   opens the submenu; its entries per row (badges and notes; accessible names as today);
   keyboard: `c` opens straight into the submenu, ← back to "Check out", → into it again,
   Escape closes both; the confirmation's heading shows the badge ("Check out branch wip?" as
   text). The existing checkout tests choose through the submenu; `commits.spec.ts`'s `c` test
   and V13's "a menu takes Escape first" pass.
3. **Nothing else changes**: `pnpm check`; every other e2e spec. No analysis change, so no
   `regression-check` run.
4. **Viewer** (`viewer-check`): screenshots of Qwik's HEAD row and remote-branch row with the
   submenu open, and the confirmation, light and dark; the submenu flipped left near the right
   edge and moved up near the bottom.
5. **Cost**: none expected (the entries are the same; one more element). First rows drawn as
   V13's.

**Risks**

| Risk | Mitigation |
|---|---|
| One more step to check out with the mouse (hover, then pick) | Asked for. The submenu opens on hover, with no delay: there is one parent entry, so no diagonal-move problem. `c` goes straight to the targets. |
| The badge and its note read as two things | The note is muted and says the kind first ("tag · …"); the accessible name stays the whole sentence. |
| Colour alone tells branch from tag | The note says the kind. |
| A submenu off-screen near the right or bottom edge | Flipped left, moved up, scrolling past the window's height; e2e at a narrow window. |
| A menu with a single entry looks empty | It is where later row actions go (V11's "later": create a branch here); the submenu opens on hover. |

**Order**: unit tests and `checkout.ts`; e2e (red); the menu and submenu; the confirmation;
styles; screenshots; README.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V14 ✅ | Checkout submenu | "Check out ▸" with the targets in a submenu, names as the row's badges; the confirmation's heading with the name as a badge; `c` straight into the submenu. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 68 | How the row menu offers checkout | **One entry, "Check out ▸"; its targets in a submenu opened on hover, click, → or Enter** | Asked. The entries no longer repeat "Check out" (10 times on Qwik's HEAD row), and the menu has room for later row actions. |
| 69 | How a target's name shows | **As the row's badge (same colours), first in the entry, with a muted note after it; in the confirmation's heading at heading size** | Asked ("the branch name more visible"). The names were plain text mid-sentence, and the rows already teach the colours. |
| 70 | What `c` opens | **The menu with the submenu open, its first enabled entry active** | `c` "checks out": a second key to reach the targets would add a step the keyboard never had. |

**Not in V14 (later)**: other row actions in the menu (create a branch here, copy the SHA,
compare with the parent); the line after a checkout ("Switched to branch wip") with a badge.

## As built — V14

- As planned in `src/checkout.ts` (`ref`, `note`), `src/CheckoutMenu.tsx` and `src/styles.css`;
  `CommitsPage` passes `submenu` for `c`. Core, the server and `src/commits.ts` unchanged.
- The arrow after "Check out" is drawn by CSS with empty alternative text (`content: '▸' /
  ''`): plain generated text counts in the accessible name, and the item was "Check out▸".
- A note that does not fit beside its name goes under it (`flex-wrap`). The first screenshot of
  Qwik's remote-branch row showed the note, kept on one line, squeezing the badge to "o".
- The confirmation's badge is an inline block (8 px corners, wrapping inside), leaving 1em for
  the "?": a pill split over two lines lost its border, then the "?" fell to a line of its own.
- Hovering "Check out" opens the submenu and keeps "Check out" highlighted; the pointer on an
  entry highlights it, and the keys then act in the submenu. A click on "Check out" opens it
  with the first entry active, like → and Enter.
- The menu's minimum width went from 240 to 160 px: it holds one entry.
- "Check out" and its submenu sit in a wrapper (`role="none"`, `.menu-host`) for screen readers.
  It is a flex column: in a plain block the button kept its own width (121 of 150 px), and the
  user saw its highlight and arrow stop short of the menu's edge.
- Headings for a tag or a commit no longer say "(detached HEAD)": the first words under them
  do ("Detaches HEAD at …").

**Results (V14)**. Tests first: the new unit test failed (no `ref`), and against `main`'s build
5 of 6 checkout e2e tests failed (no lone "Check out", no submenu). Now 558 unit tests (1 new)
and 66 e2e (2 new: the keyboard path through both menus; the submenu kept in a 900 × 300 window,
flipped left of "⋯" and moved up near the bottom; the entries test rewritten for the submenu;
3 tests choose through it; the confirmation's badge checked). Real repositories (Chromium,
1440 × 900, light and dark), against the spike's numbers:

| Row | Before | V14 |
|---|---|---|
| Qwik HEAD (`main`, 8 tags) | one menu, 480 × 343 px, "Check out" 10 times | menu 160 × 42, submenu 368 × 335: 10 badges in a column, notes after them |
| Qwik `2cf8a7d` (remote branch) | 480 × 112, a 117-character entry on two lines | submenu 480 × 105: the name whole on one line, the note under it |
| A 140-character branch (scratch repository) | — | cut with "…" in the submenu (its title whole), whole in the confirmation |
| Page errors | — | 0 |

Not verified: Firefox and Safari (empty alternative text for `content` needs Chrome 77, Safari
17.4, Firefox 128; older browsers draw the same arrow and read it in the name); touch screens
(no hover: a tap on "Check out" opens the submenu, as a click does); first rows drawn, not
re-measured (the rows did not change).
