import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { PluginContext, SymbolDecl, ts, VirtualFile } from '@cpr/core';
import { scanMdx, type MdxCode } from './mdx.js';
import { mdxShim, Positions, RENDER, templateId } from './mdx-shim.js';
import type { Projects } from './projects.js';
import { mdxProvider } from './provider.js';

export interface MdxRoute {
  file: string;
  text: string;
  code: MdxCode;
  shim: VirtualFile;
}

export interface MdxRoutes {
  byFile: Map<string, MdxRoute>;
  /** Repo-relative MDX provider modules: the router's MDX compiler imports them. */
  providers: Set<string>;
  warnings: string[];
}

/**
 * The `.mdx` files under the routes folders of a revision's Qwik apps that hold code (imports,
 * exports, components, expressions), each with its shim. Prose-only files are left out: there is
 * nothing in them to analyze.
 */
export function mdxRoutes(revision: PluginContext, projects: Projects): MdxRoutes {
  const routes: MdxRoutes = { byFile: new Map(), providers: new Set(), warnings: [] };
  for (const file of revision.sourceFiles()) projects.of(file);
  const sys = revision.ts.sys;
  for (const project of projects.known()) {
    if (project.routers.size === 0) continue;
    const dir = posix.join(revision.root, project.routesDir);
    if (!sys.directoryExists(dir)) continue;
    const provider = mdxProvider(revision, project);
    if (provider) routes.providers.add(provider.file);
    for (const path of sys.readDirectory(dir, ['.mdx'], ['**/node_modules'])) {
      const file = posix.relative(revision.root, path);
      if (routes.byFile.has(file)) continue;
      const text = revision.readFile(file);
      if (text === undefined) continue;
      const code = scanMdx(text);
      if (code.error) routes.warnings.push(`${file}: ${code.error}; read up to there`);
      if (code.esm.length + code.elements.length + code.expressions.length === 0) continue;
      const shim = mdxShim(revision.ts, file, text, code, provider?.components);
      routes.byFile.set(file, { file, text, code, shim });
    }
  }
  return routes;
}

/**
 * An MDX route as a template symbol, hashed over its code parts only: a prose edit is no
 * change; an import, element or expression edit is one (formatting aside).
 */
export function mdxSymbol(tsApi: typeof ts, route: MdxRoute): SymbolDecl {
  const tokens = codeTokens(tsApi, route.code);
  const end = new Positions(route.text).of(route.text.length);
  return {
    id: templateId(route.file),
    kind: 'template',
    name: '(template)',
    container: null,
    exported: false,
    file: route.file,
    range: { start: { line: 1, col: 1 }, end },
    signature: 'MDX route',
    hashes: { signature: hash(['mdx']), body: hash(tokens) },
    bodySize: tokens.length,
  };
}

/** The shim's nodes standing for the route: its render function and the file's exports. */
export function mdxNodes(tsApi: typeof ts, shim: ts.SourceFile): ts.Node[] {
  return shim.statements.filter(
    (statement) =>
      (tsApi.isFunctionDeclaration(statement) && statement.name?.text === RENDER) ||
      tsApi.isExportAssignment(statement) ||
      tsApi.isExportDeclaration(statement) ||
      (tsApi.canHaveModifiers(statement) &&
        !(tsApi.isFunctionDeclaration(statement) && statement.name?.text === RENDER) &&
        (tsApi.getModifiers(statement) ?? []).some(
          (m) => m.kind === tsApi.SyntaxKind.ExportKeyword,
        )),
  );
}

/** Tokens of every code part in file order, quote style aside. */
function codeTokens(tsApi: typeof ts, code: MdxCode): string[] {
  const parts = [...code.esm, ...code.elements, ...code.expressions].sort(
    (a, b) => a.start - b.start,
  );
  const tokens: string[] = [];
  const scanner = tsApi.createScanner(tsApi.ScriptTarget.Latest, true, tsApi.LanguageVariant.JSX);
  for (const part of parts) {
    scanner.setText(part.text);
    for (
      let kind = scanner.scan();
      kind !== tsApi.SyntaxKind.EndOfFileToken;
      kind = scanner.scan()
    ) {
      tokens.push(
        kind === tsApi.SyntaxKind.StringLiteral
          ? JSON.stringify(scanner.getTokenValue())
          : scanner.getTokenText(),
      );
    }
    tokens.push('\u0000');
  }
  return tokens;
}

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}
