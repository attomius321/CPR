import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ts } from 'ts-morph';
import type { ExtractOptions } from '../../adapter.js';
import type { Range, Shape, SymbolDecl, SymbolId, SymbolKind } from '../../model.js';
import { isTsSource } from './files.js';
import { runHook, type ArgumentRoles, type PluginSymbol } from './plugins.js';
import { pluginRevision, type TsRevision } from './project.js';
import {
  bindingNames,
  functionValue,
  hasModifier,
  isDefaultExport,
  memberName,
  unwrap,
} from './syntax.js';
import { listTokens, tokens } from './tokens.js';

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

/**
 * Long inferred types are truncated (`…`): printing them in full dominated extraction on
 * generic-heavy code (zod). A change hidden in a truncated tail is still caught as the callee's
 * own signature change.
 */
const TYPE_FLAGS = ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

const MAX_DISPLAY = 300;

interface Part {
  kind: SymbolKind;
  /** The declaration node: references are searched from it and outgoing ones inside it. */
  node: ts.Node;
  start: number;
  end: number;
  signature: string[];
  body: string[];
  display: string;
  shape?: Shape;
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

/**
 * Extracts declarations from repo-relative files and records their nodes in
 * `revision.declarations`. Files that are missing or not in the program are skipped.
 */
export function extractTs(
  revision: TsRevision,
  files: readonly string[],
  { infer = () => true }: ExtractOptions = {},
): SymbolDecl[] {
  const { program, root } = revision;
  const checker = program.getTypeChecker();
  const symbols: SymbolDecl[] = [];
  const roles = decoratorRoles(revision);
  for (const file of files) {
    if (!isTsSource(file)) continue;
    const sf = program.getSourceFile(join(root, file));
    if (!sf || revision.virtual.has(sf.fileName)) continue;
    const extractor = new FileExtractor(file, sf, checker, root, infer, roles);
    for (const [symbol, nodes] of extractor.run()) {
      symbols.push(symbol);
      revision.declarations.set(symbol.id, nodes);
    }
  }
  // Plugins' own symbols (e.g. templates) join the adapter's.
  for (const active of revision.plugins) {
    const extract = active.plugin.extract;
    if (!extract) continue;
    const found = runHook(active, 'extract', revision.warnings, [] as PluginSymbol[], () =>
      extract(pluginRevision(revision, active), files),
    );
    for (const { symbol, nodes } of found) {
      symbols.push(symbol);
      revision.declarations.set(symbol.id, nodes ?? []);
    }
  }
  return symbols;
}

/** The first applying plugin's roles for a decorator's arguments, if one claims it. */
function decoratorRoles(revision: TsRevision): DecoratorRoles {
  const claimants = revision.plugins.filter((p) => p.plugin.decoratorArguments);
  if (claimants.length === 0) return () => undefined;
  return (decorator) => {
    for (const active of claimants) {
      const roles = runHook(active, 'decoratorArguments', revision.warnings, undefined, () =>
        active.plugin.decoratorArguments?.(pluginRevision(revision, active), decorator),
      );
      if (roles) return roles;
    }
    return undefined;
  };
}

type DecoratorRoles = (decorator: ts.Decorator) => ArgumentRoles | undefined;

class FileExtractor {
  private readonly symbols = new Map<SymbolId, Builder>();
  private readonly exportedNames = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly sf: ts.SourceFile,
    private readonly checker: ts.TypeChecker,
    private readonly root: string,
    private readonly infer: (id: SymbolId) => boolean,
    private readonly roles: DecoratorRoles = () => undefined,
  ) {}

  run(): [SymbolDecl, ts.Node[]][] {
    this.collectExportedNames();
    this.visitStatements(this.sf.statements, null);
    return [...this.symbols.values()].map((builder) => [
      this.finish(builder),
      builder.parts.map((part) => part.node),
    ]);
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
          shape: this.typeShape(statement),
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
      body: [...this.decoratorBody(node), ...this.classBody(node)],
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
                ...this.withDecoratorBody(
                  member,
                  this.functionPart(fn, 'method', name, {
                    head: [...this.modifierTokens(member), ...tokens(member.name, this.sf)],
                    prefix: [...prefix, ...this.memberPrefix(fn)],
                  }),
                ),
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
                body: [...this.decoratorBody(member), ...tokens(member.initializer, this.sf)],
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
    const lead = [
      ...(head ? [...head, ...this.modifierTokens(fn)] : [...this.modifierTokens(fn), name]),
      ...tokens((fn as { asteriskToken?: ts.Node }).asteriskToken, this.sf),
      ...tokens((fn as { questionToken?: ts.Node }).questionToken, this.sf),
      ...angle(listTokens(fn.typeParameters, this.sf)),
    ];
    const returns = this.returnTokens(fn);
    const signature = [...lead, '(', ...listTokens(fn.parameters, this.sf), ')', ...returns];
    const body = (fn as { body?: ts.Node }).body;
    return {
      kind,
      ...this.span(fn),
      signature,
      body: [...this.decoratorBody(fn), ...tokens(body, this.sf)],
      display: this.functionDisplay(fn, name, prefix ?? this.memberPrefix(fn)),
      shape: {
        params: fn.parameters.map((p) => ({
          optional: Boolean(p.questionToken ?? p.initializer ?? p.dotDotDotToken),
          type: p.type ? tokens(p.type, this.sf).join(' ') : this.inferred(p),
        })),
        returns: returns.slice(1).join(' '),
        rest: lead.join(' '),
      },
    };
  }

  /** Members of interfaces, object type aliases (and their intersections) and enums. */
  private typeShape(
    node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
  ): Shape {
    const text = (n: ts.Node | undefined) => tokens(n, this.sf).join(' ');
    const rest = [...this.modifierTokens(node), node.name.text];
    const members: NonNullable<Shape['members']> = {};

    if (ts.isEnumDeclaration(node)) {
      for (const member of node.members) {
        members[member.name.getText(this.sf)] = { optional: false, type: text(member.initializer) };
      }
      return { members, rest: rest.join(' ') };
    }

    rest.push(...angle(listTokens(node.typeParameters, this.sf)));
    const literals: (readonly ts.TypeElement[])[] = [];
    if (ts.isInterfaceDeclaration(node)) {
      rest.push(...listTokens(node.heritageClauses, this.sf));
      literals.push(node.members);
    } else {
      const parts = ts.isIntersectionTypeNode(node.type) ? node.type.types : [node.type];
      const others: string[] = [];
      for (const part of parts) {
        if (ts.isTypeLiteralNode(part)) literals.push(part.members);
        else others.push(text(part));
      }
      rest.push(...others.sort());
    }
    literals.flat().forEach((member, i) => {
      const name = member.name
        ? `${member.name.getText(this.sf)}${ts.isMethodSignature(member) ? '()' : ''}`
        : `[${ts.SyntaxKind[member.kind]}]`;
      const key = name in members ? `${name}#${i}` : name;
      members[key] = {
        optional: Boolean(member.questionToken),
        type: text(ts.isPropertySignature(member) ? member.type : member),
      };
    });
    return { members, rest: rest.join(' ') };
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

  /**
   * Inferred type of a variable, property or expression, with literal types widened: a `const`
   * holding `'a'` has type `'a'`, but editing the value is a body change, not a new contract.
   */
  private inferred(node: ts.Node): string {
    return this.later(() =>
      this.typeString(
        this.checker.getBaseTypeOfLiteralType(this.checker.getTypeAtLocation(node)),
        node,
      ),
    );
  }

  private readonly returnTypes = new Map<ts.Node, string>();

  /** One placeholder per function: the signature hash and the display both use it. */
  private inferredReturn(fn: ts.SignatureDeclaration): string {
    let placeholder = this.returnTypes.get(fn);
    if (placeholder === undefined) {
      placeholder = this.later(() => {
        const signature = this.checker.getSignatureFromDeclaration(fn);
        if (!signature) return 'any';
        return this.typeString(this.checker.getReturnTypeOfSignature(signature), fn);
      });
      this.returnTypes.set(fn, placeholder);
    }
    return placeholder;
  }

  // Inference is the expensive part of extraction, and its result only matters for symbols
  // the caller wants (`infer`). Inferred types are recorded as placeholders and computed in
  // `finish()`, once the symbol's ID is known; skipped ones become empty.
  private readonly deferred: (() => string)[] = [];
  private readonly computed = new Map<number, string>();

  private later(compute: () => string): string {
    return `${PLACEHOLDER}${this.deferred.push(compute) - 1}${PLACEHOLDER}`;
  }

  private resolve(text: string, infer: boolean): string {
    if (!text.includes(PLACEHOLDER)) return text;
    return text.replace(PLACEHOLDERS, (_, index: string) => {
      if (!infer) return '';
      const i = Number(index);
      let value = this.computed.get(i);
      if (value === undefined) {
        value = this.safely(this.deferred[i] ?? (() => '?'));
        this.computed.set(i, value);
      }
      return value;
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
    const infer = this.infer(builder.id);
    const resolve = (text: string) => this.resolve(text, infer);
    const parts = builder.parts.map((part) => ({
      ...part,
      signature: part.signature.map(resolve),
      // Without inference, `f(): ` and `const x: ` lose their dangling colon.
      display: resolve(part.display).replace(/:\s*$/, ''),
      ...(part.shape ? { shape: resolveShape(part.shape, resolve) } : {}),
    }));
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
      signature: truncate(`${first?.display ?? builder.name}${extra}`),
      hashes: {
        signature: hash([
          `exported:${builder.exported}`,
          ...parts.map((p) => p.signature.join(' ')),
        ]),
        body: bodies.every((b) => b === '') ? '' : hash(bodies),
      },
      bodySize: parts.reduce((sum, p) => sum + p.body.length, 0),
      // Overloads, accessor pairs and merged declarations: too many forms to compare.
      ...(parts.length === 1 && parts[0]?.shape ? { shape: parts[0].shape } : {}),
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

  /**
   * Modifier and decorator tokens of a signature. A decorator a plugin claims contributes its
   * name and the arguments the plugin marks as signature; the rest goes to `decoratorBody`.
   */
  private modifierTokens(node: ts.Node): string[] {
    const out: string[] = [];
    if (ts.canHaveDecorators(node)) {
      for (const decorator of ts.getDecorators(node) ?? []) {
        const roles = this.roles(decorator);
        if (!roles) {
          tokens(decorator, this.sf, out);
          continue;
        }
        const callee = ts.isCallExpression(decorator.expression)
          ? decorator.expression.expression
          : decorator.expression;
        out.push('@');
        tokens(callee, this.sf, out);
        for (const argument of roles.signature) tokens(argument, this.sf, out);
      }
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

  /** Body tokens from the arguments of plugin-claimed decorators (none without plugins). */
  private decoratorBody(node: ts.Node): string[] {
    const out: string[] = [];
    if (!ts.canHaveDecorators(node)) return out;
    for (const decorator of ts.getDecorators(node) ?? []) {
      for (const argument of this.roles(decorator)?.body ?? []) tokens(argument, this.sf, out);
    }
    return out;
  }

  private withDecoratorBody(node: ts.Node, part: Part): Part {
    const extra = this.decoratorBody(node);
    return extra.length > 0 ? { ...part, body: [...extra, ...part.body] } : part;
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

  private span(node: ts.Node): { node: ts.Node; start: number; end: number } {
    return { node, start: node.getStart(this.sf), end: node.getEnd() };
  }

  private range(start: number, end: number): Range {
    const a = this.sf.getLineAndCharacterOfPosition(start);
    const b = this.sf.getLineAndCharacterOfPosition(end);
    return {
      start: { line: a.line + 1, col: a.character + 1 },
      end: { line: b.line + 1, col: b.character + 1 },
    };
  }

  /** Collapses whitespace; truncation happens after placeholders are resolved. */
  private text(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }
}

// ---- pure helpers --------------------------------------------------------------------------

/** Private-use character: never appears in source tokens. */
const PLACEHOLDER = '\uE000';
const PLACEHOLDERS = /\uE000(\d+)\uE000/g;

function resolveShape(shape: Shape, resolve: (text: string) => string): Shape {
  return {
    rest: resolve(shape.rest),
    ...(shape.params
      ? { params: shape.params.map((p) => ({ optional: p.optional, type: resolve(p.type) })) }
      : {}),
    ...(shape.returns === undefined ? {} : { returns: resolve(shape.returns) }),
    ...(shape.members ? { members: shape.members } : {}),
  };
}

function truncate(text: string): string {
  return text.length > MAX_DISPLAY ? `${text.slice(0, MAX_DISPLAY - 1)}…` : text;
}

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

function withoutExportTokens(list: string[]): string[] {
  let i = 0;
  while (list[i] === 'export' || list[i] === 'default') i++;
  return list.slice(i);
}
