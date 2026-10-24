# Journal: V14 — Checkout submenu

[Index](../JOURNAL.md) · [Plan](../plan/v14-checkout-submenu.md)

## V14 spike — the checkout menu's names (2026-10-14, branch `milestone/v14-checkout-submenu`)

Measured before planning a checkout submenu, in Chromium on `symbiote view` of the Qwik and
Bitwarden clones (`main` at `c2e3486`, 1440 × 900). Qwik's HEAD row (`main` and 8 release tags)
gets 10 entries, each starting "Check out" and 8 ending "(detached HEAD)"; the menu stops at its
480 px max width and is 343 px tall. A remote branch's entry is 117 characters ("Check out
origin/dependabot/… as dependabot/…") on two lines, and the confirmation repeats it as its
heading. The names are plain text in the middle of each sentence, while the rows draw the same
names as coloured badges. Refs per commit stay small (Qwik 1–8 but for one commit with 10 or
more, Bitwarden 1–5, CPython 1–2); the longest name is 140 characters (a Bitwarden remote
branch). So the plan puts the targets in a submenu under one "Check out" entry, each name as
the row's badge with a muted note, and the name as a badge in the confirmation's heading.

## V14 — Checkout submenu (2026-10-14, branch `milestone/v14-checkout-submenu`)

A row's menu holds one entry, "Check out ▸"; its targets open in a submenu beside it on hover
(or a click, → or Enter), each named by the row's badge with a muted note after it ("tag ·
detached HEAD"). `c` opens straight into the submenu. The confirmation's heading shows the name
as a large badge ("Check out branch [wip]?"). Viewer only.

**Learned**:
- CSS generated content is part of the accessible name: the item drawn as "Check out ▸" was
  named "Check out▸" until the arrow got empty alternative text (`content: '▸' / ''`).
- In a menu entry the name must win the space. A one-line note squeezed a 62-character remote
  name to "o"; with `flex-wrap` the note goes under a long name and the name stays whole up to
  the menu's width, then ends in "…" with its title whole.
- A pill badge wrapped over two lines loses its border; as an inline block it wraps inside
  rounded corners, and `max-width: calc(100% - 1em)` keeps the "?" beside it.
- The submenu has to be measured where nothing narrows it (at the window's left edge, hidden):
  measured in place near the right edge, its shrink-to-fit width would be too small before it
  is moved to the left.
- A `<button>` does not stretch to fill a plain block wrapper, though it does as a flex item:
  wrapped for screen readers, "Check out" was 121 px wide in a 150 px menu. The user saw it
  before any test did; an e2e test now checks that it fills the menu.
- The menu opens after `/api/refs` and `/api/status` answer: a test that pressed Enter right
  after clicking "⋯" reached the page before the menu. It now waits for the menu.

**Verification**: tests first — the new unit test failed on the missing `ref`; 5 of 6 checkout
e2e tests failed against `main`'s build. Now 558 unit tests and 66 e2e (2 new: the keyboard path
through both menus, the submenu kept in a small window). Screenshots on the Qwik clone, light and
dark: HEAD's row (`main` and 8 tags: a submenu of 10 badges, 368 × 335 px, where the menu was
480 × 343 with "Check out" 10 times), the remote-branch row (the name whole, the note under
it), and their confirmations; a 140-character branch in a scratch repository. No page errors.
Not verified: Firefox, Safari, touch screens.

Merged into main (2026-10-14). `main` verified after the merge: 558 unit tests, build, 66 e2e.
