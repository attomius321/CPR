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

## IN1 — one command, a prebuilt terminal, and Electron no longer fetched by asking (2026-10-28, branch `feature/extend-view-with-wrapper`)

Built after the person's OK ("Write here on this branch", "As you wish"): IN1a swaps node-pty for
`@lydell/node-pty` 1.1.0; IN1b adds `./install.sh` and `scripts/install.mjs`; a fix for Electron
found on the way; the README's install. Decisions 532–538.

**Learned**:
- **Requiring Electron's package downloads Electron**: since Electron 44 its `index.js` runs its
  `install.js` when the binary is missing. `findApp`'s comment said it throws. On `main` a
  `symbiote view` without `pnpm app:setup` waited 22.1 s for 118 MB and opened the window. Found
  because the installer's first fresh run printed "Downloading Electron binary..." before
  "Building Symbiote…" and never ran its own download step.
- **pnpm's shims set `NODE_PATH`**: under `npx vitest`, `require.resolve` from a folder with no
  Electron found the worktree's (through `node_modules/.pnpm/node_modules`). `electronBinary` walks
  the folders as Node does, without it.
- **The build and the download overlap well**: 3.9 s of build inside 25.6 s of download; a fresh
  install with the window took 31.8 s, without it 10.0 s, an update 1.3 s.
- **A test's PATH can hold only fakes**: the installer's tests run with `sh`, `dirname` and `node`
  linked in a folder of fakes, so the machine's pnpm, corepack and npx never answer.

**Verification**: tests first (red: the new name's error; no `install.sh`; the installer requiring
Electron; no `electronBinary`). `pnpm check` passes (2,126 tests). `pnpm test:e2e` passes: the
viewer's 335 specs in 5.1 min (the agents' terminals there in real pseudo-terminals, on the prebuilt
binary), then the nexus's 8 in 20.3 s. Three fresh clones, each in an empty home with no compiler:
`./install.sh` (31.8 s), again (1.3 s), `--no-app` (10.0 s); `symbiote --version`, a terminal that
loads, `symbiote-nexus --no-open`. `main`'s `findApp` timed downloading Electron (22.1 s). No
analysis change: no regression-check.

Not verified: a slow connection, Alpine or 32-bit ARM (no published binary), macOS, the person's
own home.
