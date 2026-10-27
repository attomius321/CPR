# Journal: V71 — The analyzing page in Symbiote's style, on the start page's ground

[Index](../JOURNAL.md) · [Plan](../plan/v71-analyzing-page.md)

## V71 spike — the analyzing page beside the style (2026-10-27, branch `feature/review-analyzing-loading`)

The analyzing page on `main` (`88cb800`) in Chromium at 1440×900, dark and light, its six states
(starting, a phase, another, queued, failed, stopped, and a review of two of them) served by
routing `api/graph` on a real `symbiote view` of this repository; the start page beside it.

**Learned**:
- **The page knows a review's branch while it runs**: `api/capabilities` answers
  `branchReview` before the first poll, but `useDiffGraph` kept it for the ready state only, so a
  review's page showed two SHAs.
- **The phases are fixed and ordered** (`AnalysisPhase` in `core/src/pipeline.ts`): checkout,
  loadBase, loadHead, extract, references, findings; `null` before the first. The page polls every
  500 ms, so a short phase is never seen: steps before the running one are marked done, not timed.
- **Start's arcs are mostly off screen at 1440 px**: its top-left ring shows a sliver, its right
  pair starts past the cards. On a page with one card and room around it, centred arcs show whole.
- **The sidenav's state dot is shared** (Skills, Scout, a workspace's facts use it): the steps take
  it as it is, the comet of working included, with its reduced-motion form.
- **The status region read the seconds aloud**: the whole line, seconds included, was in
  `role="status"` and changed every second.

## V71 — the analyzing page as a card on the start page's arcs (2026-10-27, branch `feature/review-analyzing-loading`)

A diff's or a review's page while it is analyzed is one card in the middle of the main area: the
S lit, "Analyzing a1b2c3d → e4f5a6b" or "Reviewing feature/x" with "into main · first review ·
‹pair›", a chip with the seconds (or Failed, or Stopped); the six phases as the merge log's rows
with the sidenav's state dots; Start's head buttons with icons. Behind it, the start page's arcs
— one recipe now, `ui/ground.css` — centred on the card over the whole area, a comet turning on
the inner ring while it runs. Decisions 502–506.

**Learned**:
- **Start's top-left ring does not go with centred ones**: kept beside them as planned, it
  crossed the 1,120 px pair at the top left. Concentric rings only, the orbit lit inside as that
  ring was; a 1,560 px ring for wide windows takes its `::after`.
- **A comet's light reads as a blot when wide**: 22 px at 55 % of the primary was a smudge on the
  orbit at 1440×900; 12 px at 45 % is a glint.
- **`*` is not `::before`**: the base's `box-sizing: border-box` reaches the orbit's element but
  not the pseudo-element rings, which stay content-box; Start's rings were drawn that way, so the
  shared recipe keeps them as they were (its main area is pixel-identical).
- **`StoppedIcon` is a pause**: the sidenav's Stopped group draws a pause circle; a Stop button
  wants lucide's circle-stop (`StopIcon`).
- **A leading space in a flex button is dropped**: measured, the words " Stop" begin 6 px after
  the icon, as "Git" do: the button's gap alone, no space added to it.

**Verification**: tests first — `test/analysis-steps.test.ts` (5) red on a missing module,
`e2e/analyzing.spec.ts` (6) red on a missing card — then green. `pnpm check` 2,013 of 2,013;
`pnpm build`; `pnpm test:e2e` 329 of 329. A real analysis of this repository
(`88cb800~40..88cb800`) on `symbiote view`: each phase marked in order (checkout 0.3 s, base 0.6,
head 2.7, symbols 4.1, references 5.1, findings 13.7), the graph at 14.4 s, the comet seen on
the orbit's far side mid-run, no page errors. Screenshots of every state at 1440×900, 1440×1080,
1920×1080, 900×800 and 390×844, dark and light; letter-spacing 0 on the page's elements; both
buttons 36 px on one centre line. Start's main area pixel-identical to `main`'s but for `main`'s
SHA in its Source note and the live usage numbers.

Not verified: the desktop app's window; Firefox and Safari; a queued analysis and a review in a
real run (routed); the comet's cost in frames on a slow machine (one composited element).
