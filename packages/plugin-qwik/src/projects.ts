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

/**
 * A package using Qwik: an app (or library) and its conventions. Its folder is the nearest one
 * with a `package.json`; that file or one above it (a monorepo's root, whose dependencies its
 * packages share) names Qwik.
 */
export interface QwikProject {
  /** Repo-relative folder, `''` at the root. */
  folder: string;
  /** The router majors it depends on; empty without the router (no route conventions). */
  routers: ReadonlySet<Major>;
  /** Repo-relative routes folder (`<folder>/src/routes` unless the Vite config says). */
  routesDir: string;
  /** Repo-relative folder of server plugins (the routes folder unless the Vite config says). */
  serverPluginsDir: string;
  /**
   * The MDX provider module (`mdx.providerImportSource`), imported as `.mdx` files import it:
   * its `useMDXComponents` gives components to every `.mdx` file.
   */
  mdxProvider?: string;
}

const VITE_CONFIGS = ['ts', 'mts', 'js', 'mjs', 'cts', 'cjs'].map((ext) => `vite.config.${ext}`);
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

export interface Projects {
  /** The Qwik project a repo-relative file belongs to, if its package uses Qwik. */
  of: (file: string) => QwikProject | undefined;
  /** The projects of every file asked about so far. */
  known: () => QwikProject[];
  warnings: string[];
}

/** Qwik projects of a revision, found per folder (a repo can hold several apps). */
export function qwikProjects(revision: PluginContext): Projects {
  const warnings: string[] = [];
  const manifests = new Map<string, Record<string, unknown> | undefined>();
  const manifest = (folder: string) => {
    if (!manifests.has(folder)) {
      manifests.set(
        folder,
        folder === ''
          ? revision.packageJson
          : parseJson(revision.readFile(`${folder}/package.json`)),
      );
    }
    return manifests.get(folder);
  };
  // The package a folder belongs to: the nearest `package.json` that is one (a name,
  // dependencies or scripts), not a marker like `{ "type": "module" }`.
  const packages = new Map<string, string>();
  const packageOf = (folder: string): string => {
    let found = packages.get(folder);
    if (found === undefined) {
      found = folder === '' || isPackage(manifest(folder)) ? folder : packageOf(parent(folder));
      packages.set(folder, found);
    }
    return found;
  };
  // The dependencies of the nearest `package.json` naming Qwik, from a folder up.
  const qwikDependencies = new Map<string, ReadonlySet<string> | null>();
  const dependenciesOf = (folder: string): ReadonlySet<string> | null => {
    let found = qwikDependencies.get(folder);
    if (found === undefined) {
      const deps = dependencies(manifest(folder));
      found = [...QWIK_PACKAGES].some((name) => deps.has(name))
        ? deps
        : folder === ''
          ? null
          : dependenciesOf(parent(folder));
      qwikDependencies.set(folder, found);
    }
    return found;
  };
  const projects = new Map<string, QwikProject | null>();
  const of = (file: string): QwikProject | undefined => {
    const folder = packageOf(parent(file));
    let found = projects.get(folder);
    if (found === undefined) {
      const deps = dependenciesOf(folder);
      found = deps ? project(revision, folder, deps, warnings) : null;
      projects.set(folder, found);
    }
    return found ?? undefined;
  };
  const known = () => [...projects.values()].filter((p): p is QwikProject => p !== null);
  return { of, known, warnings };
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
    ...(options.mdxProvider ? { mdxProvider: options.mdxProvider } : {}),
  };
}

/**
 * `routesDir` and `serverPluginsDir` given to `qwikCity(…)`/`qwikRouter(…)` in the project's
 * Vite config, relative to the project: a path in quotes, or built by `resolve`/`join` from
 * paths in quotes and the config's folder (directly or through a `const` of the config). Any
 * other value is left out with a warning, so the default applies. And `mdx.providerImportSource`,
 * a module name in quotes.
 */
function viteOptions(revision: PluginContext, folder: string, warnings: string[]): ViteOptions {
  for (const name of VITE_CONFIGS) {
    const path = join(folder, name);
    const text = revision.readFile(path);
    if (text === undefined) continue;
    const tsApi = revision.ts;
    const sf = tsApi.createSourceFile(path, text, tsApi.ScriptTarget.Latest, true);
    const found: ViteOptions = {};
    const visit = (node: ts.Node): void => {
      if (tsApi.isCallExpression(node) && isRouterPlugin(tsApi, node.expression)) {
        const options = node.arguments[0];
        if (options && tsApi.isObjectLiteralExpression(options)) {
          for (const key of ['routesDir', 'serverPluginsDir'] as const) {
            const value = property(tsApi, options, key);
            if (!value) continue;
            const relative = pathValue(tsApi, sf, value);
            if (relative !== undefined) {
              found[key] = join(folder, relative);
            } else {
              const fallback = key === 'routesDir' ? 'src/routes' : 'the routes folder';
              warnings.push(`${path}: cannot read ${key}; using ${fallback}`);
            }
          }
          const mdx = property(tsApi, options, 'mdx');
          const provider =
            mdx && tsApi.isObjectLiteralExpression(mdx)
              ? property(tsApi, mdx, 'providerImportSource')
              : undefined;
          if (provider && tsApi.isStringLiteral(provider)) found.mdxProvider = provider.text;
        }
      }
      tsApi.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  }
  return {};
}

interface ViteOptions {
  routesDir?: string;
  serverPluginsDir?: string;
  mdxProvider?: string;
}

function isRouterPlugin(tsApi: typeof ts, callee: ts.Expression): boolean {
  const name = tsApi.isIdentifier(callee)
    ? callee.text
    : tsApi.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  return name === 'qwikCity' || name === 'qwikRouter';
}

/** The folder of the config file (`__dirname`, `process.cwd()`, `import.meta.dirname`). */
const HERE = '.';

/**
 * A path relative to the config's folder, if the expression is one the plugin can read without
 * running the config.
 */
function pathValue(
  tsApi: typeof ts,
  sf: ts.SourceFile,
  node: ts.Expression,
  depth = 0,
): string | undefined {
  if (depth > 5) return undefined;
  if (tsApi.isStringLiteral(node) || tsApi.isNoSubstitutionTemplateLiteral(node)) {
    return posix.isAbsolute(node.text) ? undefined : node.text;
  }
  const text = node.getText(sf);
  if (text === '__dirname' || text === 'process.cwd()' || text === 'import.meta.dirname') {
    return HERE;
  }
  if (tsApi.isIdentifier(node)) {
    const initializer = constant(tsApi, sf, node.text);
    return initializer && pathValue(tsApi, sf, initializer, depth + 1);
  }
  if (!tsApi.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const name = tsApi.isIdentifier(callee)
    ? callee.text
    : tsApi.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  // fileURLToPath(new URL('./src/routes', import.meta.url))
  const url = node.arguments[0];
  if (name === 'fileURLToPath' && url && tsApi.isNewExpression(url)) {
    const [target, base] = url.arguments ?? [];
    return base?.getText(sf) === 'import.meta.url' && target
      ? pathValue(tsApi, sf, target, depth + 1)
      : undefined;
  }
  if (name !== 'resolve' && name !== 'join') return undefined;
  const parts: string[] = [];
  for (const argument of node.arguments) {
    const part = pathValue(tsApi, sf, argument, depth + 1);
    if (part === undefined) return undefined;
    parts.push(part);
  }
  return parts.length > 0 ? posix.join(...parts) : undefined;
}

/** The initializer of a top-level `const` of the file. */
function constant(tsApi: typeof ts, sf: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of sf.statements) {
    if (!tsApi.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (tsApi.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

function property(
  tsApi: typeof ts,
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const member of object.properties) {
    if (tsApi.isShorthandPropertyAssignment(member) && member.name.text === name) {
      return member.name;
    }
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

function isPackage(manifest: Record<string, unknown> | undefined): boolean {
  return (
    !!manifest &&
    ['name', 'scripts', ...DEPENDENCY_FIELDS].some((field) => manifest[field] !== undefined)
  );
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
