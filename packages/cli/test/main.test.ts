import { SCHEMA_VERSION } from '@cpr/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createBranchedRepo, tempDir } from '../../core/test/helpers/git-repo.js';
import type { AppWindow } from '../src/app.js';
import { run } from '../src/main.js';

async function cpr(
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

describe('cpr', () => {
  it('prints help with no arguments', async () => {
    const { code, stdout } = await cpr([]);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: cpr');
  });

  it('describes cpr view as History, every branch, with the workspaces beside it (V25, V29a)', async () => {
    for (const argv of [[], ['view', '--help']]) {
      const { stdout } = await cpr(argv);
      expect(stdout).not.toMatch(/current\s+branch/);
      expect(stdout).not.toMatch(/commits\s+page/);
      expect(stdout).not.toMatch(/first\s+page\s+is\s+Workspaces/);
      expect(stdout).toMatch(/History[^]*every\s+branch[^]*workspaces/);
    }
  });

  it('prints the version and schema version', async () => {
    const { code, stdout } = await cpr(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(
      new RegExp(`^cpr \\d+\\.\\d+\\.\\d+ \\(graph schema ${SCHEMA_VERSION}\\)\\n$`),
    );
  });

  it('explains cpr app, and refuses what it does not know (N1b)', async () => {
    expect((await cpr(['app'])).code).toBe(2);
    const help = await cpr(['app', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: cpr app install | uninstall');
    const odd = await cpr(['app', 'nope']);
    expect(odd.code).toBe(2);
    expect(odd.stderr).toContain("unknown action 'nope'");
  });

  it('rejects unknown commands with a usage error', async () => {
    const { code, stderr } = await cpr(['nope']);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown command 'nope'");
  });
});

describe('cpr diff', () => {
  const { repo, shas } = createBranchedRepo();
  // Keep worktree slots out of the real cache.
  const cacheDir = tempDir();
  const previousCacheDir = process.env.CPR_CACHE_DIR;
  process.env.CPR_CACHE_DIR = cacheDir;
  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
    if (previousCacheDir === undefined) delete process.env.CPR_CACHE_DIR;
    else process.env.CPR_CACHE_DIR = previousCacheDir;
  });

  it('lists symbols changed since the merge-base, by file', async () => {
    const { code, stdout } = await cpr(['diff', 'main', 'feature'], repo.root);
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
    const { code, stdout } = await cpr(['diff', 'feature'], repo.root);
    expect(code).toBe(0);
    expect(stdout).toContain('feature (');
    expect(stdout).toContain('→ HEAD (');
  });

  it('can skip the merge-base', async () => {
    const { stdout } = await cpr(['diff', 'main', 'feature', '--no-merge-base'], repo.root);
    expect(stdout).not.toContain('merge-base');
    expect(stdout).toContain('\nD  src/main-only.ts\n');
  });

  it('prints the graph JSON with --json and writes it with --out', async () => {
    const { code, stdout } = await cpr(
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
    expect((await cpr(['diff', 'main', 'feature', '--fail-on', 'error'], repo.root)).code).toBe(0);
    const warning = await cpr(['diff', 'main', 'feature', '--fail-on', 'warning'], repo.root);
    expect(warning.code).toBe(1);
    expect(warning.stderr).toContain("1 finding at or above 'warning'");
    expect((await cpr(['diff', 'main', 'feature', '--fail-on', 'loud'], repo.root)).code).toBe(2);
  });

  it('serves the graph and sources with cpr view', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '<!doctype html><title>viewer</title>');
    process.env.CPR_VIEWER_DIR = viewer;
    try {
      const seen: Record<string, string> = {};
      const result = await cpr(['view', 'main', 'feature'], repo.root, async (stdout) => {
        const url = /CPR viewer: (\S+)/.exec(stdout())?.[1] ?? '';
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
      delete process.env.CPR_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  it('lists the history with cpr view and no revisions, analyzing nothing first', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '');
    process.env.CPR_VIEWER_DIR = viewer;
    try {
      let url = '';
      let page: { branch: string; done: boolean; commits: { subject: string }[] } | undefined;
      const result = await cpr(['view'], repo.root, async (stdout) => {
        url = /CPR viewer: (\S+)/.exec(stdout())?.[1] ?? '';
        page = (await (await fetch(new URL('api/history', url))).json()) as typeof page;
      });
      expect(result.code).toBe(0);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(result.stdout).toBe(`CPR viewer: ${url}  (Ctrl+C to stop)\n`);
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
      delete process.env.CPR_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  it('needs <base> for --since in cpr view', async () => {
    const { code, stderr } = await cpr(['view', '--since', 'main'], repo.root);
    expect(code).toBe(2);
    expect(stderr).toContain('--since needs <base>');
  });

  it('does not open the browser with --no-open', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '');
    process.env.CPR_VIEWER_DIR = viewer;
    try {
      const result = await cpr(['view', 'main', 'feature', '--no-open'], repo.root);
      expect(result.opened).toEqual([]);
    } finally {
      delete process.env.CPR_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  describe("in CPR's window (N1a)", () => {
    type Answer = AppWindow | { error: string } | null;

    /**
     * `cpr view` where CPR's window answers `answer`; Ctrl+C comes at once when `ctrlC`, else
     * never (only the window can end it).
     */
    async function inApp(argv: string[], answer: Answer, ctrlC = false) {
      const viewer = tempDir();
      writeFileSync(join(viewer, 'index.html'), '');
      process.env.CPR_VIEWER_DIR = viewer;
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
        delete process.env.CPR_VIEWER_DIR;
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
      expect(result.stdout).toMatch(/\nCPR's window is open: close it, or Ctrl\+C, to stop\n$/);
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
      expect(browser.stdout).not.toContain("CPR's window");
      expect(browser.opened).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/)]);
      const none = await inApp(['view'], null, true);
      expect(none.opened).toHaveLength(1);
      expect(none.stderr).toBe('');
    });

    it('opens the browser when the window fails, and says why', async () => {
      const result = await inApp(['view'], { error: 'cpr app: no display' }, true);
      expect(result.opened).toHaveLength(1);
      expect(result.stderr).toBe(
        "cpr: CPR's window did not open (cpr app: no display); opening the browser\n",
      );
    });

    it('opens nothing with --no-open', async () => {
      const result = await inApp(['view', '--no-open'], window(Promise.resolve()), true);
      expect(result.asked).toEqual([]);
      expect(result.opened).toEqual([]);
    });
  });

  it('fails on unknown revisions', async () => {
    const { code, stderr } = await cpr(['diff', 'main', 'nope'], repo.root);
    expect(code).toBe(1);
    expect(stderr).toBe("cpr: unknown revision 'nope'\n");
  });

  it('reports usage errors', async () => {
    expect((await cpr(['diff'], repo.root)).code).toBe(2);
    expect((await cpr(['diff', '--bogus', 'main'], repo.root)).code).toBe(2);
    expect((await cpr(['diff', 'a', 'b', 'c'], repo.root)).stderr).toContain(
      "unexpected argument 'c'",
    );
  });
});
