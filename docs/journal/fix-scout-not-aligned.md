# Journal: Fix — Scout's head on one line

[Index](../JOURNAL.md)

## Fix — Scout's head on one line: Effort and its stepper centred with the selects (2026-10-26, branch `fix/scout-not-aligned`)

Asked: "The scout top bar elements are not aligned beautifully", with a screenshot of the head on
one line. Measured in the e2e harness at 1,920 px: the title, the Agent and Model selects, the
state and New conversation centred at 25 px; "Effort" and the stepper's track at 15 px, its words
at 34. Two causes in `ScoutPage.css`. "Effort" was placed on its track's line
(`align-items: flex-start`), right for Scribe's box, where each control has a row of its own, but
10 px over the line every other part of the head shares. And the stepper was 36 px high (16 px of
track, 2 of gap, 18 of words) beside 28 px selects and button: 4 px out of them above and below,
it grew the head from its 44 px to 50.

In the head only (`.scout-choices`): "Effort" centred on its stepper, and the stepper 28 px high,
its words on a 12 px line at their 12 px size with no gap. Every part of the head now shares one
centre (21.5 px), the stepper's top and bottom are the selects', and the head is 44 px again.
Narrow (the choices on a line of their own), the same on that line. The stepper elsewhere
(Settings, Start a workspace, Scribe's box) is as it was; its drag, keys and words work as before.
A one-line stepper in the head (the track and the level picked, no words) was the other way: it
would lose picking a level by its word there.

**Verification**: an e2e test at 1,920 and 1,200 px — the selects, "Effort", the stepper, the state
and New conversation on one centre within 1 px, the stepper no taller than the selects, the head
44 px on one line (red before: "Effort" 10 px off). `pnpm check` (1,799 unit tests), build, 277
e2e. Screenshots of the head at both widths, dark and light, and of the stepper on Settings, Start
a workspace and Scribe's box: those three unchanged.
