// The check command a workspace's Done when names (V24b, decision 125): guessed from the root
// files of the commit it starts from, shown with its source and editable before the start.
import { listTreeAt, readFileAtRevision, type CheckGuess, type GitRepo } from '@cpr/core';

/** A commit's root files: their names (folders too), and the text of one, null when none. */
export interface Tree {
  names: ReadonlySet<string>;
  read(path: string): Promise<string | null>;
}

/** Files below the root that a rule looks for. */
const DEEPER = ['scripts/test.sh'];

/** The tree of `sha` (a commit's full SHA), read from git, not from any working copy. */
export async function treeAt(repo: GitRepo, sha: string): Promise<Tree> {
  const [root, deeper] = await Promise.all([listTreeAt(repo, sha), listTreeAt(repo, sha, DEEPER)]);
  const names = new Set([...root, ...deeper]);
  return {
    names,
    read: (path) =>
      names.has(path)
        ? readFileAtRevision(repo, sha, path).catch(() => null)
        : Promise.resolve(null),
  };
}

/** npm's `test` script in a new package: it only fails. */
const PLACEHOLDER = /no test specified/;

/** A `packageManager` field's program: `pnpm@12.8.1` → `pnpm`; null when it is not a name. */
function managerOf(field: unknown): string | null {
  if (typeof field !== 'string') return null;
  const name = field.split('@')[0] ?? '';
  return /^[a-z][a-z0-9-]*$/.test(name) ? name : null;
}

const LOCKFILES: [string, string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

/** `package.json`'s `check` script, else its `test` script (not npm's placeholder). */
async function packageScript(tree: Tree): Promise<CheckGuess | null> {
  const text = await tree.read('package.json');
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const v = (value && typeof value === 'object' ? value : {}) as {
    scripts?: Record<string, unknown>;
    packageManager?: unknown;
  };
  const scripts = v.scripts && typeof v.scripts === 'object' ? v.scripts : {};
  const script = ['check', 'test'].find(
    (name) => typeof scripts[name] === 'string' && !PLACEHOLDER.test(scripts[name]),
  );
  if (!script) return null;
  const manager =
    managerOf(v.packageManager) ?? LOCKFILES.find(([file]) => tree.names.has(file))?.[1] ?? 'npm';
  return { command: `${manager} run ${script}`, source: `package.json (scripts.${script})` };
}

/** A Makefile's `check` target, else its `test` target. */
async function makeTarget(tree: Tree): Promise<CheckGuess | null> {
  const file = ['GNUmakefile', 'Makefile', 'makefile'].find((name) => tree.names.has(name));
  const text = file ? await tree.read(file) : null;
  if (!file || text === null) return null;
  // `test:` starts a target's line; `test :=` sets a variable.
  const target = ['check', 'test'].find((name) => new RegExp(`^${name}\\s*:(?!=)`, 'm').test(text));
  return target ? { command: `make ${target}`, source: `${file} (${target} target)` } : null;
}

async function cargo(tree: Tree): Promise<CheckGuess | null> {
  const text = await tree.read('Cargo.toml');
  if (text === null) return null;
  return /^\[workspace\]/m.test(text)
    ? { command: 'cargo test --workspace', source: 'Cargo.toml ([workspace])' }
    : { command: 'cargo test', source: 'Cargo.toml' };
}

function pytest(tree: Tree): CheckGuess | null {
  const file = ['pyproject.toml', 'setup.py', 'tox.ini', 'pytest.ini'].find((name) =>
    tree.names.has(name),
  );
  if (!file) return null;
  return tree.names.has('uv.lock')
    ? { command: 'uv run pytest', source: `${file}, uv.lock` }
    : { command: 'python -m pytest', source: file };
}

/**
 * The command that checks the repository, from its root files; the first rule that finds one:
 * `package.json`'s `check` or `test` script run by its package manager, a Makefile's `check` or
 * `test` target, `scripts/test.sh`, `cargo test`, `go test ./...`, `pytest`. Agent instructions
 * are not read: their commands sit among alternatives, and the agent reads them anyway.
 */
export async function guessCheck(tree: Tree): Promise<CheckGuess | null> {
  return (
    (await packageScript(tree)) ??
    (await makeTarget(tree)) ??
    (tree.names.has('scripts/test.sh')
      ? { command: 'bash scripts/test.sh', source: 'scripts/test.sh' }
      : null) ??
    (await cargo(tree)) ??
    (tree.names.has('go.mod') ? { command: 'go test ./...', source: 'go.mod' } : null) ??
    pytest(tree)
  );
}
