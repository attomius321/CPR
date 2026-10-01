import type { Shape, SymbolDecl } from './model.js';

/**
 * How a signature change affects existing users:
 * - `compatible`: existing uses keep working (an optional parameter or member was added).
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
  return result;
}
