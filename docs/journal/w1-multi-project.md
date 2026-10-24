# Journal: W1 — Repositories with several projects

[Index](../JOURNAL.md) · [Plan](../plan/w1-multi-project.md)

## W1 — Repositories with several projects (2026-10-03, branch `milestone/w1-multi-project`)

Reported: "Symbiote does not render any HTML templates in my app" — an Angular 11 app two folders
below a repo root with nothing Angular (or TypeScript) in it, next to a second app. Reproduced
with an Angular 11 fixture moved into a subfolder and an HTML-only change: the `.html` file was
listed as changed, no template analyzed, no warning.

**Learned**
- Three things were decided once, at the root: whether the Angular plugin applies, which Angular
  version (and so which template syntax) the repo uses, and which compiler options every file
  gets. Without a root `tsconfig.json`, nested configs were loaded with defaults, so `@app/…` and
  `baseUrl` imports resolved nowhere — in plain TypeScript too. Merging all projects' `paths`
  cannot work: two apps map `@app/*` to different folders.
- ts-morph's `resolutionHost` gets the importing file, and its resolver is used by both the
  program and the language service: per-file options fix resolution without splitting the
  program. It only offers TypeScript's older callback (no ESM/CJS mode), so Symbiote computes the mode
  itself, and the hook is only installed when a project's aliases differ from the root's.
- Angular keeps its build options in `tsconfig.app.json` (Angular 6–11: `src/tsconfig.app.json`
  with `baseUrl`), a file Symbiote never read. Config choice now follows the build, not the editor.
- Verification found what the plan missed: on a replica (RealWorld at Angular 11 and 21 as two
  apps), 38 template edges went from one app to the other's components — both apps have
  `app-article-preview`, and A2 matches selectors repo-wide. Templates now see the components of
  their own Angular workspace (`angular.json` folder) and of shared code outside every workspace.
- Hand-written expectations of template columns were off by one three times; the tests now carry
  values checked against the template text, not counted in my head.

**Verification**: core and Angular fixtures (red before, green after), CLI hint test (fails on
the old code), full suite 293+ tests; 29 R1 comparisons identical; replica 0 → 13 templates,
0 cross-app edges; Bitwarden (per-project resolution on: its test runner has its own `paths`):
10 commits with every edge, finding and warning identical to `main`, no slowdown.

Merged into main (2026-10-03).
