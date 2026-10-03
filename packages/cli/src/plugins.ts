import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CprError, PLUGIN_API_VERSION, type TsPlugin } from '@cpr/core';

/** The project's CPR settings, at the repository root. */
export const CONFIG_FILE = 'cpr.config.json';

/** A plugin to load and the folder its path is relative to. */
interface PluginRequest {
  spec: string;
  from: string;
  /** Where the request was made, for error messages. */
  origin: string;
}

/**
 * Loads the plugins asked for in `cpr.config.json` (paths relative to the repo root) and by
 * `--plugin` (relative to the working folder). A short name like `angular` is the package
 * `@cpr/plugin-angular`, looked up in the project first and then next to the CLI.
 */
export async function loadPlugins(
  flags: readonly string[],
  { cwd, repoRoot }: { cwd: string; repoRoot: string },
): Promise<TsPlugin[]> {
  const requests: PluginRequest[] = [
    ...readConfig(repoRoot).map((spec) => ({ spec, from: repoRoot, origin: CONFIG_FILE })),
    ...flags.map((spec) => ({ spec, from: cwd, origin: '--plugin' })),
  ];
  const plugins: TsPlugin[] = [];
  const files = new Set<string>();
  for (const request of requests) {
    const file = locate(request, repoRoot);
    if (files.has(file)) continue;
    files.add(file);
    const plugin = await importPlugin(file, request);
    if (plugins.some((p) => p.name === plugin.name)) {
      throw new CprError(`two plugins are named '${plugin.name}' (${request.spec})`);
    }
    plugins.push(plugin);
  }
  return plugins;
}

/** The `plugins` of `cpr.config.json`, if the file exists. */
function readConfig(repoRoot: string): string[] {
  const path = join(repoRoot, CONFIG_FILE);
  if (!existsSync(path)) return [];
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CprError(`${CONFIG_FILE}: ${(error as Error).message}`, { cause: error });
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new CprError(`${CONFIG_FILE}: expected an object like { "plugins": ["angular"] }`);
  }
  const plugins = (config as { plugins?: unknown }).plugins;
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins) || !plugins.every((p) => typeof p === 'string' && p !== '')) {
    throw new CprError(`${CONFIG_FILE}: "plugins" must be a list of plugin names or paths`);
  }
  return plugins as string[];
}

/** `angular` → `@cpr/plugin-angular`; scoped or qualified names stay as they are. */
export function pluginPackage(spec: string): string {
  return spec.startsWith('@') || spec.includes('/') ? spec : `@cpr/plugin-${spec}`;
}

function isPath(spec: string): boolean {
  return spec.startsWith('.') || isAbsolute(spec);
}

/** The plugin's entry file. */
function locate({ spec, from, origin }: PluginRequest, repoRoot: string): string {
  if (isPath(spec)) {
    const file = resolve(from, spec);
    if (!existsSync(file)) throw new CprError(`plugin ${spec} (${origin}): ${file} not found`);
    return file;
  }
  const name = pluginPackage(spec);
  // The project's own copy first, so it can pin a version; then the one shipped with the CLI.
  for (const base of [join(repoRoot, 'package.json'), import.meta.url]) {
    try {
      return createRequire(base).resolve(name);
    } catch {
      // try the next place
    }
  }
  throw new CprError(
    `plugin ${spec} (${origin}): cannot find the package ${name}; install it in the project ` +
      `(npm install --save-dev ${name}) or next to cpr`,
  );
}

async function importPlugin(file: string, { spec, origin }: PluginRequest): Promise<TsPlugin> {
  let module: { default?: unknown; plugin?: unknown };
  try {
    module = (await import(pathToFileURL(file).href)) as typeof module;
  } catch (error) {
    throw new CprError(`plugin ${spec} (${origin}): cannot load ${file}: ${String(error)}`, {
      cause: error,
    });
  }
  const plugin = module.default ?? module.plugin;
  if (!isPlugin(plugin)) {
    throw new CprError(
      `plugin ${spec} (${origin}): ${file} is not a CPR plugin ` +
        `(expected a default export with name, apiVersion and applies)`,
    );
  }
  const apiVersion: number = plugin.apiVersion;
  if (apiVersion !== PLUGIN_API_VERSION) {
    throw new CprError(
      `plugin ${plugin.name} targets plugin API ${apiVersion}, ` +
        `this cpr implements ${PLUGIN_API_VERSION}: use a version of the plugin made for it`,
    );
  }
  return plugin;
}

function isPlugin(value: unknown): value is TsPlugin {
  if (!value || typeof value !== 'object') return false;
  const plugin = value as Partial<Record<keyof TsPlugin, unknown>>;
  return (
    typeof plugin.name === 'string' &&
    plugin.name !== '' &&
    typeof plugin.apiVersion === 'number' &&
    typeof plugin.applies === 'function'
  );
}

/**
 * An Angular project reviewed without the Angular plugin, with changed templates: a hint, since
 * template users of component members are otherwise invisible. A template's project is the
 * nearest `package.json` above it, up to the repo root (repos can hold several apps).
 */
export function angularHint(
  plugins: readonly TsPlugin[],
  changedFiles: readonly { path: string }[],
  repoRoot: string,
): string | undefined {
  if (plugins.some((p) => p.name === 'angular')) return undefined;
  const templates = changedFiles.filter((f) => f.path.endsWith('.html'));
  const checked = new Map<string, boolean>();
  const usesAngular = (folder: string): boolean => {
    const known = checked.get(folder);
    if (known !== undefined) return known;
    const manifest = readManifest(join(repoRoot, folder, 'package.json'));
    const result = manifest
      ? [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some(
          (deps) => !!deps && typeof deps === 'object' && '@angular/core' in deps,
        )
      : folder !== '.' && usesAngular(posix.dirname(folder));
    checked.set(folder, result);
    return result;
  };
  return templates.some((f) => usesAngular(posix.dirname(f.path)))
    ? 'Angular project: add --plugin angular to analyze templates'
    : undefined;
}

function readManifest(
  path: string,
): { dependencies?: unknown; devDependencies?: unknown; peerDependencies?: unknown } | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
