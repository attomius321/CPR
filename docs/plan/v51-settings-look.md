# V51 — Settings and Skills: centred, in cards

[Index](../PLAN.md) · [Journal](../journal/v51-settings-look.md)

**Status:** in progress (2026-10-25), on branch `feature/settings-style` (the workspace's); the plan
confirmed by the person ("OK"), with three answers: Skills follows Settings, the list as I see fit,
Appearance in a section of its own rather than the head.

**Problem** (asked: "Make settings view styling like start new workspace page"). Measured on `main`
(`5cd31ce`) in Chromium, `serveWorkspaces` with the fake Claude Code, Settings' first prompt open:

| Window | Main area | The list | The editor | Characters a line in a prompt |
|---|---|---|---|---|
| 1280×720 | 1040×696 | 240 px, 16 from the left | 744 px | 115 |
| 1440×900 | 1200×876 | 240, 16 | 904 | 140 |
| 1920×1080 | 1680×1056 | 240, 16 | 1,384 | 216 |
| 2560×1440 | 2320×1416 | 240, 16 | 2,024 | 318 |

Skills draws its list and editor with the same rules (`.settings-body`, `.settings-list`,
`.settings-editor`): the same numbers.

What makes it unlike the start page (V49):
- **Pinned to the top left, stretched to the right edge**: every pixel a window adds goes to the
  editor, whose prompt then runs 2–3 times the ~100 characters V49 kept the brief to.
- **No grouping**: the heading, the text area, its placeholders and Save stand on the canvas; a
  prebuilt agent's Model, Effort and Instructions are told apart by a hairline and a heading each,
  the Model's select under its name.
- **A setting in the head**: Appearance (a segmented control) and Play the intro sit in the head,
  where the start page has only its title, where it starts and its actions.
- **Dated chips** (the style's table): "Symbiote's" and "The project's" are bordered chips.

**Goal**: Settings and Skills drawn as the start page is: centred in the main area at every
width, the head's contents in that width, each page's parts as cards, settings as rows (name left,
control right); Appearance and the intro an entry of their own. Unchanged: what is saved and when,
the drafts and the leave guard, Ctrl+S, `?prompt=` and `?skill=`, the list's groups and order,
the narrow layout (the list, then a page with All settings), the tokens, every other page.

## The page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│          Settings ?                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│          No prompt changed: every agent is told Symbiote's text.            │
│          Workspaces        Scout                                            │
│            Feature         ╭───────────────────────────────────────────╮    │
│            Fix             │ Model ?      [Claude Code's default     ▾] │    │
│            …               │──────────────────────────────────────────│    │
│          Reviews           │ Effort ?                                  │    │
│            …               │ ●────·────·────·────·────·                │    │
│          Prebuilt agents   ╰───────────────────────────────────────────╯    │
│            Merger          ╭───────────────────────────────────────────╮    │
│            Scout  ▌        │ Instructions  Symbiote's  ?               │    │
│            Scribe          │ [ You are Scout, the person's assistant … ]│    │
│          This browser      │ …                                  [Save] │    │
│            Appearance      ╰───────────────────────────────────────────╯    │
```

- **Centred** (decision 386): `.settings-body` is a grid of the list (240 px) and the page (up to
  760 px, the brief's width), 24 px apart, centred in the main area: 1,024 px in all. The head
  keeps its full-width strip in `--side`; its title and actions (Skills' New skill) are laid out
  in the same width (`max(16px, (100% − 1024px) / 2)`), as are the notes under it (the git note,
  a warning, an error). Under 900 px the narrow layout is kept.
- **Cards** (decision 387): the style's card (14 px, `--panel`, `--line`, `--shadow-lift`, 16 px
  padding; 12 on a phone). A prompt's page: its heading (the chip, its "?") over one card holding
  the text, its size, the fixed answer, the placeholders, the actions and Symbiote's text. A
  prebuilt agent's page: its name, a card of rows (Model, Effort), then a card per prompt with its
  heading inside. A skill: its name and where it is over one card; New skill the same; Scribe's
  pane framed as a card.
- **Rows** (decision 387): Model is a row, its name and "?" left in `--muted` weight 500 in a
  104 px column, the select right of it (up to 360 px), a note or a warning under the select;
  Effort keeps the stepper under its name, as on the start page. The names stay `h3`s: the parts
  are still regions with a heading.
- **Appearance** (decision 388): an entry of its own at the list's end, "This browser → Appearance"
  (`?prompt=appearance`): a card of two rows, Theme (Dark, Light, System; kept in this browser)
  and Intro (Play the intro). The head keeps only the title and its "?". It is listed even when
  the prompts cannot be read, so the theme can always be changed.
- **The list** (decision 389): a plain column beside the cards, as today: navigation, not a part
  being written.
- **Skills follows** (decision 390, the person's answer): the same width, cards and head;
  Scribe's terminal gets the page's 760 px (~90 columns of Claude Code).
- **Chips**: "Symbiote's" (and Skills' "Committed") quiet: `--raised`, `--muted`, no border; "The
  project's" and "Changed" the `--modified` tint (12 % fill, 30 % edge), Skills' "New" the
  `--added` tint.
- **Not lowered on a tall window** (unlike the start page's cards): a prompt's card is taller
  than a 900 px window already; a gap above would push it down.

## Verification

1. **e2e first** (red on `main`): in `settings.spec.ts`, at 1920×1080 and 2560×1440 the list and
   the page centred (the margins left and right equal ±1 px), the head's title over the list's
   left edge (±1 px), the page a card no wider than 760 px; on Scout's page Model's name and its
   select on one row. Appearance an entry: the theme set there, the intro played from there. In
   `skills.spec.ts`, Skills centred the same way. Updated for the move: `look.spec.ts`,
   `intro.spec.ts`, `app.spec.ts`.
2. **The rest**: `pnpm check` (the tokens' contrast, radii, sizes and accent guards), `pnpm build`,
   the whole `pnpm test:e2e`.
3. **Screenshots** before and after, dark and light, at 1280×720, 1440×900, 1920×1080, 2560×1440
   and 390×844: a prompt, Scout, the merger (its fixed answer), Appearance, a changed prompt (its
   chip, Symbiote's text), an unsaved draft; Skills (a skill, New skill, Scribe); text at 3× for
   uneven gaps. The table above measured again.
4. The graph, the fonts and the layout code are not touched: no Bitwarden timing.

**Risks**

| Risk | Mitigation |
|---|---|
| A text area in a card: two frames | the card is `--panel`, the field `--input-bg` with `--field-line`, as on the start page |
| Scribe's terminal narrower at 1440 (904 → 760 px) | ~90 columns at 13 px; looked at in the screenshots |
| Tests that find Appearance in the head | updated in the same commit as the move; nothing else uses it |
| `feature/scout-should-be-a-terminal` (V50) also edits `settings.spec.ts` and `look.spec.ts` | whichever merges second resolves; the hunks are apart |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V51 | Settings and Skills centred in cards; Appearance an entry | `SettingsPage.*`, `SkillsPage.*`, `settings.spec.ts`, `skills.spec.ts`, `look.spec.ts`, `intro.spec.ts`, `app.spec.ts` |

**Proposed decisions** (confirmed by the person with the plan):

| # | Question | Decision | Why |
|---|---|---|---|
| 386 | Where Settings stands in a wide main area | **Centred: the list 240 px and the page up to 760 px; the head's contents in that width** | the start page's rule (decision 378); 216–318 characters a line at 1920–2560 |
| 387 | How a page is grouped | **Cards; a prebuilt agent's Model and Effort as rows in one card, each prompt a card** | the start page's cards and rows (decision 379) |
| 388 | Where Appearance and the intro go | **An entry of their own, "This browser → Appearance", at the list's end** | the person's answer; a setting is a row, not a head's action |
| 389 | The list | **A plain column, not a card** | navigation beside the cards; the person left it to me |
| 390 | Skills | **Follows Settings, Scribe's pane in the page's width** | the person's answer; the two pages are drawn alike (V41) |

**Not in V51 (later)**: Scout's page and History; a settings search.
