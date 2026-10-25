# V48 — Workspaces that show what their agents are doing, and which wait for you

[Index](../PLAN.md) · [Journal](../journal/v48-workspace-activity.md)

**Status:** planned (2026-10-25), on branch `feature/dynamic-agent-workspace-activity-status` (a
workspace started in Symbiote, from `main` at `94e1feb`); waiting for the person's OK and their
answers to the open choices at the end. Not started.

**Problem** (asked: "Ensure the interface clearly distinguishes between states such as
Initializing, Running, Thinking, Working, Waiting for response, Review required, Completed,
Failed, Stopped … Map these states to the actual states exposed by the existing system. Do not
fabricate agent activity or introduce unsupported lifecycle states (for both claude and codex)";
the brief in full is the workspace's record). Measured on `main` (`94e1feb`), with the e2e fake
agent in six states (screenshots in the journal's spike) and on the person's 52 recorded threads
(`symbiote/threads/`, read only):

| What | Today |
|---|---|
| Groups in the sidenav | Merging, **Needs you**, Working, Done. Needs you holds 17 of the 19 lines `workspaceNext` can say: a question or a permission, an interrupt, a plan, six review steps (ready, in progress, again, approved, changes requested, commented), a failure, a failed start, no agent, an unknown state, a stop, "not running", finished without commits, a gone branch |
| Telling them apart | A 7 px dot in one of five colours, and a line of text cut at about 22 characters at the default 240 px: "Waiting: permission p…", "Waiting: question · no…", "Ready for review · 1 co…" |
| What a waiting agent asks | Known to the thread ("Waiting: permission to run pnpm test -- --run src/auth", "Asks: Which store …? — Redis · SQLite") but shown only in the Thread tab of the open workspace; the card and header say Claude Code's two words, "permission prompt" |
| The count by "Workspaces" | Needs you's size (5 with one failed, one stopped, one to review and two waiting): it does not say how many agents are blocked |
| Time on a card | When the workspace was made ("just now", "2d"), not how long its agent has worked or waited |
| Motion | None but a new card's 1.2 s flash; a working agent and a stopped one differ only by hue |
| How agents waited on the person | 21 permission or question waits: median **2.1 min** before the next entry, p75 15.8 min, p90 **31.3 min**. 97 finished turns before the person's next message: median 2.4 min, p90 15.4 min |
| How long agents work | 166 turns: median 3.4 min, p75 10.1, p90 **24.5 min**, longest 625 min. Up to 4 agents working at once (25 Oct, 13:50) |
| How state reaches the page | Polling (`useWorkspaces.ts`): `/api/workspaces` and four more every 5 s while an agent works or waits, 1.5 s while a merge runs, again on focus and when the page is shown. No push for workspaces (terminals and merge logs stream by SSE) |

What causes it:
1. **Every "your move" is one group.** `workspaceNext` (`workspaces/workspaces.ts`) already tells
   the states apart (`tone`: working, waiting, ready, failed, idle, done), but `workspaceGroups`
   folds five of them into Needs you, and the sidenav draws a tone only as a dot's colour.
2. **The list says the state, not the moment.** `WorkspaceSummary` carries `lastAction` (a time)
   and `agent.waitingFor` (Claude Code's words); what the agent asks and when its turn began are
   in its thread, which only the open workspace reads.
3. **No state is drawn by more than colour**, and nothing on the page moves with the agents.

**Goal**: an agent blocked on the person is seen at once, from any page, with what it asks, how
long it has waited and one action to answer it; a working agent looks alive and says for how long
it has worked; review, failure, stop and done each read as themselves; a workspace's panel has a
timeline of what really happened. Everything shown comes from what Symbiote already reads (the
agents' sessions, the threads its hooks record, Codex's runner and app server, git, the reviews);
nothing is simulated. What must not change: every workspace action (start, stop, start again,
reply, terminal, shells, review, merge, clean up), History's badges and branch order (V23), the
merge queue, polling's cost when nothing is live, `/history`'s first paint.

## The states, as each agent reports them

Symbiote shows only what its sources say. `AgentStateName` (core) keeps its eleven names; no new
lifecycle state is added for either agent.

| The brief's state | Claude Code (`claude agents --json` + the thread) | Codex through Symbiote's runner | Codex on its app server | V48 shows |
|---|---|---|---|---|
| Initializing | No such state: `claude --bg` returns once started (the person's last start: 926 ms) | No such state | No such state | **Starting…** only while the page's own start request runs (decision 367) |
| Running / Working | `working` + `busy` | runner alive, no `end` | thread `active`, nothing awaited | **Working** · time since its turn began |
| Thinking | Not reported: the list has `state`, `status`, `waitingFor`; no hook records tool use | Not kept (`exec --json` has reasoning items; the runner drops them) | Not read (items read as `summary`) | Not shown; a follow-up names what it needs (below) |
| Waiting for response | `blocked`/`waiting` with `waitingFor`; `idle` + `working` (interrupted, a fix of 2026-10-18); a plan with "plan first" | Never: `exec` does not ask | `active` waiting on an approval or input | **Waiting for you** · what it asks · how long |
| Review required | Finished with commits (`ready`), the review's verdicts; finished without commits (`done`) | the same | the same | **To review** |
| Completed | Merged into the default branch | the same | the same | **Done** |
| Failed | `failed`; `not-started`; `no-agent`; the branch gone | `end` with Codex's error; ended without a word | `systemError`; a failed turn | **Not running**, red, its error and a way to read it |
| Stopped | `stopped`; `not-running`; `unknown` (sessions not listed), each in its words | `end: stopped` | an interrupted turn; the server unreadable | **Not running**, grey |

## The status model (`workspaces/workspaces.ts`, pure)

- `workspaceNext` stays the one place a workspace's state is decided. Its `group` splits Needs
  you by the agent's state (decision 368): **waiting** (`needs-you` in every form, and
  `plan-ready`); **review** (finished with commits, every review step, and `done` without
  commits, now "Finished: read its report" in the `ready` tone instead of the grey "Finished
  without commits"); **stopped** (`failed`, `not-started`, `no-agent`, `unknown`, `stopped`,
  `not-running`, a gone branch). `workspaceGroups` returns the five lists. `workspacesFirst`
  (V23) keeps its order (waiting, review and stopped are today's Needs you); `workspaceChips`
  keeps every mark but the finished-without-commits one, now `●` in the review's colour.
- Its `text` stays the line the page says; a new `blocked?: string` says what a waiting agent
  asks, from the list's `activity` (below) through the thread's own words (`waitsFor`, now
  exported): "Permission to run pnpm test -- --run src/auth", "Asks: Which store should hold the
  sessions? — Redis · SQLite". Without a recorded ask (interrupted; Codex, whose request is not
  read): its last message when it waits, else Claude Code's or Codex's word.
- The tones stay what History's badges and the dots draw. Ready for review stays in Needs you's
  amber as `fix/needs-you-workspaces-fix` (unmerged, the person's) draws it; waiting is told from
  it by its section, a halo and its words, not by hue.

## What the list says of each agent (`packages/cli`, `WorkspaceSummary.activity`)

One optional field, made from what `summary()` reads already (the thread's last 256 KB for
Claude Code and Codex's runner, the app server's last two turns for Codex there); no new read, no
new process, no push channel (decision 369):

```ts
/** What its agent did last and since when, as its thread (or Codex's app server) says (V48). */
export interface WorkspaceActivity {
  /** When its current state began: its turn's prompt while it works, its ask while it waits,
   *  its last report once it finished, its end once it stopped. Absent when unrecorded. */
  since?: string;
  /** While it waits: the ask this turn recorded (a question and its options, or a permission and
   *  its tool's input cut at 1 KB). */
  asks?: Extract<ThreadEntry, { kind: 'asks' }>;
  /** Its newest report: when, and its first line, at most 200 characters. */
  report?: { at: string; text: string };
}
```

- A pure `activityOf(entries, agent)` in a new `packages/cli/src/workspace-activity.ts`, and
  `serverActivity(read, agent)` beside `serverLastAction` in `codex.ts`; unit-tested on recorded
  shapes: a turn with a permission granted mid-way still works since its prompt; a resumed
  session; Codex's runs by `run`; a thread without hooks (before V18c) gives nothing.
- Cost: ~300 bytes a workspace on each read; the derivation walks entries already parsed.
  Measured against `main` on 50 workspaces' list read (time and bytes).

## The look (`packages/viewer`)

Within Symbiote's style (`symbiote-style`): states in their tokens (`--warning`, `--moved`,
`--removed`, `--added`, `--faint`), tints mixed from them, no new colour, no dependency, the
cards' dots kept (V44: only a group has an icon).

- **One status indicator** (`StatusDot` in `WorkspaceFacts.tsx`, replacing `StateDot`; the same
  props, used by the cards, the rail, the panel's header): shape and halo tell states apart
  beyond hue — working a filled cyan dot whose halo breathes (opacity of a pseudo-element, 2.4 s,
  compositor only); waiting a filled amber dot with a steady 2 px halo; to review a filled amber
  dot; failed a filled red one; stopped an empty grey ring; done a green dot; starting a small
  spinning ring. `prefers-reduced-motion: reduce` stops every loop and keeps the shapes
  (decision 370). The state's words stay beside every dot (the dot stays `aria-hidden`).
- **Waiting for you, first in the sidenav**: a section above Merging, tinted with `--warning`
  (10 % fill, 25 % edge, the style's tint recipe), its bell icon and its count. Its cards are
  taller: the name; "Waiting · 4m"; what it asks on up to two lines (all of it in the title); a
  **Respond** button that opens the workspace on its terminal and focuses it (the Thread tab and
  its reply box where no terminal runs). The Workspaces heading's count becomes the number
  waiting. Absent when nothing waits: no empty box.
- **The other groups**: To review (eye icon), Not running (circle-pause), Working (hourglass),
  Done (circle-check); Merging as it is. Cards keep their three lines; the time on the right is
  how long the state has lasted when `since` is known ("12m", `shortAge`), else when it was made
  as today.
- **From anywhere**: the window's title starts with the count waiting, "(2) History · repo"
  (`WindowTitle`), and folded or narrow the rail's or the strip's bell carries the count. `w`
  focuses the first card, now the first waiting one; the arrows move on (as today).
- **The workspace's header**: the indicator and its words in the tone's colour with the time
  ("Working · 12 min", "Waiting for you · 4 min"). Under it, only when it applies, one strip in
  the state's tint: waiting — what it asks, **Respond**, and **Next waiting (2)** when others wait;
  failed — its error's first line, **Read the thread** (its end and reports), Start the agent.
  Every existing action stays where it is.
- **Elapsed time**: one clock for the page (`useNow` in `workspaces/`, `useSyncExternalStore`
  over a single 30 s interval, started by the first reader, stopped by the last, paused while
  the page is hidden). Only the time's own element subscribes: a tick renders those, not the
  sidenav (decision 371).

## The Activity tab (a timeline)

A tab beside Thread and Brief: one line an event, oldest first, newest at the bottom and followed
as the Thread tab follows (decision 372). From real records only:

- the workspace made (`created`, from `base`/`from`); each session's start (with how it was
  started, the first: `startedWith`); Symbiote's prompt and each of the person's messages (first
  line, opens to the whole); each ask ("Asked: …", "Asked permission to run …"); each report
  (first line, opens to the whole Markdown); each end with its reason; the review's verdict
  (`thread.verdict`, its time);
- the branch's commits with their dates (`/api/workspaces/changes`, read while the tab is shown,
  with the list's reads);
- keyed by entry (time, kind, index in its source), so a new read appends rows and React keeps
  the others; a row opens with the style's 150 ms height transition (`interpolate-size`, Electron
  44's Chromium has it; without it, it opens at once).

Not on it: tool calls, commands, files edited — Symbiote records none (the follow-up below).

## Motion and the small things

- Status changes: the dot's colour and the header's text fade in 150 ms (the style's colour
  timing). A card that changes group moves there (FLIP: its old box measured before the render,
  the move played by the Web Animations API, 200 ms ease-out); a new card fades and rises 4 px in
  (`@starting-style`); a removed one goes at once. None of it under reduced motion.
- Loading: until the first read, three card skeletons in `--raised`, shown after 150 ms so a fast
  read draws none (replacing "Listing workspaces…").
- Empty: "No workspaces yet" with its Start link as today; no Waiting section when nothing waits.
- Focus: every card shows the style's focus ring (`--focus`) on its button; hover keeps `--hover`.
- Notices (decision 373): when a read shows a workspace newly waiting, finished or failed, the
  status bar says it once ("Pick a store waits for you: Asks: Which store …") with an Open link
  (`Notice` gains an optional `href`); never on the first read, never for the workspace on
  screen, never a dialog.
- Optimistic, where the server's answer cannot differ: **Starting…** — a placeholder card with
  the spinner while `POST /api/workspaces` runs, replaced by the real card or removed with the
  error; **Stopping…** on Stop the agent until its call returns.

## Real time (decision 374)

Polling stays the way state reaches the page: the brief's "reuse what exists", and agents wait a
median 2.1 min for the person, against a 5 s read. Added:

- **Stale**: a failed read keeps what was read, says "Not updated since 14:02 — Symbiote does not
  answer" under the Workspaces heading, and reads again every 5 s until one succeeds (today a
  failed read is dropped silently, and with no agent live the reads stop).
- Order and duplicates: reads are already one at a time (`refresh` shares the one under way,
  `reloadWorkspaces` queues one after it); the thread's read drops an answer older than the
  branch or the list it was asked for (as today). Notices are keyed by branch, state and `since`,
  so a read that says the same again says nothing.

## Verification

1. **Unit, red first** (`pnpm check`):
   - `workspaceNext`/`workspaceGroups`: each `AgentStateName` from Claude Code, the runner and the
     app server in its group, with its words and `blocked`; merged in Done; a gone branch in Not
     running; V23's `workspacesFirst` order unchanged.
   - `activityOf`, `serverActivity`: `since`, `asks`, `report` on recorded shapes (above).
   - The timeline: entries, commits and the verdict in time order, stable keys across reads.
   - `useNow`: one interval for many readers, none without readers, paused when hidden (fake
     timers). The notices: once per transition, none on the first read or for the open workspace.
     Stale: a failed read keeps the data and retries.
   - `tokens.test.ts`: the new state rules in its allowlist, tints from state tokens, font sizes
     from the scale; `styles.test.ts`: any new CSS part in `styles.css`'s list.
2. **e2e** (`workspaces.spec.ts`, `shell.spec.ts`, the fake agent; `env -u WAYLAND_DISPLAY` on this
   machine): a permission asked moves a card into Waiting for you with "Permission to run …", the
   count and the title say 1, Respond opens its terminal focused; a second waits, Next waiting goes
   to it; answered, it leaves the section with no reload; a commit and a report put it in To
   review; failed and stopped in Not running with their colours; the Activity tab lists start,
   prompt, ask, report and commit in order and appends a new report; reduced motion: the working
   dot's `animation-name` is `none`; Starting… and Stopping… show and go. The existing specs that
   name "Needs you" are updated to the new groups, nothing else in them.
3. **Codex**: `codex.spec.ts`, `codex-server.spec.ts` pass; a Codex workspace in each group.
4. **Look**: screenshots before and after, 1440×900 at device scale 1, dark and light, of every
   page and state (the person's rule): the sidenav open, folded and narrow, each group, the
   panel's strips, the Activity tab; letters checked at 3× for uneven gaps.
5. **Cost**: `/history`'s first paint and first rows, 16 rounds alternated with `main`'s build
   (V44's method); the list's read time and bytes with 50 workspaces; four working dots idle for
   10 s: no layout or style recalculation from the animation (CDP `Performance.getMetrics`), and
   CPU in the app on WSLg (software GL) against `main`'s.

**Risks**

| Risk | Mitigation |
|---|---|
| A looping halo keeps the compositor busy; on WSLg the app composites in software | Measured (5.); above the budget the halo beats once after each read instead (open choice 2) |
| Renaming the groups undoes the person's habit and V44's headings | Open choice 1; History's badges and colours unchanged |
| `fix/needs-you-workspaces-fix` changes the same tone rules (Sidenav.css, Workspace.css, WorkspaceMark.css, tokens.test.ts) | Merge `main` in once it lands; its rule (ready in amber) kept |
| `since` absent for threads without hooks (before V18c) or an interrupted turn | No time shown then; never a guess |
| Notices become noise with many agents | Once per transition, only three kinds, never the open workspace; open choice 4 |
| A taller Waiting card pushes the others down | Only waiting cards grow; two lines at most |

**Order**: V48a first (the model and the field, which the rest reads), then V48b, V48c, V48d;
screenshots and measurements after each.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V48a | The model and the list | `group: 'waiting'`, the five groups, `blocked`; `WorkspaceSummary.activity` from `activityOf`/`serverActivity`; unit tests |
| V48b | The indicators and Waiting for you | `StatusDot`, the Waiting section, Respond, the count in the heading, title and rail, the cards' times, the header's strips, Next waiting, `useNow` |
| V48c | The Activity tab | The timeline from the thread, the commits and the verdict |
| V48d | Motion and the small things | FLIP and entry, skeletons, notices, Starting… and Stopping…, stale reads, reduced motion |
| V48e | Verified and written | e2e, screenshots of every page, the costs, README, the journal |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 367 | Which states | **Only those the agents report; "Starting…" only while the page's own start request runs; no Thinking** | Neither agent reports a starting or a thinking state Symbiote reads; the brief forbids inventing one |
| 368 | The groups | **Waiting for you, Merging, To review, Not running, Working, Done** (open choice 1) | The brief's states, each its own; an agent blocked mid-task apart from work to look at |
| 369 | Where the moment comes from | **`WorkspaceSummary.activity` from what the list reads already** | The thread knows what an agent asks and when its turn began; no new read or channel |
| 370 | How states are drawn | **Dots of different shapes and halos, the words beside them; waiting's prominence steady, working's halo breathing; nothing loops under reduced motion** | Colour alone fails colour-blind eyes and the person's own fix makes review amber; attention must not depend on motion |
| 371 | Elapsed time | **From `since` only, in minutes, one 30 s clock while the page is shown, re-rendering only the times** | Reliable timestamps only; a tick must not render the sidenav |
| 372 | The timeline | **An Activity tab: the thread's entries, the branch's commits and the verdict, in time order** | The real events Symbiote has; tool calls are not among them |
| 373 | Notifications | **A status-bar line once per transition into waiting, finished or failed, with Open; a "(n)" in the window's title** | Seen from other windows and pages, never a dialog |
| 374 | Real time | **Polling as it is; a failed read keeps the data, says since when, and retries every 5 s** | A median 2.1 min wait against a 5 s read; the brief asks to reuse what exists |

**Open choices for the person** (the plan above takes the first of each):

1. **The groups.** (a) Waiting for you · Merging · To review · Not running · Working · Done, each
   with its icon; or (b) only Waiting for you split out, Needs you kept for the rest (review,
   failed, stopped) as today.
2. **A working agent's dot.** (a) A halo breathing while it works (2.4 s), measured for CPU on
   WSLg; or (b) one beat after each read that finds it working (every 5 s); or (c) still.
3. **The window title's count**, "(2) …": yes or no.
4. **Status-bar notices on transitions**: yes or no.
5. **Tool-level activity** ("Running pnpm test", "Editing src/auth.ts", and Thinking): (a) a
   follow-up milestone with its own spike, not V48; or (b) V48f now. It needs, for Claude Code,
   `PreToolUse`/`PostToolUse` hooks on every tool (a Node process per call, ~25 ms each as V18c
   measured the hook) written to a file of their own, so the thread's 200-entry window keeps its
   messages; for Codex on its app server, the running turn's items read in full (or its
   `item/started` notifications kept); for Codex's runner, `exec --json`'s items kept.

**Not in V48 (later)**: tool-level activity (choice 5); a push channel for workspaces (an SSE
stream fed by the threads' files and the sessions' list, as the terminals and merge logs have);
progress bars or percentages (no agent reports progress); desktop or sound notifications;
Scout's and Scribe's dots beyond sharing the indicator's classes; History's badges (`WorkspaceMark`)
beyond their tones.
