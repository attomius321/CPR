# Fix — ./install.sh on macOS: the app step skipped with a note

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding I1)

**Status:** planned (2026-11-06), to be built on branch `fix/macos-install` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/macos-install` · **Size** S · **Depends on** none · **Plan** P30 of
51 (the audit's order)

## The brief

**What happens**: on macOS, `./install.sh` without `--no-app` downloads Electron (~100 MB),
builds, writes the commands, then runs `symbiote app install`. That throws "symbiote app install
is not supported on darwin yet", and the install ends with
`symbiote install: symbiote app install failed` and exit 1. The README says "macOS runs the same
code but is not tested yet".

**How to reproduce** (Code; no Mac here): read `scripts/install.mjs:93` (Electron fetched when
`withApp`), `:131-133` (`symbiote app install`, its failure fatal) and
`packages/cli/src/app.ts:181-182` (`installApp` throws off Linux).

**Where to look**: `scripts/install.mjs:34` (`withApp`), `:93`, `:131-136`, `:188-200`
(`hasElectron`); `packages/cli/src/app.ts:178-183`; `packages/cli/test/install.test.ts` (10 cases,
`spawnSync` of the script with a fake pnpm); `README.md:33` and the install section.

**Out of scope**: making the window work on macOS; Windows without WSL.

**Done when**:
- On a platform other than Linux, `./install.sh` fetches no Electron and runs no `app install`.
- It prints one line: Symbiote's window is Linux-only for now, so the commands open the browser.
- It exits 0 with both commands written.
- `--no-app` behaves as today everywhere.

## Evidence

Code, from the audit; not run on macOS. `install.sh --no-app` on Linux was run: 1.0 s on a built
checkout, both commands written, the PATH advice printed.

## Approach

- In `install.mjs`: `const appHere = process.platform === 'linux'`;
  `withApp = !args.includes('--no-app') && appHere`. When the app was wanted but `appHere` is
  false, print once:
  `Symbiote's window runs on Linux (and WSL) only for now: symbiote view opens your browser.`
- The same check makes `hasElectron`'s download skipped (`:93`).
- `install.sh`'s usage text (`USAGE`, `:12-21`) says the window is Linux-only.

## Tests first

In `install.test.ts`: "on macOS, fetches no Electron, adds no launcher, says why, exits 0". Run
the script with `node --import <preload>`, where the preload sets
`Object.defineProperty(process, 'platform', { value: 'darwin' })`. Assert the fake pnpm's log
holds no Electron step, no launcher was written, stdout has the line, and the exit code is 0.
Red today: exit 1 with "app install failed".

## Verification

- `pnpm check`.
- `./install.sh --no-app` on Linux into a scratch `XDG_BIN_HOME`.
- The full `./install.sh` on Linux only with `XDG_DATA_HOME` and `XDG_BIN_HOME` in scratch
  folders: the app step writes a desktop launcher.
- Read the README's install lines again.
