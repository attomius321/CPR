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
