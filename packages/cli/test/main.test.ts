import { SCHEMA_VERSION } from '@symbiote/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  createBranchedRepo,
  createRepo,
  tempDir,
  type TestRepo,
} from '../../core/test/helpers/git-repo.js';
import type { AppWindow } from '../src/app.js';
import { run } from '../src/main.js';

async function symbiote(
  argv: string[],
  cwd = process.cwd(),
  whileRunning: (stdout: () => string) => Promise<void> = () => Promise.resolve(),
) {
  let stdout = '';
  let stderr = '';
  const opened: string[] = [];
  const code = await run(argv, {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    openUrl: (url) => opened.push(url),
    waitForExit: () => whileRunning(() => stdout),
    env: process.env,
  });
  return { code, stdout, stderr, opened };
}

describe('symbiote', () => {
  it('prints help with no arguments', async () => {
    const { code, stdout } = await symbiote([]);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: symbiote');
  });

  it('describes symbiote view as History, every branch, with the workspaces beside it (V25, V29a)', async () => {
    for (const argv of [[], ['view', '--help']]) {
      const { stdout } = await symbiote(argv);
      expect(stdout).not.toMatch(/current\s+branch/);
      expect(stdout).not.toMatch(/commits\s+page/);
      expect(stdout).not.toMatch(/first\s+page\s+is\s+Workspaces/);
      expect(stdout).toMatch(/History[^]*every\s+branch[^]*workspaces/);
    }
  });

  it('prints the version and schema version', async () => {
    const { code, stdout } = await symbiote(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(
      new RegExp(`^symbiote \\d+\\.\\d+\\.\\d+ \\(graph schema ${SCHEMA_VERSION}\\)\\n$`),
    );
  });

  it('explains symbiote app, and refuses what it does not know (N1b)', async () => {
    expect((await symbiote(['app'])).code).toBe(2);
    const help = await symbiote(['app', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: symbiote app install | uninstall');
    const odd = await symbiote(['app', 'nope']);
    expect(odd.code).toBe(2);
    expect(odd.stderr).toContain("unknown action 'nope'");
  });

  it('rejects unknown commands with a usage error', async () => {
    const { code, stderr } = await symbiote(['nope']);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown command 'nope'");
  });
});

describe('symbiote diff', () => {
  const { repo, shas } = createBranchedRepo();
  // Keep worktree slots out of the real cache.
  const cacheDir = tempDir();
  const previousCacheDir = process.env.SYMBIOTE_CACHE_DIR;
  process.env.SYMBIOTE_CACHE_DIR = cacheDir;
  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
    if (previousCacheDir === undefined) delete process.env.SYMBIOTE_CACHE_DIR;
    else process.env.SYMBIOTE_CACHE_DIR = previousCacheDir;
  });

  it('lists symbols changed since the merge-base, by file', async () => {
    const { code, stdout } = await symbiote(['diff', 'main', 'feature'], repo.root);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        `main (${shas.main.slice(0, 7)}) → feature (${shas.feature.slice(0, 7)}), merge-base ${shas.root.slice(0, 7)}`,
        '4 files changed · 3 symbols changed: 1 added, 2 modified',
        '',
        'Findings',
        '  ⚠ orphan-added  src/added.ts#added',
        '      added is new and nothing references it',
        '',
        'M  src/a.ts',
        '     ~ variable    a  (body)',
        'A  src/added.ts',
        '     + variable    added',
        'D  src/gone.ts',
        'R  src/old.ts → src/new.ts',
        '     → function    old  (moved from src/old.ts#old)',
        '',
      ].join('\n'),
    );
  });

  it('defaults head to HEAD', async () => {
    const { code, stdout } = await symbiote(['diff', 'feature'], repo.root);
    expect(code).toBe(0);
    expect(stdout).toContain('feature (');
    expect(stdout).toContain('→ HEAD (');
  });

  it('can skip the merge-base', async () => {
    const { stdout } = await symbiote(['diff', 'main', 'feature', '--no-merge-base'], repo.root);
    expect(stdout).not.toContain('merge-base');
    expect(stdout).toContain('\nD  src/main-only.ts\n');
  });

  it('prints the graph JSON with --json and writes it with --out', async () => {
    const { code, stdout } = await symbiote(
      ['diff', 'main', 'feature', '--json', '--out', 'graph.json'],
      repo.root,
    );
    expect(code).toBe(0);
    const graph = JSON.parse(stdout) as { schemaVersion: string; stats: { durationMs: number } };
    expect(graph.schemaVersion).toBe(SCHEMA_VERSION);
    expect(graph.stats.durationMs).toBeGreaterThan(0);
    expect(readFileSync(join(repo.root, 'graph.json'), 'utf8')).toBe(stdout);
    rmSync(join(repo.root, 'graph.json'));
  });

  it('fails with --fail-on when a finding is severe enough', async () => {
    // The branch adds an unused export: one orphan-added warning.
    expect(
      (await symbiote(['diff', 'main', 'feature', '--fail-on', 'error'], repo.root)).code,
    ).toBe(0);
    const warning = await symbiote(['diff', 'main', 'feature', '--fail-on', 'warning'], repo.root);
    expect(warning.code).toBe(1);
    expect(warning.stderr).toContain("1 finding at or above 'warning'");
    expect((await symbiote(['diff', 'main', 'feature', '--fail-on', 'loud'], repo.root)).code).toBe(
      2,
    );
  });

  it('serves the graph and sources with symbiote view', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '<!doctype html><title>viewer</title>');
    process.env.SYMBIOTE_VIEWER_DIR = viewer;
    try {
      const seen: Record<string, string> = {};
      const result = await symbiote(['view', 'main', 'feature'], repo.root, async (stdout) => {
        const url = /Symbiote viewer: (\S+)/.exec(stdout())?.[1] ?? '';
        for (const path of [
          '',
          'api/graph',
          'api/source?side=head&file=src/a.ts',
          'api/source?side=base&file=src/a.ts',
        ]) {
          const response = await fetch(new URL(path, url));
          seen[path] = `${response.status} ${(await response.text()).slice(0, 40)}`;
        }
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('4 files · 3 symbols changed · 1 findings');
      // The pair's own page, compared from the merge-base; the commits page is at `/`.
      expect(result.opened).toEqual([
        expect.stringMatching(
          new RegExp(`^http://127\\.0\\.0\\.1:\\d+/diff/${shas.root}\\.\\.${shas.feature}/$`),
        ),
      ]);
      expect(seen['']).toBe('200 <!doctype html><title>viewer</title>');
      expect(seen['api/graph']).toMatch(/^200 \{"schemaVersion":"0\.\d+\.\d+"/);
      expect(seen['api/source?side=head&file=src/a.ts']).toBe('200 export const a = 2;\n');
      expect(seen['api/source?side=base&file=src/a.ts']).toBe('200 export const a = 1;\n');
    } finally {
      delete process.env.SYMBIOTE_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  it('lists the history with symbiote view and no revisions, analyzing nothing first', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '');
    process.env.SYMBIOTE_VIEWER_DIR = viewer;
    try {
      let url = '';
      let page: { branch: string; done: boolean; commits: { subject: string }[] } | undefined;
      const result = await symbiote(['view'], repo.root, async (stdout) => {
        url = /Symbiote viewer: (\S+)/.exec(stdout())?.[1] ?? '';
        page = (await (await fetch(new URL('api/history', url))).json()) as typeof page;
      });
      expect(result.code).toBe(0);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(result.stdout).toBe(`Symbiote viewer: ${url}  (Ctrl+C to stop)\n`);
      expect(result.opened).toEqual([url]);
      // Every branch: main and feature, each above the root they forked from.
      expect(page).toMatchObject({ branch: 'main', done: true });
      expect(page?.commits.map((c) => c.subject).sort()).toEqual([
        'feature work',
        'main moves on',
        'root',
      ]);
      expect(page?.commits.at(-1)?.subject).toBe('root');
    } finally {
      delete process.env.SYMBIOTE_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  it("leaves its address for Symbiote's MCP bridge while it runs; symbiote mcp reaches it (MC1)", async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '');
    process.env.SYMBIOTE_VIEWER_DIR = viewer;
    try {
      let url = '';
      let record: unknown;
      let answer = '';
      let code: number | undefined;
      const result = await symbiote(['view', '--no-open'], repo.root, async (stdout) => {
        url = /Symbiote viewer: (\S+)/.exec(stdout())?.[1] ?? '';
        const [file = ''] = readdirSync(join(cacheDir, 'views'));
        record = JSON.parse(readFileSync(join(cacheDir, 'views', file), 'utf8'));
        const input = new PassThrough();
        const output = new PassThrough();
        output.on('data', (chunk: Buffer) => (answer += chunk.toString()));
        const bridged = run(['mcp'], {
          cwd: repo.root,
          stdout: () => undefined,
          stderr: () => undefined,
          openUrl: () => undefined,
          waitForExit: () => Promise.resolve(),
          env: process.env,
          stdio: { input, output },
        });
        input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
        code = await bridged;
      });
      expect(result.code).toBe(0);
      expect(record).toMatchObject({ url, pid: process.pid, root: expect.any(String) as unknown });
      expect(code).toBe(0);
      const tools = (JSON.parse(answer) as { result: { tools: { name: string }[] } }).result.tools;
      expect(tools.map((t) => t.name)).toContain('overview');
      // Gone once it stopped: a bridge then says Symbiote is not running.
      expect(readdirSync(join(cacheDir, 'views'))).toEqual([]);
    } finally {
      delete process.env.SYMBIOTE_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  it('says it runs while it runs, for Symbiote nexus: a record of its own server (NX1)', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '');
    process.env.SYMBIOTE_VIEWER_DIR = viewer;
    try {
      let url = '';
      let files: string[] = [];
      let record: unknown;
      const result = await symbiote(['view', '--no-open'], repo.root, (stdout) => {
        url = /Symbiote viewer: (\S+)/.exec(stdout())?.[1] ?? '';
        files = readdirSync(join(cacheDir, 'running'));
        record = JSON.parse(readFileSync(join(cacheDir, 'running', `${process.pid}.json`), 'utf8'));
        return Promise.resolve();
      });
      expect(result.code).toBe(0);
      expect(files).toEqual([`${process.pid}.json`]);
      expect(record).toEqual({
        url,
        pid: process.pid,
        root: repo.root,
        name: basename(repo.root),
        started: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      });
      // Gone once it stopped: the nexus marks its tab stopped.
      expect(readdirSync(join(cacheDir, 'running'))).toEqual([]);
    } finally {
      delete process.env.SYMBIOTE_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  it('needs <base> for --since in symbiote view', async () => {
    const { code, stderr } = await symbiote(['view', '--since', 'main'], repo.root);
    expect(code).toBe(2);
    expect(stderr).toContain('--since needs <base>');
  });

  it('does not open the browser with --no-open', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '');
    process.env.SYMBIOTE_VIEWER_DIR = viewer;
    try {
      const result = await symbiote(['view', 'main', 'feature', '--no-open'], repo.root);
      expect(result.opened).toEqual([]);
    } finally {
      delete process.env.SYMBIOTE_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  describe("in Symbiote's window (N1a)", () => {
    type Answer = AppWindow | { error: string } | null;

    /**
     * `symbiote view` where Symbiote's window answers `answer`; Ctrl+C comes at once when `ctrlC`,
     * else never (only the window can end it).
     */
    async function inApp(argv: string[], answer: Answer, ctrlC = false) {
      const viewer = tempDir();
      writeFileSync(join(viewer, 'index.html'), '');
      process.env.SYMBIOTE_VIEWER_DIR = viewer;
      let stdout = '';
      let stderr = '';
      const opened: string[] = [];
      const asked: [string, string][] = [];
      try {
        const code = await run(argv, {
          cwd: repo.root,
          stdout: (text) => (stdout += text),
          stderr: (text) => (stderr += text),
          openUrl: (url) => opened.push(url),
          openApp: (url, title) => {
            asked.push([url, title]);
            return Promise.resolve(answer);
          },
          waitForExit: () => (ctrlC ? Promise.resolve() : new Promise(() => undefined)),
          env: process.env,
        });
        return { code, stdout, stderr, opened, asked };
      } finally {
        delete process.env.SYMBIOTE_VIEWER_DIR;
        rmSync(viewer, { recursive: true, force: true });
      }
    }

    const window = (closed: Promise<void>) => {
      const window = { closed, close: vi.fn() };
      return window;
    };

    it('opens the window, not the browser, and stops when the window closes', async () => {
      const result = await inApp(['view'], window(Promise.resolve()));
      expect(result.code).toBe(0);
      expect(result.opened).toEqual([]);
      // Said once the window shows: what stops the command now.
      expect(result.stdout).toMatch(
        /\nSymbiote's window is open: close it, or Ctrl\+C, to stop\n$/,
      );
      expect(result.asked).toEqual([
        [expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/), basename(repo.root)],
      ]);
    });

    it('closes the window on Ctrl+C', async () => {
      const shown = window(new Promise(() => undefined));
      const result = await inApp(['view', 'main', 'feature'], shown, true);
      expect(result.code).toBe(0);
      expect(result.asked[0]?.[0]).toMatch(/\/diff\/[0-9a-f]+\.\.[0-9a-f]+\/$/);
      expect(shown.close).toHaveBeenCalledOnce();
    });

    it('opens the browser with --browser, or when the app is not set up', async () => {
      const browser = await inApp(['view', '--browser'], window(Promise.resolve()), true);
      expect(browser.asked).toEqual([]);
      expect(browser.stdout).not.toContain("Symbiote's window");
      expect(browser.opened).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/)]);
      const none = await inApp(['view'], null, true);
      expect(none.opened).toHaveLength(1);
      expect(none.stderr).toBe('');
    });

    it('opens the browser when the window fails, and says why', async () => {
      const result = await inApp(['view'], { error: 'symbiote app: no display' }, true);
      expect(result.opened).toHaveLength(1);
      expect(result.stderr).toBe(
        "symbiote: Symbiote's window did not open (symbiote app: no display); opening the browser\n",
      );
    });

    it('opens nothing with --no-open', async () => {
      const result = await inApp(['view', '--no-open'], window(Promise.resolve()), true);
      expect(result.asked).toEqual([]);
      expect(result.opened).toEqual([]);
    });
  });

  it('fails on unknown revisions', async () => {
    const { code, stderr } = await symbiote(['diff', 'main', 'nope'], repo.root);
    expect(code).toBe(1);
    expect(stderr).toBe("symbiote: unknown revision 'nope'\n");
  });

  it('reports usage errors', async () => {
    expect((await symbiote(['diff'], repo.root)).code).toBe(2);
    expect((await symbiote(['diff', '--bogus', 'main'], repo.root)).code).toBe(2);
    expect((await symbiote(['diff', 'a', 'b', 'c'], repo.root)).stderr).toContain(
      "unexpected argument 'c'",
    );
  });
});

// Hive mode per repository (fix/hive-per-symbiote, decision 621): each repository's `symbiote
// view` has its own; the config folder's record of V82 is not read.
describe('symbiote view: Hive mode, per repository', () => {
  const repos = [createRepo(), createRepo()];
  for (const repo of repos) {
    repo.git('config', 'user.email', 'hive@example.com');
    repo.write({ 'a.ts': 'export const a = 1;\n' });
    repo.commit('one');
  }
  const viewer = tempDir();
  writeFileSync(join(viewer, 'index.html'), '<html lang="en">viewer</html>');
  const cacheDir = tempDir();
  const config = tempDir();
  const earlier = join(config, 'symbiote', 'hive.json');
  const EARLIER = '{"on":true,"since":"2026-10-30T18:00:00.000Z"}';
  mkdirSync(dirname(earlier), { recursive: true });
  writeFileSync(earlier, EARLIER);
  const names = [
    'SYMBIOTE_VIEWER_DIR',
    'SYMBIOTE_CACHE_DIR',
    'XDG_CONFIG_HOME',
    'APPDATA',
    'SYMBIOTE_USAGE',
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  beforeAll(() => {
    Object.assign(process.env, {
      SYMBIOTE_VIEWER_DIR: viewer,
      SYMBIOTE_CACHE_DIR: cacheDir,
      // The machine's settings folder on Linux and Windows: V82 kept Hive there.
      XDG_CONFIG_HOME: config,
      APPDATA: config,
      SYMBIOTE_USAGE: 'off',
    });
  });
  afterAll(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    for (const repo of repos) repo.cleanup();
    for (const dir of [viewer, cacheDir, config]) rmSync(dir, { recursive: true, force: true });
  });

  const urlOf = (stdout: () => string) => /Symbiote viewer: (\S+)/.exec(stdout())?.[1] ?? '';
  const page = async (url: string) => (await fetch(url)).text();
  const hive = async (url: string) =>
    ((await (await fetch(new URL('api/hive', url))).json()) as { on: boolean }).on;
  const OFF = '<html lang="en">viewer</html>';
  const ON = '<html data-hive="on" lang="en">viewer</html>';

  it("turning it on in one leaves another's off; it is kept for a restart, out of git", async () => {
    const [one, other] = repos as [TestRepo, TestRepo];
    const seen: Record<string, unknown> = {};
    const first = await symbiote(['view', '--no-open'], one.root, async (oneOut) => {
      const oneUrl = urlOf(oneOut);
      const second = await symbiote(['view', '--no-open'], other.root, async (otherOut) => {
        const otherUrl = urlOf(otherOut);
        seen.before = [await page(oneUrl), await page(otherUrl)];
        const turned = await fetch(new URL('api/hive', oneUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
          body: '{"on":true}',
        });
        seen.turned = turned.status;
        seen.after = [await page(oneUrl), await page(otherUrl)];
        seen.api = [await hive(oneUrl), await hive(otherUrl)];
      });
      seen.second = second.code;
    });
    expect(first.code).toBe(0);
    expect(seen.second).toBe(0);
    // The machine's record of an earlier Symbiote turns on neither.
    expect(seen.before).toEqual([OFF, OFF]);
    expect(seen.turned).toBe(200);
    expect(seen.after).toEqual([ON, OFF]);
    expect(seen.api).toEqual([true, false]);
    expect(one.git('status', '--porcelain', '--untracked-files=all')).toBe('');
    // Left as it was.
    expect(readFileSync(earlier, 'utf8')).toBe(EARLIER);

    const again = await symbiote(['view', '--no-open'], one.root, async (stdout) => {
      seen.restarted = await page(urlOf(stdout));
    });
    expect(again.code).toBe(0);
    expect(seen.restarted).toBe(ON);
  });
});
