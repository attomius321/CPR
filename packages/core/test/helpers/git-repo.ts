import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Ignore the developer's git config so commits are reproducible everywhere.
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'CPR Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'CPR Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

export interface TestRepo {
  root: string;
  git(...args: string[]): string;
  write(files: Record<string, string>): void;
  /** Stages everything, commits, and returns the new SHA. */
  commit(message: string): string;
  cleanup(): void;
}

/** A fresh temp directory, as a real path (macOS links /var to /private/var). */
export function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'cpr-test-')));
}

export function createRepo(): TestRepo {
  const root = tempDir();
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main');

  return {
    root,
    git,
    write(files) {
      for (const [path, content] of Object.entries(files)) {
        const file = join(root, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
    },
    commit(message) {
      git('add', '--all');
      git('commit', '--quiet', '--message', message);
      return git('rev-parse', 'HEAD');
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * A repo where `feature` branched from `main`, then `main` moved on:
 *
 *   root ── main
 *     └──── feature (modify a.ts, add added.ts, rename old.ts → new.ts, delete gone.ts)
 */
export function createBranchedRepo() {
  const repo = createRepo();
  repo.write({
    'src/a.ts': 'export const a = 1;\n',
    'src/old.ts':
      'export function old() {\n  return "a body long enough for rename detection";\n}\n',
    'src/gone.ts': 'export {};\n',
  });
  const root = repo.commit('root');

  repo.git('switch', '--quiet', '--create', 'feature');
  repo.write({
    'src/a.ts': 'export const a = 2;\n',
    'src/added.ts': 'export const added = true;\n',
  });
  repo.git('mv', 'src/old.ts', 'src/new.ts');
  repo.git('rm', '--quiet', 'src/gone.ts');
  const feature = repo.commit('feature work');

  repo.git('switch', '--quiet', 'main');
  repo.write({ 'src/main-only.ts': 'export {};\n' });
  const main = repo.commit('main moves on');

  return { repo, shas: { root, feature, main } };
}
