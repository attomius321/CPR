import { posix } from 'node:path';
import type { PluginContext, ts } from '@cpr/core';

/** Qwik itself: 1.x and 2.x. */
export const QWIK_PACKAGES = new Set(['@builder.io/qwik', '@qwik.dev/core']);
/** Qwik's router, by the Qwik major it belongs to. */
export const ROUTER_PACKAGES = new Map<string, Major>([
  ['@builder.io/qwik-city', 1],
  ['@qwik.dev/router', 2],
]);

export type Major = 1 | 2;

/** A folder whose `package.json` names Qwik: an app (or library) and its conventions. */
export interface QwikProject {
  /** Repo-relative folder, `''` at the root. */
  folder: string;
  /** The router majors it depends on; empty without the router (no route conventions). */
  routers: ReadonlySet<Major>;
  /** Repo-relative routes folder (`<folder>/src/routes` unless the Vite config says). */
  routesDir: string;
  /** Repo-relative folder of server plugins (the routes folder unless the Vite config says). */
  serverPluginsDir: string;
}

const VITE_CONFIGS = ['ts', 'mts', 'js', 'mjs', 'cts', 'cjs'].map((ext) => `vite.config.${ext}`);
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

export interface Projects {
  /** The Qwik project a repo-relative file belongs to: the nearest folder naming Qwik. */
  of: (file: string) => QwikProject | undefined;
  warnings: string[];
}

/** Qwik projects of a revision, found per folder (a repo can hold several apps). */
export function qwikProjects(revision: PluginContext): Projects {
  const warnings: string[] = [];
  const byFolder = new Map<string, QwikProject | null>();
  const at = (folder: string): QwikProject | null => {
    let found = byFolder.get(folder);
    if (found === undefined) {
      const manifest =
        folder === ''
          ? revision.packageJson
          : parseJson(revision.readFile(`${folder}/package.json`));
      const deps = dependencies(manifest);
      if ([...QWIK_PACKAGES].some((name) => deps.has(name))) {
        found = project(revision, folder, deps, warnings);
      } else {
        found = folder === '' ? null : at(parent(folder));
      }
      byFolder.set(folder, found);
    }
    return found;
  };
  return { of: (file) => at(parent(file)) ?? undefined, warnings };
}

function project(
  revision: PluginContext,
  folder: string,
  deps: ReadonlySet<string>,
  warnings: string[],
): QwikProject {
  const routers = new Set(
    [...ROUTER_PACKAGES].filter(([name]) => deps.has(name)).map(([, m]) => m),
  );
  const options = viteOptions(revision, folder, warnings);
  const routesDir = options.routesDir ?? join(folder, 'src/routes');
  return {
    folder,
    routers,
    routesDir,
    serverPluginsDir: options.serverPluginsDir ?? routesDir,
  };
}

/**
 * `routesDir` and `serverPluginsDir` given to `qwikCity(…)`/`qwikRouter(…)` in the project's
 * Vite config, relative to the project; a value that is not a plain string is left out (with a
 * warning), so the default applies.
 */
function viteOptions(
  revision: PluginContext,
  folder: string,
  warnings: string[],
): { routesDir?: string; serverPluginsDir?: string } {
  for (const name of VITE_CONFIGS) {
    const path = join(folder, name);
    const text = revision.readFile(path);
    if (text === undefined) continue;
    const tsApi = revision.ts;
    const sf = tsApi.createSourceFile(path, text, tsApi.ScriptTarget.Latest, true);
    const found: { routesDir?: string; serverPluginsDir?: string } = {};
    const visit = (node: ts.Node): void => {
      if (tsApi.isCallExpression(node) && isRouterPlugin(tsApi, node.expression)) {
        const options = node.arguments[0];
        if (options && tsApi.isObjectLiteralExpression(options)) {
          for (const key of ['routesDir', 'serverPluginsDir'] as const) {
            const value = property(tsApi, options, key);
            if (!value) continue;
            const literal =
              tsApi.isStringLiteral(value) || tsApi.isNoSubstitutionTemplateLiteral(value)
                ? value.text
                : undefined;
            if (literal !== undefined && !posix.isAbsolute(literal)) {
              found[key] = join(folder, literal);
            } else {
              const fallback = key === 'routesDir' ? 'src/routes' : 'the routes folder';
              warnings.push(`${path}: ${key} is not a relative path in quotes; using ${fallback}`);
            }
          }
        }
      }
      tsApi.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  }
  return {};
}

function isRouterPlugin(tsApi: typeof ts, callee: ts.Expression): boolean {
  const name = tsApi.isIdentifier(callee)
    ? callee.text
    : tsApi.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  return name === 'qwikCity' || name === 'qwikRouter';
}

function property(
  tsApi: typeof ts,
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const member of object.properties) {
    if (
      tsApi.isPropertyAssignment(member) &&
      (tsApi.isIdentifier(member.name) || tsApi.isStringLiteral(member.name)) &&
      member.name.text === name
    ) {
      return member.initializer;
    }
  }
  return undefined;
}

/** Names of the packages a manifest depends on, in any dependency field. */
export function dependencies(manifest: Record<string, unknown> | undefined): Set<string> {
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest?.[field];
    if (deps && typeof deps === 'object') for (const name of Object.keys(deps)) names.add(name);
  }
  return names;
}

export function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The folder of a repo-relative path, `''` at the root. */
export function parent(path: string): string {
  const dir = posix.dirname(path);
  return dir === '.' ? '' : dir;
}

/** A repo-relative path joined and normalized, `''` for the root. */
export function join(folder: string, path: string): string {
  const joined = posix.normalize(posix.join(folder, path)).replace(/\/$/, '');
  return joined === '.' ? '' : joined;
}

/** Whether a repo-relative file is inside a repo-relative folder (`''`: the root). */
export function inside(folder: string, file: string): boolean {
  return folder === '' || file.startsWith(`${folder}/`);
}
