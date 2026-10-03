import type { Shape, SymbolDecl } from './model.js';

/**
 * How a signature change affects existing users:
 * - `compatible`: existing uses keep working (an optional parameter, member or input was added).
 * - `additive`: readers keep working, but code that creates such values must add new required
 *   members (a required member or enum member was added, or one became required).
 * - `breaking`: existing uses may stop working (something removed, renamed or retyped).
 * - `unknown`: the forms could not be compared (overloads, classes, accessors).
 */
export type Compatibility = 'compatible' | 'additive' | 'breaking' | 'unknown';

export function compatibility(base: SymbolDecl, head: SymbolDecl): Compatibility {
  if (base.exported && !head.exported) return 'breaking';
  return compareShapes(base.shape, head.shape);
}

/**
 * When two versions differ only in their inputs (a component's props): which users the change
 * breaks, by the inputs a user passes — one passing an input that is gone or retyped, or not
 * passing one that is now required. `passed` undefined means unknown: such a user may break.
 * Undefined when anything else changed too.
 */
export function inputsBreak(
  base: SymbolDecl,
  head: SymbolDecl,
): ((passed: ReadonlySet<string> | undefined) => boolean) | undefined {
  const before = base.shape?.inputs;
  const after = head.shape?.inputs;
  if (!before || !after || (base.exported && !head.exported)) return undefined;
  if (compareShapes(withoutInputs(base.shape), withoutInputs(head.shape)) !== 'compatible') {
    return undefined;
  }
  const mustNotPass = Object.entries(before)
    .filter(([name, input]) => after[name]?.type !== input.type)
    .map(([name]) => name);
  const mustPass = Object.entries(after)
    .filter(([name, input]) => !input.optional && (before[name]?.optional ?? true))
    .map(([name]) => name);
  return (passed) =>
    !passed ||
    mustNotPass.some((name) => passed.has(name)) ||
    mustPass.some((name) => !passed.has(name));
}

function withoutInputs(shape: Shape | undefined): Shape | undefined {
  if (!shape) return undefined;
  const copy = { ...shape };
  delete copy.inputs;
  return copy;
}

export function compareShapes(base: Shape | undefined, head: Shape | undefined): Compatibility {
  if (!base || !head) return 'unknown';
  if (base.rest !== head.rest) return 'breaking';
  let result: Compatibility = 'compatible';

  if (base.params || head.params) {
    if (!base.params || !head.params) return 'unknown';
    for (const [i, before] of base.params.entries()) {
      const after = head.params[i];
      if (!after || after.type !== before.type || (before.optional && !after.optional)) {
        return 'breaking';
      }
    }
    if (head.params.slice(base.params.length).some((p) => !p.optional)) return 'breaking';
    if (base.returns !== head.returns) return 'breaking';
  }

  if (base.members || head.members) {
    const before = base.members ?? {};
    const after = head.members ?? {};
    for (const [name, member] of Object.entries(before)) {
      const next = after[name];
      if (!next || next.type !== member.type || (!member.optional && next.optional)) {
        return 'breaking';
      }
      if (member.optional && !next.optional) result = 'additive';
    }
    for (const [name, member] of Object.entries(after)) {
      if (!(name in before) && !member.optional) result = 'additive';
    }
  }

  // Inputs are what users pass (props): judged from their side. Passing one that is gone, or
  // not passing one that is now required, fails; one more optional input does not.
  if (base.inputs || head.inputs) {
    if (!base.inputs || !head.inputs) return 'unknown';
    const before = base.inputs;
    const after = head.inputs;
    for (const [name, input] of Object.entries(before)) {
      const next = after[name];
      if (!next || next.type !== input.type || (input.optional && !next.optional)) {
        return 'breaking';
      }
    }
    for (const [name, input] of Object.entries(after)) {
      if (!(name in before) && !input.optional) return 'breaking';
    }
  }
  return result;
}
