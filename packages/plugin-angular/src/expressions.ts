import * as ng from '@angular/compiler';

/** Where translated code goes. */
export interface Out {
  write(text: string): void;
  /** A name read from the template at `offset`: recorded so the shim maps back to it. */
  name(text: string, offset: number, possible?: boolean): void;
}

/** What names mean where an expression is translated. */
export interface Scope {
  /** The template's binder: names it resolves are template locals. Absent: canonical text. */
  bound?: ng.BoundTarget<ng.DirectiveMeta>;
  /** Parameters of enclosing arrow functions (`list.map(x => x.id)`), which the binder skips. */
  params: ReadonlySet<string>;
  /** Inside an event handler, where `$event` is defined. */
  event: boolean;
  /** The shim's name for a known pipe's class (`markdown` → `__cpr_D1`), if it is one. */
  pipe?: (name: string) => string | undefined;
}

export const CANONICAL: Scope = { params: new Set(), event: false };

const ASSIGNMENT = /^(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=$/;

/**
 * Writes an Angular expression as TypeScript that reads the same names: names on the component
 * become `this.name`, template locals stay as they are, unknown pipes become `__cpr_pipe(…)`
 * and whatever has no TypeScript equivalent becomes `any`. Without a binder (`CANONICAL`) it
 * writes a whitespace-free canonical form, for hashing.
 */
export function writeExpression(ast: ng.AST, out: Out, scope: Scope): void {
  const write = (node: ng.AST, inner = scope) => writeExpression(node, out, inner);
  const list = (nodes: readonly ng.AST[]) =>
    nodes.forEach((node, i) => {
      if (i > 0) out.write(', ');
      write(node);
    });

  if (ast instanceof ng.ASTWithSource) {
    write(unwrap(ast));
  } else if (ast instanceof ng.EmptyExpr) {
    out.write('undefined');
  } else if (ast instanceof ng.ImplicitReceiver || ast instanceof ng.ThisReceiver) {
    out.write('this');
  } else if (ast instanceof ng.PropertyRead || ast instanceof ng.SafePropertyRead) {
    const receiver = ast.receiver;
    if (receiver instanceof ng.ThisReceiver) {
      out.write('this.');
    } else if (receiver instanceof ng.ImplicitReceiver) {
      if (ast instanceof ng.PropertyRead && isLocal(ast, scope)) {
        out.write(ast.name);
        return;
      }
      if (scope.bound) out.write('this.');
    } else {
      write(receiver);
      out.write(ast instanceof ng.SafePropertyRead ? '?.' : '.');
    }
    out.name(ast.name, ast.nameSpan.start);
  } else if (ast instanceof ng.KeyedRead || ast instanceof ng.SafeKeyedRead) {
    write(ast.receiver);
    out.write(ast instanceof ng.SafeKeyedRead ? '?.[' : '[');
    write(ast.key);
    out.write(']');
  } else if (ast instanceof ng.Call || ast instanceof ng.SafeCall) {
    const callee = ast.receiver;
    if (
      callee instanceof ng.PropertyRead &&
      callee.receiver instanceof ng.ImplicitReceiver &&
      !(callee.receiver instanceof ng.ThisReceiver) &&
      callee.name === '$any' &&
      !isLocal(callee, scope)
    ) {
      // `$any(x)`: Angular's cast.
      out.write('(');
      if (ast.args[0]) write(ast.args[0]);
      out.write(' as any)');
      return;
    }
    write(callee);
    out.write(ast instanceof ng.SafeCall ? '?.(' : '(');
    list(ast.args);
    out.write(')');
  } else if (ast instanceof ng.LiteralPrimitive) {
    const value: unknown = ast.value;
    out.write(typeof value === 'string' ? JSON.stringify(value) : String(value));
  } else if (ast instanceof ng.LiteralArray) {
    out.write('[');
    list(ast.expressions);
    out.write(']');
  } else if (ast instanceof ng.LiteralMap) {
    out.write('({');
    ast.keys.forEach((key, i) => {
      if (i > 0) out.write(', ');
      const value = ast.values[i];
      if (key.kind === 'spread') out.write('...');
      else out.write(`${JSON.stringify(key.key)}: `);
      if (value) write(value);
    });
    out.write('})');
  } else if (ast instanceof ng.Unary) {
    out.write(`(${ast.operator}`);
    write(ast.expr);
    out.write(')');
  } else if (ast instanceof ng.Binary) {
    const assigns = ASSIGNMENT.test(ast.operation) && !/^[=!<>]=/.test(ast.operation);
    if (!assigns) out.write('(');
    write(ast.left);
    out.write(` ${ast.operation} `);
    write(ast.right);
    if (!assigns) out.write(')');
  } else if (ast instanceof ng.PrefixNot) {
    out.write('!(');
    write(ast.expression);
    out.write(')');
  } else if (ast instanceof ng.TypeofExpression) {
    out.write('(typeof ');
    write(ast.expression);
    out.write(')');
  } else if (ast instanceof ng.VoidExpression) {
    out.write('(void ');
    write(ast.expression);
    out.write(')');
  } else if (ast instanceof ng.NonNullAssert) {
    out.write('(');
    write(ast.expression);
    out.write(')!');
  } else if (ast instanceof ng.ParenthesizedExpression) {
    out.write('(');
    write(ast.expression);
    out.write(')');
  } else if (ast instanceof ng.Conditional) {
    out.write('(');
    write(ast.condition);
    out.write(' ? ');
    write(ast.trueExp);
    out.write(' : ');
    write(ast.falseExp);
    out.write(')');
  } else if (ast instanceof ng.Chain) {
    out.write('(');
    list(ast.expressions);
    out.write(')');
  } else if (ast instanceof ng.BindingPipe) {
    const pipe = scope.pipe?.(ast.name);
    if (pipe) {
      // A known pipe: `(MarkdownPipe(), MarkdownPipe.prototype.transform(value, …args))`.
      out.write('(');
      out.name(pipe, ast.nameSpan.start);
      out.write(`(), ${pipe}.prototype.`);
      out.name('transform', ast.nameSpan.start);
      out.write('(');
      list([ast.exp, ...ast.args]);
      out.write('))');
    } else {
      // An unknown pipe: the value and the arguments are still read.
      out.write('__cpr_pipe(');
      list([ast.exp, ...ast.args]);
      out.write(')');
    }
  } else if (ast instanceof ng.Interpolation || ast instanceof ng.TemplateLiteral) {
    out.write('[');
    list(ast.expressions);
    out.write(']');
  } else if (ast instanceof ng.TaggedTemplateLiteral) {
    write(ast.tag);
    out.write('([');
    list(ast.template.expressions);
    out.write('])');
  } else if (ast instanceof ng.SpreadElement) {
    out.write('...');
    write(ast.expression);
  } else if (ast instanceof ng.ArrowFunction) {
    const params = ast.parameters.map((p) => p.name);
    out.write(`((${params.join(', ')}) => `);
    write(ast.body, { ...scope, params: new Set([...scope.params, ...params]) });
    out.write(')');
  } else if (ast instanceof ng.RegularExpressionLiteral) {
    out.write(`/${ast.body}/${ast.flags ?? ''}`);
  } else {
    out.write('(null as any)');
  }
}

/** Writes an event handler's statements (`a(); b = $event`). */
export function writeStatements(ast: ng.AST, out: Out, scope: Scope, indent: string): void {
  const inner = unwrap(ast);
  const statements = inner instanceof ng.Chain ? inner.expressions : [inner];
  for (const statement of statements) {
    out.write(indent);
    writeExpression(statement, out, scope);
    out.write(';\n');
  }
}

/** The expression inside a parsed source (`ASTWithSource`), or the expression itself. */
export function unwrap(ast: ng.AST): ng.AST {
  return ast instanceof ng.ASTWithSource ? (ast as ng.ASTWithSource<ng.AST>).ast : ast;
}

/** A name the template declares (a variable, reference or `@let`), not the component's. */
function isLocal(ast: ng.PropertyRead, scope: Scope): boolean {
  if (scope.params.has(ast.name)) return true;
  if (scope.event && ast.name === '$event') return true;
  return !!scope.bound?.getExpressionTarget(ast);
}

/** An expression as canonical text: what its hash is made of. */
export function canonical(ast: ng.AST): string {
  let text = '';
  writeExpression(
    ast,
    {
      write: (s) => (text += s),
      name: (s) => (text += s),
    },
    CANONICAL,
  );
  return text;
}
