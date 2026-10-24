# Journal: Fix — agents' reports drawn as Markdown

[Index](../JOURNAL.md)

## Fix — agents' reports drawn as Markdown (2026-10-18, branch `fix/thread-markdown`)

Asked: "the output of agents is not rendered correctly, i see **Text**..etc..", in the Thread.
V18c showed every message as written (`white-space: pre-wrap`), leaving Markdown for later; the
two reports of this repository's own feature (`chore/update-readme`) held 34 bold spans, 74 code
spans, 46 bullets, 14 numbered items and 8 headings. Now an agent's report is read by `marked`'s
lexer (GitHub's flavour, line breaks kept as written) and its tokens are drawn as React elements
in `src/markdown.ts`: no HTML string is made, so nothing needs sanitizing. HTML in a report shows
as text; links and images become links only to `http(s):` and `mailto:`; task boxes are drawn
read only. `marked` is loaded into its own chunk (46 KB, 13.7 KB gzip) when a thread is first
shown, the report plain text until then; the main bundle grew 3.8 KB. The person's messages and
Symbiote's prompt are shown as written (decision 118).

**Learned**: `marked`'s lexer gives text unescaped (React escapes it once), a task's box as its
own `checkbox` token, and with `breaks` a `br` token per line break. The thread is itself a list,
so a report's top-level bullets came out as circles (the second level's) until set to discs.

**Verification**: tests first — the renderer on agents' constructs (nested and numbered lists,
headings, code, quotes, rules, tables, task lists, HTML as text, unsafe links dropped; red: no
module), an e2e spec (a heading, bold, code, a nested list, HTML as text, a link; your message
with `**` kept), and V18c's panel spec, whose plan is now a numbered list (red on `main`'s build
for both). The two real reports of `chore/update-readme` checked in light and dark at 1440 px:
no `**` left, no page errors.

Merged into main (2026-10-18), after V21: the journal and styles had both grown at the end
(kept whole, V21's first), and the new e2e spec, which answers in the box, runs without
terminals. `main` verified after the merge: 723 unit tests, build, 102 e2e.
