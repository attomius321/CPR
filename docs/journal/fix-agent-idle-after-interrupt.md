# Journal: Fix — an interrupted agent waits for you

[Index](../JOURNAL.md)

## Fix — an interrupted agent waits for you (2026-10-18, branch `fix/agent-idle-after-interrupt`)

Found in the V21 spike (branch `milestone/v21-agent-terminal`) and asked: "starting with the
bug". Esc in an agent's session (`claude attach`, which Talk copies) denies a permission prompt
or interrupts an answer and ends the turn, but no hook fires (no `Stop`, no `Notification`), and
`claude agents` says `status: idle` with `state: working` until the next turn ends (11:04 to
11:06:24 in the spike, across a stop and a restart). V18b's rule read `state` first, so the
features view said "Working" for an agent waiting on the person. Now `idle` with `working` is
"needs you" with `interrupted`, shown as "Interrupted: waiting for you"; when the thread says
the turn ended with a report, it is finished as before (V18c's rule). A reply needs no
confirmation: the session is idle, so stopping it loses nothing (the server already decided so
from `status`).

**Verification**: tests first — `agentState` (idle with working: needs you, interrupted; busy
with working: working; with the thread's report: plan ready), `featureNext`'s words, `replyMode`
sends; the features e2e with the fake's new `interrupt` (failed on `main`'s build: the row stayed
under Working). 693 unit tests, 98 e2e. Not verified with a real Claude Code after the fix (the
states are the spike's); whether a session reads `idle` with `working` for a moment when a turn
starts or ends normally was not measured — the page would say "Interrupted" until its next read
(5 s). Verified since, on the V21 branch, with Claude Code 2.1.302: Esc while it wrote read
`working`, `idle` for 40 s, and the page said "Interrupted: waiting for you" 301 ms after it.

Merged into main (2026-10-18). `main` verified after the merge: 693 unit tests, build, 98 e2e.
