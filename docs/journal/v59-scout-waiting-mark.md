# Journal: V59 — Scout's link, whole, when it waits for you

[Index](../JOURNAL.md) · [Plan](../plan/v59-scout-waiting-mark.md)

## V59 spike — how a waiting Scout looks today (2026-10-26, branch `feature/scout-waiting-for-you`)

Screenshots of `main` at `00d88e1` by a Playwright spec outside the repository on e2e's
`serveWorkspaces` (the fake Claude Code): Scout's session set to wait (`waitingFor: 'permission
prompt'`, read as `needs-you`), Scribe's too, and a workspace blocked on a permission beside them;
1440×900, device scale 1, dark and light; the sidenav open, folded, and on Scout's page.

**Learned**:
- Scout waiting is a 7 px amber dot (11 px with its 2 px halo) at the right end of its 32 px link,
  ~220 px wide in the default 240 px sidenav. The link itself is as at
  rest — muted words, a faint icon, no background — and says "Waits for you" only in its tooltip.
- A waiting workspace a few rows below is a band: the amber wash, edge and bell of Waiting for you
  (V48), with what it asks in words. Beside it the Scout dot is the quieter of the two signs for the
  same thing.
- Scribe waiting on a permission shows a **green** dot on Skills: `nextScoutMark` takes `needs-you`
  as one of the turns that end on the person, and the sidenav draws that as answered. Only Scout's
  link had a waiting state (`scoutWaits`, MC1).
- Folded, the dot sits on the icon's corner, 11 px on a 36×32 px link.
- The sidenav stays across the shell's pages (they open in place, V29a): an animation keyed on
  `data-state` runs once when the state comes, not on each page.
