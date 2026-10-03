import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { readJsonFile, workspaceMatcher, workspacePatterns } from './workspace.js';

export type ProjectKind = 'application' | 'library';

/** What makes a folder a project. */
export type ProjectSource = 'workspace' | 'nx' | 'plugin' | 'package' | 'tsconfig' | 'root';

/**
 * An app or library of the repository. A file belongs to the project with the longest folder
 * that holds it.
 */
export interface Project {
  /** Repo-relative folder; `''` for the root. */
  folder: string;
  name: string;
  /** Only when declared (Nx `projectType`, a plugin). */
  kind?: ProjectKind;
  source: ProjectSource;
  /** The plugin that declared it, with source `plugin`. */
  plugin?: string;
}

/** A project a framework declares through a plugin, e.g. one of `angular.json`'s. */
export interface DeclaredProject {
  /** Repo-relative folder; `''` for the root. */
  folder: string;
  name: string;
  kind?: ProjectKind;
  plugin: string;
}

/** The nearest project of each rule, for one folder. */
interface Nearest {
  declared?: Project;
  package?: Project;
  tsconfig?: Project;
}

/**
 * The project of a repo-relative path in the revision at `root`; the first rule that finds one
 * wins, each taking the nearest folder at or above the path's:
 * 1. declared: workspace members, Nx `project.json` files (with an `nx.json` at the root) and
 *    `declared`; one folder declared several ways is one project;
 * 2. only when the repo declares nothing: a package — a `package.json` with a name,
 *    dependencies or scripts, not a `{ "type": "module" }` marker;
 * 3. a folder with its own `tsconfig.json`;
 * 4. the root.
 * Markers are read once per folder.
 */
export function projectResolver(
  root: string,
  declared: readonly DeclaredProject[] = [],
): (path: string) => Project {
  const patterns = workspacePatterns(root);
  const member = workspaceMatcher(patterns);
  const nx = existsSync(join(root, 'nx.json'));
  const byPlugin = new Map<string, DeclaredProject>();
  for (const project of declared) {
    if (!byPlugin.has(project.folder)) byPlugin.set(project.folder, project);
  }
  const declares = patterns.length > 0 || nx || byPlugin.size > 0;
  const rootManifest = manifestAt(root, '');
  const rootProject: Project = {
    folder: '',
    name: typeof rootManifest?.name === 'string' ? rootManifest.name : 'repository root',
    source: 'root',
  };

  const nearest = new Map<string, Nearest>();
  const nearestAt = (folder: string): Nearest => {
    const cached = nearest.get(folder);
    if (cached) return cached;
    const own = markers(folder);
    const parent = folder === '' ? {} : nearestAt(parentOf(folder));
    const found: Nearest = {
      declared: own.declared ?? parent.declared,
      package: own.package ?? parent.package,
      tsconfig: own.tsconfig ?? parent.tsconfig,
    };
    nearest.set(folder, found);
    return found;
  };

  const markers = (folder: string): Nearest => {
    const dir = join(root, folder);
    const hasManifest = existsSync(join(dir, 'package.json'));
    const manifest = hasManifest ? manifestAt(root, folder) : undefined;
    const name = folder === '' ? rootProject.name : posix.basename(folder);
    const found: Nearest = {};

    const nxProject = nx ? manifestAt(root, folder, 'project.json') : undefined;
    const plugin = byPlugin.get(folder);
    const workspace = folder !== '' && hasManifest && member(folder);
    if (nxProject || plugin || workspace) {
      const kind = projectKind(nxProject?.projectType) ?? plugin?.kind;
      found.declared = {
        folder,
        name: stringOr(nxProject?.name, plugin?.name, manifest?.name) ?? name,
        ...(kind ? { kind } : {}),
        source: nxProject ? 'nx' : plugin ? 'plugin' : 'workspace',
        ...(!nxProject && plugin ? { plugin: plugin.plugin } : {}),
      };
    }
    if (folder === '') return found;
    if (!declares && manifest && isPackage(manifest)) {
      found.package = { folder, name: stringOr(manifest.name) ?? name, source: 'package' };
    }
    if (existsSync(join(dir, 'tsconfig.json'))) {
      found.tsconfig = { folder, name, source: 'tsconfig' };
    }
    return found;
  };

  return (path) => {
    const at = nearestAt(parentOf(path));
    return at.declared ?? at.package ?? at.tsconfig ?? rootProject;
  };
}

/** One side of a change, for `changeProjects`. */
export interface ProjectSide {
  /** Absolute revision root. */
  root: string;
  /** Projects its plugins declare; asked only when a file is read from this side. */
  declared: () => readonly DeclaredProject[];
}

/**
 * The projects holding `paths` (repo-relative files), sorted by folder: read from head for the
 * files head has, from base for the others. One per folder, head's when both have one.
 */
export function changeProjects(
  paths: Iterable<string>,
  head: ProjectSide,
  base: ProjectSide,
): Project[] {
  let headOf: ((path: string) => Project) | undefined;
  let baseOf: ((path: string) => Project) | undefined;
  const inHead: Project[] = [];
  const inBase: Project[] = [];
  for (const path of new Set(paths)) {
    if (existsSync(join(head.root, path))) {
      headOf ??= projectResolver(head.root, head.declared());
      inHead.push(headOf(path));
    } else {
      baseOf ??= projectResolver(base.root, base.declared());
      inBase.push(baseOf(path));
    }
  }
  const byFolder = new Map<string, Project>();
  for (const project of [...inHead, ...inBase]) {
    if (!byFolder.has(project.folder)) byFolder.set(project.folder, project);
  }
  return [...byFolder.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}

const parentOf = (path: string) => {
  const parent = posix.dirname(path);
  return parent === '.' ? '' : parent;
};

function manifestAt(
  root: string,
  folder: string,
  file = 'package.json',
): Record<string, unknown> | undefined {
  const value = readJsonFile(join(root, folder, file));
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A package, not a marker such as `{ "type": "module" }`. */
function isPackage(manifest: Record<string, unknown>): boolean {
  return (
    typeof manifest.name === 'string' ||
    ['dependencies', 'devDependencies', 'peerDependencies', 'scripts'].some(
      (field) => manifest[field] && typeof manifest[field] === 'object',
    )
  );
}

function projectKind(value: unknown): ProjectKind | undefined {
  return value === 'application' || value === 'library' ? value : undefined;
}

function stringOr(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value !== '');
}
