# Journal: Fix — "Open again" after a stop asks first

[Index](../JOURNAL.md)

## Fix — "Open again" after a stop asks first (2026-10-19, branch `fix/open-again-race`)

`features.spec.ts:579` failed about one run in three: after "Stop the agent", the terminal said
the session had exited, and "Open again" attached at once instead of saying that opening
continues the stopped session. "Open again" decided from the feature list, read every 5 s and
after each action; the terminal's `exit` event comes before that read, so the agent's state was
still the one before the stop. A person clicking fast would continue a stopped session unasked.

**Learned**: a read already under way when the stop lands is no better: `reloadFeatures` hands it
out, and it may hold the old state. `readFeaturesAgain` waits for it, then reads anew.

**Verification**: the test 7 of 12 on `main` (`--repeat-each=12`), 24 of 24 after; the whole
`features.spec.ts` 22 of 22. Not covered by a deterministic test: holding back `/api/features` in
the e2e server would need a hook it does not have.

Both fixes merged into main (2026-10-19). `main` verified after the merges: 731 unit tests (the
node-pty ones too, now that node-pty is built here), build, 104 of 104 e2e.
