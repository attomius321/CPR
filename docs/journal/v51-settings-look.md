# Journal: V51 — Settings and Skills: centred, in cards

[Index](../JOURNAL.md) · [Plan](../plan/v51-settings-look.md)

## V51 spike — Settings' width beside the start page's (2026-10-25, branch `feature/settings-style`)

Settings, Skills and Start a workspace on `main` (`5cd31ce`) in Chromium, `serveWorkspaces` with
the fake Claude Code, at 1280×720, 1440×900, 1920×1080 and 2560×1440, dark and light, from a spec
outside the repository (the list's and the editor's boxes, the prompt's characters a line by the
text area's inner width over the text's average glyph).

**Learned**:
- **The editor takes every pixel a window adds**: 744 px at 1280, 2,024 at 2560; a prompt's lines
  run 115–318 characters, where the start page keeps its brief to ~100 (760 px).
- **Skills is Settings' layout**: `SkillsPage.tsx` uses `.settings-body`, `.settings-list` and
  `.settings-editor` (V41), so a change to them moves both pages; its Scribe pane is a terminal,
  904 px wide at 1440 today.
- **Appearance is the only setting in a head**: the start page's head has its title, where it
  starts and its actions. Four specs find Appearance or Play the intro on Settings without
  opening an entry (`look.spec.ts`, `intro.spec.ts`, `app.spec.ts`).
- **V50 (`feature/scout-should-be-a-terminal`) is built beside this**: it took V50 and decisions
  383–385, and edits `settings.spec.ts` and `look.spec.ts`.

## V51 — Settings and Skills centred in cards; Appearance an entry (2026-10-25, branch `feature/settings-style`)

Settings and Skills drawn as Start a workspace: the list (240 px) and the page (up to 760 px)
centred, the head's title and the notes in their width; a prompt or a skill one card under its
heading, a prebuilt agent's Model and Effort rows of one card and each prompt a card; the chips
the style's chip and badge. Appearance and Play the intro an entry of their own, This browser →
Appearance. Decisions 386–390.

**Learned**:
- **A row's name centres on everything beside it**: with the select and its note in one wrapper,
  Model's name sat between the two. The select and the note are the row's own children now, the
  note in the next grid row.
- **The head and the body line up by arithmetic, as on the start page**: the head's padding is
  `max(16px, (100% − 1024px) / 2)` and the body a 1,024 px grid centred in a 16 px margin, which
  start at the same place. Both are inside `.settings`, the scroller: a scrollbar narrows both
  alike.
- **The list's 8 px inset put its headings off the title's line**: the group headings now start
  at the list's edge, under the title and the git note; the entries' words stay 12 px in.
- **A 760 px card wraps the longer placeholder descriptions** ({documents}, {into}): the second
  line ran back under the chip; a 12 px hanging indent keeps it in.
- **Moving a control breaks the tests that find it without opening its page**: `look.spec.ts`,
  `intro.spec.ts` and `app.spec.ts` (the desktop window's title bar) found Appearance and Play the
  intro on Settings' first view; they open Appearance first now. `settings.spec.ts` counted 16
  entries and read `.settings-model-note`.

**Verification**: tests first: "centred in a wide main area…" in `settings.spec.ts` and
`skills.spec.ts` (red: a 16 px margin) and "Appearance is an entry of its own…" (red: five buttons
in the head); then green. `pnpm check` (1,723 unit tests); `pnpm build`; the whole e2e suite 256
of 258 (the two failures this change's: the count and the class), then `settings.spec.ts` 12 of
12; the whole suite again 255 of 258, the three others than the first run's and passing alone:
the intro's first visit in 8,084 ms (under 8,000 asked), a merge's resolution not yet shown, a
sidenav card 64.00003 px high (64 at most). None touches Settings or Skills; the branch changes
nothing in `shell/` or `workspaces/`. Screenshots, dark and light, at 1280×720, 1440×900, 1920×1080, 2560×1440 and 390×844, from a
spec outside the repository (Settings: a prompt, a changed one, a draft, Scout, the merger,
Appearance; Skills: a skill, New skill, Scribe); the widths measured again (the plan's results);
letter-spacing 0 everywhere in the page and the rows read at 3×.

Not verified: one whole e2e run with no failure (the second run's three passed alone); a real
agent in Scribe's narrower pane (760 px, was 904 at 1440; the fake's pane only); Firefox and
Safari.
