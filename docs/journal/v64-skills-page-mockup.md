# Journal: V64 — Skills drawn as the person's mockup

[Index](../JOURNAL.md) · [Plan](../plan/v64-skills-page-mockup.md)

## V64 spike — Skills beside the mockup (2026-10-27, branch `feature/skills-page-revamp`)

Skills on `main` (`fcde474`) in Chromium, a scratch repository with this repository's six skills,
one new skill and a library of two (the mockup's own list), `framework-plugin` open, at 1440×900,
1936×941 (the mockup's 1672 px as the main area), 1920×1080 and 2560×1440, dark and light, served
by a `symbiote view` with fake agents, a fake VS Code and its own cache and config folders.

**Learned**:
- **The mockup was drawn over today's page**: its list is this repository's six skills, its
  `writing-docs` new, its library `skillbar` and `writing-docs`; its words are Symbiote's. Its
  `.claude/skills - Claude Code and…` entry is today's group heading drawn as an entry under
  Agent: the brief's "Skills" heading takes its place.
- **Today's text is 574 px at 1440** (67 characters a line), 1,054 at 1920. With Settings' 24 px
  gutters, a 280 px list and a 300 px Checks card beside it, the text would be ~420 px at 1440:
  the checks go under the skill there, beside it from 960 px of skill area (1,312 at 1920).
- **Some of the mockup's controls do nothing in Symbiote**: the icon at the search field's right
  and a list icon in the Checks head. The "?" takes the second's place; the first is left out.
- **Open in VS Code has a path already**: `vsCodeFolder` (`SYMBIOTE_CODE`) opens workspaces' and
  terminals' files; the e2e harness's fake `code` records its arguments (`opened()`).
- **Free numbers**: V64 and decisions from 458 on, on `main` and every branch.

## V64 — Skills as the person's mockup, and Open in VS Code (2026-10-27, branch `feature/skills-page-revamp`)

Settings' head and spacing; the list with a search, Agent, Skills and Library, an icon before each
entry; a skill one card with its icon square, Open in VS Code, the text with line numbers and
Markdown's colours over the text area, Markdown/Preview and Expand, Delete, Improve and Save with
their icons; Checks and other files cards beside it from 960 px of area. `POST /api/skills/open`
through the view's `vsCodeFolder`. Decisions 458–464.

**Learned**:
- **A drawn copy under a text area drifts on empty lines, not long ones**: wrapping matched from
  the first try (one font, padding and wrap rule), but an empty line's height came from its line
  number, a smaller type baseline-aligned: 2.9 px short each. Only a test of the two heights
  (the text area's own, read at height 0, against the copy's) showed it; screenshots did not.
- **"Skills" is now two headings**: the page's h1 and the list's group; a test that found the
  title by name and `exact` matched both. Find it by level.
- **A foot that wraps squeezes a long note**: a flex note with a 240 px basis between the size and
  four buttons took four lines in a 1440 window; a line of its own reads at once.
- **A head's action beside a long path on a phone** shrinks the path to a few characters a line;
  `flex-wrap` alone did not move the action, the title needed a basis.
- **The mockup's search and list icons** at the right of the field and the Checks head do nothing
  in Symbiote: left out, the "?" in the second's place.

**Verification**: tests first, red for the right reasons: `markdown-lines.test.ts` and
`skills.test.ts` (no module, old group titles), `packages/cli/test/skills.test.ts` (no `open`),
and `skills.spec.ts` on `main`'s build (10 of 15 red: no search, no numbers, no Checks card, the
old headings and spacing). The server's route test was written after the route. Then green:
`pnpm check` 1,897 of 1,897, `pnpm build`, `pnpm test:e2e` 302 of 302; the
measurements and typing times in the plan's results; screenshots dark and light at 1440 of a skill,
a search with no match, the view menu, Preview, Expand, an unsaved skill opened in VS Code, New
skill, the library and Scribe, and at 390 and 2560.

Not verified: the desktop app's window (its 38 px title bar over the page: the cards a little
shorter); Firefox and Safari (`:has()` for the text's focus ring, the `lh`-free line height is
plain CSS); an input method (IME) composing in the text area over its copy; Scribe with a real
agent (its pane's contents did not change); a real VS Code (the e2e fake records its arguments).
