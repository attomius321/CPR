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
