# V81 — Settings: icons in the list

[Index](../PLAN.md) · [Journal](../journal/v81-settings-list-icons.md)

**Status:** planned (2026-10-30), on branch `feature/settings-list-icons` (the workspace's); the
plan confirmed by the person ("OK"), decision 603 (`CommentIcon` redrawn) and the tints with it.

**Problem** (asked: "Settings' list is hard to navigate: 20 entries in five groups, words only.
Give every entry an icon, so the list can be scanned"). On `main` (`0173bca`) the list is 20 rows
of 32 px in a 280 px card, five group headings, no icon: V62's decision 448 left them out at the
person's request then. The person reverses it now.

**Goal**: every entry shows a lucide icon in a small tile tinted by its group (the macOS System
Settings idea): the tint says the group, the drawing the entry; the name stays the row's label.
**Unchanged**: the groups, their order, the names and the marks; what Settings saves; the open
page's card head; other pages' icons (but `CommentIcon`'s grid, decision 603).

## The icons (decision 600)

Lucide only, drawn in `ui/icons.tsx` on its 24-unit grid; 14 exist with the same meaning, 6 are
new (bold). One icon per meaning across the app: fast-forward (a merge strategy) and circle-check
(Done) are not used.

| Group | Entry → icon |
|---|---|
| Workspaces | Feature → git-branch · Fix → scissors · Refactor → blocks · Chore → power · Spike → route · Plan first → clock · Plan without → **timer-off** · Documents → file-text · Suggest settings → lightbulb |
| Reviews | Approved → **badge-check** · Approved to push → **cloud-upload** · Changes or comments → message-square · Where the review is → **map-pin** · symbiote/AGENTS.md → **scroll-text** |
| Prebuilt agents | Merger → git-merge · Nucleus → circle-dot · Scribe → sparkles |
| This machine | Skill library → folder |
| This browser | Appearance → **palette** |

The icon is decorative (`aria-hidden`), in a tile before the name; the marks stay at the row's end.
An entry's icon is found by its key (an agent's: its first prompt's); a key without one draws no
tile.

## The tints (decision 601)

The Activity tab's `--phase-*` colours, no new tokens. The icon in its group's colour on its tile
(the colour's `--phase-wash` share over `--side`, the list card's ground); the open entry's icon in
`--accent`. Contrast on the tile, dark / light:

| Group | Token | Icon | Accent |
|---|---|---|---|
| Workspaces | `--phase-implement` (blue) | 6.12 / 4.48 | 5.08 / 5.31 |
| Reviews | `--phase-test` (green) | 7.47 / 4.13 | 4.83 / 5.37 |
| Prebuilt agents | `--phase-visual` (pink) | 5.46 / 4.01 | 5.27 / 5.28 |
| This machine | `--phase-docs` (amber) | 6.69 / 4.34 | 4.99 / 5.32 |
| This browser | `--phase-explore` (teal) | 5.70 / 3.94 | 5.14 / 5.33 |

Not `--phase-git`: violet is the accent's hue, the open icon would sink into its tile. Not
`--phase-debug`: its orange is next to the amber. Blue and teal, green and teal are never adjacent
groups. A group without a tint (a prompt group added later) has a `--muted` tile, as the Activity
tab does.

## The tile (decision 602)

- 22 px, 6 px radius, the icon 14 px (the style's dense rows); rows stay 32 px, the gap 8 px.
- Opaque (mixed over `--side`, not transparent): the open row's `--selected` wash does not tint it.
- The sidenav's recipe: stroke 1.75 idle, 2.25 and `--accent` when open.
- The group headings in line with the tiles (both 8 px in), as macOS does; the words no longer
  in line with them.
- 280 − 2 (border) − 16 (card) − 16 (row) − 22 − 8 leaves 216 px for a name and its mark:
  "Changes or comments" and "changed" fit at 15 px; a longer name ends in an ellipsis as today.
- If 14 px at 1.75 reads faint at 1x, compared with 16 px in a 24 px tile; the choice recorded.

## `CommentIcon` on lucide's grid (decision 603)

It is the one of the 14 drawn on the 16-unit grid; the sidenav's strokes are 24-unit ones, and on
it 1.75 would draw 1.53 px where the others draw 1.02. Redrawn with lucide's message-square path:
on the Files page and the Activity tab it draws as before (2.4 units at 16 px, 1.6 px; 1.6 units
on the 16 grid today).

## Verification

- `tokens.test.ts` (first, failing): the group tints read from `SettingsPage.css`, each colour and
  `--accent` ≥ 3:1 on its tile over `--side`, both themes.
- `settings.spec.ts` (first, failing; replaces "the list without icons"): each of the 20 entries
  one `aria-hidden` svg in a tile, its lucide drawing (a path of it); tiles alike in a group,
  different across groups; the open icon `--accent` at 2.25, the others 1.75; the buttons' names
  unchanged; a mark after the name.
- `page-frame.spec.ts` and the whole e2e suite.
- Screenshots at 1x, both themes: 1700×925; a narrow screen, the list and an entry picked; a mark
  on "Changes or comments"; Settings' other pages (Appearance, Skill library, an agent's).
- `pnpm check`, `pnpm build`, `pnpm test:e2e`.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 600 | Icons in the list | **One lucide icon per entry, in a tile before its name; supersedes 448's "no icons" (its card, hairlines and accent stay)** | the person's brief: the list scanned, not read |
| 601 | The tints | **The `--phase-*` colours: Workspaces implement, Reviews test, Prebuilt agents visual, This machine docs, This browser explore; `--muted` for any other** | contrast-checked already, one hue in both themes; git is the accent's hue, debug the docs' neighbour |
| 602 | The tile | **22 px, 6 px radius, 14 px icon, opaque over `--side`; 1.75 idle, 2.25 and the accent open; headings in line with the tiles** | the sidenav's open recipe; 20 tiles in 280 px without crowding |
| 603 | `CommentIcon` | **Lucide's message-square on its 24 grid, same weight on the pages that use it** | the 24-unit strokes would draw it thicker than the others |
