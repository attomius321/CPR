import type { Contract, PluginRevision, ts } from '@cpr/core';
import { calls, unwrap } from './imports.js';
import { QWIK_PACKAGES } from './projects.js';

const COMPONENT = new Set(['component$']);

/**
 * A `component$(…)` value's contract: its props, which JSX users pass. Read from the types
 * written in the code first — `const C: Component<P>`, `component$<P>(…)`, `(props: P) => …` —
 * so it needs no installed Qwik; else from the value's type, `Component<P>`. A component taking
 * no props has a contract with none; one whose props cannot be read has none (as without it).
 */
export function componentContract(
  revision: PluginRevision,
  declaration: ts.VariableDeclaration | ts.ExportAssignment,
): Contract | undefined {
  const tsApi = revision.ts;
  const value = unwrap(
    tsApi,
    tsApi.isVariableDeclaration(declaration) ? declaration.initializer : declaration.expression,
  );
  if (!value || !tsApi.isCallExpression(value)) return undefined;
  if (!calls(tsApi, value, QWIK_PACKAGES, COMPONENT)) return undefined;
  const label = value.expression.getText();
  const { checker } = revision;

  const annotation = tsApi.isVariableDeclaration(declaration) ? declaration.type : undefined;
  if (
    annotation &&
    tsApi.isTypeReferenceNode(annotation) &&
    lastName(tsApi, annotation.typeName) === 'Component' &&
    annotation.typeArguments?.length === 1
  ) {
    return {
      label,
      inputs: checker.getTypeFromTypeNode(annotation.typeArguments[0] as ts.TypeNode),
    };
  }
  const typeArgument = value.typeArguments?.[0];
  if (typeArgument) return { label, inputs: checker.getTypeFromTypeNode(typeArgument) };

  const render = unwrap(tsApi, value.arguments[0]);
  if (render && (tsApi.isArrowFunction(render) || tsApi.isFunctionExpression(render))) {
    const props = render.parameters[0];
    if (!props) return { label, inputs: undefined };
    if (props.type) return { label, inputs: checker.getTypeFromTypeNode(props.type) };
  }

  // Untyped props: what the installed typings make of them, if anything.
  const type = checker.getTypeAtLocation(value);
  const props = type.aliasSymbol?.name === 'Component' ? type.aliasTypeArguments?.[0] : undefined;
  if (!props || props.flags & (tsApi.TypeFlags.Any | tsApi.TypeFlags.Unknown)) return undefined;
  return { label, inputs: props };
}

function lastName(tsApi: typeof ts, name: ts.EntityName): string {
  return tsApi.isIdentifier(name) ? name.text : name.right.text;
}
