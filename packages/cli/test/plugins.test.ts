import type { Graph } from '@cpr/core';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { run } from '../src/main.js';
import { pluginPackage } from '../src/plugins.js';

async function cpr(argv: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    openUrl: () => undefined,
    waitForExit: () => Promise.resolve(),
    env: process.env,
  });
  return { code, stdout, stderr };
}

/** Says the framework calls `onStart`, so a new one is no orphan. */
const START_PLUGIN = `export default {
  name: 'start',
  version: '1.0.0',
  apiVersion: 1,
  applies: () => true,
  exposure: (_revision, symbol) => (symbol.name === 'onStart' ? 'framework' : undefined),
};
`;

describe('cpr --plugin', () => {
  let repo: TestRepo;
  let base: string;
  const cacheDir = tempDir();
  const previousCacheDir = process.env.CPR_CACHE_DIR;

  beforeAll(() => {
    process.env.CPR_CACHE_DIR = cacheDir;
    repo = createRepo();
    repo.write({
      '.gitignore': 'node_modules/\n',
      'package.json': '{ "name": "app", "private": true }\n',
      'src/app.ts': 'export class App {\n  run(): void {}\n}\n',
      'src/main.ts': "import { App } from './app';\nnew App().run();\n",
      'tools/start.mjs': START_PLUGIN,
      'tools/future.mjs': START_PLUGIN.replace('apiVersion: 1', 'apiVersion: 2'),
      'tools/nothing.mjs': 'export default 42;\n',
      // A plugin installed as a package, like @cpr/plugin-angular would be.
      'node_modules/@cpr/plugin-start/package.json':
        '{ "name": "@cpr/plugin-start", "type": "module", "main": "index.js" }\n',
      'node_modules/@cpr/plugin-start/index.js': START_PLUGIN,
    });
    base = repo.commit('base');
    repo.write({
      'src/app.ts': 'export class App {\n  run(): void {}\n\n  onStart(): void {}\n}\n',
    });
    repo.commit('onStart');
  });
  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
    if (previousCacheDir === undefined) delete process.env.CPR_CACHE_DIR;
    else process.env.CPR_CACHE_DIR = previousCacheDir;
  });

  const graph = async (args: string[], cwd = repo.root) => {
    const result = await cpr(['diff', base, 'HEAD', '--json', ...args], cwd);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout) as Graph;
  };
  const orphans = (g: Graph) => g.findings.filter((f) => f.rule === 'orphan-added');

  it('runs without plugins by default', async () => {
    const g = await graph([]);
    expect(orphans(g).map((f) => f.symbol)).toEqual(['src/app.ts#App.onStart']);
    expect(g).not.toHaveProperty('plugins');
  });

  it('loads a plugin by path, relative to the working folder', async () => {
    const g = await graph(['--plugin', '../tools/start.mjs'], join(repo.root, 'src'));
    expect(orphans(g)).toEqual([]);
    expect(g.plugins).toEqual([{ name: 'start', version: '1.0.0' }]);
  });

  it('loads a plugin by name from the project', async () => {
    expect(pluginPackage('start')).toBe('@cpr/plugin-start');
    expect(pluginPackage('@acme/cpr-vue')).toBe('@acme/cpr-vue');
    const g = await graph(['--plugin', 'start']);
    expect(orphans(g)).toEqual([]);
  });

  it('reads cpr.config.json at the repo root, paths relative to it', async () => {
    repo.write({ 'cpr.config.json': '{ "plugins": ["./tools/start.mjs"] }\n' });
    try {
      const g = await graph([], join(repo.root, 'src'));
      expect(g.plugins).toEqual([{ name: 'start', version: '1.0.0' }]);
      // The same plugin from the flag too: loaded once.
      expect((await graph(['--plugin', './tools/../tools/start.mjs'])).plugins).toHaveLength(1);
    } finally {
      rmSync(join(repo.root, 'cpr.config.json'));
    }
  });

  it.each([
    [['--plugin', 'nope'], 'cannot find the package @cpr/plugin-nope'],
    [['--plugin', './tools/missing.mjs'], 'tools/missing.mjs not found'],
    [
      ['--plugin', './tools/future.mjs'],
      'plugin start targets plugin API 2, this cpr implements 1',
    ],
    [['--plugin', './tools/nothing.mjs'], 'is not a CPR plugin'],
  ])('explains a plugin it cannot use: %j', async (args, message) => {
    const { code, stderr } = await cpr(['diff', base, 'HEAD', ...args], repo.root);
    expect(code).toBe(1);
    expect(stderr).toContain(message);
  });

  it('explains a broken cpr.config.json', async () => {
    for (const [content, message] of [
      ['{ "plugins": ', 'cpr.config.json: '],
      ['{ "plugins": "start" }', '"plugins" must be a list'],
    ] as const) {
      repo.write({ 'cpr.config.json': content });
      const { code, stderr } = await cpr(['diff', base, 'HEAD'], repo.root);
      expect(code).toBe(1);
      expect(stderr).toContain(message);
    }
    rmSync(join(repo.root, 'cpr.config.json'));
  });
});

describe('framework hints', () => {
  const cacheDir = tempDir();
  const previousCacheDir = process.env.CPR_CACHE_DIR;
  const repo = createRepo();
  beforeAll(() => {
    process.env.CPR_CACHE_DIR = cacheDir;
  });
  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
    if (previousCacheDir === undefined) delete process.env.CPR_CACHE_DIR;
    else process.env.CPR_CACHE_DIR = previousCacheDir;
  });

  it('suggests the plugin when an Angular project changes a template', async () => {
    repo.write({
      'package.json': '{ "dependencies": { "@angular/core": "^21.0.0" } }\n',
      'src/app.component.ts': 'export class AppComponent {\n  title = "a";\n}\n',
      'src/app.component.html': '<h1>{{ title }}</h1>\n',
    });
    const base = repo.commit('base');
    repo.write({ 'src/app.component.html': '<h1>{{ title }}!</h1>\n' });
    repo.commit('template');

    const { code, stderr } = await cpr(['diff', base, 'HEAD'], repo.root);
    expect(code).toBe(0);
    expect(stderr).toBe('hint: Angular project: add --plugin angular to analyze templates\n');
  });

  it('also when the Angular app lives in a subfolder', async () => {
    repo.write({
      // Nothing Angular at the root: only the app's own package.json says so.
      'package.json': '{ "name": "two-apps", "private": true }\n',
      'apps/web/package.json': '{ "dependencies": { "@angular/core": "~11.2.0" } }\n',
      'apps/web/src/menu.component.ts': 'export class MenuComponent {\n  open = false;\n}\n',
      'apps/web/src/menu.component.html': '<nav>{{ open }}</nav>\n',
    });
    const base = repo.commit('nested app');
    repo.write({ 'apps/web/src/menu.component.html': '<nav *ngIf="open">menu</nav>\n' });
    repo.commit('nested template');

    const { code, stderr } = await cpr(['diff', base, 'HEAD'], repo.root);
    expect(code).toBe(0);
    expect(stderr).toBe('hint: Angular project: add --plugin angular to analyze templates\n');
  });

  it('suggests the Qwik plugin when a Qwik app changes a component', async () => {
    repo.write({
      'apps/site/package.json': '{ "devDependencies": { "@qwik.dev/core": "2.0.0" } }\n',
      'apps/site/src/routes/index.tsx': 'export const onGet = () => 1;\n',
    });
    const base = repo.commit('qwik app');
    repo.write({ 'apps/site/src/routes/index.tsx': 'export const onGet = () => 2;\n' });
    repo.commit('qwik route');

    const { code, stderr } = await cpr(['diff', base, 'HEAD'], repo.root);
    expect(code).toBe(0);
    expect(stderr).toBe('hint: Qwik project: add --plugin qwik to analyze routes and components\n');
  });

  it('gives no hint for plain TSX', async () => {
    repo.write({
      'apps/react/package.json': '{ "dependencies": { "react": "19.0.0" } }\n',
      'apps/react/src/app.tsx': 'export const App = () => 1;\n',
    });
    const base = repo.commit('react app');
    repo.write({ 'apps/react/src/app.tsx': 'export const App = () => 2;\n' });
    repo.commit('react change');

    const { code, stderr } = await cpr(['diff', base, 'HEAD'], repo.root);
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });
});
