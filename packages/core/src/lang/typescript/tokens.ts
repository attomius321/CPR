import { ts } from 'ts-morph';

/**
 * Token texts of a node with formatting removed, for change hashing. Two nodes that differ
 * only in whitespace, comments, JSDoc, quote style, trailing commas, statement terminators or
 * parentheses around a single arrow parameter produce the same tokens.
 */
export function tokens(node: ts.Node | undefined, sf: ts.SourceFile, out: string[] = []): string[] {
  if (node) collect(node, sf, out);
  return out;
}

/** Tokens of several nodes, separated by commas. */
export function listTokens(
  nodes: readonly ts.Node[] | undefined,
  sf: ts.SourceFile,
  out: string[] = [],
): string[] {
  nodes?.forEach((node, i) => {
    if (i > 0) out.push(',');
    collect(node, sf, out);
  });
  return out;
}

function collect(node: ts.Node, sf: ts.SourceFile, out: string[]): void {
  if (node.kind === ts.SyntaxKind.JSDoc || node.kind === ts.SyntaxKind.SemicolonClassElement) {
    return;
  }

  const children = node.getChildren(sf);
  if (children.length === 0) {
    leaf(node, sf, out);
    return;
  }

  const last = children.length - 1;
  const arrow = ts.isArrowFunction(node);
  children.forEach((child, i) => {
    // `;` and `,` as a last child are terminators, separators or trailing commas.
    if (
      i === last &&
      (child.kind === ts.SyntaxKind.SemicolonToken || child.kind === ts.SyntaxKind.CommaToken)
    ) {
      return;
    }
    // `x => x` and `(x) => x` are the same function.
    if (
      arrow &&
      (child.kind === ts.SyntaxKind.OpenParenToken || child.kind === ts.SyntaxKind.CloseParenToken)
    ) {
      return;
    }
    collect(child, sf, out);
  });
}

function leaf(node: ts.Node, sf: ts.SourceFile, out: string[]): void {
  switch (node.kind) {
    case ts.SyntaxKind.EndOfFileToken:
      return;
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      // 'a', "a" and `a` are the same value.
      out.push(JSON.stringify((node as ts.LiteralLikeNode).text));
      return;
    case ts.SyntaxKind.JsxText: {
      const text = node.getText(sf).replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
      return;
    }
    default:
      out.push(node.getText(sf));
  }
}
