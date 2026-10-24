# Journal: Angular 11 trial

[Index](../JOURNAL.md)

## Angular 11 trial (2026-10-02)

Ran Symbiote on the Angular RealWorld example app at its Angular 11.2 state (TypeScript 4.1.5, 72 TS
files, dependencies installed with `npm ci --ignore-scripts --legacy-peer-deps` under Node 22):
it loads cleanly, ~3–4.6 s per commit, and its real Angular-11-era commits come out right
(e.g. "Fixed: Tag not saving" → `EditorComponent.submitForm (body)`). Found:
- **Templates are invisible**: a method used only from `(click)` is reported as an orphan; a
  method deleted while its template still calls it is not reported at all.
- **Class families**: `ngOnInit` "used by 11" (every component implements `OnInit`); a user's
  project showed the same for a property overridden from a shared base class. → R1.
- **Decorator metadata**: changing `@NgModule({...})` arguments warns "AppRoutingModule changed
  its signature; 1 of 1 user not updated: AppModule".
- `.symbioteignore` is read from the analyzed head commit, not the working folder, so an uncommitted
  file (or a diff of older commits) ignores it; `interfaces/` matches only at the root, unlike
  `.gitignore`.
