# Journal: Fix — the Brief tab draws the brief as Markdown

[Index](../JOURNAL.md)

## Fix — the Brief tab draws the brief as Markdown (2026-10-21, branch `fix/brief-markdown`)

Reported while planning V30: "the brief does not know to render the markdown correctly". Since
V24 the server writes a brief as Markdown (`# Fix: <title>`, then `## <part>` per part), and the
person's parts are often Markdown too, but the Brief tab drew it as source in a `<pre>`: `#` and
`##` lines, backticks and list dashes as typed.

**Learned**: the thread already drew agents' reports through `markdown.ts` (marked's lexer, its
tokens as React elements, no HTML string), so the brief takes the same path: headings, lists,
code, links, and HTML as text. The styles were the thread's (`.thread-markdown`); they are now
`.markdown`, for both. Briefs from before V24 (one text) read as paragraphs.

**Verification**: two e2e assertions first, red on `main`'s build (no heading, no paragraph in the
tab): a structured brief's headings, list items, inline code and an HTML tag kept as text; a
pre-V24 brief's two paragraphs. Then 1,054 unit tests, format, lint, typecheck, build, 159 of
159 e2e. Screenshots of the tab at 1440 × 900, dark and light.

Merged into main (2026-10-21), no conflicts (`main` had not moved). `main` verified after the
merge: frozen install, 1,054 unit tests, format, lint, typecheck, build, 159 of 159 e2e.
