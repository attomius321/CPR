# V88 — Redesign foundation: both modes' colours and the shared parts

[Index](../PLAN.md) · [Journal](../journal/v88-redesign-foundation.md)

**Status:** built (2 November 2026), on branch `feature/redesign-foundation` (the workspace's,
from `main` at `42b3b57`); ready for review.

**Problem** (the brief: "Bring the redesign's foundation into the viewer, so every page takes the
new look at once and the later redesign work builds on it"). The designs are on `main`:
[`spikes/hive-redesign`](../../spikes/hive-redesign/README.md) (Hive Control) and
[`spikes/normal-redesign`](../../spikes/normal-redesign/README.md) (normal mode in the same
system). The viewer today, measured on `42b3b57`:

| | Today |
|---|---|
| `--warning` (amber) | 45 uses in 15 files (18 in `shell/Sidenav.css`), most meaning "waiting for you" |
| `--error` | 41 uses in 13 files; 9 of them Hive's identity (its Settings tile, On state, mark, the warning box), not a failure |
| `--hive-red` | 17 uses: Hive's crimson as the selection, the sidenav's Hive card, the question's edge and glow |
| Gloss, sheen, streak, glow | 8 uses in `ui/hive.css`, tokens in four blocks of `ui/base.css` |
| The honeycomb | `HiveComb.tsx`, `hive-comb.ts`, `hive-comb.css`, its mount, `e2e/hive-comb.spec.ts`; the sidenav's Hive card etched with cells and a streak every 5 s |
| States in a change kind's colour | done `--added`, failed `--removed`, working `--moved` (cyan), running `--info` (cyan) |

Hive's red is its accent, its primary and the error at once; amber means "waiting for you" while
the redesign gives it to the agent's turn. The kits' values pass every contrast rule of
`test/tokens.test.ts` but one: the light `--line` on `--bg` is 1.17 (normal) and 1.15 (Hive), under
the 1.2 asked (the spike measured it on a card).

**Goal**: every page in the kits' colours, in both modes and both themes; one set of states shared
by both modes; the status label, the stage track, the buttons, the card head and the page head as
the kits draw them, from `src/ui`; no honeycomb, sheen, streak, glow or gloss, and no red in Hive's
neutrals. The pages' layouts do not change (later briefs).

## Tokens (`ui/base.css`)

- **Normal mode** takes `spikes/normal-redesign/src/normal.css` in dark, light and the system's
  light: cool ink, the S's violet the primary (dark words), the accent, the focus and `--you`.
  The light theme becomes a grey ground with white cards (`--bg #f3f4f7`, `--panel #ffffff`).
- **Hive mode** takes `spikes/hive-redesign/src/kit.css`'s warm ink in its dark, light, system
  light and `.hive-ink` (the question's) blocks. `--hive` is the identity, `--hive-text` its text
  (Hive's `--accent` and `--focus`), `--primary #c8102e` with white words; the selection a neutral
  wash.
- **The states, both modes**: `--run` amber (in progress, the agent's turn), `--ok` green (passed,
  landed, merged), `--error` red (failed, stopped), `--info` cyan (paused, info), `--you` violet
  (the person's turn, in both modes: the person's decision). `--warning` stays amber, only for a
  real warning. `--line-2` is a secondary button's edge.
- The light `--line` darkened to pass 1.2 on the ground: `#dadee7` (normal), `#dcdce2` (Hive).
- Gone: `--hive-red`, `--hive-gloss`, `--hive-sheen`, `--hive-streak`, `--hive-glow`,
  `--hive-comb-*`. Unchanged (out of scope): lanes, kinds of work, heat, the change kinds, sizes.

## The states sorted

Each rule read in context:

- **`--you`**: the sidenav's Waiting for you and To review, a page waiting, its flash and count,
  waiting and ready dots; the ask bar; a workspace's ready head, its Waiting strip, a thread
  waiting; `WorkspaceMark` ready; Merge's asked tone and flag; the Activity tab's waiting and asks;
  the desktop app's taskbar dot (`packages/desktop/src/badge.ts`).
- **`--run`**: working, starting and merging in the sidenav (cyan today), Hive at work (crimson),
  running on the Activity tab and the analyzing page (cyan), a step log's running step.
- **`--warning`** stays for real warnings: usage high, skill checks, Settings' warnings, Start's
  advice, a stale workspace, a gone worktree, a finding's severity.
- **`--info`**: Hive paused now.
- **`--ok`, `--error`** for states drawn today in `--added` and `--removed`; a change kind's use
  keeps its colour.
- **Hive's identity in `--error`**: its Settings tile, On state and mark take `--hive`; the "what
  Hive will do" box goes neutral (proof 11-settings-hive). Real errors on Hive's page stay red.

## The shared parts (`src/ui`)

- **`StatusLabel`** (`ui/StatusLabel.tsx`, `ui/status.css`): the kit's `.pill`, an icon and a
  word, 22 px, a 12 % fill and a 28 % edge; tones `run`, `ok`, `error`, `info`, `idle`, `you`,
  `hive`. It replaces the state badges (Hive's Review tab, the Activity tab, Settings' state, a
  workspace's history, a review's result); `.badge` takes its shape, so findings' badges match.
- **`StageTrack`** (`ui/StageTrack.tsx`): hexagons on a line, `done`, `now`, `bad` or `todo`, with
  Hive's Write, Check, Review, Land or normal mode's Plan, Your OK, Build, Review, Merge. No page
  shows these steps today (Hive's head says them in a sentence): built and tested, placed by the
  later briefs.
- **Buttons** (`ui/controls.css`): the primary violet with dark words, crimson with white words in
  Hive, no gloss; secondary raised with a `--line-2` edge; ghost as today; `.danger` a secondary
  with red words (a red fill today). Turn on Hive is a crimson primary in both modes
  (`.button.hive`, proofs 09 and 11); Turn off Hive a secondary with red words.
- **`PageHead`**: its icon on a tile (raised, a hairline, the icon in `--accent`).
- **`.card-head`**: its title 15 px at 600, an `.end` for its actions. Tabs: the picked one's line
  in the identity's colour.

Where the kit and today's tested rules differ, today's win: card head 37 px (kit 40), the head's
tile 28 px so titles stay at x 52 (kit 30), a small button 24 px (kit 26), a chip's radius 4 px
(kit 6, off the scale). Page actions 30 px and cards 10 px: the same in both.

## Removed

`HiveComb.tsx`, `hive-comb.ts`, `hive-comb.css`, their mount (`main.tsx`) and import
(`styles.css`), `e2e/hive-comb.spec.ts`; in `ui/hive.css` the primary's gloss, the sheen over
`.shell-main`, the sidenav's glow, the arrival's sheen and streak, the question's streak and
crimson glow; in `shell/Sidenav.css` the Hive card's cells and streak (Hive at work a plain group
as Working, for now: the sidenav's new groups are a later brief). The arrival keeps the Mind
growing, the hex shutter closing, the look changing under it and the shutter opening onto the
page, then Alpha Ceph's becoming; the comb laid at the swap and the streak after it are gone. The
question keeps its circuit art and its layout and takes the warm ink.

## Verification

1. **Tests first**: `tokens.test.ts` with the new values, `--you`, `--run`, `--ok`, Hive's block
   without red neutrals, and a guard that no `hive-comb`, gloss, sheen, streak or glow name is
   left in `src`; `styles.test.ts` without `hive-comb.css`; `StatusLabel` and `StageTrack`
   markup tests; e2e specs reading colours or the comb updated.
2. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
3. **viewer-check**: first paint (`/git`) and Bitwarden's graph against `main`, no slower.
4. **Screenshots**: every page, both modes, both themes, 1×, before (this branch's first commit,
   equal to `main`) and after, beside the spikes' proofs: the terminal view first; card states in
   the sidenav, dialogs, menus, empty and loading states.

**Risks**

| Risk | Mitigation |
|---|---|
| The light ground turns grey under content that sat on white (Git's rows, the terminal's page) | Screenshot every page in light; content on `--bg` checked for contrast by the test's four grounds |
| e2e specs that read colours | Updated with each token; their failures read before changing them |
| A `--warning` sorted wrong | Each rule read in context; the table in the journal |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V88 | Tokens, states, shared parts, removals | This branch |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 812 | The colours (supersedes 437, 614) | **The kits' tokens: normal mode cool ink and the S's violet, Hive warm ink; light a grey ground with white cards; the light line darkened to 1.2:1** | the person's designs (`spikes/*-redesign`); the test asks 1.2 on the ground |
| 813 | The states (supersedes 467; replaces V61's amber for waiting, 422's amber band, 504's running cyan, 698's crimson) | **Amber the agent's turn and in progress, violet the person's turn in both modes, green passed, red failed, cyan paused; amber `--warning` only for a real warning** | the person, 2 November: "violet = the person's turn and amber = the agent's" |
| 814 | Hive's crimson | **Identity only: the mark, the mode, the picked tab, its accent's text, one constructive primary a page; never a state or a surface** | Hive Control's README; red stood for Hive, the primary and failure at once |
| 815 | The honeycomb and the light over the pages (supersedes 701, 702, 703, 704, 706, 707; replaces 624's and 673's streak, 698's cells) | **None: no comb, sheen, streak, glow or gloss** | the person: "the honeycomb goes" |
| 816 | The arrival without them (amends 730) | **The Mind, the shutter closing, the swap, the shutter opening onto the page; then Alpha Ceph's becoming** | the brief: keep it working; its 1.4 s redesign is later |
| 817 | A status | **`StatusLabel`: an icon and a word, tinted, 22 px; `.badge` its shape** | never colour alone (the kit's `.pill`) |
| 818 | The stage track | **`StageTrack` in `src/ui`, placed by the later briefs** | no page shows these steps today; the brief: only a like-for-like swap |
| 819 | Buttons (supersedes 613's danger button; replaces 404's Clean up as the head's primary) | **One constructive primary a page (violet, dark words; crimson, white words in Hive); secondary raised; ghost; destructive a secondary with red words (Clean up, Delete, Turn off Hive); Turn on Hive crimson in both modes** | the kits; the person's yes to the plan |
| 820 | The page head and a card's head | **The icon on a 28 px tile; a card head 37 px, its title 15 px at 600** | the kit's `.head` and `.card-head` at today's tested heights |
| 821 | The taskbar dot | **Violet, as Waiting for you** | the person's yes to the plan |

**Not in V88 (later briefs)**: the workspace page's and the terminal view's new layout, reviews,
the two Overview pages, Hive's pages and sidenav groups, turning Hive on in 1.4 s, Approve plan, the
terminal's theme, the change kinds' colours, lanes, the Activity tab's phase colours, the type
scale and heights.

## As built (V88)

- **Cards on `--panel`, the chrome alone on `--side`.** Until V88 `--panel` equalled `--side`, and
  cards painted their ground with either, or with `--bg`. With the kits' light theme (a grey
  ground, white cards) that showed as grey cards and grey panes inside white ones (Hive's Review
  tab in the first after-shots). 28 `--side` grounds and 11 `--bg` grounds of cards and card heads
  became `--panel`; the sidenav, status bar, title bar and the narrow drawer stay `--side`; code,
  pre, the graph's canvas and the thread's items stay `--bg`. Rings and hollow fills that stand a
  mark off its card (the Activity tab's tiles, Git's merge and working dots, the Monitor's tile
  borders, a signature's diff wash) follow the card. The Activity tab's tile test reads `--panel`.
- **The picked tab** keeps its 3 px line in `--primary` (crimson in Hive: the kit's `--hive` is
  a step lighter) and loses its ground (`--tab-picked` transparent), as the kits draw it.
- **`--warning`'s guard** names the two warnings whose selectors do not say so:
  `.merge-check-head` (a merge's conflicts) and `.merge-control-why` (cannot fast-forward). A
  subscription's crown on Start was amber for the mockup's sake; neither a turn nor a warning, it
  is muted now.
- **The Activity tab's tones** (`words.ts`) are the states' names: `run`, `ok`, `you`, `warning`,
  `error`, `muted`; its status a `StatusLabel` with its own icon.
- **What Hive will do** on Settings' Hive page is a neutral note with its triangle in
  `--warning`; the refused list in the question keeps the error's tint (a refusal).
- **The desktop app** takes the new grounds too: its window background and title bar
  (`frame.ts`), its start page's copy of the tokens (`start/start.css`), the taskbar dot violet.
- **User docs**: the guide and the README say violet for the waiting dot and link; the
  configuration page no longer describes the honeycomb or ink and crimson pages.
- **One primary in a workspace's head.** The audit found a merged workspace's head with three
  violet primaries (Stop the agent, Review, Clean up): a bare `.button` draws the primary, and
  V55's "Review plain" had lost its plain look when the head left `.workspace-actions` (V72).
  Stop and Start the agent are secondary, Review the one primary until merged and secondary after,
  Clean up and Clean up anyway destructive (decision 819 replaces 404's Clean up primary); a
  skill's Delete is destructive too.
- **Not placed**: `StageTrack` is built and tested but on no page (no page shows these steps
  today); the Hive group in the sidenav is a plain group until its own brief.

**Results.**

- Tests: `tokens.test.ts` 62 (21 red before the tokens), `shared-parts.test.ts` 5 (red before the
  components), `activity-words`, the desktop's `badge` and `frame` tests red then green;
  `pnpm check` 2,905 tests pass; `pnpm build` passes.
- e2e: the viewer's 394 specs ran once: 390 passed, 4 failed; 3 named the old colours (usage,
  settings) and pass since; `hive-pacing.spec.ts:108` fails on `main` too between 23:00 and
  midnight ("goes on tomorrow at 00:27": its pattern has no "tomorrow"), not this branch's. The
  nexus's 20 pass.
- First paint, Bitwarden `737ee3f` with the Angular plugin (`measure.mjs`, 3 rounds alternating
  with `main` built from `git archive`): `main` 338, 334, 320 ms; this branch 330, 325, 304 ms.
  Select, mark reviewed and pan the same (105–121 ms, 50 ms, 62–63 fps); the same 3,160 elements.
- Screenshots: 82 a side, every page in both modes and both themes, at 1×, before and after, beside
  the kits' proofs: <https://claude.ai/artifact/UHpgdwqjjVqtRGZd3RJpxm> (private).
- The README's 17 screenshots (`docs/images/*.png`) show the look before V88: amber waiting cards,
  the honeycomb in `hive.png` and `hive-settings.png`. Not retaken here.
