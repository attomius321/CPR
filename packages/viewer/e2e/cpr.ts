import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const fixtures = join(root, 'packages/core/test/fixtures/diff');
const cli = join(root, 'packages/cli/dist/bin.js');

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'CPR Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'CPR Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

export interface Running {
  url: string;
  stop(): void;
}

/**
 * Turns a fixture's base/ and head/ folders into two commits of a fresh repo and serves
 * `cpr view HEAD~1 HEAD` from the built CLI. Build first: `pnpm build`.
 */
export async function serveFixture(name: string): Promise<Running> {
  const repo = mkdtempSync(join(tmpdir(), 'cpr-e2e-'));
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  cpSync(join(fixtures, name, 'base'), repo, { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  for (const entry of readdirSync(repo))
    if (entry !== '.git') rmSync(join(repo, entry), { recursive: true });
  cpSync(join(fixtures, name, 'head'), repo, { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'head');

  const child: ChildProcess = spawn(
    process.execPath,
    [cli, 'view', 'HEAD~1', 'HEAD', '--no-open'],
    {
      cwd: repo,
      env: { ...env, CPR_CACHE_DIR: cache },
    },
  );
  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      const match = /CPR viewer: (\S+)/.exec(output);
      if (match?.[1]) resolve(match[1]);
    });
    child.stderr?.on('data', (data: Buffer) => (output += data.toString()));
    child.on('exit', (code) => reject(new Error(`cpr view exited with ${code}:\n${output}`)));
  });
  return {
    url,
    stop() {
      child.kill('SIGINT');
      rmSync(repo, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    },
  };
}
