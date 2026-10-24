import { git, GitError, gitInput, loadIgnores, openRepo, SymbioteError } from '@symbiote/core';
import { countLines } from './count.js';
import { kindOf } from './kinds.js';
import { languageOf } from './languages.js';
import type { CodeFile, CodeMap, LineCounts } from './types.js';

/** A blob of the tree read: its path, object and size. */
interface Entry {
  path: string;
  object: string;
  size: number;
}

/** Bytes asked of one `git cat-file --batch`: memory stays bounded however big the commit. */
const BATCH_BYTES = 16 * 1024 * 1024;
/** git's own test for binary content: a NUL in the first 8,000 bytes. */
const BINARY_PROBE = 8000;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Every file of a commit, counted (RM1, decision 322): read from git objects, not the working
 * tree, so a commit always gives the same map. `.symbioteignore` and `.gitattributes` come from
 * the working folder, as for a diff.
 */
export async function scanCodebase(cwd: string, rev = 'HEAD'): Promise<CodeMap> {
  const { root } = await openRepo(cwd);
  const commit = await resolveCommit(root, rev);
  const branch = rev === 'HEAD' ? await currentBranch(root) : undefined;
  return {
    version: 1,
    commit,
    ...(branch ? { branch } : {}),
    files: await readCommit(root, commit),
  };
}

/**
 * The checkout's maps, by commit (RM1): `map()` reads `HEAD`'s commit once and answers from
 * memory until `HEAD` moves; the same commit on the same branch is the same object. The last
 * `keep` commits are kept.
 */
export function codeMaps(cwd: string, keep = 4): { map(): Promise<CodeMap> } {
  const maps = new Map<string, Promise<CodeFile[]>>();
  let last: CodeMap | undefined;
  return {
    async map() {
      const { root } = await openRepo(cwd);
      const commit = await resolveCommit(root, 'HEAD');
      const branch = await currentBranch(root);
      let files = maps.get(commit);
      if (!files) {
        files = readCommit(root, commit);
        maps.set(commit, files);
        files.catch(() => maps.delete(commit));
        for (const old of maps.keys()) if (maps.size > keep) maps.delete(old);
      }
      const read = await files;
      if (last?.commit !== commit || last.branch !== branch || last.files !== read) {
        last = { version: 1, commit, ...(branch ? { branch } : {}), files: read };
      }
      return last;
    },
  };
}

async function resolveCommit(root: string, rev: string): Promise<string> {
  try {
    return (await git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])).trim();
  } catch (error) {
    if (error instanceof GitError) {
      throw new SymbioteError(`no commit to read at ${rev}: commit something first`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function currentBranch(root: string): Promise<string | undefined> {
  try {
    return (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || undefined;
  } catch (error) {
    // A detached HEAD.
    if (error instanceof GitError) return undefined;
    throw error;
  }
}

async function readCommit(root: string, commit: string): Promise<CodeFile[]> {
  const entries = await listBlobs(root, commit);
  const read = new Map<string, { binary: boolean; counts: LineCounts }>();
  const [attributes] = await Promise.all([
    linguistAttributes(
      root,
      entries.map((entry) => entry.path),
    ),
    readBlobs(root, entries, (entry, content) => {
      const binary = content.subarray(0, BINARY_PROBE).includes(0);
      const counts = binary
        ? { lines: 0, code: 0, comments: 0, blank: 0 }
        : countLines(decode(content), languageOf(entry.path)?.syntax);
      read.set(entry.path, { binary, counts });
    }),
  ]);
  const ignored = loadIgnores(root);
  return entries.map((entry) => {
    const { binary, counts } = read.get(entry.path)!;
    const { kind, aside } = kindOf(entry.path, {
      binary,
      generated: attributes.generated.has(entry.path),
      vendored: attributes.vendored.has(entry.path),
      ignored: ignored(entry.path),
    });
    return {
      path: entry.path,
      kind,
      ...(aside ? { aside } : {}),
      language: binary ? 'Binary' : (languageOf(entry.path)?.name ?? 'Text'),
      ...counts,
    };
  });
}

/** The commit's blobs, sorted by path; symlinks and submodules left out. */
async function listBlobs(root: string, commit: string): Promise<Entry[]> {
  // `<mode> <type> <object> <size>\t<path>\0`, the size padded with spaces.
  const out = await git(root, ['ls-tree', '-r', '-z', '-l', '--full-tree', commit]);
  const entries: Entry[] = [];
  for (const record of out.split('\0')) {
    const match = /^(\d+) (\w+) ([0-9a-f]+) +(\d+|-)\t(.*)$/s.exec(record);
    if (!match) continue;
    const [, mode, type, object, size, path] = match;
    if (type !== 'blob' || mode === '120000') continue;
    entries.push({ path: path!, object: object!, size: Number(size) });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Hands each entry its blob's bytes, read by `git cat-file --batch` in batches of about
 * `BATCH_BYTES`: only one batch is in memory at a time, however big the commit.
 */
async function readBlobs(
  root: string,
  entries: readonly Entry[],
  onBlob: (entry: Entry, content: Buffer) => void,
): Promise<void> {
  // Files with the same content share one object, asked once.
  const byObject = new Map<string, Entry[]>();
  for (const entry of entries) {
    const same = byObject.get(entry.object);
    if (same) same.push(entry);
    else byObject.set(entry.object, [entry]);
  }
  let batch: string[] = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const out = await gitInput(root, ['cat-file', '--batch'], batch.join('\n') + '\n');
    // `<object> blob <size>\n<content>\n` each.
    let at = 0;
    while (at < out.length) {
      const newline = out.indexOf(10, at);
      const [object, , size] = out.subarray(at, newline).toString('latin1').split(' ');
      const end = newline + 1 + Number(size);
      const content = out.subarray(newline + 1, end);
      for (const entry of byObject.get(object!) ?? []) onBlob(entry, content);
      at = end + 1;
    }
    batch = [];
    bytes = 0;
  };
  for (const [object, [first]] of byObject) {
    if (bytes > 0 && bytes + first!.size > BATCH_BYTES) await flush();
    batch.push(object);
    bytes += first!.size;
  }
  await flush();
}

/** The paths `.gitattributes` marks `linguist-generated` or `linguist-vendored`. */
async function linguistAttributes(
  root: string,
  paths: readonly string[],
): Promise<{ generated: Set<string>; vendored: Set<string> }> {
  const generated = new Set<string>();
  const vendored = new Set<string>();
  if (paths.length === 0) return { generated, vendored };
  const out = await gitInput(
    root,
    ['check-attr', '-z', '--stdin', 'linguist-generated', 'linguist-vendored'],
    paths.join('\0') + '\0',
  );
  // `<path>\0<attribute>\0<value>\0` each; a value is `set`, `unset`, `unspecified` or its text.
  const fields = out.toString('utf8').split('\0');
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [path, attribute, value] = [fields[i]!, fields[i + 1], fields[i + 2]];
    if (value !== 'set' && value !== 'true') continue;
    (attribute === 'linguist-generated' ? generated : vendored).add(path);
  }
  return { generated, vendored };
}

/** A blob's text: UTF-8, else Latin-1, whose newlines are the same bytes. */
function decode(content: Buffer): string {
  try {
    return utf8.decode(content);
  } catch {
    return content.toString('latin1');
  }
}
