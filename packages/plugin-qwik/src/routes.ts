import { posix } from 'node:path';
import { inside, join, parent, type Major, type QwikProject } from './projects.js';

/**
 * What Qwik's router makes of a file, by the rules of its Vite plugin (`getSourceFile` and
 * `walkServerPlugins` in `@builder.io/qwik-city` 1.x and `@qwik.dev/router` 2.x):
 * - `route`: a page or endpoint (`index`, `index!`, `index@layout`, error pages),
 * - `layout`: `layout`, `layout!`, `layout-name`,
 * - `entry` and `service-worker` modules under the routes folder,
 * - `plugin`: `plugin` or `plugin@name` directly in the server plugins folder,
 * - `app-entry`: `src/entry.<name>.tsx` of any Qwik project, named by Vite and adapter configs.
 */
export type ModuleKind = 'route' | 'layout' | 'entry' | 'service-worker' | 'plugin' | 'app-entry';

const PAGE_MODULE = new Set(['.tsx', '.jsx']);
const MODULE = new Set(['.ts', '.js']);
const MARKDOWN = new Set(['.md', '.mdx']);

/** Request handlers: what the router calls on pages, layouts and server plugins. */
export const HANDLERS: ReadonlySet<string> = new Set([
  'onRequest',
  'onGet',
  'onPost',
  'onPut',
  'onPatch',
  'onDelete',
  'onHead',
  'onOptions',
]);

const ROUTE_EXPORTS_1 = ['default', 'head', 'onStaticGenerate', ...HANDLERS];
const ROUTE_EXPORTS_2 = [...ROUTE_EXPORTS_1, 'routeConfig', 'eTag', 'cacheKey'];

/** The exports the router reads from a page or layout module, by name. */
export function routeExports(project: QwikProject): ReadonlySet<string> {
  return new Set(project.routers.has(2) ? ROUTE_EXPORTS_2 : ROUTE_EXPORTS_1);
}

/** What a repo-relative file is to its project's router, if anything. */
export function moduleKind(project: QwikProject, file: string): ModuleKind | undefined {
  const name = posix.basename(file);
  const ext = posix.extname(name).toLowerCase();
  const extless = ext ? name.slice(0, -ext.length) : name;

  if (
    parent(file) === join(project.folder, 'src') &&
    /^entry\.[\w-]+$/.test(extless) &&
    (PAGE_MODULE.has(ext) || MODULE.has(ext))
  ) {
    return 'app-entry';
  }
  if (project.routers.size === 0) return undefined;

  if (
    parent(file) === project.serverPluginsDir &&
    (MODULE.has(ext) || PAGE_MODULE.has(ext)) &&
    /^plugin(|@.+)$/.test(extless) &&
    !/\.(test|unit|spec)(\.[jt]s)?$/.test(extless)
  ) {
    return 'plugin';
  }
  if (!inside(project.routesDir, file)) return undefined;

  const page = PAGE_MODULE.has(ext);
  const module = MODULE.has(ext);
  if (
    (/^index(|!|@.+)$/.test(extless) || isErrorPage(project.routers, extless)) &&
    (page || module || MARKDOWN.has(ext))
  ) {
    return 'route';
  }
  if (/^layout(|!|-.+)$/.test(extless) && (page || module)) return 'layout';
  if (extless === 'entry' && module) return 'entry';
  if (extless === 'service-worker' && module) return 'service-worker';
  return undefined;
}

/** 1.x: any status from 400 to 599 (read like `parseInt`); 2.x: `404` and `error`. */
function isErrorPage(routers: ReadonlySet<Major>, extless: string): boolean {
  if (routers.has(1)) {
    const status = Number(/^\d+/.exec(extless)?.[0]);
    if (status >= 400 && status <= 599) return true;
  }
  return routers.has(2) && /^(error|404)(|!|@.+)$/.test(extless);
}
