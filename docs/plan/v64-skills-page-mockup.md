# V64 — Skills drawn as the person's mockup

[Index](../PLAN.md) · [Journal](../journal/v64-skills-page-mockup.md)

**Status:** merged into `main` on 2026-10-27 (built 2026-10-27), on branch `feature/skills-page-revamp` (the
workspace's); the plan confirmed by the person, with four answers: the skill's text in Geist as Settings' prompts
(not the mockup's mono), the actions in the skill's card as Settings' pages have theirs, the git
chips as they are (Committed stays quiet), the icons as proposed. Asked after: Open in VS Code for
a skill.

**Problem** (asked: "Make the skills page like this. Keep the title bar like in Setting, with its
icon and title, no breadcrumbs. Scribe should be put in Agent category, and the skills inside
Skills on the left page.", with the mockup `Dark Symbiote Skills Editor.png`, 1672×941, the page
without the sidenav). Measured on `main` (`fcde474`) in Chromium, a scratch repository with this
repository's six skills, one new skill and a library of two, `framework-plugin` open:

| Window | Main area | The list | The skill | Its text | Characters a line |
|---|---|---|---|---|---|
| 1440×900 | 1176×876 | 240, 8 px in | 912 | 574 | 67 |
| 1936×941 (the mockup's main area) | 1672×917 | 240 | 1,408 | 1,070 | 128 |
| 1920×1080 | 1656×1056 | 240 | 1,392 | 1,054 | 126 |
| 2560×1440 | 2296×1416 | 240 | 2,032 | 1,694 | 204 |

Today's against the mockup:

| | Today | The mockup |
|---|---|---|
| Head | "Skills ?" on one line, New skill a plain button | a breadcrumb "Symbiote › Skills" (left out: the brief), New skill the primary with its + |
| The list | Agent → Scribe; `.claude/skills · Claude Code` → the skills; Library | a search field; Agent → Scribe (its dot); the skills; Library; an icon before every entry |
| The skill | its name and chip, the path line, a plain text area, the checks a bare column beside it | one card: a file icon in a square, the name and chip, the path line; the text with line numbers and Markdown's colours, a "Markdown ▾" menu and an expand button over it; "67 lines, about 1164 tokens" under it |
| Checks | a caption and dots | a card of its own at the right: an icon and "Checks", each check's dot, its first part in bold and the rest muted |
| Actions | Delete…, Improve with Scribe, Save as plain buttons | Delete… in red with a bin, Improve with Scribe with a sparkle, Save the primary with its icon |

**Goal**: Skills drawn as the mockup, its head as Settings', and Open in VS Code on a skill.
Unchanged: what is saved and when, the drafts and the leave guard, Ctrl+S, Discard changes, a
stale save's Read it again, New skill's form, Link for Codex, the library's commit, push and pull,
Scribe's conversation, `?skill=`, `?new`, `?scribe`, `?library`, the narrow layout (the list, then
the open pane with All skills), the git chips and marks, the tokens, every other page.

## The page

```
 📖 Skills ?                                                           [+ New skill]
    What your agents load for a kind of work: this checkout's skills and your library's.
╭──────────────────╮ ╭─────────────────────────────────────────╮ ╭──────────────────╮
│ 🔍 Search skills…│ │ [📄] framework-plugin Committed  [↗ VS Code]│ │ ⓘ Checks       ? │
│ Agent            │ │ .claude/skills/…/SKILL.md · read by …   │ │ ● The descriptio…│
│  ✦ Scribe      ● │ │ ┌───────────────────[Markdown ▾] [⤢]─┐ │ ╰──────────────────╯
│ Skills           │ │ │ 1 ---                               │ │ ╭──────────────────╮
│ ▐📄 framework-pl▌│ │ │ 2 name: framework-plugin            │ │ │ Its other files  │
│  📄 milestone    │ │ │ 5 # Framework plugins               │ │ ╰──────────────────╯
│  📄 writing-d new│ │ └─────────────────────────────────────┘ │
│ Library          │ │ 67 lines, about 1,164 tokens            │
│  📁 skillbar     │ │       [🗑 Delete…] [✦ Improve with Scribe] [💾 Save] │
╰──────────────────╯ ╰─────────────────────────────────────────╯
```

## Head and layout

- Settings' head (V62, decision 447): the Skills icon in the accent, **Skills** and its "?", a
  line under it; New skill the primary (`.button`) with its + at the right. Skills' own classes
  (`skills-bar`, `skills-title`): V56 found a borrowed `.settings-*` class carries Settings'
  variables, and an e2e test refuses one.
- Settings' spacing (the person: "keep the persistent layout across pages"): the cards 24 px from
  the main area's edges and 16 apart, the list 280 px. The whole width stays Skills' (decision
  408): no 1,400 px column.

## The list

- A search field at the top of the list's card: it keeps the Skills and Library entries whose name
  or description holds what is typed (case aside); Scribe and the library's own entry stay; Esc
  clears it; nothing found says so. Pure: `skillMatches` in `skills.ts`.
- Groups (`skillGroups`): **Agent** (Scribe), **Skills** (`.claude/skills`), **Codex skills**
  (`.agents/skills`, only when it is a folder of its own with skills), **Library**. Who reads a
  skill is on its path line, as today.
- Icons (lucide's, in `icons.tsx`): a file before a skill, Scribe's sparkle, a folder before the
  library. Marks and Scribe's dot as today; the open entry as Settings' (the wash, the accent).

## The skill

- One card: a 40 px raised square with the file icon in the accent, the name (600, the title
  size) and its git chip as today, Open in VS Code at the right; the path line under it.
- **The text**: the `<textarea>` stays the editor (typing, undo, Ctrl+S, IME, the drafts), its
  words transparent over a drawn copy (`aria-hidden`) holding the line numbers and Markdown's
  colours: the frontmatter's `---` and keys, headings in the accent, fences and their lines,
  inline code, list and quote markers, links. Both in Geist at 15 px (the person's answer), the
  same padding, wrapping and line height; a wrapped line takes no new number. The copy is made by
  a pure line reader, `skills/markdown-lines.ts`, whose pieces join back into the exact line: the
  two layers cannot hold different text. No new dependency (CodeMirror would be one, with styling
  of its own).
- Over the text at its top right: **Markdown ▾**, a menu of Markdown (the editor) and Preview (the
  skill drawn by `ui/markdown.ts`, as the start page's preview); **Expand**, the card over the
  whole main area until the button or Esc.
- Its foot: the size at the left ("67 lines, about 1,164 tokens"), what a change did, then
  Delete… (red words, the bin), Improve with Scribe (the sparkle), Discard changes when edited,
  Save (the primary, its icon). Delete's confirmation in place as today.
- **Checks**: a card beside the skill where the skill's area is 960 px or wider (its text keeps
  ~640 px), under it on a narrower one: an icon and "Checks", the "?" at its right; each check its
  level's dot, the words up to its first ": " in `--text` and 500, the rest muted; "Nothing the
  standard or the agents would refuse." when nothing. Its other files in a card under it.

## Open in VS Code

- `POST /api/skills/open { path, line? }` (`packages/cli/src/server.ts`), through the view's
  `vsCodeFolder` (`SYMBIOTE_CODE`, as workspaces' and terminals' files): a checkout skill opens in
  the checkout's window at the line, a library skill in its library's folder's window (its own
  git). A path the skills do not list is refused (400); VS Code not found is 502 with why.
- The button in the skill's head; it opens at the caret's line. "Opened … in VS Code" or why not
  in the foot's notice. Unsaved changes: the note says VS Code shows the file as saved.

## The other panes

New skill, the library and Scribe keep their contents in the same card: New skill's head the +
in the square, the library's the folder; Scribe's conversation as today.

## Verification

1. **Unit** (red first): `markdown-lines.test.ts` (each kind of line, a fence across lines, the
   frontmatter only at the top, every line's pieces joining to the line); `skills.test.ts` (the
   groups' titles, `skillMatches`, a check's lead and rest); `packages/cli/test` for
   `/api/skills/open` (opened at the line, the library's folder, a path not listed refused).
2. **E2E** (`skills.spec.ts`, red first): the head's icon and line and no breadcrumb; headings
   Agent, Skills, Library; the search; one number a line; the drawn copy exactly as tall as the
   text area's text (long wrapped lines, a last empty line) at 1440 and 390; Preview and back keep
   the draft; Expand and Esc; the Checks card beside at 1920, under at 1440; Open in VS Code
   reaching the fake `code` at the caret's line; the cards 24 px in and 16 apart. Every existing
   test green, the changed geometry test rewritten.
3. **Nothing else changes**: `pnpm check`, `pnpm build`, `pnpm test:e2e`; Settings, History,
   Scout, the Monitor and Start looked at.
4. **Viewer**: screenshots dark and light at 1x at the four sizes and 390: a skill, one with
   checks, a long one, New skill, the library, Scribe, a search with no match, Preview, expanded;
   letter-spacing 0 on every element; the measurements again.

**Risks**

| Risk | Mitigation |
|---|---|
| The drawn copy drifts from the text area (wrapping, a last newline, a font difference) | one font, padding and wrap rule for both; the height test; a long real SKILL.md looked at |
| Typing slows on a long SKILL.md (a copy redrawn per key) | lines memoised; measure keys on a 256 KB file |
| The text narrows at 1440 with three columns | the checks go under the skill below 960 px of area |
| A library skill opens a new VS Code window | said in the button's tip |

**Order**: the line reader and its tests; the list and head; the editor; checks and foot; Open in
VS Code; the other panes; screenshots.

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 458 | Skills' head and spacing | **Settings' head (icon, title, line), New skill the primary; cards 24 px from the edges and 16 apart, the list 280** | the brief: "keep the title bar like in Setting"; the person: "keep the persistent layout across pages" |
| 459 | The list's groups | **Agent, Skills, Codex skills (its own folder only), Library; a search; icons** | the brief: Scribe in Agent, the skills in Skills; the mockup's search and icons |
| 460 | The editor | **the text area over a drawn copy with line numbers and Markdown's colours, in Geist** | the mockup's editor; the person: Geist as Settings; no dependency |
| 461 | Markdown ▾ and expand | **a menu of Markdown and Preview; the card over the main area until Esc** | the mockup's controls, each doing something |
| 462 | Checks | **a card of its own beside the skill from 960 px, under it below; each check's lead bold** | the mockup; the text keeps ~640 px |
| 463 | The actions | **in the skill card's foot, with their icons; Save the primary; git chips unchanged** | the person's answers 2 and 3 |
| 464 | Open in VS Code | **`POST /api/skills/open`, the checkout's window or the library's, at the caret's line** | asked by the person; `vsCodeFolder` as workspaces |

**Not in V64 (later)**: the mockup's icon at the search field's right and the list icon in the
Checks head (nothing behind them); syntax colours inside a fence by language; a minimap.

## As built (V64)

What differs from the plan, and why:

- **The line numbers take the text's line height.** Baseline-aligned with their line, an empty
  line took its height from its number (13 px type): 2.9 px short a line, 13.6 px over the e2e
  skill's five empty lines. The e2e test of the copy's height caught it; the numbers now have the
  text's line height (`--code-line`) and each line at least that.
- **What a change did has a line of its own** over the size and the actions: in a 1440 window
  "Opened … in VS Code" wrapped to four lines between the size and Delete…. The note for unsaved
  text is short: "It shows the file as saved."
- **The checks' "?"** moved from the "nothing to refuse" line to the Checks card's head, where the
  mockup has its list icon.
- **The open entry is Settings'**: the selection's wash, its words and icon in the accent (the
  mockup's words are white), as the person's "keep the persistent layout across pages".
- **`PaneHead`** (`skills/PaneHead.tsx`) is the head of a skill, New skill and the library alike.
  Scribe's pane keeps its conversation's own head.
- **On a phone** the head's action (Open in VS Code) goes under the title: beside it, the path
  wrapped a few characters a line.
- **The library's "Nothing to commit."** lost a 24 px indent it had from `.hint` (before V64 too).
- **Markdown ▾** draws its menu with the "⋯" menu's glass (`.more-menu`); its Esc closes only the
  menu, the next one leaves Expand.
- **The accent's roles** (`tokens.test.ts`) gained the panes' icon square (`.skills-tile`) and the
  headings in a skill's text (`.md-heading`).

**Results.** Measured as the problem (Chromium, the same scratch repository, `framework-plugin`
open):

| Window | Main area | The list | The skill's card | Its text | Characters a line | Checks |
|---|---|---|---|---|---|---|
| 1440×900 | 1176×876 | 280, 24 px in | 832 | 732 (574 before) | 86 (67) | under it |
| 1936×941 (the mockup's main area) | 1672×917 | 280 | 1,012 | 912 | 108 (128) | beside, 300 |
| 1920×1080 | 1656×1056 | 280 | 996 | 896 | 106 (126) | beside |
| 2560×1440 | 2296×1416 | 280 | 1,636 | 1,536 | 185 (204) | beside |

A typed character reaches the screen in one frame: median 16.5 ms on the 67-line skill and on a
3,154-line one (213 KB, under the 256 KB limit), the slowest of 25 keys 29 ms on the long one.
Letter-spacing 0 on every element of the page in both themes; no page errors in 12 states.
