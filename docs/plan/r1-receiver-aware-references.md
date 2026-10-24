# R1 — Receiver-aware references ✅

[Index](../PLAN.md) · [Journal](../journal/r1-receiver-aware-references.md)

**Problem** (found on an Angular project): TypeScript's reference search is built for safe
renaming, so it treats every class in a family as related. When `CbsComponent` overrides a
property declared by its base class `ResourceBase`, the search for `CbsComponent.panelDisplayType`
also returns `this.panelDisplayType` inside every *sibling* class (`RentCarsResourceComponent`,
…) and the base declaration itself. Symbiote lists them all as "used by", although a sibling object can
never be a `CbsComponent`. The same cause gives Angular's `ngOnInit` "used by 11" (every component
implements `OnInit`) and puts siblings into `signature-changed` user counts.

**Rule:** a reference counts as a use of a class member only if the code could run with an
instance of the member's class. Symbiote looks at the object the member is read from — `x` in
`x.member`, the class itself for `this`/implicit `this` — and asks the checker for its class:

| Object's class | Example | Result |
|---|---|---|
| The member's class or a subclass | `this.m` inside `CbsComponent`; `cbs.m` via `@ViewChild` | use (certain) |
| An ancestor class or an interface it implements | `this.m` in a `ResourceBase` method; `item: ResourceBase` | use, marked **possible** |
| Unrelated (sibling, cousin) | `this.m` in `RentCarsResourceComponent` | dropped |
| Unknown (`any`, JS, type parameters without a constraint) | `obj.m` | use (unsure → keep) |

Declaration sites returned by the search are not uses:
- **an ancestor's declaration** of the member (the base `panelDisplayType`) → an `overrides` edge
  from the member to it;
- **a subclass's override** → an `overrides` edge from the override to the member (it must stay
  compatible, so it still counts for `signature-changed`);
- **a sibling's declaration** (another component's `ngOnInit`) → dropped.

Symbols that are not class members (functions, variables, types) are not affected.

**Graph contract (schema 0.4.0):** new edge kind `overrides`; edges gain optional
`possible: true` when every site reaches the member only through an ancestor or interface type.
The viewer labels such neighbours "possible".

**Verification**
1. A fixture mirroring the Angular case: a base class, an overriding class, a sibling, a base
   method, a polymorphic user (`ResourceBase`-typed value), a subclass override, and two classes
   implementing a shared interface method — each with its expected result.
2. Golden graphs may change only where class families are involved; every changed line is checked.
3. Before/after edge diffs on ky, zod, vite and the Angular 11 RealWorld app: every edge that
   disappears is inspected and must be a sibling or declaration case.

**Risk:** medium-low. The only harmful outcome is dropping a real use; "unknown → keep" and step 3
guard against it. **Cost:** one type lookup per reference.

Not in R1 (listed for later): reading Angular templates, `.symbioteignore` from the working folder,
`interfaces/` matching at any depth, decorator-only class changes treated as compatible. (Since
done: templates and decorators in A1–A2, `.symbioteignore` in a fix of its own; see the journal.)
