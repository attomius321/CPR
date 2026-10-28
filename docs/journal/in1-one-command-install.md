# Journal: IN1 — Install in one command, with no native build

[Index](../JOURNAL.md) · [Plan](../plan/in1-one-command-install.md)

## IN1 spike — where the install's time and its compiler go (2026-10-28, branch `feature/extend-view-with-wrapper`)

Asked for a faster install in one command, after node-gyp problems on Linux. Measured on a fresh
`git clone --depth 1` of `main` (`2e30fa9`) in the job's folder: `pnpm install` with the store,
pnpm's cache and node-gyp's headers each in an empty folder of its own (`--store-dir`,
`--config.cache-dir`, `npm_config_devdir`, `--config.side-effects-cache=false`), with and without a
compiler (`CC`/`CXX=/bin/false`); node-pty's build alone; then a prototype with
`@lydell/node-pty@1.1.0` and a real pseudo-terminal on Node 26 and 24. Read: `chore/install-command`.

**Learned**:
- **node-pty is the native build**: 1.1.0 has prebuilds for darwin and win32 only, so on Linux
  `node scripts/prebuild.js || node-gyp rebuild` compiles it: 5.9 s of a 7.7 s cold install, most
  of it 67 MB of Node 26's headers (1.0 s once they are cached).
- **Without a compiler the install says it worked**: exit 0, `gyp ERR!` in the middle of the
  output, no `pty.node`, and Symbiote's terminals off. What the person met.
- **`@lydell/node-pty` 1.1.0 removes the build**: no install script, a 73 KB package per platform
  chosen by pnpm (`os`, `cpu`); a cold install with no compiler 3.4 s; a pty ran on Node 26.8.2
  and 24.14.1 (Node-API).
- **pnpm 12 refuses `--cache-dir` as a flag**: it answers with `pnpm add`'s usage and
  "unexpected argument '--frozen-lockfile'". `--config.cache-dir=` works. A changed
  `XDG_CACHE_HOME` also made corepack fetch pnpm again, a copy that refused the same command.
- **The machine's caches hide the cost**: the same install with the person's caches took 2.1 s,
  node-pty's compile included; only empty folders show a new machine's.
- **An install command exists, unmerged**: `chore/install-command` (Oct 23) writes
  `~/.local/bin/symbiote` after `pnpm install` and `pnpm build`; the person's command is from it.
  It needs pnpm first and still builds node-pty.
