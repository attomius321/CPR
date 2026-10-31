# D2 — your blind sample

35 items drawn at random (seed 20261101): 22 of Symbiote's 97 findings and 13 of the AI reviewers' 119 comments. Tick one box per item; a note is welcome but optional. Please do not open `data/scores.json` before you finish.

- **Right and worth reading**: true, and it names something the diff does not make obvious; a reviewer would check or ask about it.
- **Right but noise**: true, but nothing to act on.
- **Wrong**: a claim in it is false at the commit it talks about.

## s01 · Review comment · pullfrog[bot]

[zod #6491](https://github.com/colinhacks/zod/pull/6491) — feat(mini): publish Zod Mini as the standalone @zod/mini package (#6491)

> `expectedMiniPeer` is computed unconditionally, so it never carries a prerelease tag even though the version check right below it has a dedicated `tag !== "latest"` branch. A prerelease only satisfies a range when a comparator shares its exact `major.minor.patch` *and* carries a prerelease tag itself, so `zod@4.5.1-beta.0` does not satisfy `^4.5.0` — verified with `semver.satisfies`, false even under `includePrerelease`. Publishing `@zod/mini` under a `beta` tag would ship a peer range that the zod beta released alongside it cannot satisfy.
> 
> Technical details
> 
> ````markdown
> # Prerelease publishes of @zod/mini get an unsatisfiable peer range
> 
> ## Affected sites
> - `scripts/check-versions.ts:69` — `expectedMiniPeer = ^${version.major}.${version.minor}.0`, no prerelease branch.
> - `scripts/check-versions.ts:70` — `isMiniVersionValid` allows a prerelease mini version via `startsWith`, so the two halves of the check disagree about whether prereleases are supported.
> 
> ## Evidence
> ```
> semver.satisfies("4.6.0-beta.1", "^4.6.0")                          // false
> semver.satisfies("4.6.0-beta.1", "^4.6.0", {includePrerelease:true}) // false
> ```
> Reachable through `pnpm publish --tag beta` from `packages/mini`, which runs `prepublishOnly` with `npm_config_tag=beta`. zod does run beta cycles — the `4.0.0-beta.*` versions already sitting on `@zod/mini` are from one.
> 
> ## Required outcome
> - On a prerelease publish, the enforced peer range is one the zod prerelease shipping in the same cycle actually satisfies.
> - The version check and the peer check agree on whether prereleases are a supported path at all; if they aren't, the prerelease branch should reject rather than pass with a range nothing can match.
> 
> ## Open questions for the human
> - Is publishing `@zod/mini` on a prerelease tag in scope? If it isn't, the simpler fix is to fail the mini check outright when `npm_config_tag !== "latest"`.
> ````
> 
> 

```diff
scripts/check-versions.ts:69 (commented on 89aeddeff8)
   }
 }
+
+// @zod/mini ships in lockstep with zod and its peer floor is the minor it shipped with
+const miniPackageJson = JSON.parse(readFileSync(join(__dirname, "..", "packages", "mini", "package.json"), "utf8"));
+const miniVersion = miniPackageJson.version as string;
+const miniPeer = miniPackageJson.peerDependencies?.zod as string | undefined;
+const expectedMiniPeer = `^${version.major}.${version.minor}.0`;
```

Thread:
- pullfrog[bot]: Addressed in 261c284 — the prerelease path now rejects a `@zod/mini` publish outright rather than enforcing an unsatisfiable range, and I confirmed pnpm does set `npm_package_name` so the guard fires.

[the comment on GitHub](https://github.com/colinhacks/zod/pull/6491#discussion_r3883985447)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s02 · Review comment · github-code-quality[bot]

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> ## Implicit operand conversion
> 
> This expression will be implicitly converted from undefined to number.

```diff
libs/vault/src/components/vault-items-table/vault-items-table.component.spec.ts:1554 (commented on 84127539fb)
+
+      expect(selectionModel().allSelected()).toBe(false);
+      expect(selectionModel().indeterminate()).toBe(true);
+    });
+
+    /** The partial header still clears, so the cap can't strand it — see `toggleAll`. */
+    it("clears from the partial header at the cap", () => {
+      const many = Array.from({ length: MAX_SELECTION_COUNT + 25 }, (_, i) =>
```

[the comment on GitHub](https://github.com/bitwarden/clients/pull/22260#discussion_r3898308757)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s03 · Review comment · claude[bot]

[bitwarden #22539](https://github.com/bitwarden/clients/pull/22539) — chore(lock): Move LockService into libs/unlock and add lock/unlock source tracking (#22539)

> ♻️ **DEBT**: This introduces a package-level cycle between `@bitwarden/unlock` and `@bitwarden/auth`.
> 
> 
> Details and fix
> 
> `@bitwarden/auth` already depends on `@bitwarden/unlock` (e.g. `libs/auth/src/common/login-strategies/password-login.strategy.ts:26`, `libs/auth/src/common/services/login-strategies/login-strategy.service.ts:40` import `UnlockService`). With this move, `@bitwarden/unlock` now imports back into `@bitwarden/auth/common` for `LogoutService`.
> 
> It compiles today because `LogoutService` is only used as a type here, so the import is elided — but nothing prevents the next value-level import from making it a real runtime cycle. `libs/unlock` has no entry in the "Bandaids for keeping existing circular dependencies from getting worse and new ones from being created" block in `eslint.config.mjs`, so the boundary check that would flag this for a KM-owned lib (`KEY_MANAGEMENT_FORBIDDEN_PACKAGES` lists `@bitwarden/auth`) doesn't apply here.
> 
> Worth either relocating the `LogoutService` abstraction out of `@bitwarden/auth/common`, or adding an explicit `libs/unlock/src/**/*.ts` boundary entry documenting that this one import is the accepted exception.
> 

```diff
libs/unlock/src/lock.service.ts:3 (commented on 49426cc115)
@@ -1,51 +1,57 @@
 import { combineLatest, filter, firstValueFrom, map, timeout } from "rxjs";
 
+import { LogoutService } from "@bitwarden/auth/common";
```

[the comment on GitHub](https://github.com/bitwarden/clients/pull/22539#discussion_r3819936085)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s04 · Review comment · claude[bot]

[bitwarden #22893](https://github.com/bitwarden/clients/pull/22893) — [PM-42854] bugs with policies drawers (#22893)

> ♻️ **DEBT**: These VFO1 variants now duplicate their legacy strings verbatim — consider reusing the legacy keys instead.
> 
> 
> Details and fix
> 
> `automaticAppLoginWithSSODescListVfo1` is now byte-identical to `automaticAppLoginWithSSODescV2`, and `freeFamiliesSponsorshipDescVfo1` (line 14918) is identical to `freeFamiliesSponsorshipPolicyDescV2`. Duplicated `en` strings are translated twice in Crowdin and can silently drift apart on a later copy edit.
> 
> When the VFO1 copy matches the legacy copy, existing definitions point the VFO1 property at the legacy key rather than duplicating the message — e.g. `uri-match-default.component.ts` uses `drawerDescriptionVfo1 = "uriMatchDetectionPolicyDescV2"` and `two-factor-authentication.component.ts` uses `drawerDescriptionVfo1 = "twoStepLoginPolicyDescV2"`.
> 
> Here the simplest equivalent is to drop `descriptionVfo1`/`drawerDescriptionVfo1` from `AutomaticAppLoginPolicy`, drop `descriptionVfo1` from `FreeFamiliesSponsorshipPolicy`, and delete the two now-redundant keys — the `?? policy.description` fallback in `policyDescriptionKeys`/`policyDrawerDescriptionKeys` renders the same copy.
> 

```diff
apps/web/src/locales/en/messages.json:9569 (commented on 912b032680)
@@ -9562,7 +9566,7 @@
     "message": "When users launch an app from your identity provider, their login details will be automatically filled and submitted, creating a one-click, secure login."
   },
   "automaticAppLoginWithSSODescListVfo1": {
-    "message": "Login forms will automatically be filled and submitted for apps launched from your configured identity provider.",
+    "message": "When users launch an app from your identity provider, their login details will be automatically filled and submitted, creating a one-click, secure login.",
```

[the comment on GitHub](https://github.com/bitwarden/clients/pull/22893#discussion_r3917623705)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s05 · Review comment · pullfrog[bot]

[zod #6546](https://github.com/colinhacks/zod/pull/6546) — docs: Zod 4.6 announcement post (#6546)

> The linked harness does not actually benchmark this pair together: plain and compiled targets run in separate timing blocks, and each operation keeps an independent best-of-15 minimum. Please either add an interleaved cross-mode measurement and regenerate this chart, or remove the cross-mode `32x` claim.
> 
> Technical details
> 
> ````markdown
> # Cross-mode ratio is not paired
> 
> ## Affected sites
> - packages/docs/content/blog/zod-4-6.mdx:88-94 — publishes a ratio between compiled validation and plain parsing
> - packages/bench/validate-vs-safeparse.ts:154-160 — selects independent minima for the two operations
> - packages/bench/validate-vs-safeparse.ts:182-221 — creates plain and compiled targets separately, then measures each target to completion
> 
> ## Required outcome
> - Derive the chart from plain `.safeParse().success` and compiled `z.validate()` calls alternated within the same rounds, or omit the cross-mode comparison.
> ````
> 
> 

```diff
packages/docs/content/blog/zod-4-6.mdx:88 (commented on 0860cedcfb)
+<ThemedImage
+  lightSrc="/blog/validate-compiled-invalid-light.svg"
+  darkSrc="/blog/validate-compiled-invalid-dark.svg"
+  alt="Time per call on invalid input, schemas compiled with z.compile(), safeParse().success as a gray bar with z.validate() as a blue bar inside it: a union of 3 objects 32 ns (35.6x faster), an array of 10 strings 22 ns (23.6x), a 3-element tuple 27 ns (17.5x), a 5-key object 20 ns (16.9x), a discriminated union of 3 22 ns (14.6x), z.string() 18 ns (15.5x), z.number() 18 ns (15.1x), z.boolean() 18 ns (14.8x); up to 35.6x faster"
+  caption={<>Time per call on invalid input, compiled with z.compile() — lower is better (<a href="https://github.com/colinhacks/zod/blob/main/packages/bench/validate-vs-safeparse.ts">benchmark</a>)</>}
+/>
+
+That chart compares two compiled calls. Against a plain, uncompiled `.safeParse().success` — the upgrade most callers are actually making — it is up to 32x faster.
```

Thread:
- pullfrog[bot]: Addressed in c95f148 by removing the cross-mode comparison.

[the comment on GitHub](https://github.com/colinhacks/zod/pull/6546#discussion_r3909002345)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s06 · Review comment · claude[bot]

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> ❌ **CRITICAL**: The web host on this PR's base renders this table without providing `VaultBatchBarService`, so the vault route will throw `NullInjectorError`.
> 
> 
> Details and fix
> 
> The PR description notes "No consumer exists on this base" — that held while this was stacked on `vault/pm-40312/...`, but the base is now `main` and PM-40312 has landed, so a consumer does exist:
> 
> - `apps/web/src/app/vault/individual-vault/vault-next.component.html:8` renders `<vault-items-table>`
> - `apps/web/src/app/vault/individual-vault/vault-next.component.ts:75-78` provides only `DefaultCipherFormConfigService` and `WebVaultItemActionsService`
> 
> `VaultBatchBarService` is `@Injectable()` with no `providedIn`, and nothing in the ancestor chain provides it — `vault.module.ts` and `vault-routing.module.ts` declare no providers, and the only web providers are the legacy `individual-vault/vault.component.ts:186` and `admin-console/organizations/collections/vault.component.ts:141`, neither of which is an ancestor of `VaultNextComponent` (it is a top-level route component). With `FeatureFlag.VFO1Foundation` on, constructing the table throws `NG0201: No provider for VaultBatchBarService` and the page fails to render.
> 
> CI will not catch this: `vault-next.component.spec.ts:201-211` replaces the table with `NO_ERRORS_SCHEMA`.
> 
> Desktop is unaffected — `apps/desktop/src/vault/app/vault-v3/vault.component.ts:163` provides the service above `app-vault-list-table`.
> 
> Two ways out:
> 
> 1. Wire the host in this PR — provide `VaultBatchBarService` in `VaultNextComponent` along with the collaborators it injects that are not root-provided (`RoutedVaultFilterService`, `RoutedVaultFilterBridgeService`, `ASSIGN_COLLECTIONS_DIALOG`, `BULK_DELETE_DIALOG`), and render `<bit-vault-batch-action />` as the class docs now require.
> 2. Inject with `{ optional: true }` and no-op both effects when it is absent, so a host without a batch bar keeps working.
> 

```diff
libs/vault/src/components/vault-items-table/vault-items-table.component.ts:243 (commented on f69db57f42)
 export class VaultItemsTableComponent<C extends CipherViewLike> {
   private readonly i18nService = inject(I18nService);
 
+  /**
+   * The batch bar's selection state, bridged to the table's own in {@link bridgeSelection}. A
+   * required collaborator the host provides — see the class docs.
+   */
+  private readonly batchBarService = inject<VaultBatchBarService<C>>(VaultBatchBarService);
```

Thread:
- jaasen-livefront: Fixed in https://github.com/bitwarden/clients/commit/e85193687c5d29810822f9b992bef0e5b96def95

[the comment on GitHub](https://github.com/bitwarden/clients/pull/22260#discussion_r3846092008)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s07 · Review comment · github-code-quality[bot]

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> ## Implicit operand conversion
> 
> This expression will be implicitly converted from undefined to number.

```diff
libs/vault/src/components/vault-items-table/vault-items-table.component.spec.ts:1519 (commented on 84127539fb)
+
+    /**
+     * Bulk actions turn each selected item into per-cipher permission checks and request payloads,
+     * so select-all over a very large vault is capped rather than unbounded — matching the cap the
+     * legacy vault-items component applies.
+     */
+    it("caps the selection itself at MAX_SELECTION_COUNT", () => {
+      const many = Array.from({ length: MAX_SELECTION_COUNT + 25 }, (_, i) =>
```

[the comment on GitHub](https://github.com/bitwarden/clients/pull/22260#discussion_r3898308738)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s08 · Symbiote finding · warning · signature-changed

[zod #6380](https://github.com/colinhacks/zod/pull/6380) — feat(json-schema): accept a function for `unrepresentable` (#6380)

> Seen changed its signature; 3 of 4 users not updated: JSONSchemaGenerator.seen, extractDefs, process

```diff
Change to packages/zod/src/v4/core/to-json-schema.ts#Seen:
@@ -9,8 +9,6 @@ export interface Seen {
   /** Cycle path */
   cycle?: (string | number)[] | undefined;
   isParent?: boolean | undefined;
-  /** Deferred `unrepresentable: "throw"` error, thrown after `override` gets a chance to handle it */
-  unrepresentable?: string | undefined;
   /** Schema to inherit JSON Schema properties from (set by processor for wrappers) */
   ref?: schemas.$ZodType | null;
   /** JSON Schema property path for this schema */


Used by packages/zod/src/v4/core/json-schema-generator.ts#JSONSchemaGenerator.seen (unchanged):
packages/zod/src/v4/core/json-schema-generator.ts:80
  }
  /** @deprecated Access via ctx instead */
  get seen(): Map<schemas.$ZodType, Seen> {
    return this.ctx.seen;
  }

Used by packages/zod/src/v4/core/to-json-schema.ts#extractDefs (unchanged):
packages/zod/src/v4/core/to-json-schema.ts:293
  // returns a ref to the schema
  // defId will be empty if the ref points to an external schema (or #)
  const makeURI = (entry: [schemas.$ZodType<unknown, unknown>, Seen]): { ref: string; defId?: string } => {
    // comparing the seen objects because sometimes
    // multiple schemas map to the same seen object.
packages/zod/src/v4/core/to-json-schema.ts:328
  // stored cached version in `def` property
  // remove all properties, set $ref
  const extractToDef = (entry: [schemas.$ZodType<unknown, unknown>, Seen]): void => {
    // if the schema is already a reference, do not extract it
    if (entry[1].schema.$ref) {

Used by packages/zod/src/v4/core/to-json-schema.ts#process (unchanged):
packages/zod/src/v4/core/to-json-schema.ts:211

  // initialize
  const result: Seen = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);


Used by packages/zod/src/v4/core/to-json-schema.ts#ToJSONSchemaContext (modified):
packages/zod/src/v4/core/to-json-schema.ts:124
  io: "input" | "output";
  counter: number;
  seen: Map<schemas.$ZodType, Seen>;
  cycles: "ref" | "throw";
  reused: "ref" | "inline";
```

[the symbol at head](https://github.com/colinhacks/zod/blob/51e93234d83cbb5915b3d52942ecb01d039f5040/packages/zod/src/v4/core/to-json-schema.ts#L93-L108) · [the symbol at base](https://github.com/colinhacks/zod/blob/9d20fdc3c37207fa3fe77c9524a3421f4399cbf6/packages/zod/src/v4/core/to-json-schema.ts#L79-L96)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s09 · Review comment · pullfrog[bot]

[zod #6411](https://github.com/colinhacks/zod/pull/6411) — fix(v4): make fromJSONSchema propertyNames compose with the other object keywords (#6411)

> With the `required` fallback gone, `additionalSchema` has exactly one consumer left (line 462), inside the `else` that only runs when `patternProperties` is absent — but it is still computed unconditionally. That turns a previously-lazy conversion into an eager one, so a schema whose `additionalProperties` was harmlessly ignored can now throw during conversion.
> 
> Technical details
> 
> ````markdown
> # Hoisted `additionalSchema` converts a subschema the branch never uses
> 
> ## Affected sites
> - `packages/zod/src/v4/classic/from-json-schema.ts:408-411` — computed before the `patternProperties` / `else` split.
> - `packages/zod/src/v4/classic/from-json-schema.ts:462-464` — the only remaining read.
> 
> ## Reproduction
> ```ts
> fromJSONSchema({
>   type: "object",
>   patternProperties: { "^S_": { type: "string" } },
>   additionalProperties: { not: { type: "string" } },
> });
> // throws: not is not supported in Zod (except { not: {} } for never)
> // on main this converts fine — additionalProperties is ignored when
> // patternProperties is present, so it was never converted
> ```
> `convertSchema` also mutates `ctx` (refs, registry), so the eager call has side effects for a schema that is then discarded.
> 
> ## Required outcome
> `additionalProperties` is converted only on the path that consumes it, restoring the previous behavior for the `patternProperties` combination.
> 
> ## Suggested approach (optional)
> Delete lines 408-411 and put the conversion back inline at line 464: `zodSchema = objectSchema.catchall(convertSchema(schema.additionalProperties as JSONSchema.JSONSchema, ctx));`, with the guard at 462 back to `typeof schema.additionalProperties === "object"`.
> ````
> 
> 

```diff
packages/zod/src/v4/classic/from-json-schema.ts:411 (commented on 9bf1a422b9)
@@ -375,34 +405,18 @@ function convertBaseSchema(schema: JSONSchema.JSONSchema, ctx: ConversionContext
       const properties = schema.properties || {};
       const requiredSet = new Set(schema.required || []);
 
+      const additionalSchema =
+        typeof schema.additionalProperties === "object"
+          ? convertSchema(schema.additionalProperties as JSONSchema.JSONSchema, ctx)
+          : undefined;
```

[the comment on GitHub](https://github.com/colinhacks/zod/pull/6411#discussion_r3780549741)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s10 · Symbiote finding · warning · exported-api-changed

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> VaultBatchBarService.clear was removed from the package's public API

```diff
Change to libs/vault/src/services/vault-batch-bar.service.ts#VaultBatchBarService.clear:
@@ -1,4 +0,0 @@
-  clear(): void {
-    this.selection.clear();
-    this._cleared$.next();
-  }

```

[the symbol at base](https://github.com/bitwarden/clients/blob/26c25d3d4e9463714ffe30d2b6727615ba56dac9/libs/vault/src/services/vault-batch-bar.service.ts#L395-L398)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s11 · Review comment · claude[bot]

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> ⚠️ **IMPORTANT**: Finding 1: The bar renders without the `PM37785_VaultBatchBar` gate the other three hosts apply.
> 
> 
> Details and fix
> 
> `VaultBatchActionComponent` does not self-gate — its constructor attaches the portal unconditionally, and `bit-bulk-actions-bar` reveals itself purely on `effectiveCount() > 0`. `barVisible()` (flag ∧ count) is never read by the component. So with `PM37785_VaultBatchBar` off, checking a row on this page shows a fully functional bulk bar.
> 
> Every other call site gates it:
> 
> - `apps/web/src/app/vault/individual-vault/vault.component.html:109`
> - `apps/web/src/app/admin-console/organizations/collections/vault.component.html:164`
> - `apps/desktop/src/vault/app/vault-v3/vault.component.html:88`
> 
> Fix: wrap it the same way, e.g. a `vaultBatchBarFeatureFlag` signal on the component, or `@if (batchBarService.enabled())` since the service already exposes `enabled`.
> 
> 

```diff
apps/web/src/app/vault/individual-vault/vault-next.component.html:72 (commented on 2229c0e9bb)
@@ -68,3 +68,5 @@
     }
   </div>
 </vault-items-table>
+
+<bit-vault-batch-action />
```

[the comment on GitHub](https://github.com/bitwarden/clients/pull/22260#discussion_r3961657801)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s12 · Symbiote finding · info · signature-changed

[zod #6380](https://github.com/colinhacks/zod/pull/6380) — feat(json-schema): accept a function for `unrepresentable` (#6380)

> literalProcessor changed its signature compatibly; existing users keep working (2 users, 2 untouched)

```diff
Change to packages/zod/src/v4/core/json-schema-processors.ts#literalProcessor:
@@ -1,11 +1,15 @@
-export const literalProcessor: Processor<schemas.$ZodLiteral> = (schema, ctx, json, _params) => {
+export const literalProcessor: Processor<schemas.$ZodLiteral> = (schema, ctx, json, params) => {
   const def = schema._zod.def as schemas.$ZodLiteralDef<any>;
   const vals: (string | number | boolean | null)[] = [];
   for (const val of def.values) {
     if (val === undefined) {
-      handleUnrepresentable(schema, ctx, "Literal `undefined` cannot be represented in JSON Schema");
+      // a custom schema replaces the whole literal, so there is nothing left to accumulate
+      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
+        return;
+      // otherwise do not add to vals
     } else if (typeof val === "bigint") {
-      handleUnrepresentable(schema, ctx, "BigInt literals cannot be represented in JSON Schema");
+      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
+        return;
       vals.push(Number(val));
     } else {
       vals.push(val);


Used by packages/zod/src/v4/classic/schemas.ts#ZodLiteral (unchanged):
packages/zod/src/v4/classic/schemas.ts:2092
  core.$ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => processors.literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {

Used by packages/zod/src/v4/core/json-schema-processors.ts#allProcessors (unchanged):
packages/zod/src/v4/core/json-schema-processors.ts:563
  date: dateProcessor,
  enum: enumProcessor,
  literal: literalProcessor,
  nan: nanProcessor,
  template_literal: templateLiteralProcessor,
```

[the symbol at head](https://github.com/colinhacks/zod/blob/51e93234d83cbb5915b3d52942ecb01d039f5040/packages/zod/src/v4/core/json-schema-processors.ts#L154-L188) · [the symbol at base](https://github.com/colinhacks/zod/blob/9d20fdc3c37207fa3fe77c9524a3421f4399cbf6/packages/zod/src/v4/core/json-schema-processors.ts#L154-L184)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s13 · Symbiote finding · info · signature-changed

[zod #6536](https://github.com/colinhacks/zod/pull/6536) — feat(v4): make z.properties() a schema, and give z.instanceof() a .properties() method (#6536)

> SupportedSchemaType changed its signature; its only user was updated

```diff
Change to packages/zod/src/v4/core/compile.ts#SupportedSchemaType:
@@ -34,5 +34,6 @@ type SupportedSchemaType =
   | "lazy"
   | "pipe"
   | "custom"
+  | "properties"
   | "transform"
   | "catch";


Used by packages/zod/src/v4/core/compile.ts#generateCheck (modified):
packages/zod/src/v4/core/compile.ts:917
): string | null {
  const def = schema._zod.def;
  const type = def.type as SupportedSchemaType;

  // A coercing schema would compile to the bare type test and reject what it should convert; inside a union that reads as a rejected branch, so refuse at codegen.
```

[the symbol at head](https://github.com/colinhacks/zod/blob/fbbe61757a8a31266ac16376c85b76e878d5a9e6/packages/zod/src/v4/core/compile.ts#L861-L899) · [the symbol at base](https://github.com/colinhacks/zod/blob/bf9902164b5396449540415c2221a24bc9fd0e22/packages/zod/src/v4/core/compile.ts#L828-L865)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s14 · Symbiote finding · warning · signature-changed

[bitwarden #23031](https://github.com/bitwarden/clients/pull/23031) — [PM-43141] Introduce new import source component  (#23031)

> DefaultFeatureFlagValue changed its signature; 4 of 4 users not updated: DefaultFeatureFlagValueType, getFeatureFlagValue, FEATURE_FLAG_CATALOG, StorybookConfigService.valueFor · 1 test user, 1 not updated

```diff
Change to libs/common/src/enums/feature-flag.enum.ts#DefaultFeatureFlagValue:
@@ -21,6 +21,7 @@ export const DefaultFeatureFlagValue = {
   /* Tools */
   [FeatureFlag.SendControls]: FALSE,
   [FeatureFlag.Pm30110SdkSendsApi]: FALSE,
+  [FeatureFlag.ImportUpgrade]: FALSE,
   [FeatureFlag.PM34203TemporaryItemSharing]: FALSE,
 
   /* DIRT */


Used by libs/common/src/enums/feature-flag.enum.ts#DefaultFeatureFlagValueType (unchanged):
libs/common/src/enums/feature-flag.enum.ts:261
} satisfies Record<FeatureFlag, AllowedFeatureFlagTypes>;

export type DefaultFeatureFlagValueType = typeof DefaultFeatureFlagValue;

export type FeatureFlagValueType<Flag extends FeatureFlag> = DefaultFeatureFlagValueType[Flag];

Used by libs/common/src/enums/feature-flag.enum.ts#getFeatureFlagValue (unchanged):
libs/common/src/enums/feature-flag.enum.ts:270
) {
  if (serverConfig?.featureStates == null || serverConfig.featureStates[flag] == null) {
    return DefaultFeatureFlagValue[flag];
  }


Used by libs/storybook/src/addons/feature-flags/config.ts#FEATURE_FLAG_CATALOG (unchanged):
libs/storybook/src/addons/feature-flags/config.ts:63
 */
export const FEATURE_FLAG_CATALOG: FeatureFlagOption[] = Object.entries(FeatureFlag)
  .filter(([, value]) => typeof DefaultFeatureFlagValue[value as FeatureFlag] === "boolean")
  .map(([name, value]) => ({ name, value: value as string }))
  .sort((a, b) => a.name.localeCompare(b.name));

Used by libs/storybook/src/addons/feature-flags/config.ts#StorybookConfigService.valueFor (unchanged):
libs/storybook/src/addons/feature-flags/config.ts:52
    // Cast needed because indexing by a generic `Flag` widens to the union of
    // all flag value types rather than narrowing to `FeatureFlagValueType<Flag>`.
    return DefaultFeatureFlagValue[key] as FeatureFlagValueType<Flag>;
  }
}

Used by libs/common/src/enums/feature-flag.enum.spec.ts#(module) (unchanged):
libs/common/src/enums/feature-flag.enum.spec.ts:9
describe("getFeatureFlagValue", () => {
  const testFlag = Object.values(FeatureFlag)[0];
  const testFlagDefaultValue = DefaultFeatureFlagValue[testFlag];

  it("returns default flag value when serverConfig is null", () => {
```

[the symbol at head](https://github.com/bitwarden/clients/blob/7fe51403f5906908ff81a88f3b3682e2238a46e0/libs/common/src/enums/feature-flag.enum.ts#L146-L259) · [the symbol at base](https://github.com/bitwarden/clients/blob/ab3611ca2a960a17e7cdf07bcac98d24aa50a61a/libs/common/src/enums/feature-flag.enum.ts#L145-L257)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s15 · Symbiote finding · warning · exported-api-changed

[zod #6536](https://github.com/colinhacks/zod/pull/6536) — feat(v4): make z.properties() a schema, and give z.instanceof() a .properties() method (#6536)

> _properties is no longer exported from the package entry

```diff
Change to packages/zod/src/v4/core/api.ts#_properties:
@@ -1,7 +1,12 @@
 export function _properties<Shape extends schemas.$ZodShape>(
-  shape: Shape
-): checks.$ZodCheckProperty<{ -readonly [k in keyof Shape]: util.Widen<core.input<Shape[k]>> }>[] {
-  return Object.entries(shape).map(
-    ([property, schema]) => new checks.$ZodCheckProperty({ check: "property", property, schema })
-  ) as any;
+  Class: util.SchemaClass<schemas.$ZodProperties>,
+  shape: Shape,
+  params?: string | $ZodPropertiesParams
+): schemas.$ZodProperties<Shape> {
+  return new Class({
+    type: "properties",
+    check: "properties",
+    shape,
+    ...util.normalizeParams(params),
+  }) as any;
 }

```

[the symbol at head](https://github.com/colinhacks/zod/blob/fbbe61757a8a31266ac16376c85b76e878d5a9e6/packages/zod/src/v4/core/api.ts#L1133-L1144) · [the symbol at base](https://github.com/colinhacks/zod/blob/bf9902164b5396449540415c2221a24bc9fd0e22/packages/zod/src/v4/core/api.ts#L1131-L1137)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s16 · Symbiote finding · warning · signature-changed

[bitwarden #23031](https://github.com/bitwarden/clients/pull/23031) — [PM-43141] Introduce new import source component  (#23031)

> DesktopLayoutComponent.openImport changed its signature; 1 of 1 user not updated: desktop-layout.component.html · 1 test user

```diff
Change to apps/desktop/src/app/layout/desktop-layout.component.ts#DesktopLayoutComponent.openImport:
@@ -1,3 +1,7 @@
-  protected openImport() {
+  protected async openImport() {
+    if (await this.configService.getFeatureFlag(FeatureFlag.ImportUpgrade)) {
+      await this.router.navigate(["/import"]);
+      return;
+    }
     this.dialogService.open(ImportDesktopComponent);
   }


Used by apps/desktop/src/app/layout/desktop-layout.component.html#(template) (unchanged):
apps/desktop/src/app/layout/desktop-layout.component.html:34

      <bit-nav-item icon="bwi-generate" [text]="'generator' | i18n" (click)="openGenerator()" />
      <bit-nav-item icon="bwi-import" [text]="'importNoun' | i18n" (click)="openImport()" />
      <bit-nav-item icon="bwi-download" [text]="'exportNoun' | i18n" (click)="openExport()" />
    }

Used by apps/desktop/src/app/layout/desktop-layout.component.spec.ts#(module) (unchanged):
apps/desktop/src/app/layout/desktop-layout.component.spec.ts:231
      jest.spyOn(router, "navigate");

      await component["openImport"]();

      expect(dialogService.open).toHaveBeenCalledWith(ImportDesktopComponent);
apps/desktop/src/app/layout/desktop-layout.component.spec.ts:244
      jest.spyOn(router, "navigate").mockResolvedValue(true);

      await component["openImport"]();

      expect(router.navigate).toHaveBeenCalledWith(["/import"]);
```

[the symbol at head](https://github.com/bitwarden/clients/blob/7fe51403f5906908ff81a88f3b3682e2238a46e0/apps/desktop/src/app/layout/desktop-layout.component.ts#L61-L67) · [the symbol at base](https://github.com/bitwarden/clients/blob/ab3611ca2a960a17e7cdf07bcac98d24aa50a61a/apps/desktop/src/app/layout/desktop-layout.component.ts#L60-L62)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s17 · Symbiote finding · info · signature-changed

[zod #6391](https://github.com/colinhacks/zod/pull/6391) — feat(json-schema): run `override` before the unrepresentable error (#6391)

> transformProcessor changed its signature compatibly; existing users keep working (2 users, 2 untouched)

```diff
Change to packages/zod/src/v4/core/json-schema-processors.ts#transformProcessor:
@@ -1,5 +1,3 @@
-export const transformProcessor: Processor<schemas.$ZodTransform> = (_schema, ctx, _json, _params) => {
-  if (ctx.unrepresentable === "throw") {
-    throw new Error("Transforms cannot be represented in JSON Schema");
-  }
+export const transformProcessor: Processor<schemas.$ZodTransform> = (schema, ctx, _json, _params) => {
+  handleUnrepresentable(schema, ctx, "Transforms cannot be represented in JSON Schema");
 };


Used by packages/zod/src/v4/classic/schemas.ts#ZodTransform (unchanged):
packages/zod/src/v4/classic/schemas.ts:2085
    core.$ZodTransform.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => processors.transformProcessor(inst, ctx, json, params);

    inst._zod.parse = (payload, _ctx) => {

Used by packages/zod/src/v4/core/json-schema-processors.ts#allProcessors (unchanged):
packages/zod/src/v4/core/json-schema-processors.ts:566
  custom: customProcessor,
  function: functionProcessor,
  transform: transformProcessor,
  map: mapProcessor,
  set: setProcessor,
```

[the symbol at head](https://github.com/colinhacks/zod/blob/7f6a296cfb02e848d0888af7cee8ed5b5518f170/packages/zod/src/v4/core/json-schema-processors.ts#L234-L236) · [the symbol at base](https://github.com/colinhacks/zod/blob/2715c12e76cf022d7dbdeb5852c09fddfe91a481/packages/zod/src/v4/core/json-schema-processors.ts#L256-L260)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s18 · Symbiote finding · info · orphan-added

[zod #6491](https://github.com/colinhacks/zod/pull/6491) — feat(mini): publish Zod Mini as the standalone @zod/mini package (#6491)

> default is a new default export nothing imports (loaded by convention?)

```diff
Change to packages/mini/vitest.config.ts#default:
@@ -0,0 +1,13 @@
+export default mergeConfig(
+  rootConfig,
+  defineProject({
+    resolve: {
+      conditions: ["@zod/source", "default"],
+    },
+    test: {
+      typecheck: {
+        tsconfig: "./tsconfig.json",
+      },
+    },
+  })
+);

```

[the symbol at head](https://github.com/colinhacks/zod/blob/6e17b6fbd9a57953f36161daa648615590929566/packages/mini/vitest.config.ts#L4-L16)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s19 · Symbiote finding · warning · exported-api-changed

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> VaultBatchBarService.selected is public API and its new signature may break code outside the repo

```diff
Change to libs/vault/src/services/vault-batch-bar.service.ts#VaultBatchBarService.selected:
@@ -1,4 +1,3 @@
-  readonly selected = computed(() => {
-    this.selectionChanged();
-    return this.selection.selected;
-  });
+  readonly selected = computed<readonly VaultItem<C>[]>(
+    () => this.source()?.selected() ?? this.defaultSelection(),
+  );

```

[the symbol at head](https://github.com/bitwarden/clients/blob/1ec98fd26666cca5820728cf4c5c4352d17699d7/libs/vault/src/services/vault-batch-bar.service.ts#L219-L221) · [the symbol at base](https://github.com/bitwarden/clients/blob/26c25d3d4e9463714ffe30d2b6727615ba56dac9/libs/vault/src/services/vault-batch-bar.service.ts#L159-L162)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s20 · Symbiote finding · info · signature-changed

[zod #6391](https://github.com/colinhacks/zod/pull/6391) — feat(json-schema): run `override` before the unrepresentable error (#6391)

> dateProcessor changed its signature compatibly; existing users keep working (2 users, 2 untouched)

```diff
Change to packages/zod/src/v4/core/json-schema-processors.ts#dateProcessor:
@@ -1,5 +1,3 @@
-export const dateProcessor: Processor<schemas.$ZodDate> = (_schema, ctx, _json, _params) => {
-  if (ctx.unrepresentable === "throw") {
-    throw new Error("Date cannot be represented in JSON Schema");
-  }
+export const dateProcessor: Processor<schemas.$ZodDate> = (schema, ctx, _json, _params) => {
+  handleUnrepresentable(schema, ctx, "Date cannot be represented in JSON Schema");
 };


Used by packages/zod/src/v4/classic/schemas.ts#ZodDate (unchanged):
packages/zod/src/v4/classic/schemas.ts:1377
  core.$ZodDate.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => processors.dateProcessor(inst, ctx, json, params);

  inst.min = (value, params) => inst.check(checks.gte(value, params));

Used by packages/zod/src/v4/core/json-schema-processors.ts#allProcessors (unchanged):
packages/zod/src/v4/core/json-schema-processors.ts:557
  any: anyProcessor,
  unknown: unknownProcessor,
  date: dateProcessor,
  enum: enumProcessor,
  literal: literalProcessor,
```

[the symbol at head](https://github.com/colinhacks/zod/blob/7f6a296cfb02e848d0888af7cee8ed5b5518f170/packages/zod/src/v4/core/json-schema-processors.ts#L141-L143) · [the symbol at base](https://github.com/colinhacks/zod/blob/2715c12e76cf022d7dbdeb5852c09fddfe91a481/packages/zod/src/v4/core/json-schema-processors.ts#L148-L152)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s21 · Symbiote finding · info · signature-changed

[zod #6536](https://github.com/colinhacks/zod/pull/6536) — feat(v4): make z.properties() a schema, and give z.instanceof() a .properties() method (#6536)

> _properties changed its signature; all 2 users were updated

```diff
Change to packages/zod/src/v4/core/api.ts#_properties:
@@ -1,7 +1,12 @@
 export function _properties<Shape extends schemas.$ZodShape>(
-  shape: Shape
-): checks.$ZodCheckProperty<{ -readonly [k in keyof Shape]: util.Widen<core.input<Shape[k]>> }>[] {
-  return Object.entries(shape).map(
-    ([property, schema]) => new checks.$ZodCheckProperty({ check: "property", property, schema })
-  ) as any;
+  Class: util.SchemaClass<schemas.$ZodProperties>,
+  shape: Shape,
+  params?: string | $ZodPropertiesParams
+): schemas.$ZodProperties<Shape> {
+  return new Class({
+    type: "properties",
+    check: "properties",
+    shape,
+    ...util.normalizeParams(params),
+  }) as any;
 }


Used by packages/zod/src/v4/classic/schemas.ts#properties (added):
packages/zod/src/v4/classic/schemas.ts:2765
  params?: string | core.$ZodPropertiesParams
): ZodProperties<Shape> {
  return core._properties(ZodProperties, shape, params) as any;
}


Used by packages/zod/src/v4/mini/schemas.ts#properties (added):
packages/zod/src/v4/mini/schemas.ts:1868
  params?: string | core.$ZodPropertiesParams
): ZodMiniProperties<Shape> {
  return core._properties(ZodMiniProperties, shape, params) as any;
}

```

[the symbol at head](https://github.com/colinhacks/zod/blob/fbbe61757a8a31266ac16376c85b76e878d5a9e6/packages/zod/src/v4/core/api.ts#L1133-L1144) · [the symbol at base](https://github.com/colinhacks/zod/blob/bf9902164b5396449540415c2221a24bc9fd0e22/packages/zod/src/v4/core/api.ts#L1131-L1137)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s22 · Symbiote finding · warning · orphan-added

[bitwarden #22535](https://github.com/bitwarden/clients/pull/22535) — [PM-40851] Render the shared folder grid on the desktop vault view (#22535)

> SingleColumnCollapsed is new and nothing references it

```diff
Change to libs/vault/src/components/shared-folder-card-grid/shared-folder-card-grid.component.stories.ts#SingleColumnCollapsed:
@@ -0,0 +1,8 @@
+export const SingleColumnCollapsed: Story = {
+  decorators: [
+    componentWrapperDecorator((story) => `<div class="${NARROWEST_WRAPPER}">${story}</div>`),
+  ],
+  args: {
+    collections: MANY_FOLDERS,
+  },
+};

```

[the symbol at head](https://github.com/bitwarden/clients/blob/265d5c1293c832f433b18998b10e36759f4fe5af/libs/vault/src/components/shared-folder-card-grid/shared-folder-card-grid.component.stories.ts#L191-L198)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s23 · Symbiote finding · warning · orphan-added

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> StoryLayoutFooterComponent.footerPortal is new and nothing references it

```diff
Change to libs/vault/src/components/vault-items-table/vault-items-table.stories.ts#StoryLayoutFooterComponent.footerPortal:
@@ -0,0 +1 @@
+  protected readonly footerPortal = inject(LayoutFooterService).portal;

```

[the symbol at head](https://github.com/bitwarden/clients/blob/1ec98fd26666cca5820728cf4c5c4352d17699d7/libs/vault/src/components/vault-items-table/vault-items-table.stories.ts#L69-L69)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s24 · Symbiote finding · warning · exported-api-changed

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> VaultItemsTableComponent.clearSelection was removed from the package's public API

```diff
Change to libs/vault/src/components/vault-items-table/vault-items-table.component.ts#VaultItemsTableComponent.clearSelection:
@@ -1,3 +0,0 @@
-  clearSelection(): void {
-    this.tableComponent()?.selectionModel()?.clear();
-  }

```

[the symbol at base](https://github.com/bitwarden/clients/blob/26c25d3d4e9463714ffe30d2b6727615ba56dac9/libs/vault/src/components/vault-items-table/vault-items-table.component.ts#L727-L729)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s25 · Symbiote finding · info · signature-changed

[bitwarden #22539](https://github.com/bitwarden/clients/pull/22539) — chore(lock): Move LockService into libs/unlock and add lock/unlock source tracking (#22539)

> DefaultUnlockService.runOnUnlockSideEffects changed its signature; its only user was updated

```diff
Change to libs/unlock/src/default-unlock.service.ts#DefaultUnlockService.runOnUnlockSideEffects:
@@ -1,6 +1,7 @@
   private async runOnUnlockSideEffects(
     userId: UserId,
     client: Ref<PasswordManagerClient>,
+    source: UnlockSource,
   ): Promise<void> {
     const userKey = SymmetricCryptoKey.fromString(
       await client.value.crypto().get_user_encryption_key(),
@@ -14,6 +15,6 @@
     await this.stateProvider.setUserState(USER_EVER_HAD_USER_KEY, true, userId);
 
     for (const action of this.onUnlockActions) {
-      await action(userId, userKey);
+      await action(userId, userKey, source);
     }
   }


Used by libs/unlock/src/default-unlock.service.ts#DefaultUnlockService.unlockWithMethod (modified):
libs/unlock/src/default-unlock.service.ts:232
          });

          await this.runOnUnlockSideEffects(userId, ref, source);
        }),
      ),
```

[the symbol at head](https://github.com/bitwarden/clients/blob/ea11cf7540c0b3595f860ba6f27ae0272bd5e28d/libs/unlock/src/default-unlock.service.ts#L309-L328) · [the symbol at base](https://github.com/bitwarden/clients/blob/3ad4a68c2147eee962fc01248eb41b684d092bda/libs/unlock/src/default-unlock.service.ts#L275-L293)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s26 · Symbiote finding · warning · signature-changed

[bitwarden #22539](https://github.com/bitwarden/clients/pull/22539) — chore(lock): Move LockService into libs/unlock and add lock/unlock source tracking (#22539)

> DefaultLockService.registerOnLockAction changed its signature; 2 of 2 users not updated: DefaultSharedUnlockFollowerService.start, DefaultSharedUnlockLeaderService.start

```diff
Change to libs/unlock/src/lock.service.ts#DefaultLockService.registerOnLockAction:
@@ -1,3 +1,3 @@
-  registerOnLockAction(action: (userId: UserId) => Promise<void>): void {
+  registerOnLockAction(action: (userId: UserId, source: LockSource) => Promise<void>): void {
     this.onLockActions.push(action);
   }


Used by libs/common/src/key-management/shared-unlock/default-shared-unlock-follower.service.ts#DefaultSharedUnlockFollowerService.start (unchanged):
libs/common/src/key-management/shared-unlock/default-shared-unlock-follower.service.ts:57
    await this.follower.start();

    this.lockService.registerOnLockAction(async (userId) => {
      if (!(await this.enabled(userId))) {
        return;

Used by libs/common/src/key-management/shared-unlock/default-shared-unlock-leader.service.ts#DefaultSharedUnlockLeaderService.start (unchanged):
libs/common/src/key-management/shared-unlock/default-shared-unlock-leader.service.ts:56
    this.leader = SharedUnlockLeader.try_new(this.ipcService.client, sharedUnlockDriver);
    await this.leader.start();
    this.lockService.registerOnLockAction(async (userId) => {
      if (!(await this.enabled(userId))) {
        return;
```

[the symbol at head](https://github.com/bitwarden/clients/blob/ea11cf7540c0b3595f860ba6f27ae0272bd5e28d/libs/unlock/src/lock.service.ts#L64-L66) · [the symbol at base](https://github.com/bitwarden/clients/blob/3ad4a68c2147eee962fc01248eb41b684d092bda/libs/auth/src/common/services/accounts/lock.service.ts#L58-L60)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s27 · Symbiote finding · warning · orphan-added

[bitwarden #22523](https://github.com/bitwarden/clients/pull/22523) — [CL-1248] Add FAB button component to vault (#22523)

> Default is new and nothing references it

```diff
Change to libs/vault/src/components/fab/fab.stories.ts#Default:
@@ -0,0 +1,8 @@
+export const Default: Story = {
+  render: (args) => ({
+    props: args,
+    template: /*html*/ `
+      <button type="button" ${formatArgsForCodeSnippet<VaultFabComponent>(args)}></button>
+    `,
+  }),
+};

```

[the symbol at head](https://github.com/bitwarden/clients/blob/ebf711e5d7556603cd189935c2fbffd96db754d6/libs/vault/src/components/fab/fab.stories.ts#L40-L47)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s28 · Review comment · pullfrog[bot]

[zod #6546](https://github.com/colinhacks/zod/pull/6546) — docs: Zod 4.6 announcement post (#6546)

> The exported type is spelled `ZodInstanceOf`, so `ZodInstanceof` names a symbol that does not exist. Please use the correct casing here, or refer to `z.instanceof()` if the constructor name is not intended to be part of the API.

```diff
packages/docs/content/blog/zod-4-6.mdx:35 (commented on f4bafcff93)
+```ts
+const responseLike = z.properties({ status: z.number().min(200).max(299) });
+
+responseLike.parse(new Response("ok", { status: 200 }));  // ✅ a real Response
+responseLike.parse({ status: 204 });                      // ✅ a plain object
+```
+
+A corresponding `.properties()` method has been added to `ZodInstanceof`.
```

Thread:
- pullfrog[bot]: Addressed in a7406aa.

[the comment on GitHub](https://github.com/colinhacks/zod/pull/6546#discussion_r3908837566)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s29 · Review comment · claude[bot]

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> ♻️ **DEBT**: Finding 2: Clearance keys on the selection count rather than on the bar actually being up, so it reserves 53px where no bar mounts.
> 
> 
> Details and fix
> 
> Desktop provides `VaultBatchBarService` unconditionally (`apps/desktop/.../vault-v3/vault.component.ts:181`) but gates `<bit-vault-batch-action />` on `PM37785_VaultBatchBar && PM37785_DesktopVaultBatchBar`. With VFO1 on and the desktop flag off, checking a row here adds 53px of empty space under the table with no bar to fill it.
> 
> The existing hosts key their clearance on bar visibility, not raw count:
> 
> - `apps/web/src/app/vault/components/vault-items/vault-items.component.html:5` — `batchBarService?.barVisible() ? …`
> - `apps/desktop/src/vault/app/vault-v3/vault-list.component.html:19` — `barVisible() ? …`
> 
> Switching to `this.batchBarService?.barVisible()` matches that convention and covers the shared flag. The desktop-only flag still isn't visible to a shared component, so if that combination needs to be exact, an input from the host would be the complete fix.
> 
> 

```diff
libs/vault/src/components/vault-items-table/vault-items-table.component.ts:258 (commented on 2229c0e9bb)
+  });
+
   protected readonly filterNamespace = VAULT_FILTER_NAMESPACE;
   protected readonly filterKeys = VAULT_FILTER_KEYS;
 
+  /** Bottom margin held while the bulk-actions bar is up. */
+  protected readonly bulkBarClearance = computed(() =>
+    (this.batchBarService?.selectedCount() ?? 0) > 0 ? BULK_BAR_CLEARANCE : 0,
```

[the comment on GitHub](https://github.com/bitwarden/clients/pull/22260#discussion_r3961659018)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s30 · Review comment · Copilot

[zod #6546](https://github.com/colinhacks/zod/pull/6546) — docs: Zod 4.6 announcement post (#6546)

> add the missing em dash and fix grammar so this bullet matches the other “at a glance” items
> 
> This issue also appears on line 55 of the same file.

```diff
packages/docs/content/blog/zod-4-6.mdx:22 (commented on d8119b80ce)
+
+At a glance:
+
+- [`z.properties()`](#zproperties) — now a schema that infers, with a `.properties()` method on `z.instanceof()`
+- [`@zod/mini`](#zodmini) — Zod Mini, published as its own package
+- [Faster failures](#faster-failures) — up to 4.7x on the failure path when you only check `success`
+- [Less memory per schema](#less-memory-per-schema) — up to 17% on top of the 9x reduction in Zod 4.5
+- [Recursive schemas built by a factory](#recursive-schemas-built-by-a-factory) no longer crash
```

[the comment on GitHub](https://github.com/colinhacks/zod/pull/6546#discussion_r3907549089)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s31 · Review comment · pullfrog[bot]

[zod #6029](https://github.com/colinhacks/zod/pull/6029) — feat(json-schema): emit a root $ref when the root schema has an id (#6029)

> The surrounding file uses `toMatchInlineSnapshot` almost everywhere — converting just this case to `toEqual` loses the ability to regenerate it via `pnpm vitest run --update`. Suggest keeping the inline snapshot form here so the regeneration story stays uniform across the file. Same applies to the two new tests above at 2206 and 2228, where inline snapshots would match the surrounding style.

```diff
packages/zod/src/v4/classic/tests/to-json-schema.test.ts:2502 (commented on 71a326ab0d)
-        "name",
-        "b",
-      ],
-      "type": "object",
-    }
-  `);
+    },
+  });
```

[the comment on GitHub](https://github.com/colinhacks/zod/pull/6029#discussion_r3300875322)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s32 · Symbiote finding · warning · signature-changed

[zod #6380](https://github.com/colinhacks/zod/pull/6380) — feat(json-schema): accept a function for `unrepresentable` (#6380)

> ToJSONSchemaContext changed its signature; 6 of 10 users not updated: JSONSchemaGenerator.constructor, JSONSchemaGenerator.ctx, _$ZodTypeInternals, Processor, extractDefs and 1 more

```diff
Change to packages/zod/src/v4/core/to-json-schema.ts#ToJSONSchemaContext:
@@ -2,7 +2,8 @@ export interface ToJSONSchemaContext {
   processors: Record<string, Processor>;
   metadataRegistry: $ZodRegistry<Record<string, any>>;
   target: "draft-04" | "draft-07" | "draft-2020-12" | "openapi-3.0" | ({} & string);
-  unrepresentable: "throw" | "any";
+  // must be schemas.$ZodType to prevent recursive type resolution error
+  unrepresentable: "throw" | "any" | UnrepresentableHandler;
   override: (ctx: {
     // must be schemas.$ZodType to prevent recursive type resolution error
     zodSchema: schemas.$ZodType;


Used by packages/zod/src/v4/core/json-schema-generator.ts#JSONSchemaGenerator.constructor (unchanged):
packages/zod/src/v4/core/json-schema-generator.ts:86
  constructor(params?: JSONSchemaGeneratorConstructorParams) {
    // Normalize target for internal context
    let normalizedTarget: ToJSONSchemaContext["target"] = params?.target ?? "draft-2020-12";
    if (normalizedTarget === "draft-4") normalizedTarget = "draft-04";
    if (normalizedTarget === "draft-7") normalizedTarget = "draft-07";

Used by packages/zod/src/v4/core/json-schema-generator.ts#JSONSchemaGenerator.ctx (unchanged):
packages/zod/src/v4/core/json-schema-generator.ts:49
 */
export class JSONSchemaGenerator {
  private ctx: ToJSONSchemaContext;

  /** @deprecated Access via ctx instead */

Used by packages/zod/src/v4/core/schemas.ts#_$ZodTypeInternals (unchanged):
packages/zod/src/v4/core/schemas.ts:158
  /** @internal Subject to change, not a public API. */
  processJSONSchema?:
    | ((ctx: ToJSONSchemaContext, json: JSONSchema.BaseSchema, params: ProcessParams) => void)
    | undefined;


Used by packages/zod/src/v4/core/to-json-schema.ts#Processor (unchanged):
packages/zod/src/v4/core/to-json-schema.ts:21
export type Processor<T extends schemas.$ZodType = schemas.$ZodType> = (
  schema: T,
  ctx: ToJSONSchemaContext,
  json: JSONSchema.BaseSchema,
  params: ProcessParams

Used by packages/zod/src/v4/core/to-json-schema.ts#extractDefs (unchanged):
packages/zod/src/v4/core/to-json-schema.ts:267

export function extractDefs<T extends schemas.$ZodType>(
  ctx: ToJSONSchemaContext,
  schema: T
  // params: EmitParams

Used by packages/zod/src/v4/core/to-json-schema.ts#process (unchanged):
packages/zod/src/v4/core/to-json-schema.ts:190
export function process<T extends schemas.$ZodType>(
  schema: T,
  ctx: ToJSONSchemaContext,
  _params: ProcessParams = { path: [], schemaPath: [] }
): JSONSchema.BaseSchema {
```

[the symbol at head](https://github.com/colinhacks/zod/blob/51e93234d83cbb5915b3d52942ecb01d039f5040/packages/zod/src/v4/core/to-json-schema.ts#L110-L134) · [the symbol at base](https://github.com/colinhacks/zod/blob/9d20fdc3c37207fa3fe77c9524a3421f4399cbf6/packages/zod/src/v4/core/to-json-schema.ts#L98-L121)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s33 · Symbiote finding · warning · signature-changed

[zod #6536](https://github.com/colinhacks/zod/pull/6536) — feat(v4): make z.properties() a schema, and give z.instanceof() a .properties() method (#6536)

> hide changed its signature; 2 of 2 users not updated: ZodType, $ZodType

```diff
Change to packages/zod/src/v4/core/util.ts#hide:
@@ -1,3 +1,3 @@
-export function hide<T>(inst: object, key: string, value: T): T {
+export function hide<T>(inst: object, key: PropertyKey, value: T): T {
   return own(inst, key, value, false);
 }


Used by packages/zod/src/v4/classic/schemas.ts#ZodType (unchanged):
packages/zod/src/v4/classic/schemas.ts:283
    // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
    get "~standard"(): ZodType["~standard"] {
      return util.hide(this, "~standard", {
        ...core.standardProps(this),
        jsonSchema: {

Used by packages/zod/src/v4/core/schemas.ts#$ZodType (unchanged):
packages/zod/src/v4/core/schemas.ts:327
    // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
    get "~standard"(): StandardSchemaV1.Props<any, any> {
      return util.hide(this, "~standard", standardProps(this));
    },
    set "~standard"(value: StandardSchemaV1.Props<any, any>) {
```

[the symbol at head](https://github.com/colinhacks/zod/blob/fbbe61757a8a31266ac16376c85b76e878d5a9e6/packages/zod/src/v4/core/util.ts#L1142-L1144) · [the symbol at base](https://github.com/colinhacks/zod/blob/bf9902164b5396449540415c2221a24bc9fd0e22/packages/zod/src/v4/core/util.ts#L1138-L1140)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s34 · Symbiote finding · warning · exported-api-changed

[zod #6536](https://github.com/colinhacks/zod/pull/6536) — feat(v4): make z.properties() a schema, and give z.instanceof() a .properties() method (#6536)

> _instanceof is public API and its new signature may break code outside the repo

```diff
Change to packages/zod/src/v4/classic/schemas.ts#_instanceof:
@@ -1,11 +1,11 @@
 function _instanceof<T extends typeof util.Class>(
   cls: T,
   params: ZodInstanceOfParams = {}
-): ZodCustom<InstanceType<T>, InstanceType<T>> {
-  const inst = new ZodCustom({
+): ZodInstanceOf<InstanceType<T>> {
+  const inst = new ZodInstanceOf({
     type: "custom",
     check: "custom",
-    fn: (data) => data instanceof cls,
+    fn: (data: unknown) => data instanceof cls,
     abort: true,
     ...(util.normalizeParams(params) as any),
   });

```

[the symbol at head](https://github.com/colinhacks/zod/blob/fbbe61757a8a31266ac16376c85b76e878d5a9e6/packages/zod/src/v4/classic/schemas.ts#L2831-L2856) · [the symbol at base](https://github.com/colinhacks/zod/blob/bf9902164b5396449540415c2221a24bc9fd0e22/packages/zod/src/v4/classic/schemas.ts#L2788-L2813)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:

## s35 · Symbiote finding · warning · orphan-added

[bitwarden #22260](https://github.com/bitwarden/clients/pull/22260) — [PM-40320] feat: Add bulk action support to shared VaultItemsTableComponent (#22260)

> VaultItemsTableComponent.keepSelectionOnRows is new and nothing references it

```diff
Change to libs/vault/src/components/vault-items-table/vault-items-table.component.ts#VaultItemsTableComponent.keepSelectionOnRows:
@@ -0,0 +1,8 @@
+  private readonly keepSelectionOnRows = effect(() => {
+    const rows = this.sortedCiphers();
+    const model = this.tableComponent()?.selectionModel();
+    if (model == null) {
+      return;
+    }
+    untracked(() => this.reconcileSelection(model, rows));
+  });

```

[the symbol at head](https://github.com/bitwarden/clients/blob/1ec98fd26666cca5820728cf4c5c4352d17699d7/libs/vault/src/components/vault-items-table/vault-items-table.component.ts#L784-L791)

- [ ] right and worth reading
- [ ] right but noise
- [ ] wrong

Note:
