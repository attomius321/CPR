# IN1 — Install in one command, with no native build

[Index](../PLAN.md) · [Journal](../journal/in1-one-command-install.md)

**Status:** planned (2026-10-28) and OK'd by the person the same day, on branch
`feature/extend-view-with-wrapper` (a workspace started in Symbiote, after NX1); not started.

**Problem** (asked: "i would also like a way to make the install faster, one command only...also,
i had problems with node-gyp", "on linux", "i had to install it manually"). Measured on this
machine (WSL2, Ubuntu 24.04, Node 26.8.2, pnpm 12.8.1, a fast connection), on a fresh clone of
`main` (`2e30fa9`):

| What | Today |
|---|---|
| The README's steps | Install pnpm; clone; `pnpm install`; `pnpm build`; an alias in `~/.bashrc`; `pnpm app:setup` for the window; `symbiote app install` for the launcher. On Linux, python3, make and a C++ compiler first |
| Why a compiler | `node-pty` 1.1.0 (the agents' terminals, V21) ships prebuilt binaries for macOS and Windows only: on Linux its install script runs `node-gyp rebuild` |
| `pnpm install`, store, caches and node-gyp's headers empty | 7.7 s, of which node-pty's build 5.9 s: 67 MB of Node 26's headers, then 1.0 s of compiling |
| … without a compiler (`CC`/`CXX` refused) | Exits 0. node-gyp's `gyp ERR! build error` sits in the output; node-pty is left out, so there are no agent terminals (Hermes is not offered), and nothing says so at the end |
| `chore/install-command` (Oct 23, not merged) | `pnpm cli:install` / `pnpm app:install`: install, build, `~/.local/bin/symbiote`. Needs pnpm first; still builds node-pty. The person's `~/.local/bin/symbiote` comes from it |

A prototype in the job's folder swapped `node-pty` for `@lydell/node-pty@1.1.0` ("node-pty with
prebuilt binaries": node-pty 1.1.0's own source, a binary per platform as an optional package,
no install script; `@lydell/node-pty-linux-x64` is 73 KB):

| Measured | Result |
|---|---|
| `pnpm install`, every cache empty, no compiler | 3.4 s; no node-gyp, no headers; only the linux-x64 package fetched |
| A shell in a real pseudo-terminal | Ran on Node 26.8.2 and on Node 24.14.1: node-pty 1.x is built on Node-API, one binary for every Node |

**Goal**: on Linux and WSL, `git clone … && cd Symbiote && ./install.sh` installs everything:
dependencies, the build, Symbiote's window, and the `symbiote` and `symbiote-nexus` commands. It
needs git and Node 22.12 or newer, no compiler and no pnpm of the person's. Run again after
`git pull`, it updates. **Unchanged**: what Symbiote does once installed; `pnpm install` and
`pnpm build` for contributors.

## The terminal without a build

- `@symbiote/cli`'s optional dependency becomes `@lydell/node-pty` 1.1.0, the same node-pty
  version; `terminal.ts`'s `loadPty` imports it by that name. Its words stay ("node-pty is not
  installed"): it is node-pty.
- `allowBuilds: node-pty: true` goes from `pnpm-workspace.yaml`: no package of Symbiote's runs a
  build script on install (Electron's stays off, decision 196).
- Where no binary is published (Alpine's musl, 32-bit ARM), the terminal is off with its reason,
  as today without a build.

## One command

- **`install.sh`** at the repository's root (POSIX sh): checks Node (22.12 or newer, else says
  where to get it) and hands over to **`scripts/install.mjs`**, which does the steps:
  1. **The commands' places first**: `symbiote` and `symbiote-nexus` in `$XDG_BIN_HOME`, else
     `~/.local/bin`. A file there that is not Symbiote's (no `# Symbiote's command` line) stops
     the install before anything runs (the chore's rule).
  2. **pnpm**: the person's if it is pnpm 12; else `corepack pnpm` (the version from
     `packageManager`); else `npx --yes pnpm@12.8.1`. Nothing installed globally.
  3. **`pnpm install --frozen-lockfile`**, its output shown.
  4. **The build and Electron's download at the same time** (`pnpm build`, `pnpm app:setup`):
     each said with its time, its output shown only if it fails. `--no-app` skips the window;
     an Electron already downloaded is not fetched again.
  5. **The commands written** (`exec node <checkout>/packages/{cli,nexus}/dist/bin.js "$@"`, the
     node on `PATH`), then `symbiote --version` run through them.
  6. **The window's launcher**: `symbiote app install` (it records node, the CLI and `PATH` for
     the desktop's app list), unless `--no-app`.
  7. **What it did**: each step's time, whether the agents' terminal loads (its reason if not),
     whether the folder is on `PATH` (the line to add if not), and what to run next.
- `pnpm cli:install` (`--no-app`) and `pnpm app:install` run the same script (the person: "As you
  wish").

## Verification

1. **Tests first** (red before): `loadPty` by the new name (missing, not loading, the real one
   loads and runs a terminal, as today's tests); the installer run with a fake `pnpm` (and
   `corepack`, `npx`) on a temporary home: the steps in order, both commands written and run,
   `--no-app`, run twice, a command that is not Symbiote's left alone and nothing run, a failing
   step's output and exit, no pnpm of the person's, a Node too old.
2. **Nothing else changes**: `pnpm check`, `pnpm build`, every e2e spec (the agents' terminals
   run in real pseudo-terminals there). No analysis change: no regression-check.
3. **Real**: a fresh clone in the job's folder, every cache empty, no compiler, a home of its own:
   `./install.sh` timed to a working `symbiote` and a terminal that loads; with and without the
   window; run again.

**Risks**

| Risk | Mitigation |
|---|---|
| `@lydell/node-pty` is one person's repackaging | node-pty's own source and version, built in its repository's CI; pinned to 1.1.0 (21 months old), no install script; back to `node-pty` is one line |
| A platform with no published binary | The terminal is off with its reason, as without a build today; the installer says so |
| `corepack` is gone from Node 25 and later | `npx` (npm ships with Node) as the last way to pnpm |
| A `symbiote` alias in `~/.bashrc` (the old README's) shadows the command | Both run the same checkout's CLI; the README says the alias can go |

**Order**: IN1a the terminal's package; IN1b the installer; IN1c the real run, the README.

## Milestones

| # | Milestone | Output |
|---|---|---|
| IN1a | No native build | `@lydell/node-pty` 1.1.0; `allowBuilds` without node-pty; `loadPty` |
| IN1b | One command | `install.sh`, `scripts/install.mjs`, `pnpm cli:install` / `app:install` |
| IN1c | Checked and written | The real run's numbers; the README's install; CLAUDE.md |

**Decisions** (with the person's answers, 2026-10-28):

| # | Question | Decision | Why |
|---|---|---|---|
| 532 | The terminal's package | **`@lydell/node-pty` 1.1.0, prebuilt, in place of `node-pty` 1.1.0** | node-pty has no Linux binary: 5.9 s and a compiler on every Linux install, and without one no terminal, silently. Same source and version, Node-API (one binary for Node 22–26) |
| 533 | The one command | **`./install.sh`: git and Node only; the steps in `scripts/install.mjs`** | "one command only"; pnpm need not be installed first (corepack, else npx) |
| 534 | The window | **Installed by default; `--no-app` skips it** (the person: "As you wish") | The person uses the window; 100 MB they can decline |
| 535 | The commands | **Scripts in `~/.local/bin` (`$XDG_BIN_HOME`): `symbiote`, `symbiote-nexus`; never another's file** | Every shell and program finds them, unlike an alias; the chore's rule, which the person ran |
| 536 | Faster | **The build and Electron's download at once; no native build; nothing fetched twice** | The download (~100 MB) was a step of its own after the build |
| 537 | The pnpm scripts | **`pnpm cli:install` and `pnpm app:install` kept, running the same script** (the person: "AS you wish") | The person's `~/.local/bin/symbiote` names `pnpm cli:install` |
| 538 | `chore/install-command` | **Written anew on this branch, not merged** (the person: "Write here on this branch") | One review; that branch can be deleted once this merges |

**Not in IN1 (later)**: a release users install without cloning (`npm`, a package); macOS and
Windows (the script runs, untested there: Linux and WSL are what Symbiote is tested on).
