# Journal: V87 — Readable type at VS Code's density

[Index](../JOURNAL.md) · [Plan](../plan/v87-readable-type.md)

## V87 plan — the research and three designs (2026-11-01, branch `feature/font-sizes-too-small`)

The person found V85's 13 px too small a day after choosing it on mockups, and asked for the
accessibility standards' answer at the same density, then designs in Hive and normal mode before
any work. Three designs (today, A: 14 px body, B: 15 px body) were screenshotted at the person's
own window, 2560 × 1354 at 1x, over a `git archive` build in the job's tmp whose Git row height and
terminal size read a global, on a scratch clone of this repository, the sidenav answered with the
person's real workspace list (one read of their running view's `/api/workspaces`, `/api/reviews`,
`/api/merges`). The person chose B, the terminal as it is, and the text-size choice.

**Learned**:
- **The person's pixel is small**: two 27-inch screens at 2560 × 1440, Windows at 100 % (96 DPI),
  the app full-window at zoom 0 (`~/.config/symbiote/app/state.json`). One CSS px is 0.233 mm,
  12 % under the 96-dpi px the guides assume: 13 px body is 0.154° of x-height at 60 cm, at the
  bottom of the critical print size's range (0.15–0.3°, 0.2° typical). VS Code's 13 px is macOS's
  13 pt, mostly drawn on 2× screens.
- **WCAG sets no minimum font size**; what it does ask, V85 failed twice: 22 px rows and icon
  buttons under 2.5.8's 24 px targets (stacked rows' 24 px circles overlap: a wide row does not
  help), and `--faint` text at 4.05–4.58:1 under 1.4.3's 4.5.
- **Windows' minimum is 12 px regular** ("Text smaller than these sizes and weights are illegible
  in some languages"); V85's captions, chips and counts were 11.
- **Geist's x-height is 0.532 em**, Helvetica's (measured with a canvas in Chromium), so APCA's
  and the guides' sizes apply to it unchanged.
- **Dark `--muted` passes WCAG 2 at 8.5:1 and is weak by APCA** (Lc 56; light Lc 81): WCAG 2's
  ratio flatters light text on dark. Not changed: APCA is a draft.
- **An init script's `<style>` on `documentElement` is dropped by the parser**: a design's tokens
  went in from a `MutationObserver` that appends to `document.head`.
- **V85 changed four line heights**; the other 33 in px were set for V61's scale, which B nearly
  is, so B fits them; the text-size choice needs them to follow their sizes.

**Sources**: [WCAG 2.2, Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html);
[Typography in Windows 11](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography);
[Apple HIG, Typography](https://developer.apple.com/design/human-interface-guidelines/typography);
[APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html);
[Legge & Bigelow 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264). The designs:
`https://claude.ai/artifact/SbY6qQ3mMJ3KVJkHBwcfHW` (private).
