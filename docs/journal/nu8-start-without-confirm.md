# Journal: NU8 — Nucleus starts workspaces without a Confirm

[Index](../JOURNAL.md) · [Plan](../plan/nu8-start-without-confirm.md)

## NU8 spike — who can say it is Nucleus (2026-11-02, branch `feature/nucleus-start-without-confirm`)

The plan's first choice for decision 787 was a key made by `symbiote view` in memory, put in the
environment of Nucleus's process and sent by its bridge, so that only Nucleus could start without a
Confirm. Measured with Claude Code 2.1.316: `NU8_PROBE_KEY=from-starter claude --bg --name
nu3-env-probe --strict-mcp-config --mcp-config <probe>` started a session whose MCP server, a probe
that writes its environment, read `NU8_PROBE_KEY` as null. Nucleus runs as such a session
(`startPageAgent`: `claude --bg`), started and woken by Claude Code's own background process.

**Learned**:
- **A `--bg` session does not take its starter's environment**: its MCP servers are children of
  Claude Code's background process. A key would have to be on disk (the MCP file, the settings
  file), where every agent of the same user reads it, as it reads `/proc/<pid>/environ`. So the
  caller stays the bridge's `--as nucleus` header (decision 787), and the plan says what that
  allows.
- **HV4's branch reads Hive as `main` does** (`HiveRecord.on()`, `symbiote/hive.json`); its
  decision 772 makes every workspace started while Hive is on a Hive workspace. Its plan left
  Alpha Ceph's Confirm on a start "until HV7"; decision 783 replaces that part.
- **Decision numbers**: `main` uses up to 781 (the brief named HV4's 775); NU8 takes 782–787.

## NU8 — the setting, the MCP, the record, Settings (2026-11-02, branch `feature/nucleus-start-without-confirm`)

Nucleus's `start_workspace` starts at once while the person's setting
(`symbiote/nucleus-start.json`, never committed) or Hive mode is on; every other asked tool and
every `symbiote mcp` caller still waits. Recorded as a `confirm` line with `stage: 'skipped'`,
shown "Started without a Confirm" in the Activity tab and the export. A switch on Nucleus's page
in Settings, on and disabled while Hive is on. Decisions 782–787.

**Learned**:
- **NU3 was taken**: NU1's plan names NU3–NU7 in its decision 595, in prose and a decision row,
  not as headings or index rows. The skill's check (`^#{1,3} NU3 `) did not find it; a plain
  `git grep NU3` on every branch did. Renamed NU8.
- **Hive's record fits as is**: `{ on, since }`, the place beside the reviews, a tracked file read
  as off. Generalized as `repositorySwitch` rather than copied.
- **The skipped Confirm must not look like one waiting**: `events.ts` put any line of a known ask
  that was not `ended` into `asked`, and `groups.ts` reads a Confirm without an answer as waiting.
  The skipped line is its end, and its group is done.
- **Uncommitted work is at risk in a workspace whose terminal detached**: Symbiote showed the
  agent stopped while the session ran; the person tried to clean up and discarded the changes.
  Committed at each step after.

**Verification**: tests first (red for the right reason: the starts waited for an ask, the texts
did not change, the route was missing), `pnpm check` (195 files, 2,771 tests), `pnpm build`,
`mcp.spec.ts` 3 of 3.

Not verified: a real Nucleus conversation on Claude Code or Codex reading the new texts.
