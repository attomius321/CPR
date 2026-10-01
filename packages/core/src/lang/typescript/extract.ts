import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ts } from 'ts-morph';
import type { Range, SymbolDecl, SymbolId, SymbolKind } from '../../model.js';
import type { TsRevision } from './project.js';
import { listTokens, tokens } from './tokens.js';

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_FILE = /\.d\.[cm]?ts$|\.min\.js$/;

/** Files the TypeScript adapter analyzes: TS and JS sources, but not declarations or bundles. */
export function isTsSource(path: string): boolean {
  return SOURCE_FILE.test(path) && !SKIPPED_FILE.test(path);
}

/** Merged declarations (overloads, declaration merging) take the kind that comes first. */
const KIND_ORDER: SymbolKind[] = [
  'class',
  'function',
  'enum',
  'namespace',
  'interface',
  'type',
  'method',
  'constructor',
  'accessor',
  'property',
  'variable',
];

const TYPE_FLAGS =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

const MAX_DISPLAY = 300;

interface Part {
  kind: SymbolKind;
  start: number;
  end: number;
  signature: string[];
  body: string[];
  display: string;
}

interface Builder {
  id: SymbolId;
  name: string;
  container: SymbolId | null;
  exported: boolean;
  parts: Part[];
}

interface Container {
  id: SymbolId;
  qualified: string;
  exported: boolean;
}

/** Extracts declarations from repo-relative files. Missing and non-source files are skipped. */
export function extractTs(revision: TsRevision, files: readonly string[]): SymbolDecl[] {
  const { project, root } = revision;
  const paths: [string, string][] = [];
  for (const file of files) {
    if (!isTsSource(file)) continue;
    const path = join(root, file);
    if (project.getSourceFile(path) ?? project.addSourceFileAtPathIfExists(path)) {
      paths.push([file, path]);
    }
  }

  // Build the program after adding files, and read files back from it: the program may
  // re-create a source file (e.g. with another module format), and only its copy is bound.
  const program = project.getProgram().compilerObject;
  const checker = program.getTypeChecker();
  return paths.flatMap(([file, path]) => {
    const sf = program.getSourceFile(path);
    return sf ? new FileExtractor(file, sf, checker, root).run() : [];
  });
}

class FileExtractor {
  private readonly symbols = new Map<SymbolId, Builder>();
  private readonly exportedNames = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly sf: ts.SourceFile,
    private readonly checker: ts.TypeChecker,
    private readonly root: string,
  ) {}

  run(): SymbolDecl[] {
    this.collectExportedNames();
    this.visitStatements(this.sf.statements, null);
    return [...this.symbols.values()].map((builder) => this.finish(builder));
  }

  // ---- traversal -------------------------------------------------------------------------

  private visitStatements(statements: readonly ts.Statement[], container: Container | null): void {
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement)) {
        const name = statement.name?.text ?? (isDefaultExport(statement) ? 'default' : undefined);
        if (!name) continue;
        this.add(container, name, this.isExported(statement, name, container), {
          ...this.functionPart(statement, 'function', name),
        });
      } else if (ts.isClassDeclaration(statement)) {
        const name = statement.name?.text ?? 'default';
        this.addClass(statement, name, this.isExported(statement, name, container), container);
      } else if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      ) {
        const name = statement.name.text;
        const kind: SymbolKind = ts.isInterfaceDeclaration(statement)
          ? 'interface'
          : ts.isTypeAliasDeclaration(statement)
            ? 'type'
            : 'enum';
        this.add(container, name, this.isExported(statement, name, container), {
          kind,
          ...this.span(statement),
          signature: withoutExportTokens(tokens(statement, this.sf)),
          body: [],
          display: this.shapeDisplay(statement),
        });
      } else if (ts.isVariableStatement(statement)) {
        this.addVariables(statement, container);
      } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
        this.addNamespace(
          statement,
          this.isExported(statement, statement.name.text, container),
          container,
        );
      } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        this.addDefaultExpression(statement);
      }
    }
  }

  private addClass(
    node: ts.ClassLikeDeclaration,
    name: string,
    exported: boolean,
    container: Container | null,
  ): void {
    const self = this.add(container, name, exported, {
      kind: 'class',
      ...this.span(node),
      signature: [
        ...this.modifierTokens(node),
        'class',
        name,
        ...angle(listTokens(node.typeParameters, this.sf)),
        ...listTokens(node.heritageClauses, this.sf),
      ],
      body: this.classBody(node),
      display: this.text(
        `${hasModifier(node, ts.SyntaxKind.AbstractKeyword) ? 'abstract ' : ''}class ${name}` +
          `${this.sourceText(node.typeParameters, '<', '>')}` +
          `${node.heritageClauses ? ` ${node.heritageClauses.map((h) => h.getText(this.sf)).join(' ')}` : ''}`,
      ),
    });

    for (const member of node.members) {
      const name = memberName(member, this.sf);
      if (name === undefined) continue;
      const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
      const local = `${isStatic ? 'static:' : ''}${name}`;
      const exported =
        self.exported &&
        !hasModifier(member, ts.SyntaxKind.PrivateKeyword) &&
        !(member.name && ts.isPrivateIdentifier(member.name));
      const prefix = this.memberPrefix(member);

      if (ts.isMethodDeclaration(member)) {
        this.addMember(self, local, exported, this.functionPart(member, 'method', name));
      } else if (ts.isConstructorDeclaration(member)) {
        this.addMember(self, local, exported, this.functionPart(member, 'constructor', name));
      } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        const keyword = ts.isGetAccessorDeclaration(member) ? 'get' : 'set';
        this.addMember(self, local, exported, {
          ...this.functionPart(member, 'accessor', name, {
            head: [...this.modifierTokens(member), keyword, name],
          }),
          display: this.functionDisplay(member, `${keyword} ${name}`, prefix),
        });
      } else if (ts.isPropertyDeclaration(member)) {
        const fn = functionValue(member.initializer);
        this.addMember(
          self,
          local,
          exported,
          fn
            ? {
                ...this.functionPart(fn, 'method', name, {
                  head: [...this.modifierTokens(member), ...tokens(member.name, this.sf)],
                  prefix: [...prefix, ...this.memberPrefix(fn)],
                }),
                ...this.span(member),
              }
            : {
                kind: 'property',
                ...this.span(member),
                signature: [
                  ...this.modifierTokens(member),
                  ...tokens(member.name, this.sf),
                  ...tokens(member.questionToken ?? member.exclamationToken, this.sf),
                  ...this.typeTokens(member.type, member.name),
                ],
                body: tokens(member.initializer, this.sf),
                display: this.text(
                  `${prefix.join(' ')} ${name}${member.questionToken ? '?' : ''}: ${this.typeText(member.type, member.name)}`,
                ),
              },
        );
      }
    }
  }

  private addVariables(statement: ts.VariableStatement, container: Container | null): void {
    const flags = statement.declarationList.flags;
    const keyword = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';

    for (const declaration of statement.declarationList.declarations) {
      for (const identifier of bindingNames(declaration.name)) {
        const name = identifier.text;
        const exported = this.isExported(statement, name, container);
        const init = unwrap(declaration.initializer);
        const fn = functionValue(declaration.initializer);

        if (fn) {
          this.add(container, name, exported, {
            ...this.functionPart(fn, 'function', name, {
              head: [
                keyword,
                name,
                ...(declaration.type ? [':', ...tokens(declaration.type, this.sf)] : []),
              ],
            }),
            ...this.span(
              statement.declarationList.declarations.length === 1 ? statement : declaration,
            ),
          });
        } else if (init && ts.isClassExpression(init)) {
          this.addClass(init, name, exported, container);
        } else {
          this.add(container, name, exported, {
            kind: 'variable',
            ...this.span(
              statement.declarationList.declarations.length === 1 ? statement : declaration,
            ),
            signature: [keyword, name, ...this.typeTokens(declaration.type, identifier)],
            body: tokens(declaration.initializer, this.sf),
            display: this.text(
              `${keyword} ${name}: ${this.typeText(declaration.type, identifier)}`,
            ),
          });
        }
      }
    }
  }

  private addNamespace(
    node: ts.ModuleDeclaration,
    exported: boolean,
    container: Container | null,
  ): void {
    const name = (node.name as ts.Identifier).text;
    const self = this.add(container, name, exported, {
      kind: 'namespace',
      ...this.span(node),
      signature: [...this.modifierTokens(node), 'namespace', name],
      body: [],
      display: `namespace ${name}`,
    });
    const selfContainer: Container = {
      id: self.id,
      qualified: qualifiedName(self.id),
      exported: self.exported,
    };

    const { body } = node;
    if (body && ts.isModuleBlock(body)) {
      this.visitStatements(body.statements, selfContainer);
    } else if (body && ts.isModuleDeclaration(body) && ts.isIdentifier(body.name)) {
      // namespace A.B {} declares B inside A.
      this.addNamespace(body, exported, selfContainer);
    }
    // The namespace's own body is the list of what it declares.
    const prefix = `${self.id}.`;
    const part = self.parts[self.parts.length - 1];
    if (part) {
      part.body = [...this.symbols.values()]
        .filter(
          (child) => child.id.startsWith(prefix) && !child.id.slice(prefix.length).includes('.'),
        )
        .map((child) => `${child.parts[0]?.kind}:${child.name}`)
        .sort();
    }
  }

  private addDefaultExpression(node: ts.ExportAssignment): void {
    const expression = unwrap(node.expression);
    if (ts.isIdentifier(expression)) return; // `export default foo` exports an existing symbol
    const fn = functionValue(node.expression);
    if (fn) {
      this.add(null, 'default', true, {
        ...this.functionPart(fn, 'function', 'default', { head: ['default'] }),
        ...this.span(node),
      });
    } else if (ts.isClassExpression(expression)) {
      this.addClass(expression, 'default', true, null);
    } else {
      this.add(null, 'default', true, {
        kind: 'variable',
        ...this.span(node),
        signature: ['default', ':', this.inferred(node.expression)],
        body: tokens(node.expression, this.sf),
        display: this.text(`default: ${this.inferred(node.expression)}`),
      });
    }
  }

  // ---- parts -----------------------------------------------------------------------------

  /**
   * A function-like part. `head` replaces the default `<modifiers> <name>` signature prefix
   * (variables, properties, accessors); the function's own modifiers still follow it.
   */
  private functionPart(
    fn: ts.SignatureDeclaration,
    kind: SymbolKind,
    name: string,
    { head, prefix }: { head?: string[]; prefix?: string[] } = {},
  ): Part {
    const signature = [
      ...(head ? [...head, ...this.modifierTokens(fn)] : [...this.modifierTokens(fn), name]),
      ...tokens((fn as { asteriskToken?: ts.Node }).asteriskToken, this.sf),
      ...tokens((fn as { questionToken?: ts.Node }).questionToken, this.sf),
      ...angle(listTokens(fn.typeParameters, this.sf)),
      '(',
      ...listTokens(fn.parameters, this.sf),
      ')',
      ...this.returnTokens(fn),
    ];
    const body = (fn as { body?: ts.Node }).body;
    return {
      kind,
      ...this.span(fn),
      signature,
      body: tokens(body, this.sf),
      display: this.functionDisplay(fn, name, prefix ?? this.memberPrefix(fn)),
    };
  }

  private returnTokens(fn: ts.SignatureDeclaration): string[] {
    if (fn.type) return [':', ...tokens(fn.type, this.sf)];
    if (ts.isConstructorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) return [];
    return [':', this.inferredReturn(fn)];
  }

  private functionDisplay(fn: ts.SignatureDeclaration, name: string, prefix: string[]): string {
    const returns =
      ts.isConstructorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)
        ? ''
        : `: ${fn.type ? fn.type.getText(this.sf) : this.inferredReturn(fn)}`;
    const params = fn.parameters.map((p) => p.getText(this.sf)).join(', ');
    return this.text(
      `${prefix.length > 0 ? `${prefix.join(' ')} ` : ''}${name}${this.sourceText(fn.typeParameters, '<', '>')}(${params})${returns}`,
    );
  }

  private classBody(node: ts.ClassLikeDeclaration): string[] {
    const keys: string[] = [];
    const code: string[] = [];
    for (const member of node.members) {
      const name = memberName(member, this.sf);
      if (name !== undefined) {
        const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
        keys.push(`${ts.SyntaxKind[member.kind]}:${isStatic ? 'static:' : ''}${name}`);
      } else {
        // Static blocks and index signatures are not symbols; their code is the class's.
        tokens(member, this.sf, code);
      }
    }
    return [...[...new Set(keys)].sort(), ...code];
  }

  // ---- types -----------------------------------------------------------------------------

  private typeTokens(annotation: ts.TypeNode | undefined, at: ts.Node): string[] {
    return annotation ? [':', ...tokens(annotation, this.sf)] : [':', this.inferred(at)];
  }

  private typeText(annotation: ts.TypeNode | undefined, at: ts.Node): string {
    return annotation ? annotation.getText(this.sf) : this.inferred(at);
  }

  private inferred(node: ts.Node): string {
    return this.safely(() => this.typeString(this.checker.getTypeAtLocation(node), node));
  }

  private inferredReturn(fn: ts.SignatureDeclaration): string {
    return this.safely(() => {
      const signature = this.checker.getSignatureFromDeclaration(fn);
      if (!signature) return 'any';
      return this.typeString(this.checker.getReturnTypeOfSignature(signature), fn);
    });
  }

  /** Type text with revision roots removed, so base and head checkouts print the same. */
  private typeString(type: ts.Type, at: ts.Node): string {
    return this.checker.typeToString(type, at, TYPE_FLAGS).split(`${this.root}/`).join('');
  }

  /** Runs a checker query; a checker failure on odd code degrades to an unknown type. */
  private safely(query: () => string): string {
    try {
      return query();
    } catch {
      return '?';
    }
  }

  // ---- helpers ---------------------------------------------------------------------------

  private add(container: Container | null, name: string, exported: boolean, part: Part): Builder {
    const qualified = container ? `${container.qualified}.${name}` : name;
    const id = `${this.file}#${qualified}`;
    let builder = this.symbols.get(id);
    if (!builder) {
      builder = { id, name, container: container?.id ?? null, exported, parts: [] };
      this.symbols.set(id, builder);
    }
    builder.exported ||= exported;
    builder.parts.push(part);
    return builder;
  }

  private addMember(owner: Builder, local: string, exported: boolean, part: Part): void {
    this.add(
      { id: owner.id, qualified: qualifiedName(owner.id), exported: owner.exported },
      local,
      exported,
      part,
    );
  }

  private finish(builder: Builder): SymbolDecl {
    const { parts } = builder;
    const kind = KIND_ORDER.find((k) => parts.some((p) => p.kind === k)) ?? 'variable';
    const primary = parts.filter((p) => p.kind === kind);
    const first = primary[0] ?? parts[0];
    const extra = kind === 'accessor' ? accessorSuffix(primary) : overloadSuffix(primary);
    const bodies = parts.map((p) => p.body.join(' '));

    return {
      id: builder.id,
      kind,
      name: builder.name.replace(/^static:/, ''),
      container: builder.container,
      exported: builder.exported,
      file: this.file,
      range: this.range(
        Math.min(...parts.map((p) => p.start)),
        Math.max(...parts.map((p) => p.end)),
      ),
      signature: `${first?.display ?? builder.name}${extra}`,
      hashes: {
        signature: hash([
          `exported:${builder.exported}`,
          ...parts.map((p) => p.signature.join(' ')),
        ]),
        body: bodies.every((b) => b === '') ? '' : hash(bodies),
      },
      bodySize: parts.reduce((sum, p) => sum + p.body.length, 0),
    };
  }

  private collectExportedNames(): void {
    for (const statement of this.sf.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        !statement.moduleSpecifier &&
        statement.exportClause
      ) {
        if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            this.exportedNames.add((element.propertyName ?? element.name).text);
          }
        }
      } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
        this.exportedNames.add(statement.expression.text);
      }
    }
  }

  private isExported(node: ts.Node, name: string, container: Container | null): boolean {
    const keyword = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    if (container) return container.exported && keyword;
    return keyword || this.exportedNames.has(name);
  }

  private modifierTokens(node: ts.Node): string[] {
    const out: string[] = [];
    if (ts.canHaveDecorators(node)) {
      for (const decorator of ts.getDecorators(node) ?? []) tokens(decorator, this.sf, out);
    }
    if (ts.canHaveModifiers(node)) {
      for (const modifier of ts.getModifiers(node) ?? []) {
        if (modifier.kind === ts.SyntaxKind.ExportKeyword) continue;
        if (modifier.kind === ts.SyntaxKind.DefaultKeyword) continue;
        out.push(modifier.getText(this.sf));
      }
    }
    return out;
  }

  /** Display prefix for members: `static`, `private`, `async`… (decorators left out). */
  private memberPrefix(node: ts.Node): string[] {
    if (!ts.canHaveModifiers(node)) return [];
    return (ts.getModifiers(node) ?? [])
      .filter(
        (m) => m.kind !== ts.SyntaxKind.ExportKeyword && m.kind !== ts.SyntaxKind.DefaultKeyword,
      )
      .map((m) => m.getText(this.sf));
  }

  private shapeDisplay(
    node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
  ): string {
    if (ts.isTypeAliasDeclaration(node)) {
      return this.text(
        `type ${node.name.text}${this.sourceText(node.typeParameters, '<', '>')} = ${node.type.getText(this.sf)}`,
      );
    }
    if (ts.isEnumDeclaration(node)) {
      return `${hasModifier(node, ts.SyntaxKind.ConstKeyword) ? 'const ' : ''}enum ${node.name.text}`;
    }
    const heritage = node.heritageClauses?.map((h) => h.getText(this.sf)).join(' ');
    return this.text(
      `interface ${node.name.text}${this.sourceText(node.typeParameters, '<', '>')}${heritage ? ` ${heritage}` : ''}`,
    );
  }

  private sourceText(nodes: readonly ts.Node[] | undefined, open: string, close: string): string {
    if (!nodes || nodes.length === 0) return '';
    return `${open}${nodes.map((n) => n.getText(this.sf)).join(', ')}${close}`;
  }

  private span(node: ts.Node): { start: number; end: number } {
    return { start: node.getStart(this.sf), end: node.getEnd() };
  }

  private range(start: number, end: number): Range {
    const a = this.sf.getLineAndCharacterOfPosition(start);
    const b = this.sf.getLineAndCharacterOfPosition(end);
    return {
      start: { line: a.line + 1, col: a.character + 1 },
      end: { line: b.line + 1, col: b.character + 1 },
    };
  }

  private text(value: string): string {
    const flat = value.replace(/\s+/g, ' ').trim();
    return flat.length > MAX_DISPLAY ? `${flat.slice(0, MAX_DISPLAY - 1)}…` : flat;
  }
}

// ---- pure helpers --------------------------------------------------------------------------

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

/** `(+N overloads)`: overload signatures besides the first, not counting the implementation. */
function overloadSuffix(parts: Part[]): string {
  const withBody = parts.filter((p) => p.body.length > 0).length;
  const signatures =
    withBody > 0 && withBody < parts.length ? parts.length - withBody : parts.length;
  const extra = signatures - 1;
  return extra > 0 ? ` (+${extra} overload${extra === 1 ? '' : 's'})` : '';
}

function accessorSuffix(parts: Part[]): string {
  return parts.length > 1 ? ' (get/set)' : '';
}

function qualifiedName(id: SymbolId): string {
  return id.slice(id.indexOf('#') + 1);
}

function angle(inner: string[]): string[] {
  return inner.length > 0 ? ['<', ...inner, '>'] : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function isDefaultExport(node: ts.Node): boolean {
  return (
    hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
    hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  );
}

function withoutExportTokens(list: string[]): string[] {
  let i = 0;
  while (list[i] === 'export' || list[i] === 'default') i++;
  return list.slice(i);
}

/** Strips wrappers that do not change what a value is: parentheses, `as`, `satisfies`, `!`. */
function unwrap(node: ts.Expression): ts.Expression;
function unwrap(node: ts.Expression | undefined): ts.Expression | undefined;
function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function functionValue(
  node: ts.Expression | undefined,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const value = unwrap(node);
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : undefined;
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

/** Name of a class member that is a symbol; undefined for static blocks, index signatures, `;`. */
function memberName(member: ts.ClassElement, sf: ts.SourceFile): string | undefined {
  if (ts.isConstructorDeclaration(member)) return 'constructor';
  const { name } = member;
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    return `[${name.expression.getText(sf).replace(/\s+/g, ' ')}]`;
  }
  return name.text;
}
