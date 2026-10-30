# Goal: a folder report for loc

Give `loc` a report of a folder: how many files and lines each language has, from the command
line. No new dependencies.

1. `scanFolder(root: string): Promise<FileCount[]>`, exported from `src/index.ts`:
   - every file under `root`, recursively; directories named `.git` and `node_modules` are skipped;
     symbolic links are not followed (left out);
   - a file whose first 8,000 bytes hold a NUL byte is binary: left out;
   - each file is `{ path, language, lines, code, comments, blank }`: `path` relative to `root`
     with `/` separators; `language` is `languageOf(path)?.name`, `"Text"` when there is none; the
     counts are `countLines(text, languageOf(path)?.syntax)` of its UTF-8 text;
   - sorted by `path` (plain string order).
2. `summarize(files: FileCount[]): Summary`, exported from `src/index.ts`:
   - `{ languages: LanguageTotal[]; total: Totals }`, where `Totals` is
     `{ files, lines, code, comments, blank }` and `LanguageTotal` is `Totals` plus `language`;
   - one entry per language, sorted by `code` (most first), then by `language` (plain string
     order);
   - `total` sums every file.
3. A command, `node dist/cli.js [folder] [--json]` (after `npm run build`); `folder` defaults to
   the current directory:
   - `--json`: prints `summarize(await scanFolder(folder))` as JSON, two-space indented, with a
     final newline;
   - otherwise a table: a header row, one row per language in the summary's order, and a last row
     `Total`; columns `Language`, `Files`, `Lines`, `Code`, `Comments`, `Blank`; numbers
     right-aligned;
   - exit code 0; a folder that does not exist or is not a directory: a message on stderr that
     starts with `loc: `, exit code 2; an unknown option: the same.
