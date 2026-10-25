# Journal: V57 — A card being cleaned up: disabled until it goes

[Index](../JOURNAL.md) · [Plan](../plan/v57-cleaning-up-card.md)

## V57 spike — how long a card shows as before (2026-10-25, branch `feature/deleted-workspace-in-progress`)

Read from Symbiote's own log of the day (`~/.cache/symbiote/logs/2026-10-25.jsonl`, the person's
real runs of `symbiote view`): every `POST /api/workspaces/clean`, `POST /api/merges/remove` and
`GET /api/workspaces`, with their `ms`; and the code from the bin's click (V55's `CardRemove`) and
the head's Clean up (`Workspace.tsx`'s `clean`) to the card's going.

**Learned**:
- **A Clean up is ~1.7 s, and its card stays ~1 s more**: 15 clean-ups took 1.3–2.4 s (median
  1.7 s); the card goes with the next read of the list, 1.0 s at the median (20 reads, at most
  1.6 s). Meanwhile only the bin says anything (disabled), and only under the pointer.
- **Removing a merge is 2–6 ms** (16 removals), but its card waits for the same read of the
  workspaces too: `reloadWorkspaces` reads the five lists together.
- **Several in a row**: three clean-ups 4 s apart at 19:48, two at 21:16 — the person goes down
  the Done group.
- **The page cannot see a Clean up Scout runs**: `clean_workspace` (MC1) acts in the server, its
  ask names the branch only in its words, and the list is not read while nothing works. Left out
  (the person agreed).

## V57 — a card disabled while it is cleaned up or removed (2026-10-25, branch `feature/deleted-workspace-in-progress`)

From the moment a Clean up or a landed merge's Remove is sent until the list's next read drops
its card, the card is disabled: its name, kind and branch at 50 %, its dot a grey comet, its line
"Cleaning up · its worktree and its branch" ("its worktree; the branch stays", "Removing it from
the queue"), no hover, no bin, no click; the arrows and `w` skip it. A refusal gives it back at
once. The head's Clean up says "Cleaning up…". The state is a store in the page
(`workspaces/removing.ts`) marked by `cleanUp` and `removeMerge`. Decisions 411–414.

**Learned**:
- **Two calls to `reloadWorkspaces` are two reads**: one made while a read is under way queues
  another after it (V29b, so a change is never answered by an older read). The bin, the head and
  the merge page each read the list again after a removal; with `cleanUp` reading it too, a
  clean-up would have read it twice, ~1 s each. The read moved into `cleanup.ts`, and they no
  longer do.
- **A disabled button takes no focus, so the arrows stopped at it**: they move with `.focus()`
  between the cards' buttons, and a disabled one ignores it. Both they and `w` now pick from the
  enabled ones (`CARD_NAMES`); a merge card's link loses its `href` (and so its focus) instead.
- **Playwright counts an `aria-disabled` element as not enabled**, and a `click()` on it waits
  for that to change: the test clicks the disabled card by `page.mouse`, where a person would.
- **A hover wash checked at once would prove nothing**: the card's background has a 150 ms
  transition from transparent, so a check right after the hover could read transparent whatever
  the CSS says. The test waits past it.
- **The line does not fit at the default width**: ~265 px of text for ~190 px in a 240 px
  sidenav. Cut as the other cards' lines are, with its whole text in its tip.
- **`main`'s `pnpm check` already fails one test**: `tooltips.test.ts` finds a `title` on Skills'
  Save (`SkillsPage.tsx:583`), from the merge of V54 and V56. Left as it is; said in the report.

**Verification**: tests first, red for the right reason (3 unit, 3 e2e), then green. `pnpm check`:
format, lint, typecheck clean, 1,765 of 1,766 unit tests (the one above, also on `main`).
`pnpm build`. `pnpm test:e2e`: 274 of 274. Contrast of the dimmed name: 4.7:1 dark, 3.5:1 light.
Screenshots at 1440×900, 1×, both themes, with 3× crops: every state of the card above, the
rail, a merge card, the head. Not verified: a clean-up Scout runs (left out), the desktop app.
