# Journal: Fix — one Settings page per prebuilt agent

[Index](../JOURNAL.md)

## Fix — one Settings page per prebuilt agent, under Prebuilt agents (2026-10-24, branch `fix/scout-merger-scribe-settings`)

The person: "There is no need to make a separate tab for each setting of prebuilt agents... use
only one page in settings. Prebuilt Agents is the category, and each name of agent represent his
page name of the setting"; on the plan, Model and Effort before Instructions, and "make a little
identation for the subcategories of a setting in category".

Settings listed the Merger, Scout and Scribe as groups with an entry for each setting
(Instructions, Model, Effort): 8 entries and 8 pages, 21 entries in all. Now one group, **Prebuilt
agents**, lists each agent by its name; its page holds its Model, its Effort (the Merger's and
Scout's) and its Instructions, a hairline between them. 16 entries. A group's entries sit 12 px in
from its heading, on Skills too, whose list is Settings' (its "No skills in this checkout yet." moved
down 16 px, where the next group's heading would be, so it does not read as an entry out of line).

**Learned**:
- **The cause was only the viewer's list**: it added an entry per prompt and per model or effort
  setting under the prompt's group. The server's groups, the API and the config keys stay;
  `promptGroups` folds the agents' groups into one, an entry per agent (`PREBUILT_AGENTS`).
- **Two reads on one page would go stale**: each tab read `<api>/efforts` on its own, which was
  right while Model and Effort never showed together. On one page, a model picked left the
  stepper on the old model's levels. The page reads once for both; a model saved answers with its
  own levels, and the Effort is drawn again for it (a level the new model lacks is said, as before).
- **The address is the agent's prompt key** (`?prompt=scout`), as its Instructions had, so
  `?prompt=merger` still opens the merger's settings; `?prompt=scout.model` and the like are gone
  and open the first entry, as any unknown key. Nothing linked to them.
- **A save of the effort still changes the prompts' version**: the page reads the prompts again
  after one. The e2e test waits for that read before saving the Instructions on the same page; a
  person would have to save within it (tens of ms) to meet "changed since".

**Verification**: tests first, red for the right reason on `main`'s code: `settings.test.ts` 3
(`promptGroups` gave a group per agent, `markOf` missing), `settings.spec.ts` 9 of 10 (21 entries,
no Prebuilt agents, no agent page; the drafts test, unchanged, passed). Then green: `pnpm check`
(113 files, 1,571 unit tests), build, e2e 239 of 239; the settings and skills specs 3 times each,
48 of 48. Screenshots at 1440×1150 and 390×844, dark and light (a Workspaces prompt, the three
agent pages, the list on a phone, Skills): no page error, nothing wider than the screen.
Not verified: with the real agents (the fake Claude Code's models and levels only); Codex as
Scout's or the merger's agent on the page.
