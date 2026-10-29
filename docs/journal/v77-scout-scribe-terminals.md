# Journal: V77 — Scout and Scribe are terminals, set in Settings

[Index](../JOURNAL.md) · [Plan](../plan/v77-scout-scribe-terminals.md)

## V77 spike — what Scout's page and Scribe's pane offer besides the terminal (2026-10-29, branch `feature/remove-scout-in-page-settings`)

Read on `main` at `61163d2`: `ScoutPage.tsx`, `Conversation.tsx`, `SkillsPage.tsx`,
`SettingsPage.tsx`, the server's page agent (`scout.ts`, `scribe.ts`, `prompts.ts`) and the e2e
specs of Scout, Skills and Settings.

**Learned**:
- **Scribe cannot open with no request.** Its instructions are its first prompt, ending with
  `{request}` (required in Settings), and `open` refuses a spec without a system prompt (409).
  Scout went through this in V50 (decision 383): the same change makes Scribe a terminal.
- **The head's Agent select was the only way, in the app, to run Scout or Scribe on Codex** when
  both agents are installed: Settings has no agent row, and `agent.kind` is set by hand in
  `symbiote/config.json`. The person kept it so: "The agent choices are already in Settings".
- **Improve with Scribe had nowhere to go**: it filled the box. An open terminal can be typed into
  (`OpenedTerminal`, `/api/terminals/<id>/in`); the e2e fake echoes keys and prints `got:` on
  Enter, so an unsent text can be checked.
