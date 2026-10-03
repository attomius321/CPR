import { dirname, resolve } from 'node:path';
import { ts, type ResolutionHostFactory } from 'ts-morph';

/** A folder's configs in the order its build picks them; anything else named `tsconfig.*.json` after. */
const PREFERRED = ['tsconfig.app.json', 'tsconfig.lib.json', 'tsconfig.json'];
/** What tests are built with. */
const TEST_CONFIGS = ['tsconfig.spec.json', 'tsconfig.test.json', 'tsconfig.e2e.json'];
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$|(?:^|\/)e2e\//;

/** `tsconfig.json`, `tsconfig.app.json`, `tsconfig.base.json`… */
export const isAnyConfig = (name: string): boolean => /^tsconfig(?:\.[\w-]+)?\.json$/.test(name);

interface ProjectConfig {
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  /** `baseUrl` and absolute `paths`: what makes its non-relative imports its own. */
  key: string;
}

export interface ProjectResolutionOptions {
  root: string;
  /** Every config found in the repo (absolute paths). */
  configs: readonly string[];
  /** The config the program is created from, if any: its files resolve as they always did. */
  rootConfig: string | undefined;
  /** Options CPR forces on every project. */
  overrides: ts.CompilerOptions;
  /** Workspace packages mapped to their sources, for every project. */
  workspace: Record<string, string[]>;
}

/**
 * Module resolution per project, for repos holding several: a file's imports resolve with the
 * options of the config its project is built with — the nearest folder's `tsconfig.app.json`,
 * `tsconfig.lib.json` or `tsconfig.json` (tests: their spec config) — and, if that finds
 * nothing, as they would without it. Undefined when no config's `paths` or `baseUrl` differ from
 * the root project's: then nothing changes at all.
 */
export function projectResolution(
  params: ProjectResolutionOptions,
): ResolutionHostFactory | undefined {
  const { root, rootConfig, overrides, workspace } = params;
  const byFolder = new Map<string, string[]>();
  for (const config of params.configs) {
    const folder = dirname(config);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), config]);
  }

  const parsed = new Map<string, ProjectConfig | null>();
  const configOf = (path: string): ProjectConfig | null => {
    let config = parsed.get(path);
    if (config === undefined) {
      const options = parseOptions(path);
      const merged = options && {
        ...options,
        ...overrides,
        paths: { ...workspace, ...(options.paths ?? {}) },
      };
      config =
        options && merged
          ? {
              options: merged,
              cache: ts.createModuleResolutionCache(dirname(path), (f) => f, merged),
              key: aliasKey(options, path),
            }
          : null;
      parsed.set(path, config);
    }
    return config;
  };

  const rootKey = rootConfig
    ? (configOf(rootConfig)?.key ?? aliasKey({}, rootConfig))
    : aliasKey({}, root);
  const own = (config: ProjectConfig | null): config is ProjectConfig =>
    !!config && config.key !== rootKey && config.key !== aliasKey({}, '');
  if (!params.configs.some((path) => own(configOf(path)))) return undefined;

  // The project config of each folder (and whether for tests), walking up to the root.
  const owners = new Map<string, ProjectConfig | null>();
  const ownerOf = (file: string): ProjectConfig | null => {
    const test = TEST_FILE.test(file);
    const start = dirname(file);
    const key = `${test ? 't' : 'f'}\0${start}`;
    const cached = owners.get(key);
    if (cached !== undefined) return cached;
    let found: ProjectConfig | null = null;
    for (let folder = start; ; folder = dirname(folder)) {
      const configs = byFolder.get(folder);
      const pick = configs && pickConfig(configs, test);
      if (pick) {
        found = configOf(pick);
        break;
      }
      if (folder === root || dirname(folder) === folder || !folder.startsWith(root)) break;
    }
    owners.set(key, found);
    return found;
  };

  return (host, getCompilerOptions) => {
    let fallbackCache: ts.ModuleResolutionCache | undefined;
    const modes = new WeakMap<ts.SourceFile, Map<string, ts.ResolutionMode>>();
    return {
      resolveModuleNames(
        names,
        containingFile,
        _reused,
        redirected,
        _options,
        containingSourceFile,
      ) {
        const options = getCompilerOptions();
        fallbackCache ??= ts.createModuleResolutionCache(root, (f) => f, options);
        // Dependencies resolve as they always did; repo files with their project's options.
        const project = containingFile.includes('/node_modules/') ? null : ownerOf(containingFile);
        const useOwn = own(project);
        return names.map((name) => {
          const mode = containingSourceFile
            ? modeOf(modes, containingSourceFile, name, options)
            : undefined;
          if (useOwn) {
            const found = ts.resolveModuleName(
              name,
              containingFile,
              project.options,
              host,
              project.cache,
              redirected,
              mode,
            ).resolvedModule;
            if (found) return found;
          }
          return ts.resolveModuleName(
            name,
            containingFile,
            options,
            host,
            fallbackCache,
            redirected,
            mode,
          ).resolvedModule;
        });
      },
    };
  };
}

/** The config a folder's build uses for a file: tests prefer their spec config. */
function pickConfig(configs: readonly string[], test: boolean): string | undefined {
  const named = (name: string) => configs.find((c) => c.endsWith(`/${name}`) || c === name);
  for (const name of test ? [...TEST_CONFIGS, ...PREFERRED] : PREFERRED) {
    const found = named(name);
    if (found) return found;
  }
  // Something else (`tsconfig.base.json`, `tsconfig.build.json`): the first, but never a test
  // config for application code.
  return configs.find((c) => test || !TEST_CONFIGS.some((name) => c.endsWith(`/${name}`)));
}

/** A config's options (`extends` followed); its file list is not needed, so not globbed. */
function parseOptions(path: string): ts.CompilerOptions | undefined {
  try {
    return ts.getParsedCommandLineOfConfigFile(
      path,
      {},
      {
        ...ts.sys,
        readDirectory: () => [],
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    )?.options;
  } catch {
    return undefined;
  }
}

/** `baseUrl` and `paths` with absolute targets: two configs with the same key resolve alike. */
function aliasKey(options: ts.CompilerOptions, configPath: string): string {
  const base =
    options.baseUrl ??
    (options as { pathsBasePath?: string }).pathsBasePath ??
    (configPath ? dirname(configPath) : '');
  const paths = Object.entries(options.paths ?? {})
    .map(([pattern, targets]) => [pattern, targets.map((t) => resolve(base, t))])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  return JSON.stringify({ baseUrl: options.baseUrl ?? null, paths });
}

/** Whether an import is ESM or CommonJS where that matters (`node16`, `nodenext`). */
function modeOf(
  cache: WeakMap<ts.SourceFile, Map<string, ts.ResolutionMode>>,
  file: ts.SourceFile,
  name: string,
  options: ts.CompilerOptions,
): ts.ResolutionMode {
  let modes = cache.get(file);
  if (!modes) {
    modes = new Map();
    for (const statement of file.statements) {
      const specifier =
        ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
          ? statement.moduleSpecifier
          : ts.isImportEqualsDeclaration(statement) &&
              ts.isExternalModuleReference(statement.moduleReference)
            ? statement.moduleReference.expression
            : undefined;
      if (specifier && ts.isStringLiteral(specifier) && !modes.has(specifier.text)) {
        modes.set(specifier.text, ts.getModeForUsageLocation(file, specifier, options));
      }
    }
    cache.set(file, modes);
  }
  return modes.get(name);
}

/** Configs referenced by a solution-style config (`files: []`, no `include`), which loads none. */
export function isSolutionStyle(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const { files, include } = config as { files?: unknown; include?: unknown };
  return Array.isArray(files) && files.length === 0 && include === undefined;
}
