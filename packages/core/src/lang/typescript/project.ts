import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Project, ts } from 'ts-morph';
import { CprError } from '../../errors.js';
import type { LoadOptions } from '../../adapter.js';
import type { RevisionSource } from '../../revision.js';

export interface TsRevision {
  /** Absolute revision root, without a trailing slash. */
  root: string;
  project: Project;
}

const SOURCE_GLOB = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const IGNORED_DIRS = ['node_modules', 'dist', 'build', 'coverage', 'out', '.git'];

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
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.Preserve,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
};

/**
 * Loads a revision as one ts-morph project: the root tsconfig (following its `references`), or
 * every source file with default options when there is none.
 */
export function loadTsProject(source: RevisionSource, { project }: LoadOptions = {}): TsRevision {
  const root = resolve(source.root);
  const configPath = project ? join(root, project) : join(root, 'tsconfig.json');
  if (project && !existsSync(configPath)) throw new CprError(`project file not found: ${project}`);

  if (!existsSync(configPath)) {
    const tsProject = new Project({ compilerOptions: { ...DEFAULTS, ...OVERRIDES } });
    tsProject.addSourceFilesAtPaths([
      join(root, SOURCE_GLOB),
      ...IGNORED_DIRS.map((dir) => `!${join(root, '**', dir, '**')}`),
    ]);
    return { root, project: tsProject };
  }

  const tsProject = new Project({ tsConfigFilePath: configPath, compilerOptions: OVERRIDES });
  for (const reference of referencedConfigs(configPath)) {
    tsProject.addSourceFilesFromTsConfig(reference);
  }
  return { root, project: tsProject };
}

/** All tsconfig files reachable through `references`, depth first, without repeats. */
function referencedConfigs(configPath: string, seen = new Set<string>([configPath])): string[] {
  const { config } = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8')) as {
    config?: { references?: { path?: unknown }[] };
  };
  const references = config?.references;
  const found: string[] = [];
  for (const { path } of references ?? []) {
    if (typeof path !== 'string') continue;
    let target = resolve(dirname(configPath), path);
    if (!target.endsWith('.json')) target = join(target, 'tsconfig.json');
    if (seen.has(target) || !existsSync(target)) continue;
    seen.add(target);
    found.push(target, ...referencedConfigs(target, seen));
  }
  return found;
}
