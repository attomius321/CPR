import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Project, ts } from 'ts-morph';
import type { LoadOptions } from '../../adapter.js';
import { CprError } from '../../errors.js';
import { loadIgnores } from '../../ignore.js';
import type { SymbolId } from '../../model.js';
import type { RevisionSource } from '../../revision.js';
import { isTsSource } from './files.js';

export interface TsRevision {
  /** Absolute revision root, without a trailing slash. */
  root: string;
  project: Project;
  /** Language service; every node, the checker and reference search share its program. */
  service: ts.LanguageService;
  program: ts.Program;
  /** Declaration nodes of extracted symbols, for reference search. */
  declarations: Map<SymbolId, ts.Node[]>;
  warnings: string[];
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', '.git']);
const MAX_DEPTH = 5;

/** Options we force on every project, whatever its tsconfig says. */
const OVERRIDES: ts.CompilerOptions = {
  noEmit: true,
  // Analyze JS files too, even in TS projects; without this the program drops them.
  allowJs: true,
  checkJs: false,
  // Old configs (baseUrl, moduleResolution node, target es5) still work in TS 6.0 but warn.
  ignoreDeprecations: '6.0',
};

/** Used when the repo has no tsconfig at all. */
const DEFAULTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
};

/**
 * Loads a revision as one ts-morph project: the root tsconfig plus every tsconfig it references
 * or that lives in the repo (outside ignored folders). Without a root tsconfig, the configs
 * below it are loaded with default options; without any, every source file is.
 * Workspace packages resolve to their sources in this revision through `paths`. `files` are
 * added up front, so the program never changes after loading.
 */
export function loadTsProject(
  source: RevisionSource,
  { project, files = [] }: LoadOptions = {},
): TsRevision {
  const root = resolve(source.root);
  const warnings: string[] = [];
  const configPath = project ? join(root, project) : join(root, 'tsconfig.json');
  if (project && !existsSync(configPath)) throw new CprError(`project file not found: ${project}`);
  const workspace = workspacePaths(root);
  const ignored = loadIgnores(root);
  // Folders are passed with a trailing `/`, so `**/playground/**` prunes the whole folder.
  const notIgnored = (path: string) => {
    const rel = repoPath(root, path);
    return rel === undefined || !ignored(path.endsWith('/') ? `${rel}/` : rel);
  };
  const addConfigs = (tsProject: Project, configs: string[]) => {
    for (const config of configs) {
      try {
        tsProject.addSourceFilesFromTsConfig(config);
      } catch (error) {
        warnings.push(`could not load ${repoPath(root, config)}: ${(error as Error).message}`);
      }
    }
  };

  let tsProject: Project;
  if (existsSync(configPath)) {
    tsProject = new Project({
      tsConfigFilePath: configPath,
      compilerOptions: { ...OVERRIDES, paths: { ...workspace, ...configPaths(configPath) } },
    });
    const others = project
      ? referencedConfigs(configPath)
      : [...referencedConfigs(configPath), ...findFiles(root, isConfig, notIgnored)];
    addConfigs(
      tsProject,
      [...new Set(others)].filter((c) => c !== configPath),
    );
  } else {
    tsProject = new Project({ compilerOptions: { ...DEFAULTS, ...OVERRIDES, paths: workspace } });
    const configs = findFiles(root, isConfig, notIgnored);
    if (configs.length > 0) addConfigs(tsProject, configs);
    else
      for (const file of findFiles(root, isTsSource, notIgnored))
        tsProject.addSourceFileAtPath(file);
  }

  for (const file of files) {
    if (isTsSource(file)) tsProject.addSourceFileAtPathIfExists(join(root, file));
  }

  const service = tsProject.getLanguageService().compilerObject;
  const program = service.getProgram();
  if (!program) throw new Error('TypeScript did not create a program');
  for (const file of files) {
    const path = join(root, file);
    if (isTsSource(file) && existsSync(path) && !program.getSourceFile(path)) {
      warnings.push(`${file}: not part of the TypeScript program, skipped`);
    }
  }
  return { root, project: tsProject, service, program, declarations: new Map(), warnings };
}

/** Repo-relative POSIX path, or undefined outside the root. */
export function repoPath(root: string, path: string): string | undefined {
  const rel = relative(root, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}

/** All tsconfig files reachable through `references`, depth first, without repeats. */
function referencedConfigs(configPath: string, seen = new Set<string>([configPath])): string[] {
  const config = readJson(configPath) as { references?: { path?: unknown }[] } | undefined;
  const found: string[] = [];
  for (const { path } of config?.references ?? []) {
    if (typeof path !== 'string') continue;
    let target = resolve(dirname(configPath), path);
    if (!target.endsWith('.json')) target = join(target, 'tsconfig.json');
    if (seen.has(target) || !existsSync(target)) continue;
    seen.add(target);
    found.push(target, ...referencedConfigs(target, seen));
  }
  return found;
}

/** The config's own `paths`, made absolute, so they can be merged with workspace paths. */
function configPaths(configPath: string): Record<string, string[]> {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => undefined,
    },
  );
  const options = parsed?.options;
  if (!options?.paths) return {};
  const base =
    options.baseUrl ?? (options as { pathsBasePath?: string }).pathsBasePath ?? dirname(configPath);
  return Object.fromEntries(
    Object.entries(options.paths).map(([pattern, targets]) => [
      pattern,
      targets.map((target) => resolve(base, target)),
    ]),
  );
}

/**
 * `paths` entries mapping each workspace package (a package.json below the root) to its
 * sources in this revision, so cross-package imports resolve here even when the package's
 * `types` point at an unbuilt `dist/` or `node_modules` links to another checkout.
 */
function workspacePaths(root: string): Record<string, string[]> {
  const patterns = workspacePatterns(root);
  if (patterns.length === 0) return {};
  const include = patterns.filter((p) => !p.startsWith('!')).map(globRegExp);
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => globRegExp(p.slice(1)));

  const paths: Record<string, string[]> = {};
  for (const manifest of findFiles(root, (name) => name === 'package.json')) {
    const dir = dirname(manifest);
    const rel = repoPath(root, dir);
    if (!rel || !include.some((r) => r.test(rel)) || exclude.some((r) => r.test(rel))) continue;
    const pkg = readJson(manifest) as Record<string, unknown> | undefined;
    if (typeof pkg?.name !== 'string') continue;
    const entry = sourceEntry(dir, pkg);
    if (!entry) continue;
    paths[pkg.name] = [entry];
    paths[`${pkg.name}/*`] = [join(dir, 'src', '*'), join(dir, '*')];
  }
  return paths;
}

/** Workspace globs from package.json `workspaces` or pnpm-workspace.yaml `packages`. */
function workspacePatterns(root: string): string[] {
  const pkg = readJson(join(root, 'package.json')) as { workspaces?: unknown } | undefined;
  const workspaces = pkg?.workspaces;
  const list = Array.isArray(workspaces)
    ? workspaces
    : (workspaces as { packages?: unknown } | undefined)?.packages;
  const patterns = Array.isArray(list)
    ? list.filter((p): p is string => typeof p === 'string')
    : [];

  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) {
    let inPackages = false;
    for (const line of readFileSync(pnpm, 'utf8').split('\n')) {
      if (/^\S/.test(line)) inPackages = /^packages\s*:/.test(line);
      const item = inPackages ? /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line) : null;
      if (item?.[1]) patterns.push(item[1]);
    }
  }
  return patterns.map((p) => p.replace(/^\.\//, '').replace(/\/$/, ''));
}

/** `packages/*` → matches `packages/a`; `**` matches any depth. */
function globRegExp(glob: string): RegExp {
  const source = glob
    .split('/')
    .map((part) =>
      part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'),
    )
    .join('/');
  return new RegExp(`^${source}$`);
}

export function sourceEntry(dir: string, pkg: Record<string, unknown>): string | undefined {
  const candidates = [
    pkg.source,
    exportsEntry(pkg.exports),
    pkg.types,
    pkg.typings,
    pkg.module,
    pkg.main,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    for (const path of sourceCandidates(candidate)) {
      if (existsSync(join(dir, path))) return join(dir, path);
    }
  }
  for (const path of ['src/index.ts', 'src/index.tsx', 'index.ts', 'src/index.js', 'index.js']) {
    if (existsSync(join(dir, path))) return join(dir, path);
  }
  return undefined;
}

function exportsEntry(exports: unknown, depth = 0): unknown {
  if (typeof exports === 'string' || depth > 3 || !exports || typeof exports !== 'object') {
    return exports;
  }
  const map = exports as Record<string, unknown>;
  const main = '.' in map ? map['.'] : map;
  if (typeof main === 'string' || !main || typeof main !== 'object') return main;
  const conditions = main as Record<string, unknown>;
  for (const key of ['source', 'types', 'import', 'default', 'require']) {
    if (key in conditions) return exportsEntry(conditions[key], depth + 1);
  }
  return undefined;
}

/** `./dist/index.d.ts` → `src/index.ts`, `src/index.tsx`, …: where the source probably is. */
function sourceCandidates(path: string): string[] {
  const clean = path.replace(/^\.\//, '');
  if (/\.(?:[cm]?ts|tsx)$/.test(clean) && !/\.d\.[cm]?ts$/.test(clean)) return [clean];
  const stem = clean.replace(/(?:\.d)?\.[cm]?[jt]s$/, '');
  const inSrc = stem.replace(/^(?:dist|build|lib|out|esm|cjs)\//, 'src/');
  return [...new Set([inSrc, stem])].flatMap((s) => [`${s}.ts`, `${s}.tsx`, `${s}.js`]);
}

const isConfig = (name: string) => name === 'tsconfig.json';

/**
 * Files under `root` whose name matches, skipping dependency, build and hidden folders and
 * paths `keep` rejects (checked for folders and files).
 */
function findFiles(
  root: string,
  match: (name: string) => boolean,
  keep: (path: string) => boolean = () => true,
): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && match(entry.name) && keep(path)) found.push(path);
      else if (
        entry.isDirectory() &&
        depth < MAX_DEPTH &&
        !SKIPPED_DIRS.has(entry.name) &&
        !entry.name.startsWith('.') &&
        keep(`${path}/`)
      ) {
        walk(path, depth + 1);
      }
    }
  };
  walk(root, 0);
  return found.sort();
}

export function readJson(path: string): unknown {
  try {
    return ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8')).config as unknown;
  } catch {
    return undefined;
  }
}
