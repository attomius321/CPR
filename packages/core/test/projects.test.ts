import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeDirectories } from '../src/index.js';
import { projectResolver, type DeclaredProject } from '../src/projects.js';
import { workspaceMatcher } from '../src/workspace.js';

const tree = (name: string) =>
  fileURLToPath(new URL(`./fixtures/projects/${name}`, import.meta.url));
const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/diff/${name}/${side}`, import.meta.url));

describe('workspace globs', () => {
  it('match members at any depth with `**`, and leave out `!` patterns', () => {
    const member = workspaceMatcher(['apps/*', 'libs/**/*', 'tools/**', '!libs/private']);
    expect(member('apps/web')).toBe(true);
    expect(member('apps/desktop/src')).toBe(false);
    // `**` matches no folder too: `libs/**/*` holds `libs/common`.
    expect(member('libs/common')).toBe(true);
    expect(member('libs/tools/send/send-ui')).toBe(true);
    expect(member('libs/private')).toBe(false);
    expect(member('tools/lint/rules')).toBe(true);
    expect(member('docs')).toBe(false);
  });
});

describe('the project of a file', () => {
  it('is the declared project with the longest folder: workspace members, Nx, plugins', () => {
    // An Angular plugin's projects: `web` is also a workspace member and an Nx project.
    const declared: DeclaredProject[] = [
      { folder: 'apps/web', name: 'web-app', kind: 'application', plugin: 'angular' },
      { folder: 'license/bit-web', name: 'bit-web', kind: 'application', plugin: 'angular' },
    ];
    const projectOf = projectResolver(tree('declared'), declared);
    const web = { folder: 'apps/web', name: 'web', kind: 'application', source: 'nx' };
    expect(projectOf('apps/web/src/app.ts')).toEqual(web);
    // A folder with its own tsconfig inside a declared project stays the project's.
    expect(projectOf('apps/web/e2e/login.ts')).toEqual(web);
    // Nested packages (an Electron manifest, a component package) do not split an app.
    expect(projectOf('apps/desktop/src/main.ts')).toEqual({
      folder: 'apps/desktop',
      name: '@acme/desktop',
      source: 'workspace',
    });
    expect(projectOf('apps/browser/src/autofill/components/button.ts')).toEqual({
      folder: 'apps/browser',
      name: '@acme/browser',
      source: 'workspace',
    });
    expect(projectOf('libs/common/src/index.ts')).toEqual({
      folder: 'libs/common',
      name: '@acme/common',
      source: 'workspace',
    });
    expect(projectOf('libs/tools/send/send-ui/src/index.ts')).toEqual({
      folder: 'libs/tools/send/send-ui',
      name: '@acme/send-ui',
      source: 'workspace',
    });
    // Nx only (no package.json).
    expect(projectOf('libs/shared/index.ts')).toEqual({
      folder: 'libs/shared',
      name: 'shared',
      kind: 'library',
      source: 'nx',
    });
    // A plugin only.
    expect(projectOf('license/bit-web/src/app.ts')).toEqual({
      folder: 'license/bit-web',
      name: 'bit-web',
      kind: 'application',
      source: 'plugin',
      plugin: 'angular',
    });
    // Nobody declares it, but it has its own tsconfig.
    expect(projectOf('license/bit-common/src/index.ts')).toEqual({
      folder: 'license/bit-common',
      name: 'bit-common',
      source: 'tsconfig',
    });
    const root = { folder: '', name: '@acme/clients', source: 'root' };
    expect(projectOf('scripts/release.ts')).toEqual(root);
    expect(projectOf('README.md')).toEqual(root);
  });

  it('is the nearest package when the repo declares nothing', () => {
    const projectOf = projectResolver(tree('packages'));
    expect(projectOf('web/one/src/main.ts')).toEqual({
      folder: 'web/one',
      name: 'one',
      source: 'package',
    });
    // `{ "type": "module" }` is a marker, not a package.
    expect(projectOf('web/one/src/esm/util.js')).toEqual({
      folder: 'web/one',
      name: 'one',
      source: 'package',
    });
    // No name: the folder's.
    expect(projectOf('web/two/src/main.ts')).toEqual({
      folder: 'web/two',
      name: 'two',
      source: 'package',
    });
    expect(projectOf('tools/gen.ts')).toEqual({
      folder: 'tools',
      name: 'tools',
      source: 'tsconfig',
    });
    expect(projectOf('README.md')).toEqual({ folder: '', name: 'repository root', source: 'root' });
  });

  it('reads pnpm workspaces; a package they leave out belongs to the root', () => {
    const projectOf = projectResolver(tree('pnpm'));
    expect(projectOf('packages/a/index.ts')).toEqual({
      folder: 'packages/a',
      name: '@x/a',
      source: 'workspace',
    });
    expect(projectOf('tools/lint/rules/index.ts')).toEqual({
      folder: 'tools/lint/rules',
      name: '@x/lint-rules',
      source: 'workspace',
    });
    expect(projectOf('packages/private/index.ts')).toEqual({
      folder: '',
      name: 'pnpm-root',
      source: 'root',
    });
  });

  it('is the root project when a plugin declares one there', () => {
    const shop = { folder: '', name: 'shop', kind: 'application', plugin: 'angular' } as const;
    const projectOf = projectResolver(tree('packages'), [shop]);
    const expected = {
      folder: '',
      name: 'shop',
      kind: 'application',
      source: 'plugin',
      plugin: 'angular',
    };
    // Declared: packages and tsconfig folders inside it are not projects of their own.
    expect(projectOf('web/one/src/main.ts')).toEqual(expected);
    expect(projectOf('tools/gen.ts')).toEqual(expected);
    expect(projectOf('README.md')).toEqual(expected);
  });
});

describe('projects in the analysis', () => {
  it('lists the projects of the changed files and their neighbours', async () => {
    const analysis = await analyzeDirectories(
      fixture('projects', 'base'),
      fixture('projects', 'head'),
    );
    expect(analysis.projects).toEqual([
      // Head's name: the root package was renamed, and CHANGELOG.md only base has.
      { folder: '', name: 'acme', source: 'root' },
      { folder: 'apps/admin', name: '@acme/admin', source: 'workspace' },
      // Only an unchanged caller is there.
      { folder: 'apps/shop', name: '@acme/shop', source: 'workspace' },
      // Only base has it: read from base.
      { folder: 'libs/legacy', name: '@acme/legacy', source: 'workspace' },
      { folder: 'libs/ui', name: '@acme/ui', source: 'workspace' },
    ]);
  });

  it('finds the apps of a repo that declares nothing by their tsconfigs', async () => {
    const analysis = await analyzeDirectories(
      fixture('multi-project', 'base'),
      fixture('multi-project', 'head'),
    );
    expect(analysis.projects).toEqual([
      { folder: 'apps/web/a', name: 'a', source: 'tsconfig' },
      { folder: 'apps/web/b', name: 'b', source: 'tsconfig' },
    ]);
  });

  it('leaves them out when everything is in one project', async () => {
    const analysis = await analyzeDirectories(
      fixture('callers', 'base'),
      fixture('callers', 'head'),
    );
    expect(analysis.projects).toBeUndefined();
  });
});
