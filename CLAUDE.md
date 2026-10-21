# CPR

CPR reviews a change as a **graph of changed symbols** (functions, classes, methods, types,
framework templates) and the calls between them, with findings on the risky parts. A local CLI
(`cpr diff`, `cpr view`, `cpr pr`) and a browser viewer; GitHub and GitLab; framework plugins.

- North Star, design and every decision: `docs/PLAN.md` (milestone sections, §14 decisions).
- What each milestone learned and measured: `docs/JOURNAL.md`. Read the entries for the area you
  touch before changing it — most traps there were found the hard way.
- Graph JSON contract: `docs/graph-schema.md`.

**North Star: review decisions, not lines.** When trading off: precise beats complete (a wrong
finding costs more trust than a missing one), explainable beats clever, local and fast beats hosted.

## Repository map

- `packages/core` — the engine: git revisions and worktrees, the TypeScript adapter (ts-morph),
  extraction, diff, references, detectors, graph JSON and its JSON Schema. See its `CLAUDE.md`.
- `packages/cli` — `cpr diff|view|pr`, output formats, plugin loading and framework hints.
- `packages/forge` — GitHub and GitLab APIs (pull/merge requests, comments).
- `packages/viewer` — React + React Flow app that `cpr view` serves. See its `CLAUDE.md`.
- `packages/plugin-angular`, `packages/plugin-qwik` — framework plugins (`--plugin angular|qwik`).
  Each has a `CLAUDE.md`.
- `action.yml`, `action/` — the GitHub Action; `ci/gitlab/cpr.yml` — the GitLab CI template.
- `scripts/` — `dogfood.mjs`, `regression/` (real-repo comparisons), `viewer/measure.mjs`.
- `spikes/` — throwaway experiments, not linted or tested.

## Commands

Node ≥ 22.12 (`.nvmrc`: 24), pnpm 12 (`packageManager`). Run from the repo root.

```sh
pnpm install --frozen-lockfile                  # add --offline in a container with the store
pnpm check                                      # format:check + lint + typecheck + unit tests
pnpm build                                      # tsc -b + viewer bundle; needed by the CLI, e2e, scripts
npx vitest run packages/core/test/compat.test.ts -t "interfaces"   # one file / one test
pnpm test:e2e                                   # viewer Playwright tests (after pnpm build)
(cd packages/viewer && npx playwright test e2e/qwik.spec.ts)       # one e2e spec
pnpm format                                     # prettier --write
node packages/cli/dist/bin.js diff <base> [head] [--plugin angular] [--out graph.json]   # in any git repo
node packages/cli/dist/bin.js view [<base> [head]]    # opens the viewer (no revisions: Workspaces)
```

## Code

- TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM (`NodeNext`):
  relative imports end in `.js`; type-only imports use `import type`.
- Prettier (single quotes, width 100) and typed ESLint; `pnpm format` before committing.
- Match the surrounding code: a short doc comment on exported functions and on anything whose
  *why* is not obvious; no comments that restate the code.
- Leave absent optional fields absent (`...(x ? { x } : {})`), as the codebase does.
- Plugins and the viewer import only **types** from `@cpr/core` (core pulls ts-morph; the viewer is
  a browser bundle). New runtime dependencies need a reason recorded in `docs/PLAN.md`.
- Paths in the analysis and the graph are repo-relative POSIX; positions are 1-based.

## Tests

- Vitest: `packages/*/test/**/*.test.ts`, run against workspace sources (vitest aliases
  `@cpr/core` to `packages/core/src`).
- Fixtures: `test/fixtures/<case>/{base,head}/`, analyzed with `analyzeDirectories`. Fixtures are
  excluded from lint, Prettier and test discovery. Fake framework typings live in fixture
  `node_modules/` and are committed (see `.gitignore`); model them on the real package's shapes
  and check them with `tsc` against the real typings when you can.
- **Write the failing test first**: encode the right answer, run it, see it fail for the right
  reason, then implement. Keep "without the plugin nothing changes" tests for plugin work.
- Golden files: `packages/core/test/__snapshots__/` (`toMatchFileSnapshot`); a graph change shows
  up there — read the diff before updating with `-u`.
- Viewer: pure layout and review logic unit-tested (`packages/viewer/test`); behavior in Playwright
  (`packages/viewer/e2e`, fixtures served as a real `cpr view`/`cpr pr` by `e2e/cpr.ts`).

## Verifying a change

| Change | Also run |
|---|---|
| Anything | `pnpm check` and `pnpm build` |
| Analysis: core extraction, references, detectors, or a plugin | `regression-check` skill: the `r1` set against `main`; `bitwarden` and `qwik-docs` when references or a plugin change |
| Viewer | `pnpm test:e2e`; `viewer-check` skill on a real graph (screenshot, first paint); a look change follows the `cpr-style` skill |
| Graph JSON | schema + `docs/graph-schema.md` + version bump (see `packages/core/CLAUDE.md`) |

IMPORTANT: fixtures are not enough for analysis changes. Q1 passed every fixture and still shipped
a crash that only Bitwarden showed. Without a plugin, results must stay identical to `main`
unless the change says otherwise — prove it with the comparisons.

## Workflow

- Work is organized in **milestones** listed in `docs/PLAN.md` (IDs like W1, Q2, V7). Use the
  `milestone` skill: measure on real data, plan in PLAN.md, branch, failing tests first, implement,
  verify, record in JOURNAL.md.
- One branch per milestone: `milestone/<id>-<slug>` (e.g. `milestone/v7-app-boundaries`); fixes on
  `fix/<slug>` from `main`; docs and tooling on `chore/<slug>`. Never commit to `main` directly.
- IMPORTANT: **ask the user before merging into `main`.** An Approve in CPR, when the user asks
  you to act on the review (`cpr-review` skill), is that yes. Then merge with `--no-ff`
  ("Merge <ID>: …"), verify `main` (`pnpm check`, build, e2e), push, and add a
  "Docs: <ID> merged" commit.
- Do not open pull requests unless asked. Commit and push as you go
  (`git push -u origin <branch>`); a session ends with everything pushed.
- Commit messages: subject `<ID>: <what changed>` (or `Fix: …`, `Docs: …`, `Plan <ID>: …`), a body
  that explains why and gives measured results, then the attribution trailers the session provides.
- Report results honestly: say what was not verified; numbers over adjectives.

## Docs to keep current

- `docs/PLAN.md`: the milestone's section (status, problem with numbers, goal, design,
  verification, risks, milestones, decisions), then "As built" (what differs from the plan and why)
  and results; the "Proposed next" table near §12.
- `docs/JOURNAL.md`: one entry per milestone or fix — what was learned, how it was verified, and
  "Merged into main (date)".
- `README.md` for user-visible behavior (commands, flags, plugins).
- Write like the existing docs: short sentences, measured numbers, no hype.

## Environment gotchas

- Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` when it exists
  (`packages/viewer/playwright.config.ts`); do not run `playwright install` in such containers.
- `pkill -f <pattern>` can match and kill your own shell: find PIDs with `pgrep -f '[n]ode …'`.
- The CLI keeps worktrees in its cache (`CPR_CACHE_DIR`, else `~/.cache/cpr` on Linux). A worktree
  with `main` checked out blocks `git checkout main`: add worktrees with `git worktree add --detach`.
- Viewer TypeScript (e.g. `packages/viewer/src/flow.ts`) runs in scripts with
  `node --experimental-strip-types`.
- Real-repo runs take minutes: run them in the background and keep working.

## Skills (`.claude/skills/`)

- `milestone` — plan and deliver a milestone the way this repository does.
- `regression-check` — compare a branch with `main` on ky, zod, vite, RealWorld, Bitwarden, Qwik.
- `framework-plugin` — add or change a framework plugin (`@cpr/plugin-*`).
- `viewer-check` — check viewer changes in a browser: e2e, screenshots, first paint on real graphs.
- `cpr-style` — CPR's style: tokens (contrast checked), control recipes, dated patterns to
  replace; for any restyle or new UI in `packages/viewer`.
- `cpr-review` — act on a review the user left on your branch in CPR (`cpr/AGENTS.md`).
