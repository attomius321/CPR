import * as ng from '@angular/compiler';
import { canonical, unwrap } from './expressions.js';

/** Template syntax of the project's Angular version. */
export interface Syntax {
  /** `@if`/`@for`… blocks and `@let` (Angular 17+). Never one without the other: the parser
   *  loops forever on `@let` with blocks on and `@let` off. */
  blocks: boolean;
}

export interface ParsedTemplate {
  nodes: ng.TmplAstNode[];
  /** Parse errors, `line:col message` (1-based, in the template's file). */
  errors: string[];
  bound: ng.BoundTarget<ng.DirectiveMeta>;
}

/** Where an inline template sits in its `.ts` file. */
export interface InlineRange {
  /** Offset of the first character inside the quotes. */
  start: number;
  /** Offset of the closing quote. */
  end: number;
}

const MAX_CACHED = 5000;
const cache = new Map<string, ParsedTemplate>();
const EMPTY_BINDER = new ng.R3TargetBinder(new ng.SelectorMatcher<ng.DirectiveMeta[]>());

/**
 * Parses a template with Angular's own parser. Base and head share most templates, so results
 * are cached by text. For an inline template, `text` is its whole `.ts` file and spans are
 * offsets in it. Never throws: a parser crash is an error like a syntax error.
 */
export function parseTemplate(
  text: string,
  url: string,
  syntax: Syntax,
  inline?: InlineRange,
): ParsedTemplate {
  const key = inline
    ? `${url}\0${syntax.blocks}\0${inline.start}\0${text.slice(inline.start, inline.end)}`
    : `${url}\0${syntax.blocks}\0${text}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let parsed: ParsedTemplate;
  try {
    const result = ng.parseTemplate(text, url, {
      // Collapsing whitespace rewrites text and shifts interpolation offsets: keep it.
      preserveWhitespaces: true,
      enableBlockSyntax: syntax.blocks,
      enableLetSyntax: syntax.blocks,
      ...(inline
        ? {
            range: {
              ...lineAndCol(text, inline.start),
              startPos: inline.start,
              endPos: inline.end,
            },
            escapedString: true,
          }
        : {}),
    });
    parsed = {
      nodes: result.nodes,
      errors: (result.errors ?? []).map(
        (e) =>
          `${e.span.start.line + 1}:${e.span.start.col + 1} ${e.msg.replace(/ in \S+@\d+:\d+$/, '')}`,
      ),
      bound: EMPTY_BINDER.bind({ template: result.nodes }),
    };
  } catch (error) {
    parsed = {
      nodes: [],
      errors: [`parser failed: ${(error as Error).message}`],
      bound: EMPTY_BINDER.bind({ template: [] }),
    };
  }
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, parsed);
  return parsed;
}

function lineAndCol(text: string, offset: number): { startLine: number; startCol: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { startLine: line, startCol: offset - lineStart };
}

/**
 * The template as tokens for its body hash: tags, attributes, bindings and text, with
 * whitespace, comments and quoting left out, and expressions in canonical form.
 */
export function templateTokens(parsed: ParsedTemplate, text: string): string[] {
  if (parsed.errors.length > 0) return text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const expression = (ast: ng.AST | null | undefined) => {
    if (ast) out.push(canonical(ast));
  };
  const visit = (nodes: readonly ng.TmplAstNode[]): void => {
    for (const node of nodes) {
      if (node instanceof ng.TmplAstText) {
        const value = node.value.replace(/\s+/g, ' ').trim();
        if (value) out.push(value);
      } else if (node instanceof ng.TmplAstBoundText) {
        const value = unwrap(node.value);
        if (value instanceof ng.Interpolation) {
          value.strings.forEach((s, i) => {
            const piece = s.replace(/\s+/g, ' ').trim();
            if (piece) out.push(piece);
            const e = value.expressions[i];
            if (e) out.push(`{{${canonical(e)}}}`);
          });
        } else {
          expression(node.value);
        }
      } else if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstTemplate) {
        out.push(`<${node instanceof ng.TmplAstElement ? node.name : `template:${node.tagName}`}`);
        for (const a of node.attributes) out.push(`${a.name}=${JSON.stringify(a.value)}`);
        if (node instanceof ng.TmplAstTemplate) {
          for (const a of node.templateAttrs) {
            out.push(`*${a.name}=`);
            if (a instanceof ng.TmplAstTextAttribute) out.push(JSON.stringify(a.value));
            else expression(a.value);
          }
          for (const v of node.variables) out.push(`let-${v.name}=${v.value}`);
        }
        for (const i of node.inputs) {
          out.push(`[${i.name}]=`);
          expression(i.value);
        }
        for (const o of node.outputs) {
          out.push(`(${o.name})=`);
          expression(o.handler);
        }
        for (const r of node.references) out.push(`#${r.name}=${r.value}`);
        out.push('>');
        visit(node.children);
        out.push('</>');
      } else if (node instanceof ng.TmplAstForLoopBlock) {
        out.push(`@for(${node.item.name} of`);
        expression(node.expression);
        out.push('track');
        expression(node.trackBy);
        for (const v of node.contextVariables) {
          if (v.name !== v.value) out.push(`let ${v.name}=${v.value}`);
        }
        out.push('){');
        visit(node.children);
        out.push('}');
        if (node.empty) {
          out.push('@empty{');
          visit(node.empty.children);
          out.push('}');
        }
      } else if (node instanceof ng.TmplAstIfBlock) {
        for (const branch of node.branches) {
          out.push('@if(');
          expression(branch.expression);
          if (branch.expressionAlias) out.push(`as ${branch.expressionAlias.name}`);
          out.push('){');
          visit(branch.children);
          out.push('}');
        }
      } else if (node instanceof ng.TmplAstSwitchBlock) {
        out.push('@switch(');
        expression(node.expression);
        out.push('){');
        for (const group of node.groups) {
          for (const c of group.cases) {
            out.push('@case(');
            expression(c.expression);
            out.push(')');
          }
          out.push('{');
          visit(group.children);
          out.push('}');
        }
        out.push('}');
      } else if (node instanceof ng.TmplAstDeferredBlock) {
        out.push('@defer(');
        for (const trigger of deferTriggers(node)) {
          out.push(trigger.constructor.name);
          if (trigger instanceof ng.TmplAstBoundDeferredTrigger) expression(trigger.value);
        }
        out.push('){');
        visit(node.children);
        for (const part of [node.placeholder, node.loading, node.error]) {
          if (!part) continue;
          out.push(`@${part.constructor.name}{`);
          visit(part.children);
          out.push('}');
        }
        out.push('}');
      } else if (node instanceof ng.TmplAstLetDeclaration) {
        out.push(`@let ${node.name}=`);
        expression(node.value);
      } else if (node instanceof ng.TmplAstContent) {
        out.push(`<ng-content ${node.selector}>`);
        visit(node.children);
        out.push('</>');
      } else if ('sourceSpan' in node) {
        const span = (node as { sourceSpan: ng.ParseSourceSpan }).sourceSpan;
        const value = span.toString().replace(/\s+/g, ' ').trim();
        if (value) out.push(value);
      }
    }
  };
  visit(parsed.nodes);
  return out;
}

/** Every trigger of a `@defer` block: main, prefetch and hydrate. */
export function deferTriggers(block: ng.TmplAstDeferredBlock): ng.TmplAstDeferredTrigger[] {
  return [block.triggers, block.prefetchTriggers, block.hydrateTriggers].flatMap((triggers) =>
    Object.values(triggers).filter((t): t is ng.TmplAstDeferredTrigger => !!t),
  );
}
