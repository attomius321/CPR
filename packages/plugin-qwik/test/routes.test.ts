import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@cpr/core';
import { qwikProjects, type QwikProject } from '../src/projects.js';
import { moduleKind } from '../src/routes.js';

/** A revision made of the given files, with no program. */
function revision(files: Record<string, string>): PluginContext {
  const root = files['package.json'];
  return {
    ts: ts as unknown as PluginContext['ts'],
    root: '/repo',
    packageJson: root === undefined ? undefined : (JSON.parse(root) as Record<string, unknown>),
    readFile: (path) => files[path],
    sourceFiles: () => Object.keys(files).filter((f) => /\.[jt]sx?$/.test(f)),
    syntax: () => undefined,
  };
}

const app = (deps: Record<string, string>) => JSON.stringify({ devDependencies: deps });
const V1 = app({ '@builder.io/qwik': '1.20.1', '@builder.io/qwik-city': '1.20.1' });
const V2 = app({ '@qwik.dev/core': '2.0.0', '@qwik.dev/router': '2.0.0' });

const project = (files: Record<string, string>, file: string): QwikProject => {
  const found = qwikProjects(revision(files)).of(file);
  if (!found) throw new Error(`no Qwik project for ${file}`);
  return found;
};

describe('Qwik file rules', () => {
  const v1 = project({ 'package.json': V1 }, 'src/routes/index.tsx');
  const v2 = project({ 'package.json': V2 }, 'src/routes/index.tsx');

  it.each([
    ['src/routes/index.tsx', 'route', 'route'],
    ['src/routes/shop/index.ts', 'route', 'route'],
    ['src/routes/shop/index!.tsx', 'route', 'route'],
    ['src/routes/shop/index@narrow.tsx', 'route', 'route'],
    ['src/routes/docs/index.mdx', 'route', 'route'],
    ['src/routes/404.tsx', 'route', 'route'],
    ['src/routes/404@narrow.tsx', 'route', 'route'],
    ['src/routes/500.tsx', 'route', undefined],
    ['src/routes/error.tsx', undefined, 'route'],
    ['src/routes/layout.tsx', 'layout', 'layout'],
    ['src/routes/layout!.tsx', 'layout', 'layout'],
    ['src/routes/layout-narrow.tsx', 'layout', 'layout'],
    ['src/routes/layout.mdx', undefined, undefined],
    ['src/routes/entry.ts', 'entry', 'entry'],
    ['src/routes/entry.tsx', undefined, undefined],
    ['src/routes/service-worker.ts', 'service-worker', 'service-worker'],
    ['src/routes/service-worker.tsx', undefined, undefined],
    ['src/routes/plugin.ts', 'plugin', 'plugin'],
    ['src/routes/plugin@auth.tsx', 'plugin', 'plugin'],
    ['src/routes/plugin@auth.test.ts', undefined, undefined],
    ['src/routes/admin/plugin.ts', undefined, undefined],
    ['src/routes/index.test.tsx', undefined, undefined],
    ['src/routes/helpers.ts', undefined, undefined],
    ['src/components/index.tsx', undefined, undefined],
    ['src/entry.ssr.tsx', 'app-entry', 'app-entry'],
    ['src/entry.cloudflare-pages.tsx', 'app-entry', 'app-entry'],
    ['src/components/entry.ssr.tsx', undefined, undefined],
  ])('%s: 1.x %s, 2.x %s', (file, one, two) => {
    expect(moduleKind(v1, file)).toBe(one);
    expect(moduleKind(v2, file)).toBe(two);
  });

  it('has app entries but no routes without the router', () => {
    const bare = project({ 'package.json': app({ '@builder.io/qwik': '1.20.1' }) }, 'src/a.tsx');
    expect(moduleKind(bare, 'src/entry.ssr.tsx')).toBe('app-entry');
    expect(moduleKind(bare, 'src/routes/index.tsx')).toBeUndefined();
  });
});

describe('Qwik projects', () => {
  it('are the packages using Qwik, at any depth', () => {
    const projects = qwikProjects(
      revision({
        'package.json': JSON.stringify({ name: 'monorepo' }),
        'apps/site/package.json': JSON.stringify({ name: 'site', ...JSON.parse(V2) }),
        // A module-type marker is not a package.
        'apps/site/src/ui/package.json': JSON.stringify({ type: 'module' }),
        'apps/old/package.json': V1,
        'tools/package.json': JSON.stringify({ name: 'tools' }),
      }),
    );
    expect(projects.of('apps/site/src/ui/button.tsx')?.folder).toBe('apps/site');
    expect(projects.of('apps/site/src/routes/index.tsx')?.routesDir).toBe('apps/site/src/routes');
    expect([...(projects.of('apps/old/src/a.ts')?.routers ?? [])]).toEqual([1]);
    expect(projects.of('tools/build.ts')).toBeUndefined();
  });

  it('take Qwik from a monorepo root its packages share', () => {
    // Qwik's own e2e apps: a named package.json without dependencies, Qwik at the root.
    const projects = qwikProjects(
      revision({
        'package.json': V2,
        'e2e/apps/errors/package.json': JSON.stringify({ name: 'errors', private: true }),
      }),
    );
    const found = projects.of('e2e/apps/errors/src/routes/pending/index.tsx');
    expect(found).toMatchObject({
      folder: 'e2e/apps/errors',
      routesDir: 'e2e/apps/errors/src/routes',
    });
    expect(found && moduleKind(found, 'e2e/apps/errors/src/routes/pending/index.tsx')).toBe(
      'route',
    );
  });

  it.each([
    [`qwikCity({ routesDir: './src/pages' })`, 'src/pages'],
    [`qwikCity({ routesDir: "src/pages/" })`, 'src/pages'],
    [`qwikRouter({ routesDir: resolve(__dirname, 'src', 'pages') })`, 'src/pages'],
    [`qwikRouter({ routesDir: path.join(process.cwd(), 'src/pages') })`, 'src/pages'],
    [
      `qwikRouter({ routesDir: fileURLToPath(new URL('./src/pages', import.meta.url)) })`,
      'src/pages',
    ],
    [`qwikRouter({ routesDir })`, 'src/pages'],
    [`qwikRouter({ routesDir: pages })`, 'src/pages'],
    [`qwikRouter({ mdxPlugins: {} })`, 'src/routes'],
  ])('read the routes folder from %s', (call, expected) => {
    const config = `const routesDir = resolve('src', 'pages');\nconst pages = routesDir;\nexport default { plugins: [${call}] };\n`;
    const projects = qwikProjects(
      revision({ 'web/package.json': V2, 'web/vite.config.ts': config }),
    );
    expect(projects.of('web/src/x.ts')?.routesDir).toBe(`web/${expected}`);
    expect(projects.warnings).toEqual([]);
  });

  it('say when they cannot read the routes folder', () => {
    const projects = qwikProjects(
      revision({
        'package.json': V1,
        'vite.config.mts': `export default { plugins: [qwikCity({ routesDir: dirs.routes, serverPluginsDir: 'src/server' })] };`,
      }),
    );
    const found = projects.of('src/routes/index.tsx');
    expect(found).toMatchObject({ routesDir: 'src/routes', serverPluginsDir: 'src/server' });
    expect(projects.warnings).toEqual(['vite.config.mts: cannot read routesDir; using src/routes']);
  });
});
