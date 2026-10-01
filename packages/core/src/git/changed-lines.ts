import { git } from './exec.js';
import type { GitRepo } from './repo.js';

/** Lines that differ between two commits, as the forges' diffs show them. */
export interface ChangedLines {
  /** 1-based lines removed from each base file, by base path, ascending. */
  base: Map<string, number[]>;
  /** 1-based lines added to each head file, by head path, ascending. */
  head: Map<string, number[]>;
}

/** Changed lines between two commits (`git diff -U0`, with rename detection). */
export async function listChangedLines(
  repo: GitRepo,
  from: string,
  to: string,
): Promise<ChangedLines> {
  const patch = await git(repo.root, [
    '-c',
    'core.quotePath=false',
    'diff',
    '-U0',
    '-M',
    '--no-color',
    '--no-ext-diff',
    '--no-relative',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    from,
    to,
    '--',
  ]);
  return parseChangedLines(patch);
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses a zero-context unified diff into removed and added line numbers per file. */
export function parseChangedLines(patch: string): ChangedLines {
  const lines: ChangedLines = { base: new Map(), head: new Map() };
  let basePath: string | null = null;
  let headPath: string | null = null;
  // `---`/`+++` are file headers only before a file's first hunk; later they are content.
  let header = false;

  const add = (side: Map<string, number[]>, path: string | null, start: string, count?: string) => {
    if (path === null) return;
    const list = side.get(path) ?? [];
    for (let i = 0; i < (count === undefined ? 1 : Number(count)); i++)
      list.push(Number(start) + i);
    side.set(path, list);
  };

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      basePath = headPath = null;
      header = true;
    } else if (header && line.startsWith('--- ')) {
      basePath = headerPath(line.slice(4), 'a/');
    } else if (header && line.startsWith('+++ ')) {
      headPath = headerPath(line.slice(4), 'b/');
    } else {
      const hunk = HUNK.exec(line);
      if (!hunk) continue;
      header = false;
      add(lines.base, basePath, hunk[1] as string, hunk[2]);
      add(lines.head, headPath, hunk[3] as string, hunk[4]);
    }
  }
  return lines;
}

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` → null; C-quoted names are unquoted. */
function headerPath(raw: string, prefix: string): string | null {
  if (raw === '/dev/null') return null;
  const name = raw.startsWith('"') ? unquote(raw) : raw;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/** Git's C-style quoting: `"a/tab\there"`, octal bytes for anything else unusual. */
function unquote(quoted: string): string {
  const body = quoted.slice(1, quoted.lastIndexOf('"'));
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const code = body.codePointAt(i) as number;
    if (code !== 0x5c) {
      bytes.push(...Buffer.from(String.fromCodePoint(code), 'utf8'));
      if (code > 0xffff) i++; // the second half of a surrogate pair
      continue;
    }
    const next = body[++i] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
