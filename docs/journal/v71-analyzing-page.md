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
