import { posix } from 'node:path';
import type { MappedPosition, ts, VirtualFile } from '@cpr/core';
import type { MdxCode, MdxElement, MdxPart } from './mdx.js';
import type { Provided } from './provider.js';

/** The function rendering an MDX file's elements and expressions in its shim. */
export const RENDER = '__cpr_mdx';

/** `src/routes/docs/index.mdx` → `src/routes/docs/index.mdx.cpr.tsx`, next to it. */
export const shimPath = (file: string) => `${file}.cpr.tsx`;

/** The template symbol of an MDX file. */
export const templateId = (file: string) => `${file}#(template)`;

/**
 * An MDX file as TSX, so TypeScript resolves what it uses: its `import`/`export` blocks as they
 * are, then a function that renders each component element (self-closed: its props type-check
 * as in a `.tsx` file) and evaluates each expression. An element that does not parse on its own
 * becomes a reference to its tag; a tag neither imported nor declared by the file is imported
 * from where the MDX provider gets it (`providerImportSource`), or left out. Imports are
 * scaffolding; everything else maps back to its `.mdx` position, owned by the file's template.
 */
export function mdxShim(
  tsApi: typeof ts,
  file: string,
  source: string,
  code: MdxCode,
  provided: ReadonlyMap<string, Provided> = new Map(),
): VirtualFile {
  const out = new Writer(templateId(file));
  const local = new Set<string>();
  for (const block of code.esm) {
    for (const name of declaredNames(tsApi, block.text)) local.add(name);
    const imports = /^import /.test(block.text);
    if (imports) out.write(block.text);
    else out.mapped(block);
    out.write('\n');
  }
  // Components the provider gives, imported under their tag's name.
  const tags = new Set(code.elements.map((e) => rootName(e.tag)).filter((t) => !local.has(t)));
  for (const tag of tags) {
    const from = provided.get(tag);
    if (!from) continue;
    out.write(`${importLine(tag, from, file)}\n`);
    local.add(tag);
  }
  out.write('declare function __cpr_use(...values: unknown[]): void;\n');
  out.write(`export function ${RENDER}(): void {\n`);

  const parts = [
    ...code.elements.map((element) => ({ start: element.start, element })),
    ...code.expressions.map((expression) => ({ start: expression.start, expression })),
  ].sort((a, b) => a.start - b.start);
  for (const part of parts) {
    if ('element' in part) {
      if (local.has(rootName(part.element.tag))) writeElement(tsApi, out, part.element);
    } else {
      writeExpression(tsApi, out, part.expression);
    }
  }
  out.write('}\n');

  const positions = new Positions(source);
  return {
    path: shimPath(file),
    text: out.text,
    map: (offset) => out.at(offset, file, positions),
  };
}

/** `import { Term } from '../../components/term';`, relative to the shim (next to `file`). */
function importLine(tag: string, from: Provided, file: string): string {
  let module = from.module;
  if (from.file) {
    module = posix.relative(posix.dirname(file), module).replace(/\.[cm]?[jt]sx?$/, '');
    if (!module.startsWith('.')) module = `./${module}`;
  }
  const what =
    from.name === 'default' ? tag : `{ ${from.name === tag ? tag : `${from.name} as ${tag}`} }`;
  return `import ${what} from ${JSON.stringify(module)};`;
}

function writeElement(tsApi: typeof ts, out: Writer, element: MdxElement): void {
  // `<Note kind="tip">` → `<Note kind="tip" />`: children are content, not props.
  const body = element.selfClosing ? element.text : `${element.text.slice(0, -1)}/>`;
  if (parses(tsApi, `__cpr_use(${body});`)) {
    out.write('  __cpr_use(');
    out.mapped({ ...element, text: body });
    out.write(');\n');
  } else {
    // Unreadable props: the component is still used.
    out.write('  __cpr_use(');
    out.mapped({
      start: element.start + 1,
      end: element.start + 1 + element.tag.length,
      text: element.tag,
    });
    out.write(');\n');
  }
}

function writeExpression(tsApi: typeof ts, out: Writer, expression: MdxPart): void {
  if (!parses(tsApi, `__cpr_use((${expression.text}));`)) return;
  out.write('  __cpr_use((');
  out.mapped(expression);
  out.write('));\n');
}

/** Names an ESM block declares: imports, and exported declarations. */
function declaredNames(tsApi: typeof ts, text: string): string[] {
  const sf = tsApi.createSourceFile(
    'esm.tsx',
    text,
    tsApi.ScriptTarget.Latest,
    false,
    tsApi.ScriptKind.TSX,
  );
  const names: string[] = [];
  for (const statement of sf.statements) {
    if (tsApi.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) names.push(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && tsApi.isNamespaceImport(bindings)) names.push(bindings.name.text);
      else if (bindings) for (const e of bindings.elements) names.push(e.name.text);
    } else if (tsApi.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (tsApi.isIdentifier(d.name)) names.push(d.name.text);
      }
    } else if (
      (tsApi.isFunctionDeclaration(statement) || tsApi.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text);
    }
  }
  return names;
}

function parses(tsApi: typeof ts, text: string): boolean {
  const sf = tsApi.createSourceFile(
    'part.tsx',
    text,
    tsApi.ScriptTarget.Latest,
    false,
    tsApi.ScriptKind.TSX,
  );
  return ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length ?? 0) === 0;
}

const rootName = (tag: string) => tag.split('.')[0] ?? tag;

/** The shim's text, with the stretches copied from the MDX file. */
class Writer {
  text = '';
  private readonly segments: { at: number; length: number; from: number }[] = [];

  constructor(private readonly owner: string) {}

  write(text: string): void {
    this.text += text;
  }

  /** Copies a part of the MDX file, remembering where it came from. */
  mapped(part: MdxPart): void {
    this.segments.push({ at: this.text.length, length: part.text.length, from: part.start });
    this.text += part.text;
  }

  at(offset: number, file: string, positions: Positions): MappedPosition | undefined {
    const segment = this.segments.find((s) => offset >= s.at && offset < s.at + s.length);
    if (!segment) return undefined;
    return {
      owner: this.owner,
      site: { file, ...positions.of(segment.from + offset - segment.at) },
    };
  }
}

/** 1-based line and column of offsets in a text. */
export class Positions {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1))
      this.starts.push(i + 1);
  }

  of(offset: number): { line: number; col: number } {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, col: offset - (this.starts[low] as number) + 1 };
  }
}
