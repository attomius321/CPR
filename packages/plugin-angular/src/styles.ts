import * as ng from '@angular/compiler';
import type { Mention, SymbolId } from '@symbiote/core';
import type { SourceString } from './classes.js';
import type { ParsedTemplate } from './template.js';

const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/;
/** Bindings whose value is a class list: `[ngClass]`, `[class]`, `[className]`. */
const CLASS_LISTS = new Set(['ngClass', 'class', 'className']);

/**
 * The classes a template names statically, with their offsets in `text` (the template's file):
 * `class="a b"`, `[class.a]`, and the strings and keys of `[ngClass]` and `[class]` (built names
 * such as `'tone-' + kind` name none).
 */
export function templateClasses(parsed: ParsedTemplate): { name: string; offset: number }[] {
  const found: { name: string; offset: number }[] = [];
  const words = (text: string, offset: number) => {
    for (const match of text.matchAll(/\S+/g)) {
      if (CLASS_NAME.test(match[0])) found.push({ name: match[0], offset: offset + match.index });
    }
  };
  const expression = (ast: ng.AST): void => {
    if (ast instanceof ng.ASTWithSource) {
      if (ast.ast) expression(ast.ast as ng.AST);
    } else if (ast instanceof ng.LiteralPrimitive) {
      if (typeof ast.value === 'string') words(ast.value, ast.sourceSpan.start + 1);
    } else if (ast instanceof ng.LiteralMap) {
      for (const key of ast.keys) {
        if (key.kind === 'property' && CLASS_NAME.test(key.key)) {
          found.push({ name: key.key, offset: key.sourceSpan.start + (key.quoted ? 1 : 0) });
        }
      }
    } else if (ast instanceof ng.LiteralArray) {
      for (const item of ast.expressions) expression(item);
    } else if (ast instanceof ng.Conditional) {
      expression(ast.trueExp);
      expression(ast.falseExp);
    }
  };
  visitElements(parsed.nodes, (node) => {
    for (const attribute of node.attributes) {
      if (attribute.name === 'class' && attribute.valueSpan) {
        words(attribute.value, attribute.valueSpan.start.offset);
      }
    }
    for (const input of node.inputs) {
      if (input.type === ng.BindingType.Class) {
        // `[class.active]`: the key span starts at `class.`.
        if (CLASS_NAME.test(input.name)) {
          found.push({ name: input.name, offset: input.keySpan.start.offset + 'class.'.length });
        }
      } else if (input.type === ng.BindingType.Property && CLASS_LISTS.has(input.name)) {
        expression(input.value);
      }
    }
  });
  return found;
}

/** The classes a component's `host` sets: `class: 'a b'` and `'[class.a]'` keys. */
export function hostClasses(
  host: readonly { key: string; value: SourceString }[],
): { name: string; offset: number }[] {
  const found: { name: string; offset: number }[] = [];
  for (const { key, value } of host) {
    if (key === 'class') {
      for (const match of value.text.matchAll(/\S+/g)) {
        if (CLASS_NAME.test(match[0]))
          found.push({ name: match[0], offset: value.start + match.index });
      }
    } else {
      const binding = /^\[class\.([-\w]+)\]$/.exec(key);
      // The key's own position is not kept: the value's is close by.
      if (binding?.[1]) found.push({ name: binding[1], offset: value.start });
    }
  }
  return found;
}

/** Class mentions at offsets of a file's text, as `Mention`s owned by `from`. */
export function classMentions(
  from: SymbolId,
  file: string,
  text: string,
  classes: readonly { name: string; offset: number }[],
): Mention[] {
  return classes.map(({ name, offset }) => ({
    from,
    kind: 'class',
    name,
    site: { file, ...lineAndCol(text, offset) },
  }));
}

function lineAndCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, col: offset - start + 1 };
}

/** Every element and `<ng-template>` of a template, in blocks and projections too. */
function visitElements(
  nodes: readonly ng.TmplAstNode[],
  fn: (node: ng.TmplAstElement | ng.TmplAstTemplate) => void,
): void {
  for (const node of nodes) {
    if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstTemplate) {
      fn(node);
      visitElements(node.children, fn);
    } else if (node instanceof ng.TmplAstForLoopBlock) {
      visitElements(node.children, fn);
      if (node.empty) visitElements(node.empty.children, fn);
    } else if (node instanceof ng.TmplAstIfBlock) {
      for (const branch of node.branches) visitElements(branch.children, fn);
    } else if (node instanceof ng.TmplAstSwitchBlock) {
      for (const group of node.groups) visitElements(group.children, fn);
    } else if (node instanceof ng.TmplAstDeferredBlock) {
      visitElements(node.children, fn);
      for (const part of [node.placeholder, node.loading, node.error]) {
        if (part) visitElements(part.children, fn);
      }
    } else if (node instanceof ng.TmplAstContent) {
      visitElements(node.children, fn);
    }
  }
}
