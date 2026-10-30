# Journal: V81 — Settings: icons in the list

[Index](../JOURNAL.md) · [Plan](../plan/v81-settings-list-icons.md)

## V81 — a lucide icon per entry, on its group's tile (2026-10-30, branch `feature/settings-list-icons`)

Built as planned (decisions 600–603): 19 entries, each a lucide icon on a 22 px tile tinted by its
group with the Activity tab's `--phase-*` colours; six new icons; `CommentIcon` on lucide's grid.

**Learned**:
- **The brief counted 20 entries; the list has 19** (Workspaces 9, Reviews 5, Prebuilt agents 3,
  This machine 1, This browser 1). The e2e test counts them.
- **A tile costs a long name its room**: 30 px (22 tile, 8 gap). "Changes or comments" open is
  160 px at weight 500; beside "not saved" (59 px) it got 149 in the 280 px list. The list went to
  300 px, the sidenav's width; Skills' list stays 280.
- **6 px is not a radius here**: the style's scale (`tokens.test.ts`) has 4, 8, 10. 8 px on a 22
  px tile reads as a rounded square at 4×.
- **lucide's current paths differ from older copies**: lucide-static 1.65.0's badge-check ticks
  `m16 9-5.5 5.5L8 12` and message-square has a rounded tail; the paths were taken from the
  published package (unpkg), not from memory.
- **The open tile keeps its tint**: opaque over `--side`, the violet `--selected` wash of the open
  row does not show through it; the accent icon on it reads at 4.83:1 or more.

**Verification**: tests first, red for the right reason: `tokens.test.ts` (no tints in the CSS),
`settings.spec.ts`'s new test (no `.settings-tile`). Then green; V62's "no icon" check replaced, its
alignment check moved from the names to the tiles, the list's width 300. Settings, page-frame and
Skills specs 33 of 33. Screenshots at 1x, dark and light: 1700×925 with a mark on "Changes or
comments", Appearance, Skill library, Nucleus; 390×844 with the list and an entry picked; the
Reviews group at 4×.

Not verified: other platforms' font rendering (Linux Chromium only); the person's eyes on the
tints.
