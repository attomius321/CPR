// A file's history and blame on Git's page (decision 643): its commits across renames, and each
// line's commit, at a commit or in the checkout.
import { git } from './exec.js';
import type { GitRepo } from './repo.js';

/** One of a file's commits (`GET /api/git/file/history`), newest first. */
export interface FileCommit {
  sha: string;
  subject: string;
  author: string;
  /** Its author's date (ISO 8601). */
  date: string;
  /** The file's path in this commit: renames followed. */
  path: string;
}

/** Commits listed at most: a file changed more often shows its newest. */
const HISTORY_LIMIT = 500;

/**
 * The commits that changed `path` from `from` down (`git log --follow`), newest first, each
 * with the file's path then.
 */
export async function fileHistory(
  repo: GitRepo,
  path: string,
  from: string,
): Promise<FileCommit[]> {
  const out = await git(repo.root, [
    '-c',
    'core.quotePath=false',
    'log',
    '--follow',
    '-M',
    '-z',
    `--max-count=${HISTORY_LIMIT}`,
    '--format=%x1e%H%x1f%an%x1f%aI%x1f%s',
    '--name-only',
    from,
    '--',
    path,
  ]);
  return out
    .split('\x1e')
    .filter((record) => record !== '')
    .map((record) => {
      const [head = '', names = ''] = record.split('\0');
      const [sha = '', author = '', date = '', subject = ''] = head.split('\x1f');
      return { sha, author, date, subject, path: names.replace(/^\n/, '') || path };
    });
}

/** A line's commit in a blame; `sha` null for a line the checkout has not committed. */
export interface BlameLine {
  text: string;
  sha: string | null;
}

/** A commit a blame names, once. */
export interface BlameCommit {
  author: string;
  date: string;
  subject: string;
  /** The file's path in that commit, when it differs from the one blamed. */
  path?: string;
}

/** `GET /api/git/file/blame`: each line, and the commits they name. */
export interface FileBlame {
  lines: BlameLine[];
  commits: Record<string, BlameCommit>;
}

const ZERO = /^0+$/;

/** An author's time and zone (`1793129355`, `+0200`) as an ISO 8601 date in that zone. */
function isoDate(seconds: number, zone: string): string {
  const sign = zone.startsWith('-') ? -1 : 1;
  const minutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  const local = new Date((seconds + minutes * 60) * 1000).toISOString().slice(0, 19);
  return `${local}${zone.slice(0, 3)}:${zone.slice(3, 5)}`;
}

/** Reads `git blame --porcelain`: a header per line, a commit's fields the first time it comes. */
export function parseBlame(out: string, path: string): FileBlame {
  const lines: BlameLine[] = [];
  const commits: Record<string, BlameCommit> = {};
  const fields = new Map<string, Map<string, string>>();
  let sha = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      lines.push({ text: line.slice(1).replace(/\r$/, ''), sha: ZERO.test(sha) ? null : sha });
      continue;
    }
    const header = /^([0-9a-f]{40,64}) \d+ \d+/.exec(line);
    if (header) {
      sha = header[1] ?? '';
      if (!fields.has(sha)) fields.set(sha, new Map());
      continue;
    }
    const space = line.indexOf(' ');
    if (space > 0) fields.get(sha)?.set(line.slice(0, space), line.slice(space + 1));
  }
  for (const [at, own] of fields) {
    if (ZERO.test(at)) continue;
    const file = own.get('filename');
    commits[at] = {
      author: own.get('author') ?? '',
      date: isoDate(Number(own.get('author-time') ?? 0), own.get('author-tz') ?? '+0000'),
      subject: own.get('summary') ?? '',
      ...(file && file !== path ? { path: file } : {}),
    };
  }
  return { lines, commits };
}

/** Each line of `path` and its commit: at commit `at`, or in the checkout (`null`). */
export async function blameFile(
  repo: GitRepo,
  path: string,
  at: string | null,
): Promise<FileBlame> {
  const out = await git(repo.root, [
    '-c',
    'core.quotePath=false',
    'blame',
    '--porcelain',
    ...(at ? [at] : []),
    '--',
    path,
  ]);
  return parseBlame(out, path);
}
