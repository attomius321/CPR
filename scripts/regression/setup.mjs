// Clones the repositories the regression sets use, and recreates their experiment branches.
// Usage: node scripts/regression/setup.mjs [set…]   (default: r1; `all` for every set)
// Where: $CPR_REGRESSION_DIR, else ~/.cache/cpr-regression. Blobless clones; nothing is installed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'sets.json'), 'utf8'));
export const regressionDir =
  process.env.CPR_REGRESSION_DIR ?? join(homedir(), '.cache', 'cpr-regression');

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const has = (repo, rev) => {
  try {
    git(repo, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

const names = process.argv.slice(2);
const sets = names.length === 0 ? ['r1'] : names.includes('all') ? Object.keys(config.sets) : names;
for (const name of sets) if (!config.sets[name]) throw new Error(`unknown set ${name}`);

const repos = new Map();
for (const name of sets) {
  for (const [repo, ...revs] of config.sets[name].comparisons) {
    repos.set(repo, [...(repos.get(repo) ?? []), ...revs]);
  }
}

mkdirSync(regressionDir, { recursive: true });
for (const [name, revs] of repos) {
  const { url, branches = {} } = config.repos[name];
  const path = join(regressionDir, name);
  if (!existsSync(path)) {
    console.log(`cloning ${url} into ${path}`);
    execFileSync('git', ['clone', '--quiet', '--filter=blob:none', url, path], {
      stdio: 'inherit',
    });
  }
  // Experiment branches exist only as patches: recreate them on their base commit.
  for (const [branch, { from, patch }] of Object.entries(branches)) {
    if (has(path, branch)) continue;
    const work = mkdtempSync(join(tmpdir(), 'cpr-regression-'));
    rmSync(work, { recursive: true });
    git(path, 'worktree', 'add', '--quiet', '--detach', work, from);
    try {
      git(
        work,
        '-c',
        'user.name=CPR',
        '-c',
        'user.email=cpr@example.com',
        'am',
        '--quiet',
        join(here, patch),
      );
      git(path, 'branch', branch, git(work, 'rev-parse', 'HEAD'));
    } finally {
      git(path, 'worktree', 'remove', '--force', work);
    }
    console.log(`${name}: branch ${branch} from ${patch}`);
  }
  const missing = revs.filter((rev) => !has(path, rev));
  if (missing.length > 0) {
    console.log(`${name}: fetching ${missing.length} missing commit(s)`);
    git(path, 'fetch', '--quiet', 'origin');
    const still = missing.filter((rev) => !has(path, rev));
    if (still.length > 0) throw new Error(`${name}: commits not found: ${still.join(' ')}`);
  }
  console.log(`${name}: ready (${path})`);
}
