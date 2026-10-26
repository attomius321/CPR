# V62 — Settings laid out as the person's mockup

[Index](../PLAN.md) · [Journal](../journal/v62-settings-layout.md)

**Status:** planned (2026-10-26), on branch `feature/layout-settings` (the workspace's); the plan
confirmed by the person, with three answers: the prompt stays in Geist (not the mockup's mono),
the head's line is the mockup's, Cancel and Reset show only when they apply (as today).

**Problem** (asked: "This is how settings should look like. Make it like this. without the icons
of each setting category.", with the mockup `Dark Symbiote Settings Workspace.png`, 1701×925).
Measured on `main` (`e2d0415`) in Chromium, `serveWorkspaces` with the fake Claude Code, Feature
open:

| Window | Main area | The list | The page | Ground left and right | Characters a line |
|---|---|---|---|---|---|
| 1440×900 | 1176×876 | 240 px, plain | 760, cards | 76 / 100 | 85 |
| 1700×925 (the mockup's) | 1436×901 | 240, plain | 760 | 206 / 230 | 85 |
| 1920×1080 | 1656×1056 | 240 | 760 | 316 / 340 | 85 |
| 2560×1440 | 2296×1416 | 240 | 760 | 636 / 660 | 85 |

The page scrolls as a whole (1,077 px high at 1700×925). The mockup at its own size:

- **Two cards filling the main area**: the list 286 px, the page 1,070, 17 px apart, 27–33 px
  from the main area's sides and 24 from its bottom; both run to the bottom.
- **A head of two lines**: a violet cog, "Settings", and "Configure Symbiote to match your
  workflow and preferences." in the muted colour; no git note.
- **The list a card**: group headings in the muted colour, 32 px rows, a hairline between groups,
  the open entry a violet wash with violet words; an icon before every entry.
- **The page one card**: a head (an icon, "Workspaces: Feature", a chip, "Reset to default" at
  the right) over a hairline; then "Description & instructions" with a line under it, the text
  area and its size; "Placeholders" with a line under it, the placeholders in two columns of round
  violet chips; Cancel and Save changes at the bottom right.

**Goal**: Settings drawn as the mockup, without the categories' icons. Unchanged: what is saved
and when, the drafts and the leave guard, Ctrl+S, `?prompt=`, the list's groups and order (This
machine → Skill library, which the mockup lacks, stays), the marks, Reset's confirmation, the
narrow layout (the list, then a page with All settings), the prompt's font, the tokens, Skills
(its own rules since V56) and every other page.

## The page

```
 ⚙ Settings ?
   Configure Symbiote to match your workflow and preferences.
╭─────────────────╮ ╭────────────────────────────────────────────────────────╮
│ Workspaces      │ │ Workspaces: Feature  Symbiote's                        │
│ ▐Feature      ▌ │ ├────────────────────────────────────────────────────────┤
│  Fix            │ │ Prompt                                                 │
│  …              │ │ What a Feature workspace's agent is told when it starts│
│ ─────────────── │ │ ┌────────────────────────────────────────────────────┐ │
│ Reviews         │ │ │ You are starting a new feature in this repository… │ │
│  …              │ │ └────────────────────────────────────────────────────┘ │
│ ─────────────── │ │ 911 of 8,000 characters, about 228 tokens              │
│ Prebuilt agents │ │ Placeholders                                           │
│ This machine    │ │ {branch} …                 {documents} …               │
│ This browser    │ │ No prompt changed: …         [Cancel] [Save changes]   │
╰─────────────────╯ ╰────────────────────────────────────────────────────────╯
```

- **The whole main area** (decision 446, after V51's 386): `.settings` a column, its head then a
  grid of the two cards that takes the rest of the height: the list 280 px, the page the rest, 16
  px apart, 24 px from the main area's sides and bottom. Each card scrolls on its own; the page
  card's head stays. Past 1,400 px of cards (windows over ~1,710 px) they stay centred: a prompt's
  lines stay under ~130 characters (V51 measured 318 at 2560 when the page took every pixel).
- **The head** (decision 447): the sidenav's Settings icon in `--accent`, the title, its "?"
  (About Settings) and the mockup's line under it in `--muted` (the person's answer). The git
  note leaves the head for each prompt's footer (below). Warnings and errors stay under the head.
- **The list a card** (decision 448): the style's card (10 px, `--side`, a `--line` hairline),
  group headings in `--muted` caption, rows 32 px with no icon (the brief), a hairline between
  groups; the open entry the `--selected` wash, its words `--accent` and weight 500 (a new accent
  role, "the current entry", in `tokens.test.ts`'s `ACCENT_ROLES`). The marks stay at a row's end.
- **The page one card** (decision 449): a head — the name (a prompt's "Workspaces: Feature", an
  agent's "Scout", "Skill library", "Appearance") and, on a prompt's page, its chip and Reset to
  default at the right — over a hairline; then the body. No icon before the name (the brief).
  - A prompt: "Prompt" (not the mockup's "Description & instructions": for Approved or Plan first
    the text is a line, not instructions) with the prompt's `about` under it in `--muted` (behind
    the "?" today); the text area and its size; the merger's fixed answer; "Placeholders" with
    "Each is filled in when the prompt is used; click one to insert it at the cursor." under it,
    then the chips in two columns (one under 700 px of card); Symbiote's text (when changed);
    the footer: the git note or the last save's notice at the left, Cancel and Save changes at the
    right.
  - A prebuilt agent: Model and Effort as rows (V51), then each prompt a section of the body with
    its title ("Instructions", Scribe's "Library"), chip and Reset to default on one line, the rest
    as above.
  - Appearance and Skill library: their rows in the body; the library's about under the head.
- **Controls** (decision 450): Save is "Save changes" (the primary), Discard changes is "Cancel"
  (shown with a draft, as today), "Reset to Symbiote's" is "Reset to default" with lucide's
  rotate-ccw icon (shown when the project's text is in use, its confirmation as today). A
  placeholder is a round chip, the `--selected` wash with `--accent` mono words (an accent role:
  something one acts with). The primary keeps its dark words (decision 440).

## Verification

1. **e2e first** (red on `main`), in `settings.spec.ts`: at 1700×925 and 1440×900 the list and
   the page are cards 16 px apart, 24 px from the main area's sides and bottom (±1), the list 280
   px; no icon in an entry; the open entry's words in the accent; the page card's head holds the
   name and the chip, its body "Prompt" and "Placeholders" with their lines; the placeholders in
   two columns; Cancel and Save changes at the card's bottom right; at 1920 and 2560 centred, at
   most 1,400 px. Existing tests take the new names (Save changes, Cancel, Reset to default) and
   headings, asserting the same behaviour. Updated where they read the old structure:
   `look.spec.ts`, `app.spec.ts`.
2. **The rest**: `pnpm check` (contrast, radii, sizes, the accent's roles), `pnpm build`, the whole
   `pnpm test:e2e`.
3. **Screenshots** before and after, dark and light, at 1700×925 (beside the mockup), 1440×900,
   1280×720, 1920×1080, 2560×1440 and 390×844: Feature, a changed prompt with a draft, Reset's
   confirmation, Scout, Scribe (two prompts), the merger (its fixed answer), Skill library,
   Appearance; text at 3× for uneven gaps.
4. The graph, the layout code and the fonts are not touched: no Bitwarden timing.

**Risks**

| Risk | Mitigation |
|---|---|
| A card of the window's height with a text area up to 70 % of it: a scroll inside a scroll | the text area's own scroll stays; the card's body scrolls past it as the page does today |
| The git note out of the head: a test and a reader look for it there | it shows beside Save, where the save's notice already goes; `settings.spec.ts` reads it there |
| Specs that find Save, Discard changes or Reset to Symbiote's by name | updated in the same commit |
| Skill library's and Appearance's markup share `settings-*` classes | screenshot both pages, dark and light |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V62 | Settings as the mockup | `SettingsPage.*`, `LibraryPage.tsx`, `icons.tsx`, `settings.spec.ts`, `tokens.test.ts` |

**Decisions** (confirmed by the person with the plan):

| # | Question | Decision | Why |
|---|---|---|---|
| 446 | Where Settings stands | **The whole main area: two cards to its bottom, 24 px margins, 16 apart; centred past 1,400 px** | the mockup; V51's 760 px left 206 px of ground each side at its size |
| 447 | The head | **The Settings icon, the title, its "?" and the mockup's line; the git note beside Save** | the mockup; the person's answer |
| 448 | The list | **A card, hairlines between groups, no icons, the open entry in the accent** | the mockup and the brief |
| 449 | A page | **One card: its head (name, chip, Reset) over a hairline, sections with a line of what they are** | the mockup; the prompt's `about` read without a click |
| 450 | The controls | **Save changes, Cancel, Reset to default (shown as today); placeholders round accent chips in two columns** | the mockup; the person's answer on when they show |

**Not in V62 (later)**: the mockup's mono for the prompt (the person kept Geist, as V37 chose); an
icon per category (the brief).
