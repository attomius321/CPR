# V63 — Start a workspace drawn as the person's mockup

[Index](../PLAN.md) · [Journal](../journal/v63-start-page-mockup.md)

**Status:** in progress (2026-10-27), on branch `feature/start-workspace-revamp` (the workspace's);
the plan confirmed by the person, with four answers: the title's ✨ and the goal's link and page
icons are left out, the primary keeps its dark words (decision 440), the title at Settings' size
(V62), and the background's arcs are tried.

**Problem** (asked: "I need a revamp of workspaces, it should look like in the picture.", with the
mockup `Dark Workspace Creation Dashboard (1).png`, 1641×959, the page without the sidenav).
Measured on `main` (`3b7771c`) in Chromium, `serveWorkspaces` with the fake Claude Code, at a
1641×959 window (a 1377 px main area):

| | Today | The mockup |
|---|---|---|
| Head | one 52 px line: the title, "From main at 927cae5", Cancel, Clear and Start as plain buttons | the S mark (~60 px), the title, a line under it ("Create a new workspace from a branch with an AI agent"); Cancel and Clear framed, "▶ Start workspace" the primary |
| Width | 760 + 24 + 380 = 1,164 px | 821 + 20 + 470 = 1,311 px |
| The kinds | a segmented control, words only | tabs with an icon each, the picked one a violet wash with a violet line on the card's hairline; the "?" at the row's end |
| The brief's fields | Title, Goal, Done when; More a link | a "?" beside each name; in the goal a toolbar (Markdown, attach, link, page) and a counter "0/4000"; a "Be specific for better results" box; More a framed row with an "Optional" chip |
| The run | one card, eight rows (name left, control right) | seven cards, each a violet icon and a heading: Source, Agent, Model, Effort, Permissions, Plan first, Documents |
| Ground | plain | faint violet arcs, top left and right |

**Goal**: the start page drawn as the mockup. Unchanged: what is sent to start a workspace, the
draft and when it is saved, Ctrl+Enter, Escape, `n`, drops and pastes anywhere on the page, a
start from a History row, Codex's and Hermes's rows, the tokens' values.

## The page

```
  (S)  Start a workspace                                [Cancel] [Clear] [▶ Start workspace]
       Create a new workspace from a branch with an AI agent
╭───────────────────────────────────────────────╮ ╭──────────────────────────────╮
│ [⑂ Feature] ✂ Fix  ▦ Refactor  ⏻ Chore  ⤳ Spike ? │ │ ⑂ Source                      │
│ ▔▔▔▔▔▔▔▔▔─────────────────────────────────────│ │ Start from   [⑂ main      ▾] │
│ Title ?                                       │ │ Branch name  [feature/new ][⤨]│
│ [A short name: the workspace's and its branch's]│ │ Will be created from main at │
│ Goal ?                                        │ │ 927cae5 as feature/new       │
│ ┌───────────────────────────────────────────┐ │ ╰──────────────────────────────╯
│ │ What should it do, and why?               │ │ ╭ 🤖 Agent ──────────────────╮
│ │ M↓ 📎                            0/20,000 │ │ │ Agent [✺ Claude Code ▾]    │
│ └───────────────────────────────────────────┘ │ │ ♛ your Max subscription    │
│ Done when (optional) ?                        │ ╰────────────────────────────╯
│ [How will you know it works? …              ] │ ╭ ▣ Model [Claude Code's default ▾]╮
│ Check: pnpm check, from package.json          │ ╭ ⚡ Effort ─────────────────────╮
│ ┌ 💡 Be specific for better results ────────┐ │ │ ●───·───·───·───·───·         │
│ │    Include context, constraints and …     │ │ │ Default Low Medium High xHigh Max│
│ └───────────────────────────────────────────┘ │ ╭ ⛉ Permissions [Claude Code's default ▾]╮
│ ┌ › More: Where to look, Out of scope, Notes  Optional ┐ │ ╭ ◷ Plan first and wait for my OK (●)╮
│ └───────────────────────────────────────────┘ │ ╭ 🗎 Documents (optional) ? ─────╮
╰───────────────────────────────────────────────╯ │ [+ Add files] or drop or paste │
```

- **The head** (decision 451): as Settings' since V62 — the S (`SymbioteMark`, 48 px), the title
  at `--size-title`, the mockup's line under it in `--muted`; at the right Cancel and Clear as the
  secondary (framed) button, the primary "Start workspace" with a play icon ("Make the branch"
  without an agent, "Starting…" while it starts), its words dark (decision 440, the person's
  answer). Where it starts leaves the head for Source.
- **The brief** (decision 452), one card:
  - The kinds as the mockup's tabs: an icon each (lucide's git-branch, scissors, blocks, power,
    route), the picked one the `--selected` wash, its words and icon `--accent`, a 3 px
    `--primary` line on the row's hairline. Still a radio group: keys 1–5, the arrows, the "?"
    with each kind's line at the row's end. On a phone the icons hide, so the five fit a line.
  - A "?" beside Title, the main part's name and Done when, each with a short line.
  - The main part (Goal, What happens, …) with a toolbar in its frame: **M↓** shows the text as
    Markdown and back (the viewer's renderer, `ui/markdown.ts`), **📎** adds files to Documents
    (Add files' picker), and the brief's length against its limit at the right,
    "0/20,000" (`options.maxBrief`), in `--error` past it. The note "The brief is N characters; at
    most M" stays only when it is too long.
  - Done when, its check line under it when one is guessed (the agent's command, kept visible).
  - The mockup's box: a lightbulb in `--warning`, "Be specific for better results" and its line.
  - More a framed row: a chevron, "More: Where to look, Out of scope, Notes", an "Optional" chip at
    the right; its parts open inside the frame.
- **The run** (decision 453), seven cards, each an icon in `--accent` and a heading (a new accent
  role, `.start-card-icon`, as V62's `.page-icon`):
  - **Source**: Start from (the select, a branch icon in it); Branch name, the field and a ⤨
    button that names the branch after the title again (enabled once the name was typed, its tip
    says so); the note "Will be created from main at 927cae5 as feature/new" (from a row: "from
    the commit 927cae5"); a taken name's words under it as today; the worktree's folder behind
    Branch name's "?".
  - **Agent**: the select (the agent's mark in it), one agent its name as a value; the account
    under it, a crown before a subscription; the `ANTHROPIC_API_KEY` warning; no agent: the note.
  - **Model**: the heading and the select on one line, the model's description under them.
  - **Effort**: the stepper the card's width.
  - **Permissions** (Claude Code; Codex's Sandbox, Hermes's Approvals with their "?"): the heading
    and the select or value on one line.
  - **Plan first and wait for my OK**: the switch at the right, "Let the agent propose a plan
    before making changes." under the heading.
  - **Documents (optional) ?**: the files, then a dashed area: Add files, "or drop or paste them",
    and "Add context files, docs, mockups, or requirements." under them.
- **Layout** (decision 454): head and cards at most 1,312 px wide, centred; the two columns in the
  mockup's proportion (`821fr 470fr`, the run at least 380 px), 16 px apart; one column under a
  1,000 px main area. With More open at 1440×900 the body scrolls under the head (V49 fitted it):
  Start workspace stays in view.
- **The ground** (decision 455, the person's "try"): the mockup's arcs, two rings of `--accent`
  at a few per cent drawn by CSS on the start page only, behind the cards; fainter in light.
- **The stepper's words** (decision 456): Default, Low, Medium, High, xHigh, Max — a level's first
  letter capitalised, an `x` before it kept (`stopWord`); Scout's and Settings' steppers say the
  same.
- **Left out** (decision 457, the person's answer): the title's ✨, the goal's link and page
  icons: nothing in Symbiote would answer them.

## Verification

1. **Tests first** (red on the branch before the change):
   - `start.spec.ts`: the head (the mark, the title, its line, Start workspace); the kinds as tabs,
     each with an icon; the run as seven cards with their headings; the widths at 1641×959
     (1,312 at most, the run ~470) and 1440×900; the counter (0/20,000, then a typed goal's
     length); the preview; 📎 adds a document; ⤨ names the branch after the title again; the
     Source note. Specs finding "Start" or "From main at" take the new words.
   - `test/effort.test.ts` (or the stepper's existing test): the stops' words.
2. **The rest**: `pnpm check` (contrast, radii, sizes, the accent's roles), `pnpm build`, the whole
   `pnpm test:e2e`.
3. **Screenshots** before and after, dark and light: 1641×959 beside the mockup, 1440×900,
   1280×720, 1920×1080, 2560×1440, 390×844; More open with two documents, Codex picked, a taken
   branch, no agent, from a History row, the preview; Scout's and Settings' steppers.
4. The graph, the layout code and the fonts are not touched: no Bitwarden timing.

**Risks**

| Risk | Mitigation |
|---|---|
| The run is taller as seven cards (~780 px): it may not fit 1440×900 | card padding 14 px, 8 px apart; measured; the body scrolls, the head stays |
| An icon in a `<select>` | drawn beside it, inside its frame (`pointer-events: none`), the select padded |
| The arcs read as noise in light | fainter there; screenshots in both themes |
| Specs reading the old words | updated in the same commit |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V63 | Start a workspace as the mockup | `workspaces/Start*`, `EffortStepper`, `effort.ts`, `icons.tsx`, `start.spec.ts`, `tokens.test.ts` |

**Decisions** (confirmed by the person with the plan):

| # | Question | Decision | Why |
|---|---|---|---|
| 451 | The head | **The S, the title at Settings' size, the mockup's line; Cancel and Clear framed; "Start workspace" with dark words** | the mockup; the person's answers (V62's head, decision 440) |
| 452 | The brief | **Kinds as tabs with icons; a "?" per field; the goal's preview, attach and counter; the tip box; More a framed row** | the mockup, with what Symbiote can answer |
| 453 | The run | **Seven cards with accent icons; the base in Source's note; ⤨ names the branch after the title** | the mockup; the commit stays said |
| 454 | The layout | **1,312 px at most, 821 : 470; one column under 1,000; More open scrolls at 1440×900** | the mockup's proportions |
| 455 | The ground | **The mockup's arcs, faint, on this page** | the person's "try" |
| 456 | The stepper's words | **Capitalised, xHigh; everywhere the stepper is** | the mockup; one stepper |
| 457 | The ✨, link and page icons | **Left out** | the person's answer: no behaviour behind them |
