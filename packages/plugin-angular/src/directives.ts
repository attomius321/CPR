import { posix } from 'node:path';
import * as ng from '@angular/compiler';
import type { NgClass } from './classes.js';

/** A directive or component of the repo or a library, as the binder sees it, with its class. */
export interface Meta extends ng.DirectiveMeta {
  ref: { key: string; cls: NgClass };
}

/** The directives, components and pipes templates can use, for matching them. */
export interface Registry {
  matcher: ng.SelectorMatcher<Meta[]>;
  /** By class id. */
  metas: Map<string, Meta>;
  /** By pipe name. */
  pipes: Map<string, NgClass>;
  /** Inputs (class property → binding name), inherited ones included. */
  inputs(cls: NgClass): Map<string, string>;
  outputs(cls: NgClass): Map<string, string>;
}

/**
 * Matches templates against every directive of the repo and of the libraries it imports,
 * without NgModule or standalone scopes: a template that compiles can only use what its scope
 * offers, so this over-matches only when two directives share a selector.
 */
export function registry(classes: readonly NgClass[]): Registry {
  const byName = new Map<string, NgClass[]>();
  for (const cls of classes) byName.set(cls.name, [...(byName.get(cls.name) ?? []), cls]);

  const baseOf = (cls: NgClass): NgClass | undefined => {
    const base = cls.base;
    if (!base) return undefined;
    const candidates = byName.get(base.name) ?? [];
    if (!base.module) return candidates.find((c) => c.file === cls.file) ?? only(candidates);
    if (base.module.startsWith('.')) {
      const target = posix.normalize(posix.join(posix.dirname(cls.file), base.module));
      const stem = target.replace(/\.[cm]?js$/, '');
      return candidates.find((c) => {
        const file = c.file.replace(/\.[cm]?tsx?$/, '');
        return file === stem || file === `${stem}/index`;
      });
    }
    // A path alias (`@app/shared`): the class if its name is unique.
    return only(candidates);
  };

  const merged = (kind: 'inputs' | 'outputs') => {
    const cache = new Map<NgClass, Map<string, string>>();
    const of = (cls: NgClass, seen: Set<NgClass>): Map<string, string> => {
      const cached = cache.get(cls);
      if (cached) return cached;
      const base = baseOf(cls);
      const result = new Map(base && !seen.has(base) ? of(base, new Set([...seen, cls])) : []);
      for (const [property, binding] of cls[kind]) result.set(property, binding);
      cache.set(cls, result);
      return result;
    };
    return (cls: NgClass) => of(cls, new Set([cls]));
  };
  const inputs = merged('inputs');
  const outputs = merged('outputs');

  const matcher = new ng.SelectorMatcher<Meta[]>();
  const metas = new Map<string, Meta>();
  const pipes = new Map<string, NgClass>();
  for (const cls of classes) {
    if (cls.kind === 'Pipe' && cls.pipeName) pipes.set(cls.pipeName, cls);
    if ((cls.kind !== 'Component' && cls.kind !== 'Directive') || !cls.selector) continue;
    let selectors: ng.CssSelector[];
    try {
      selectors = ng.CssSelector.parse(cls.selector);
    } catch {
      continue;
    }
    const meta: Meta = {
      name: cls.name,
      ref: { key: cls.id, cls },
      selector: cls.selector,
      isComponent: cls.kind === 'Component',
      inputs: ng.ClassPropertyMapping.fromMappedObject(Object.fromEntries(inputs(cls))),
      outputs: ng.ClassPropertyMapping.fromMappedObject(Object.fromEntries(outputs(cls))),
      exportAs: cls.exportAs ?? null,
      isStructural: cls.structural,
      ngContentSelectors: null,
      preserveWhitespaces: false,
      animationTriggerNames: null,
      matchSource: ng.MatchSource.Selector,
    };
    metas.set(cls.id, meta);
    matcher.addSelectables(selectors, [meta]);
  }
  return { matcher, metas, pipes, inputs, outputs };
}

function only<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/** Whether a binder's directive is one of ours (not an element). */
export function isMeta(value: unknown): value is Meta {
  return (
    !!value &&
    typeof value === 'object' &&
    'ref' in value &&
    typeof (value as Meta).ref === 'object' &&
    'cls' in (value as Meta).ref
  );
}

/**
 * Where a directive shows in its element: the attribute its selector names (`[appHighlight]`,
 * `*ifAuthenticated`), else the tag. An offset in the template's file.
 */
export function directiveSite(
  node: ng.TmplAstElement | ng.TmplAstTemplate,
  selector: string | null,
): number {
  const tag = node.startSourceSpan.start.offset + 1;
  if (!selector) return tag;
  let parsed: ng.CssSelector[];
  try {
    parsed = ng.CssSelector.parse(selector);
  } catch {
    return tag;
  }
  const attributes = [
    ...node.attributes,
    ...node.inputs,
    ...node.outputs,
    ...(node instanceof ng.TmplAstTemplate ? node.templateAttrs : []),
  ];
  for (const css of parsed) {
    for (let i = 0; i < css.attrs.length; i += 2) {
      const name = css.attrs[i];
      const attribute = attributes.find((a) => a.name === name);
      const span = attribute && (attribute.keySpan ?? attribute.sourceSpan);
      if (span) return span.start.offset;
    }
  }
  return tag;
}
