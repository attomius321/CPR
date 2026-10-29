# Journal: V78 — Scout and Scribe are terminals, set in Settings

[Index](../JOURNAL.md) · [Plan](../plan/v78-scout-scribe-terminals.md)

## V78 spike — what Scout's page and Scribe's pane offer besides the terminal (2026-10-29, branch `feature/remove-scout-in-page-settings`)

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

## V78 — Scout and Scribe are terminals, set in Settings (2026-10-29, branch `feature/remove-scout-in-page-settings`)

Scout's page and Scribe's pane open the agent's terminal at once, with nothing asked, and their
heads say what the conversation runs on, its state and New conversation: no Agent, Model or
Effort there, no request box, no Write. Scribe's instructions are its system prompt, as Scout's
(decision 570); Improve with Scribe types the skill's path in its terminal, unsent (571); where
no terminal runs, the page says so and offers no box (572). Decisions 569–572.

**Learned**:
- **Opening the pane again is a fresh `attach`.** The pane unmounts while a skill is open, so a
  second Improve joins the session anew, and the e2e fake prints nothing from before. The spec
  checks the text typed in that terminal, not a count over both.
- **The narrow screen's "All skills" is outside Scribe's region**, and hidden above 899 px: a spec
  at 1,440 px goes back by the list.
- **A spec outside the plan's list filled the box**: `library.spec.ts` (SK1). A search for the box's
  label over `e2e/` found it only after the full run failed on it.
- **A text pasted into Codex's trust question would answer it** (V27b: a key answers it). The
  terminal holds the text until the person's own key, then types it.
- **Codex's trust question comes first on Scribe's real terminal** (an untrusted `.claude/skills`):
  the hold for Improve's text is not hypothetical. The real run stopped there: answering writes
  the person's Codex trust list.
- **Two workspaces took V77 at once**: `feature/workspaces-history` planned V77 and 561–567 after
  this plan was written. Renumbered V78 and 569–572 before review; the first commits say V77.

**Verification**: tests first, each red for the right reason (Scribe's `open` refused, its default
holding `{request}`; Scout's head still drawing its selects and stepper; Scribe's pane its box).
`pnpm check`: 2,241 unit tests. e2e: the viewer's 338 (337, then the missed `library.spec.ts`
fixed: 23 of 23 with `skills.spec.ts`), nexus 15. Screenshots of the four screens and two states,
both themes, 1440×900 and 390×844. Real Codex: Scribe opened with no turn, at `low`, its terminal
joined; stopped at Codex's trust question. After merging `main` (V76): `pnpm check` 2,241, the
viewer's e2e 340 of 340, nexus 15 of 15.

Not verified: a request typed in a real agent's terminal, Improve's paste into a real agent's
input, Scout on a real agent (its open is V50's, unchanged), Claude Code at all (its trust needs
the person first).
