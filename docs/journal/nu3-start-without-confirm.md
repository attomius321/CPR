# Journal: NU3 — Nucleus starts workspaces without a Confirm

[Index](../JOURNAL.md) · [Plan](../plan/nu3-start-without-confirm.md)

## NU3 spike — who can say it is Nucleus (2026-11-02, branch `feature/nucleus-start-without-confirm`)

The plan's first choice for decision 787 was a key made by `symbiote view` in memory, put in the
environment of Nucleus's process and sent by its bridge, so that only Nucleus could start without a
Confirm. Measured with Claude Code 2.1.316: `NU3_PROBE_KEY=from-starter claude --bg --name
nu3-env-probe --strict-mcp-config --mcp-config <probe>` started a session whose MCP server, a probe
that writes its environment, read `NU3_PROBE_KEY` as null. Nucleus runs as such a session
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
- **Decision numbers**: `main` uses up to 781 (the brief named HV4's 775); NU3 takes 782–787.
