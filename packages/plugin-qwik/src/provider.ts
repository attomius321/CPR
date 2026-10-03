import { posix } from 'node:path';
import type { PluginContext, ts } from '@cpr/core';
import { importsOf, unwrap } from './imports.js';
import type { QwikProject } from './projects.js';

/** A component the MDX provider gives every `.mdx` file: where to import it from. */
export interface Provided {
  /** A package name, or a repo-relative module file. */
  module: string;
  /** Whether `module` is a repo file (imported by a relative path) or a package. */
  file: boolean;
  /** The export's name; `default` for a default export. */
  name: string;
}

/** The MDX provider of a project: its module file and the components it gives, by tag. */
export interface MdxProvider {
  /** Repo-relative module file. */
  file: string;
  components: Map<string, Provided>;
}

/**
 * Reads the project's MDX provider by syntax: the module `providerImportSource` names, resolved
 * like an import from the project with its tsconfig, and the object its `useMDXComponents`
 * returns — `{ ...components, Term }` gives `<Term>`, imported where the provider imports it.
 */
export function mdxProvider(
  revision: PluginContext,
  project: QwikProject,
): MdxProvider | undefined {
  if (!project.mdxProvider) return undefined;
  const tsApi = revision.ts;
  const from = posix.join(revision.root, project.routesDir, '__cpr_provider.ts');
  const file = resolve(revision, project, project.mdxProvider, from);
  const text = file && revision.readFile(file);
  if (!file || text === undefined) return undefined;
  const sf = tsApi.createSourceFile(file, text, tsApi.ScriptTarget.Latest, true);
  const components = new Map<string, Provided>();
  for (const object of returnedObjects(tsApi, sf)) {
    for (const property of object.properties) {
      let key: string | undefined;
      let value: ts.Expression | undefined;
      if (tsApi.isShorthandPropertyAssignment(property)) {
        key = property.name.text;
        value = property.name;
      } else if (
        tsApi.isPropertyAssignment(property) &&
        (tsApi.isIdentifier(property.name) || tsApi.isStringLiteral(property.name))
      ) {
        key = property.name.text;
        value = property.initializer;
      }
      const source = key && value ? origin(revision, project, sf, file, value) : undefined;
      if (key && source) components.set(key, source);
    }
  }
  return { file, components };
}

/** Objects `useMDXComponents` returns: `return { … }` or `=> ({ … })`. */
function returnedObjects(tsApi: typeof ts, sf: ts.SourceFile): ts.ObjectLiteralExpression[] {
  let body: ts.ConciseBody | undefined;
  for (const statement of sf.statements) {
    if (tsApi.isFunctionDeclaration(statement) && statement.name?.text === 'useMDXComponents') {
      body = statement.body;
    } else if (tsApi.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value = unwrap(tsApi, declaration.initializer);
        if (
          tsApi.isIdentifier(declaration.name) &&
          declaration.name.text === 'useMDXComponents' &&
          value &&
          (tsApi.isArrowFunction(value) || tsApi.isFunctionExpression(value))
        ) {
          body = value.body;
        }
      }
    }
  }
  if (!body) return [];
  const objects: ts.ObjectLiteralExpression[] = [];
  const add = (node: ts.Expression | undefined) => {
    const value = unwrap(tsApi, node);
    if (value && tsApi.isObjectLiteralExpression(value)) objects.push(value);
  };
  if (!tsApi.isBlock(body)) {
    add(body);
    return objects;
  }
  const visit = (node: ts.Node): void => {
    if (tsApi.isReturnStatement(node)) add(node.expression);
    // Returns of nested functions are not the provider's.
    if (!tsApi.isFunctionLike(node)) tsApi.forEachChild(node, visit);
  };
  tsApi.forEachChild(body, visit);
  return objects;
}

/** Where the provider gets a component: what it imports, or its own export. */
function origin(
  revision: PluginContext,
  project: QwikProject,
  sf: ts.SourceFile,
  file: string,
  value: ts.Expression,
): Provided | undefined {
  const tsApi = revision.ts;
  const imports = importsOf(tsApi, sf);
  let local: string | undefined;
  let member: string | undefined;
  if (tsApi.isIdentifier(value)) local = value.text;
  else if (tsApi.isPropertyAccessExpression(value) && tsApi.isIdentifier(value.expression)) {
    local = value.expression.text;
    member = value.name.text;
  }
  if (!local) return undefined;
  const from = posix.join(revision.root, file);
  if (member) {
    const module = imports.namespaces.get(local);
    return module ? place(revision, project, module, from, member) : undefined;
  }
  const imported = imports.named.get(local);
  if (imported) return place(revision, project, imported.module, from, imported.imported);
  const defaultImport = defaultImportOf(tsApi, sf, local);
  if (defaultImport) return place(revision, project, defaultImport, from, 'default');
  // Declared by the provider itself: importable if exported.
  return exports(tsApi, sf, local) ? { module: file, file: true, name: local } : undefined;
}

function place(
  revision: PluginContext,
  project: QwikProject,
  module: string,
  from: string,
  name: string,
): Provided | undefined {
  if (!module.startsWith('.') && !module.startsWith('/')) {
    // A path alias of the project, or a package.
    const file = resolve(revision, project, module, from);
    return file ? { module: file, file: true, name } : { module, file: false, name };
  }
  const file = resolve(revision, project, module, from);
  return file ? { module: file, file: true, name } : undefined;
}

function defaultImportOf(tsApi: typeof ts, sf: ts.SourceFile, local: string): string | undefined {
  for (const statement of sf.statements) {
    if (
      tsApi.isImportDeclaration(statement) &&
      tsApi.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.name?.text === local
    ) {
      return statement.moduleSpecifier.text;
    }
  }
  return undefined;
}

function exports(tsApi: typeof ts, sf: ts.SourceFile, name: string): boolean {
  for (const statement of sf.statements) {
    const exported =
      tsApi.canHaveModifiers(statement) &&
      (tsApi.getModifiers(statement) ?? []).some((m) => m.kind === tsApi.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (tsApi.isVariableStatement(statement)) {
      if (
        statement.declarationList.declarations.some(
          (d) => tsApi.isIdentifier(d.name) && d.name.text === name,
        )
      ) {
        return true;
      }
    } else if (
      (tsApi.isFunctionDeclaration(statement) || tsApi.isClassDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A module name resolved like an import from `from` (absolute) with the project's compiler
 * options: a repo-relative file, or undefined for a package or anything not found in the repo.
 */
function resolve(
  revision: PluginContext,
  project: QwikProject,
  module: string,
  from: string,
): string | undefined {
  const tsApi = revision.ts;
  const options = compilerOptions(revision, project);
  const resolved = tsApi.resolveModuleName(module, from, options, tsApi.sys).resolvedModule;
  const target = resolved?.resolvedFileName;
  if (!target || target.includes('/node_modules/') || !target.startsWith(`${revision.root}/`)) {
    return undefined;
  }
  return target.slice(revision.root.length + 1);
}

const optionsByProject = new WeakMap<QwikProject, ts.CompilerOptions>();

/** The project's `tsconfig.json` options (`extends` followed), or the root's. */
function compilerOptions(revision: PluginContext, project: QwikProject): ts.CompilerOptions {
  const cached = optionsByProject.get(project);
  if (cached) return cached;
  const tsApi = revision.ts;
  let options: ts.CompilerOptions = {
    moduleResolution: tsApi.ModuleResolutionKind.Bundler,
    module: tsApi.ModuleKind.ESNext,
  };
  for (const folder of [project.folder, '']) {
    const path = posix.join(revision.root, folder, 'tsconfig.json');
    if (!tsApi.sys.fileExists(path)) continue;
    const parsed = tsApi.getParsedCommandLineOfConfigFile(
      path,
      {},
      {
        ...tsApi.sys,
        readDirectory: () => [],
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );
    if (parsed) options = { ...options, ...parsed.options };
    break;
  }
  optionsByProject.set(project, options);
  return options;
}
