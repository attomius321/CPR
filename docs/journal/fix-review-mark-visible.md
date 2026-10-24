# Journal: Fix — a review's mark you can see on a badge

[Index](../JOURNAL.md)

## Fix — a review's mark you can see on a badge (2026-10-14, branch `fix/review-mark-visible`)

Asked after V16: "The review checkmark is not really visible". V15–V16 put the mark in the
badge's own text: on this repository's commits page, a 10×14 px "✓" in grey on remote badges and
blue on local ones, read as part of the branch name. Each mark now carries its tone and is a
filled 14 px chip: "✓" green, "✗" red, "+n" blue (the colour of the dot on commits since), "…"
grey; on HEAD's solid green badge the chip is light, in its tone. The badge keeps its height
(rows have a fixed height anyway); the overflow badge "+2" (hidden badges) stays plain, so it no
longer looks like "+2 commits since".

**Verification**: unit tests for the tone (red before), and the V16 e2e flow checks the "✗" and
"✓" chips' classes, a filled background in a colour other than the badge's, and a chip lower
than its badge (red before: the class was missing). 599 unit tests, 69 e2e. Screenshots light and
dark on this repository (V16 and the skill branch approved) and on a clone with every state
(approved, changes requested, +1, in progress, HEAD on an approved branch), no page errors.

Merged into main (2026-10-14). `main` verified after the merge: 599 unit tests, build, 69 e2e.
