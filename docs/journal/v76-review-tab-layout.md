# Journal: V76 — The Review tab's layout: sections, labels, a Merge into that fits

[Index](../JOURNAL.md) · [Plan](../plan/v76-review-tab-layout.md)

## V76 spike — the Review tab at the sidebar's width (2026-10-29, branch `feature/review-merge-layout`)

A scratch repository (`main`; `agent`, which merges cleanly; `conflict`, which does not; two
branches of 46 and 50 characters) served by `symbiote view` from `main`'s build (5c34635), the
Review tab screenshot on the Files and Graph pages at 300 and 480 px of sidebar, dark and light,
before and after an approval, with the sidebar's elements measured in the page.

**Learned**:
- **A select is as wide as its longest option.** Merge into's branch dropdown was 423 px in a
  298 px panel (the 50-character branch), so the tab's list scrolled sideways (435 px of content)
  and `main` ran off the card. Nothing in `controls.css` bounds a select's width.
- **The sidebar scrolls though it hides its overflow.** On the Graph page the three tabs take
  325 px; clicking Review scrolls the `overflow: hidden` sidebar to show it (`scrollLeft` 26), and
  every row under the tabs loses 26 px at its left. The Files page, the review's default, has two
  tabs (169 px) and does not.
- **Merge into is the workspace head's row, wrapped.** `.merge-control` is a wrapping flex row
  made for the head; in a 268 px column the button, the branch dropdown and the strategy dropdown
  fall onto three ragged lines.
