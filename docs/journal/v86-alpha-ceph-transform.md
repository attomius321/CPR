# Journal: V86 — Nucleus becomes Alpha Ceph in the sidenav as Hive turns on

[Index](../JOURNAL.md) · [Plan](../plan/v86-alpha-ceph-transform.md)

## V86 — Nucleus becomes Alpha Ceph, built (2026-11-01, branch `feature/alpha-ceph-transform`)

Built as planned, decisions 730–734: `setHive` holds Nucleus before the arrival
(`shell/alpha-ceph.ts`); the name and the icon everywhere read `useAlphaCeph()` (Hive on and not
held); when `arrive()` resolves, the sidenav's link plays for 1,250 ms (`HiveMindIcon`'s
`becoming` form, `hive.css`'s `alpha-ceph-*` animations, `BecomingName`), then rests as the still
Hive Mind. The person asked to build after the plan without waiting for an OK; films of the built
link replaced a mockup made first.

**Learned**:
- **The first cut left a lone dot for 250 ms**: frames every 50 ms showed the ring's arcs fading by
  550 ms and the first ring cell booting at 480 ms. The arcs now hold to 760 ms and the cells start
  at 340 ms + 80 ms each, so the arcs fade as the cells take their places.
- **White-hot is invisible on the light sidenav**: a dot heating to white and a flat white flare
  vanished on white. The dot heats to the icon's crimson lamp, and the flare is the core chamber's
  own gradient (white, pink, crimson rim) over the whole core plate, which reads on ink and on white.
- **Digits made the scramble read as a hash** ("rzpmJz7"): letters only.
- **Exact frames of a CSS-and-timer animation**: Playwright's clock (`install`, then `pauseAt`
  once the shutter is gone) freezes the name's interval and the play's timer; the icon's CSS
  animations, paused by a `MutationObserver` the moment `.becoming` appears, are set to each
  time. Every frame is then the real sidenav at an exact millisecond, and the last frame can be
  compared with the still icon (identical, all four cases).
- **A test file of the same name already existed**: `test/alpha-ceph.test.ts` (decisions
  682–687) was overwritten by this work's first write and restored from git at once; this work's
  tests are `alpha-ceph-becoming.test.ts`.
- **Settings named Nucleus with Hive's flag**: `promptGroups` and the agent page used `useHive()`
  both for showing Hive's prompts and for Nucleus's name. They take `alpha` for the name now, so
  Settings, open behind the arrival, does not say Alpha Ceph while the sidenav still says Nucleus.

**Verification**: tests first: 9 unit tests (`alpha-ceph-becoming.test.ts`: the phases, the
scramble, the boot order, the markup, and every `alpha-ceph-*` animation's end within
`BECOMING_MS`, read from `hive.css`), red on the missing module; 3 e2e in `alpha-ceph.spec.ts`
(plays only after the arrival is still, open and folded, the name changing over; never on a reload
or a new tab; at once with reduced motion), the first red before. `pnpm check` 2,685 unit tests;
`pnpm build`; `pnpm test:e2e` 379 of 379 (viewer) and 20 of 20 (nexus), run without `WAYLAND_DISPLAY`. Frames every 50 ms and real-time films,
open and folded, dark and light, at 1×; the last frame equals the still icon pixel for pixel. The
arrival at 2560×1440 against `main`'s build (`git archive`), three runs each, alternated: 59.6,
59.6, 59.6 fps on `main`, 59.1, 59.6, 59.6 on the branch, both 1.91 s long; the play 60.1 fps for
1,248 ms, no long task; no animation running afterwards.

Not verified: the app's window, a GPU, a narrow window (the drawer closed plays unseen), the
first paint on real graphs (the change adds no work at load).

## V86b — Alpha Ceph's conversation, told what Hive does (2026-11-01, branch `feature/alpha-ceph-transform`)

Asked after V86a: the question names the change, and Alpha Ceph gets a new conversation with a
Hive text. Decisions 750–752, each the person's choice, the text approved as drafted: turning Hive
on or off ends a conversation started under the other name and opens the next, unless it is
busy; `hive.nucleus` at the end of Alpha Ceph's instructions; one sentence in the question.

**Learned**:
- **Alpha Ceph knew nothing of Hive**: its instructions were Nucleus's with a new name (decision
  685); `{hive}` reached only the agents of workspaces Hive drives. The `workspace` tool already
  returns each workspace's `hive` (step, round, check, review), so the text points to it.
- **The arrival must not wait on an agent**: `setHive` awaits `POST /api/hive` before the
  shutter starts, and ending one Claude Code session and starting the next takes seconds. The
  server answers first and follows after, under the same guard as the page's starts.
- **A test written for the old rule needed a busy conversation**: "a conversation keeps the name
  it started with" turned Hive off with Alpha Ceph's conversation at rest, which now ends; it sets
  the fake session `working` first, the case the rule still keeps.

**Verification**: unit tests red first (prompts: the new key in the Hive group, the text at the
end, main's Nucleus text unchanged by SHA-256; server: 5 cases); e2e written first but first run
after the code: the question's sentence, the session removed and the next started with and
without Hive's text, one answering kept. `pnpm check` 2,691 unit tests; `pnpm test:e2e` 381 of 381 and the nexus 20 of 20 (the first run caught `hive-loop.spec`'s pinned Hive group, updated, and a merge log's wait under load, which passed alone and in the rerun). The question and Settings' new entry screenshotted at 1×.

Not verified: a real Claude Code or Codex conversation given the Hive text (the fake agent's
arguments only); another window on Nucleus's page while the conversation is replaced (its own
open may be refused once with "Alpha Ceph is being asked", then reads the new one).
