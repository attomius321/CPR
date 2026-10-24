# Journal: Phase 4, interdiff (I1–I2)

[Index](../JOURNAL.md) · [Plan](../plan/roadmap.md#phase-4-milestones-interdiff)

## I1 — Review state per change request (2026-10-01)

**What landed**
- Reviewed marks are now `{symbol ID → fingerprint}` (signature + body hashes of both sides).
  A mark counts only while the fingerprint matches; otherwise the symbol is "↻ changed since you
  reviewed it" (Changes list, detail panel, a count above the list). Marks of symbols that left
  the change are dropped on the next toggle.
- Drafts record the symbol's fingerprint and where the symbol started. On a newer version of
  the change, a draft on an unchanged symbol moves with it (same line within the symbol); a draft
  on a changed or vanished symbol becomes "outdated" and goes into the review summary.
- State moved from browser storage into the CLI: `GET/PUT /api/state/review|drafts`, files
  under `<cache>/state/<repo id>/<sha256(change request URL, else revision pair)>/`, written
  atomically. The viewer saves marks at once and the summary text after a 300 ms pause, one
  write at a time per name, and flushes with `keepalive` on `pagehide`. A graph dropped into the
  viewer still uses browser storage.
- The write header is now `x-symbiote: 1` for every write (review and state).

**Found while testing**: every `symbiote view`/`symbiote pr` run listens on a new free port, and browser
storage is per origin — so V4's "remembers reviewed symbols" only ever held within one run.
The e2e test reloaded the same page, which hid it. The new e2e test restarts `symbiote pr` after a
push (new port) and checks the state is still there.

**Decision**: 17 (review state in the CLI's cache, per change request).

## I2 — `--since`: what changed between two versions of a change (2026-10-01)

**What landed**
- `analyzeGit({ since })` (all of `symbiote diff`, `view`, `pr`): after the main analysis, the
  earlier version merge-base(base, since)..since is checked out in the same slots and only
  extracted — same two-pass inference, no references or detectors. Each changed symbol gets
  `new` / `updated` / `same` by `changeFingerprint` (both sides' signature and body hashes, the
  string the viewer's I1 marks use); `dropped` lists symbols that version changed and this one
  doesn't. Extraction was split out of `analyzeSources` (`extractChanges`) for this.
- Graph schema 0.2.0: top-level `since {ref, sha, dropped}`, node `since`. Goldens differ only
  in the version.
- Summary: `since <ref> (<sha>): 2 new, 1 updated · 1 no longer changed: …` and `[status]` per
  symbol. `symbiote pr --since <sha>` fetches the sha from the remote when it is not local (protocol
  v2 serves reachable SHAs; forges keep old heads after force-pushes).
- Viewer: "Only changes since <sha>" (on by default) hides `same` symbols from the Changes list,
  and so from `j`/`k`, and dims them on the canvas; a chip sums it up; `new`/`updated` tags on
  nodes and in the panel.

**Numbers**: on this repo, G1→I1 (34 files, 123 changed symbols) compared with the G2 head: 54
new, 22 updated, 47 same, 4 dropped — exactly the helpers I1 deleted. 5.6 s → 8.7 s.

**Learned**: a leading comment added above a declaration leaves its hashes alone (tokens skip
trivia), so "added a file header" pushes show nothing new — checked in the e2e test.

**Phase 4 is done.** Next: phase 5 — CI for GitHub (C1) and GitLab (C2).
