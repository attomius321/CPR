# Journal: V32 — Text one can read: a type scale, one step up

[Index](../JOURNAL.md) · [Plan](../plan/v32-type-scale.md)

## V32 — text one can read: a type scale, one step up (2026-10-21, branch `feature/font-too-small`)

Asked: "The font-size is too small to read ... My eyes are hurting". Every text one step larger,
nothing under 12 px but uppercase labels and one-glyph marks, every size from a `--size-*` scale
on `:root`; no text-size setting for now (decisions 226–229).

**Learned**:
- **159 font sizes, all in px, and most of what is read at 12 px or less**: buttons, paths, the
  status bar and all code at 12 px (85 rules), chips, badges, counts, dates and section labels at
  10–11 px (37). Only the body, rows and tabs were 13. A scale of named sizes and a guard test
  (as the radii have since V31c) make the next change one line.
- **Titles were not what was small.** At 18 px a symbol's long name wrapped mid-word in its panel
  (Bitwarden's `vault-cipher-row.component.html`, one line at 16 px), and a frame's name would
  outgrow the band `flow.ts` estimates at 10 px a character. Titles stay at 16 px; those at 14 go
  to 16.
- **The graph's layout holds the larger text**: `nodeWidth` counts 9.4 px a character and a 14 px
  Geist Mono name takes 8.6; 58 px still holds both lines. On Bitwarden `737ee3f`, as j walks 40
  changes, 22 of 82–83 names are cut short on both builds (the long ones hit the 380 px width
  cap either way), and no frame's band overflows (3 of 3).
- **xterm kept its columns**: at 1440×900 the terminal is 148 × 44 at 14 px, 148 × 46 at 13.
- **The change list's column (300 px) fits about two characters fewer** of a mono name; paths
  there were cut before too. Not changed: its width is layout.

**Verification**: tests first, red on `main` for the right reason: `tokens.test.ts` (the scale's
values; every size from it: 159 px sizes; no unknown token) and `look.spec.ts` (no text under
12 px, 11 for uppercase labels and one-glyph marks, on History, its row menu, Settings, the start
page, a workspace's terminal and brief, a diff, its panel and findings; the body and the terminal
at 14 px: on `main` 13 px, and chips, badges, key caps, dates and section labels at 10–11 px).
`flow.test.ts` unchanged. `pnpm check` 1,110 tests; e2e 172 of 172 (a first run beside a
screenshot job lost `changes.spec.ts:94` once; 3 of 3 alone, and passed in the full run after).
Against `main`'s build (`bbee774`), Bitwarden `737ee3f` with the Angular plugin, 3 rounds: first
paint 355–367 / 332–368 ms, select 120 / 120–121 ms, mark reviewed 50–51 / 51 ms, pan 63 fps
both. `/history` on a clone of this repository, alternated, 6 rounds: first paint 64–68 / 64–72
ms, first rows 166–240 / 161–177 ms. Screenshots before and after at 1440×900, dark and light:
History, Settings, the start page, a workspace's terminal and brief, a diff and its panel;
Bitwarden's graph, panel and map; the desktop start page (900×640, with a stub preload). Not
verified: the desktop app itself (Electron) and other browsers and systems; real agents in the
terminal; the README's screenshots, not retaken.

Merged into main (2026-10-21) by Symbiote's merger, from the approved `eb7b076`, no conflicts
(`main` had not moved since the branch).
