# Journal: Fix — Hive's message is not the writer asking

[Index](../JOURNAL.md)

## Fix — no `hive.decide` for a writer just resumed (2026-11-02, branch `fix/hive-spurious-decide`)

Hive told a writer "No person answers in Hive mode: decide yourself" when it had asked nothing,
right after Hive's own message reached it, and counted each against decision 773's limit of 3.
On `feature/hive-pull-requests` this happened three times in an hour, and the third stopped the
workspace. Plan, decisions 794–795 and results in
[HV4's plan](../plan/hv4-autonomous-landing.md#fix-a-message-is-not-the-writer-asking-fixhive-spurious-decide).

**Learned**:
- **A just-resumed writer reads as an interrupted turn.** Every message reaches a Claude Code
  writer by `claude stop` and a resume. For a moment after the resume, `claude agents` lists the
  session as `working` with its process `idle`, and `agentState` reads that as an Esc interrupt:
  `needs-you`, `interrupted: true`. Hive marks its message `sent` once its prompt is in the
  thread, then reads `needs-you` in the same pass. In the record, the count followed `sent` by
  1–2 ms each time: 09:24:12.791 → .792, 09:32:18.402 → .403, 10:27:30.259 → .261.
- **Each spurious answer cost a turn, and fed the next.** `hive.decide` goes with `stop`, so it
  stopped the turn the writer had begun on Hive's message 0.9 s earlier (the session's `end` at
  09:24:13.009). In the tests, a writer left reading interrupted got three answers in three looks:
  each answer's own resume read as the next ask.
- **The thread proves no one asked.** From the Hive run's start (07:35) to its stop (10:27) the
  thread has no `asks` entry, only `idle_prompt` notices after turns ended.
- **The person's message did not count Hive's answers again.** At 09:57 it started the rounds
  again but left `decided` at 3, so one more count stopped the workspace. The rounds and the
  answers now start again together (decision 795): the person who stepped in has answered.

**Decided** (Hive mode, no person to ask):
- An interrupted turn with nothing named is not an ask; one with `waitingFor` still is. Claude
  Code's own words for "waiting on the person" are `waitingFor` and `blocked`; an interrupt is
  only Symbiote's reading of a session idle mid-turn, which no hook confirms.
- Hive waits on an interrupted turn rather than stop the workspace after a while: the listing
  after a resume lasts a moment, and a timeout would risk the same false stop if Claude Code ever
  lists `idle` mid-turn. A turn someone interrupts with Esc in a Hive workspace now waits for them; the card
  says "Interrupted: waiting for you".
- `decided` is cleared wherever the rounds start again (`roundsAgain`): the person's message to a
  stopped or landing workspace, or during a check or review. `restarted` is left as it was: it
  counts the agent's failures, not the person's absence.

**Verification**: tests first, each red for the right reason before the fix
(`hive-runner.test.ts`; the fake Claude Code's new `drowse` and `wake` keep a resumed session
`working` and `idle` until woken):
- Hive's check failure delivered to a writer that reads interrupted: no `hive.decide`, `decided`
  absent, one stop and one resume; once its turn ends, the next round goes as before (red:
  `hive.decide` in the record's message).
- The person's message to a Hive writer that reads interrupted: nothing sent, nothing counted
  (red: `decided` 3 after three looks).
- The person's message to a workspace stopped for 4 asks: `decided` cleared, round 1, and the next
  real ask gets `hive.decide` with `decided` 1 (red: `decided` stayed 3).
- HV4's tests of `hive.plan` and `hive.decide` (a real ask answered, the fourth stopping) pass
  unchanged; the file's 63 tests pass. Not verified: a real round with Claude Code; the
  `working`/`idle` listing after a resume comes from the person's look at the card and the
  record's timings, not from a listing captured at that moment.
