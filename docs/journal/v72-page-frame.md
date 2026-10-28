# Journal: V72 — One page frame: every page the whole main area, one spacing everywhere

[Index](../JOURNAL.md) · [Plan](../plan/v72-page-frame.md)

## V72 spike — every page's margins, gutters, head and insets (2026-10-28, branch `feature/layout-fixing`)

Opened every page with the e2e harness (`serveWorkspaces`: two workspaces, one reviewed, approved
and merging; terminals on and off) in a spec kept outside the repository, at 1440 × 900 and
1920 × 1080, device scale 1, both themes; measured each card's box against the main area's, the
head's title, the first text's inset in each card, and each label and field.

**Learned**:
- **Three frames**: Git, a workspace and a review have V61's 8 px gutters; Settings and Skills the
  mockup's 24 / 16 (V62, V64); Start a workspace 16, the merge page 16, the Monitor 8 to 23.
- **Two pages stop short of the area**: Start at 1,312 px, centred (172 px of ground each side at
  1920), and 72 px lower on a window 1,080 high (V49's room above the cards); Settings at 1,400
  (128 each side at 1920).
- **Nine heads**: the title at x 16, 31, 60, 68 or 80; the cards from y 52 to 170. Scout's head
  wraps at 1440 (its model and stepper do not fit beside the state and New conversation: 80 px
  high, 52 at 1920); a review's bar wraps on the Graph page only (84 against Files' 52), so its
  cards jump when one switches.
- **Inside cards**: the words 12, 16, 20 or 24 px in; card heads 40, 48 or 64 px; a label 9 px
  over its field on Start, 5 on Skills, 13 on Scout's question; Scout's select 28 px high.
- **Free numbers**: V72 and decisions from 507 (V71 and 502–506 are `feature/review-analyzing-loading`'s).
