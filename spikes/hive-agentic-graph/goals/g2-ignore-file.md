# Goal: loc skips what a project ignores

`loc` counts every file under a folder. Projects keep files there they don't want counted:
vendored code, fixtures, generated files. Give `loc` an ignore file, then use it in the scan and
the command. No new dependencies.

1. `ignoreMatcher(root: string): Promise<(path: string, isFolder: boolean) => boolean>`, exported
   from `src/index.ts`. It reads `<root>/.locignore` (when there is none, nothing is ignored) and
   answers whether a path is ignored. `path` is relative to `root`, with `/` separators. The
   file's syntax is a subset of `.gitignore`'s:
   - one pattern a line; blank lines and lines that start with `#` are skipped; trailing spaces
     are trimmed;
   - `*` matches any characters but `/`; `?` matches one character but `/`; `**` matches across
     folders: `**/x` (x at any depth), `x/**` (everything inside x), `a/**/b` (b under a, at any
     depth, `a/b` included);
   - a pattern with no `/`, or only a trailing one, matches a name at any depth (`*.log`,
     `build`); a pattern with a `/` at its start or in its middle is relative to `root` (`/dist`,
     `src/gen`);
   - a trailing `/` matches folders only (`out/`);
   - a path is ignored when it, or one of the folders it is in, matches;
   - `!pattern` includes again what an earlier pattern ignored; the last pattern that matches
     wins. As in git, a file cannot be included again when a folder it is in is ignored.
2. `scanFolder(root, options?)` leaves out what `ignoreMatcher(root)` ignores (files, and folders
   with everything in them) unless `options.ignore` is `false`; the `.locignore` file itself is
   counted like any other file. The command does the same, and takes `--no-ignore` to count
   everything.
