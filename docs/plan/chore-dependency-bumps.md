# Chore — Electron 44.9.1 and the patch bumps; the majors listed

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding R4)

**Status:** planned (2026-11-06), to be built on branch `chore/dependency-bumps` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/dependency-bumps` · **Size** S · **Depends on** none · **Plan**
P29 of 51 (the audit's order)

## The brief

**What to change**: clear `pnpm audit`'s findings and take the patch and minor updates.

| Package | Where | From → to | Why |
|---|---|---|---|
| electron | `packages/desktop` (runtime) | 44.9.0 → ≥ 44.9.1 | high: "Mitigation for compromised eMudhra intermediate certificates" |
| vite | `packages/viewer` dev, and vitest's own | 8.3.1 → 8.3.6 | ≥ 8.3.3 fixes 1 high, 4 moderate, 1 low (launch-editor on Windows, `server.fs`, wasm, custom middleware) |
| fast-uri | core → ajv | < 3.1.9 → ≥ 3.1.9 | 2 moderate, 2 low |
| minimatch | eslint → `@eslint/config-array` | < 11.0.1 → ≥ 11.0.1 | 1 moderate |
| vitest | root dev | 5.0.3 → 5.1.0 | brings its vite forward |
| eslint, globals, typescript-eslint | root dev | 10.11.0 → 10.14.0, 17.12.0 → 17.14.0, 8.71.0 → 8.72.1 | minimatch; patch |
| @playwright/test | root dev | 1.63.0 → 1.64.1 | patch; see Risks |
| react, react-dom | viewer | 19.3.0 → 19.3.1 | patch |
| @xyflow/react, @dagrejs/dagre, marked | viewer | 12.12.0 → 12.12.1, 3.1.1 → 3.1.3, 18.1.1 → 18.1.3 | patch |
| @vitejs/plugin-react | viewer dev | 6.1.1 → 6.2.1 | minor |
| postcss | core | 8.5.28 → 8.5.32 | patch |
| prettier | root dev | 3.9.9 → 3.9.10 | patch |

**Where to look**: each `package.json` named, `pnpm-lock.yaml`, `packages/desktop/package.json:24`
(electron pinned exactly), `package.json`'s `pnpm.overrides` if a transitive one needs it.

**Out of scope**: the majors, each a plan of its own when wanted:
- electron 44 → 45.2.3: app e2e, WSLg and the GPU flags (`packages/desktop/src/gpu.ts`).
- typescript 6.0.3 → 7.0.2: every package's build and lint.
- @angular/compiler 21.2.25 → 22.2.4: the Angular plugin, the `bitwarden` regression set.
- @types/node 22.20.4 → 26.6.6: stays at the lowest Node supported (`engines` ≥ 22.12), so not
  wanted.
- @lydell/node-pty 1.1.0 → 1.2.0-beta.18: a beta.

**Done when**:
- `pnpm audit` reports no high or moderate.
- `pnpm outdated -r` lists only the majors above.
- `pnpm check`, `pnpm build` and `pnpm test:e2e` pass, the app specs included.

## Evidence

Measured on `main` c2aa5c4 (2026-11-06): `pnpm audit --json` gave 2 high, 7 moderate and 3 low,
with the paths above (`.>vitest>vite`, `packages__core>ajv>fast-uri`,
`.>eslint>minimatch`, `packages__desktop>electron`). `pnpm outdated -r --format json` gave the
versions in the table. No declared dependency is unused (each package's imports checked against
its `package.json`).

## Approach

1. `pnpm update` the patch and minor versions named, package by package, then
   `pnpm install --frozen-lockfile` to confirm.
2. The transitive ones (fast-uri, minimatch, vitest's vite): update the parent first. Only if a
   parent pins them, add an override in the root `package.json` with a comment saying why.
3. pnpm 12 checks the lockfile against its supply-chain policies ("Lockfile passes supply-chain
   policies"). A version younger than its minimum age is refused: take the newest one it allows.
4. One commit per group (runtime, viewer, tooling), so a regression bisects to a group.

## Tests first

None new: a bump is verified by the suites. Record the audit before and after.

## Verification

- `pnpm audit` and `pnpm outdated -r` before and after, in the journal.
- `pnpm check`, `pnpm build`, `pnpm test:e2e` (the desktop's `app.spec.ts` needs `pnpm app:setup`
  and Xvfb: run it).
- `regression-check` `r1` set against `main`: postcss and ajv are core's; graphs must be identical.
- `viewer-check` first paint on Bitwarden 737ee3f after the React and xyflow bumps (today
  307–340 ms).

**Risks**

| Risk | Mitigation |
|---|---|
| Playwright 1.64 expects another Chromium than `/opt/pw-browsers/chromium` | Keep 1.63 if the preinstalled one fails; never `playwright install` here |
| A React or xyflow patch changes a layout | `flow.test.ts`, the graph specs and the Bitwarden screenshot |
